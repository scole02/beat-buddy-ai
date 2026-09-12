"""Estimate written durations from measured note lengths at an explicit tempo.

Onsets and measured durations remain untouched for playback alignment. This is
not tempo inference or complete measure/rest engraving.
"""
import math

VALUES = (
    (4.0, 'whole', False), (3.0, 'half', True), (2.0, 'half', False),
    (1.5, 'quarter', True), (1.0, 'quarter', False),
    (0.75, 'eighth', True), (0.5, 'eighth', False), (0.25, 'sixteenth', False),
)


def assign_note_values(result, tempo, numerator=4, denominator=4, tolerance=0):
    if not math.isfinite(tempo) or not 40 <= tempo <= 240 or int(tempo) != tempo:
        raise ValueError('Tempo must be a whole number between 40 and 240 BPM.')
    if not isinstance(numerator, int) or not 1 <= numerator <= 12 or denominator not in (2, 4, 8, 16):
        raise ValueError('Time signature requires 1–12 beats and a beat note of 2, 4, 8, or 16.')
    if not math.isfinite(tolerance) or not 0 <= tolerance <= 25:
        raise ValueError('Timing tolerance must be between 0 and 25 percent.')
    result['timing_tolerance'] = tolerance
    result['time_signature'] = {'numerator': numerator, 'denominator': denominator}
    measure_quarters = numerator * 4 / denominator
    result['tempo'] = int(tempo)
    seconds_per_beat = 60 / tempo * denominator / 4
    for note in result['notes']:
        # Quarter-note beat; round to the nearest sixteenth-note duration.
        beats = max(0.25, math.floor(note['duration'] / seconds_per_beat * 4 + .5) / 4)
        candidates = [value for value in (0.25, 0.5, 1, 2, 4)
                      if abs(note['duration'] / seconds_per_beat - value) / value <= tolerance / 100 + 1e-9]
        if candidates:
            beats = min(candidates, key=lambda value: abs(note['duration'] / seconds_per_beat - value) / value)
        note['duration_beats'] = beats  # Quarter-note units for symbol values.
        note['duration_pulses'] = beats * denominator / 4
        start_quarters = math.floor(note['start'] / seconds_per_beat * 4 + .5) / 4
        note['notation_start'] = start_quarters * seconds_per_beat
        note['start_beat'] = round(note['start'] / (60 / tempo), 3)
        parts = []
        remaining = beats
        offset = 0.0
        while remaining > 0:
            room = measure_quarters - ((start_quarters + offset) % measure_quarters)
            for length, value, dotted in VALUES:
                if length <= min(remaining, room):
                    parts.append({'beats': length, 'value': value, 'dotted': dotted, 'offset_beats': offset})
                    offset += length
                    remaining -= length
                    break
        note['notation'] = parts
    return result
