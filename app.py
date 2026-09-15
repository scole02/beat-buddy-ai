"""Local guitar transcription app. Audio is processed in memory, never saved."""
import io
import os
import hmac
import math
import wave
import threading
from pathlib import Path
from dotenv import load_dotenv

import numpy as np
from flask import Flask, jsonify, render_template, request
from werkzeug.exceptions import RequestEntityTooLarge

from transcription import transcribe
from rhythm import assign_note_values
from reference_import import import_reference
from coaching import OpenAICoach, CoachingError, prepare_request

load_dotenv(Path(__file__).parent / ".env")
coach_slots = threading.BoundedSemaphore(2)

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 13 * 1024 * 1024


@app.get('/')
def index():
    return render_template('index.html', coaching_protected=coaching_requires_code())


def coaching_requires_code():
    return os.getenv('APP_PUBLIC', '').lower() == 'true' or bool(os.getenv('COACH_ACCESS_CODE'))


@app.get('/healthz')
def health():
    return jsonify(status='ok')


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
        return jsonify(error='Invalid note timings, time signature, or tolerance (0–25%).'), 400

@app.post('/api/references/import')
def upload_reference():
    upload = request.files.get('file')
    if upload is None:
        return jsonify(error='Choose a MusicXML file.'), 400
    if not (upload.filename or '').lower().endswith(('.musicxml', '.xml')):
        return jsonify(error='Use uncompressed .musicxml or .xml; .mxl is not supported yet.'), 400
    try:
        return jsonify(import_reference(upload.read(1024 * 1024 + 1)))
    except ValueError as exc:
        return jsonify(error=str(exc)), 400


@app.post('/api/coaching')
def get_coaching():
    if coaching_requires_code():
        code = os.getenv('COACH_ACCESS_CODE', '')
        if not code:
            return jsonify(error='AI coaching is not configured for this public demo yet.'), 503
        supplied = request.headers.get('X-Coaching-Code', '')
        if not hmac.compare_digest(supplied.encode(), code.encode()):
            return jsonify(error='Enter the coaching access code provided by your teacher.'), 401
    if request.content_length and request.content_length > 450000:
        return jsonify(error='This coaching request is too large.'), 413
    try:
        payload = prepare_request(request.get_json(silent=True))
    except ValueError as exc:
        return jsonify(error=str(exc)), 400
    if not coach_slots.acquire(blocking=False):
        return jsonify(error='Coaching is busy. Please try again shortly.'), 429
    try:
        return jsonify(OpenAICoach().generate(payload))
    except CoachingError as exc:
        return jsonify(error=str(exc)), 503
    finally:
        coach_slots.release()


@app.errorhandler(RequestEntityTooLarge)
def too_large(_error):
    return jsonify(error='This recording is too large. Please keep takes under 60 seconds.'), 413


if __name__ == '__main__':
    app.run(host='127.0.0.1', port=5000, debug=False)
