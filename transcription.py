"""YIN pitch estimation and conservative monophonic note segmentation.

This is a pitch sketch, not beat-quantized sheet music or chord recognition.
The detector supports sounding pitches C2–E6 (with a little tuning tolerance).
"""
import numpy as np

NAMES = ('C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B')
RATE = 22050
FRAME = 2048
HOP = 220


def estimate_pitch(frame, sample_rate=RATE):
    """Return frequency and YIN periodicity; reject unpitched frames."""
    frame = frame - np.mean(frame)
    # Fixed-length comparison windows avoid lag-dependent energy bias.
    size = len(frame) // 2
    max_lag = int(sample_rate / 60)
    min_lag = max(2, int(sample_rate / 1400))
    reference = frame[:size]
    fft_size = 1 << (len(frame) + size - 2).bit_length()
    convolution = np.fft.irfft(np.fft.rfft(frame, fft_size) * np.fft.rfft(reference[::-1], fft_size), fft_size)
    corr = convolution[size - 1:size + max_lag]
    cumulative = np.concatenate(([0.0], np.cumsum(frame * frame)))
    shifted_energy = cumulative[size:size + max_lag + 1] - cumulative[:max_lag + 1]
    difference = np.maximum(np.sum(reference * reference) + shifted_energy - 2 * corr, 0)
    normalized = np.ones(max_lag + 1)
    normalized[1:] = difference[1:] * np.arange(1, max_lag + 1) / np.maximum(np.cumsum(difference[1:]), 1e-15)
    candidates = np.flatnonzero(normalized[min_lag:max_lag] < 0.15)
    if not len(candidates):
        return 0.0, 0.0
    lag = int(candidates[0] + min_lag)
    while lag + 1 < max_lag and normalized[lag + 1] < normalized[lag]:
        lag += 1
    confidence = 1 - float(normalized[lag])
    left, center, right = normalized[lag - 1:lag + 2]
    denominator = left - 2 * center + right
    shift = 0.5 * (left - right) / denominator if abs(denominator) > 1e-12 else 0
    frequency = sample_rate / (lag + float(np.clip(shift, -0.5, 0.5)))
    return frequency, confidence


def transcribe(samples, sample_rate):
    duration = len(samples) / sample_rate
    peak = float(np.max(np.abs(samples))) if len(samples) else 0.0
    clipped = float(np.mean(np.abs(samples) >= 0.99)) > 0.005
    frame_size = 2 * round(FRAME * sample_rate / RATE / 2)
    hop = round(HOP * sample_rate / RATE)
    # Center windows on each timestamp, including short notes at either boundary.
    padded = np.pad(samples, (frame_size // 2, frame_size // 2))
    frames = [padded[i:i + frame_size] for i in range(0, len(samples), hop)]
    energy = np.array([np.sqrt(np.mean(frame * frame)) for frame in frames])
    gate = max(0.004, float(np.max(energy)) * 0.07) if len(energy) else 0.004
    pitches, frequencies, confidence = [], [], []
    for frame, rms in zip(frames, energy):
        hz, certainty = estimate_pitch(frame, sample_rate) if rms >= gate else (0, 0)
        midi = int(round(69 + 12 * np.log2(hz / 440))) if hz else 0
        pitches.append(midi if 36 <= midi <= 88 else 0)
        frequencies.append(hz)
        confidence.append(certainty)
    pitches = np.array(pitches)
    # Fill tiny dropouts only when surrounded by the same stable pitch.
    for i in range(1, len(pitches) - 2):
        if pitches[i] == 0 and pitches[i - 1] > 0:
            for width in (1, 2):
                if np.all(pitches[i:i + width] == 0) and pitches[i + width] == pitches[i - 1]:
                    pitches[i:i + width] = pitches[i - 1]
                    break
    boundaries = [0] + (np.flatnonzero(np.diff(pitches)) + 1).tolist() + [len(pitches)]
    notes = []
    for start, end in zip(boundaries, boundaries[1:]):
        midi = int(pitches[start]) if start < len(pitches) else 0
        length = (end - start) * hop / sample_rate
        if not midi or length < 0.09:
            continue
        hz = [f for f in frequencies[start:end] if f > 0]
        frequency = float(np.median(hz))
        onset = start * hop / sample_rate
        finish = min(duration, end * hop / sample_rate)
        notes.append({
            'midi': midi, 'name': NAMES[midi % 12], 'octave': midi // 12 - 1,
            'label': f'{NAMES[midi % 12]}{midi // 12 - 1}',
            'frequency': round(frequency, 1), 'start': round(onset, 3),
            'duration': round(finish - onset, 3),
            'confidence': round(float(np.mean(confidence[start:end])), 3),
            'cents': round(1200 * np.log2(frequency / (440 * 2 ** ((midi - 69) / 12)))),
        })
    message = 'Play one note at a time and let each note ring clearly.'
    if not notes:
        message = 'No clear notes found. Move closer to the microphone and pick one string at a time.'
    elif clipped:
        message = 'The input was a little loud. Move farther from the microphone for a cleaner take.'
    elif peak < 0.03:
        message = 'The input was quiet. Move closer to the microphone for a clearer take.'
    return {'notes': notes, 'duration': round(duration, 3), 'message': message, 'clipped': clipped}
