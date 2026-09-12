"""Local guitar transcription app. Audio is processed in memory, never saved."""
import io
import math
import wave

import numpy as np
from flask import Flask, jsonify, render_template, request
from werkzeug.exceptions import RequestEntityTooLarge

from transcription import transcribe
from rhythm import assign_note_values

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 13 * 1024 * 1024


@app.get('/')
def index():
    return render_template('index.html')


@app.post('/api/transcribe')
def analyze():
    upload = request.files.get('audio')
    if upload is None:
        return jsonify(error='Please include a WAV recording.'), 400
    try:
        tempo = request.form.get('tempo')
        tolerance = float(request.form.get('timing_tolerance', '0'))
        try:
            numerator = int(request.form.get('meter_numerator', '4'))
            denominator = int(request.form.get('meter_denominator', '4'))
        except ValueError:
            raise ValueError('Invalid time signature.')
        if tempo is not None:
            try:
                tempo = float(tempo)
            except ValueError:
                raise ValueError('Tempo must be a whole number between 40 and 240 BPM.')
            assign_note_values({'notes': []}, tempo, numerator, denominator, tolerance)
        with wave.open(io.BytesIO(upload.read()), 'rb') as wav:
            rate = wav.getframerate()
            count = wav.getnframes()
            channels = wav.getnchannels()
            if wav.getsampwidth() != 2 or channels != 1 or wav.getcomptype() != 'NONE':
                raise ValueError('Use a mono, 16-bit PCM WAV recording.')
            if not 8000 <= rate <= 96000:
                raise ValueError('The recording sample rate must be between 8 and 96 kHz.')
            if not 0.15 <= count / rate <= 60.1:
                raise ValueError('Record between 0.15 and 60 seconds of audio.')
            raw = wav.readframes(count)
            if len(raw) != count * 2:
                raise ValueError('The audio file is incomplete. Please record again.')
        samples = np.frombuffer(raw, dtype='<i2').astype(np.float64) / 32768
        result = transcribe(samples, rate)
        if tempo is not None:
            assign_note_values(result, tempo, numerator, denominator, tolerance)
        return jsonify(result)
    except (wave.Error, EOFError):
        return jsonify(error='This is not a valid WAV recording. Please record again.'), 400
    except ValueError as exc:
        return jsonify(error=str(exc)), 400



@app.post('/api/rhythm')
def update_rhythm():
    data = request.get_json(silent=True)
    try:
        if not isinstance(data, dict):
            raise ValueError('Expected rhythm settings and note timings.')
        source = data.get('notes')
        if not isinstance(source, list) or len(source) > 1000:
            raise ValueError('Invalid note timings.')
        notes = []
        for note in source:
            start, duration = float(note['start']), float(note['duration'])
            if not all(math.isfinite(v) for v in (start, duration)) or not 0 <= start <= 60.1 or not 0 < duration <= 60.1 or start + duration > 60.2:
                raise ValueError('Invalid note timings.')
            notes.append({'start': start, 'duration': duration})
        result = assign_note_values({'notes': notes}, float(data['tempo']),
            data.get('numerator', 4), data.get('denominator', 4), float(data.get('tolerance', 0)))
        return jsonify(result)
    except (ValueError, TypeError, KeyError, OverflowError):
        return jsonify(error='Invalid note timings, time signature, or tolerance (0–15%).'), 400

@app.errorhandler(RequestEntityTooLarge)
def too_large(_error):
    return jsonify(error='This recording is too large. Please keep takes under 60 seconds.'), 413


if __name__ == '__main__':
    app.run(host='127.0.0.1', port=5000, debug=False)
