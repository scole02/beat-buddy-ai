import io
import unittest
import wave

import numpy as np

from app import app
from test_transcription import tone


def wav_bytes(audio, rate=22050, channels=1, width=2):
    output = io.BytesIO()
    with wave.open(output, 'wb') as wav:
        wav.setnchannels(channels)
        wav.setsampwidth(width)
        wav.setframerate(rate)
        wav.writeframes((np.clip(audio, -1, 1) * 32767).astype('<i2').tobytes())
    output.seek(0)
    return output


class AppTests(unittest.TestCase):
    def setUp(self):
        self.client = app.test_client()

    def upload(self, audio):
        response = self.client.post('/api/transcribe', data={'audio': (audio, 'take.wav')})
        # Werkzeug spills large multipart test bodies into temporary files.
        response.request.environ['wsgi.input'].close()
        self.addCleanup(response.close)
        return response

    def test_home_and_assets(self):
        for path in ('/', '/static/app.js', '/static/style.css', '/static/recorder-worklet.js'):
            response = self.client.get(path)
            self.assertEqual(response.status_code, 200)
            response.close()

    def test_recording_to_notes(self):
        response = self.upload(wav_bytes(tone(64)))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json['notes'][0]['label'], 'E4')

    def test_silent_audio_is_valid_but_empty(self):
        response = self.upload(wav_bytes(np.zeros(22050)))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json['notes'], [])

    def test_missing_and_malformed_audio(self):
        self.assertEqual(self.client.post('/api/transcribe').status_code, 400)
        self.assertEqual(self.upload(io.BytesIO(b'not a wave')).status_code, 400)

    def test_audio_constraints(self):
        for data in (wav_bytes(tone(64), channels=2), wav_bytes(tone(64), width=1),
                     wav_bytes(np.zeros(100)), wav_bytes(np.zeros(22050 * 61)),
                     wav_bytes(np.zeros(22050), rate=1000)):
            with self.subTest(data=data):
                response = self.upload(data)
                self.assertEqual(response.status_code, 400)
                self.assertIn('error', response.json)

    def test_truncated_wave(self):
        original = wav_bytes(tone(64)).read()
        response = self.upload(io.BytesIO(original[:500]))
        self.assertEqual(response.status_code, 400)

    def test_request_size_limit(self):
        response = self.upload(io.BytesIO(b'0' * (13 * 1024 * 1024)))
        self.assertEqual(response.status_code, 413)
        self.assertIn('error', response.json)


if __name__ == '__main__':
    unittest.main()
