import io
import unittest

from app import app
from rhythm import assign_note_values
from test_app import wav_bytes
from test_transcription import tone


class RhythmTests(unittest.TestCase):
    def test_values_at_different_tempos(self):
        for bpm in (40, 100, 120, 240):
            for beats, value, dotted in ((.25, 'sixteenth', False), (.5, 'eighth', False),
                    (.75, 'eighth', True), (1, 'quarter', False), (1.5, 'quarter', True),
                    (2, 'half', False), (3, 'half', True), (4, 'whole', False)):
                with self.subTest(bpm=bpm, beats=beats):
                    note = {'duration': beats * 60 / bpm, 'start': 0}
                    result = assign_note_values({'notes': [note]}, bpm)
                    self.assertEqual(note['duration_beats'], beats)
                    self.assertEqual(note['notation'][0]['value'], value)
                    self.assertEqual(note['notation'][0]['dotted'], dotted)
                    self.assertEqual(note['start'], 0)
                    self.assertEqual(note['duration'], beats * 60 / bpm)
                    self.assertEqual(result['tempo'], bpm)

    def test_long_notes_have_tied_parts(self):
        note = {'duration': 5, 'start': 0}
        assign_note_values({'notes': [note]}, 120)
        self.assertEqual([p['value'] for p in note['notation']], ['whole', 'whole', 'half'])
        self.assertEqual([p['offset_beats'] for p in note['notation']], [0, 4, 8])

    def test_duration_tolerance(self):
        note = {'duration': .48, 'start': .02}
        assign_note_values({'notes': [note]}, 120)
        self.assertEqual(note['notation'][0]['value'], 'quarter')

    def test_eighth_note_beat_and_bar_splitting(self):
        note = {'duration': .5, 'start': 0}
        result = assign_note_values({'notes': [note]}, 120, 6, 8)
        self.assertEqual(note['notation'][0]['value'], 'eighth')
        self.assertEqual(note['duration_pulses'], 1)
        self.assertEqual(result['time_signature'], {'numerator': 6, 'denominator': 8})
        long_note = {'duration': 4, 'start': 2.5}
        assign_note_values({'notes': [long_note]}, 120, 3, 4)
        start = long_note['notation_start'] / .5
        for part in long_note['notation']:
            self.assertLessEqual((start + part['offset_beats']) % 3 + part['beats'], 3)
        self.assertEqual(sum(p['beats'] for p in long_note['notation']), 8)

    def test_tolerance_favors_undotted_values(self):
        for duration in (.51, .52, .68, .69):
            result = assign_note_values({'notes':[{'start':0,'duration':duration}]}, 100, tolerance=15)
            self.assertEqual(result['notes'][0]['notation'][0]['value'], 'quarter')
            self.assertFalse(result['notes'][0]['notation'][0]['dotted'])
            self.assertEqual(result['notes'][0]['duration'], duration)
        strict = assign_note_values({'notes':[{'start':0,'duration':.52}]}, 100, tolerance=0)
        self.assertEqual(strict['notes'][0]['notation'][0]['value'], 'eighth')
        self.assertTrue(strict['notes'][0]['notation'][0]['dotted'])
        outside = assign_note_values({'notes':[{'start':0,'duration':.6901}]}, 100, tolerance=15)
        self.assertNotEqual(outside['notes'][0]['duration_beats'], 1)

    def test_tolerance_api(self):
        with app.test_client() as client:
            data = {'notes':[{'start':0,'duration':.52}], 'tempo':100, 'tolerance':25}
            response = client.post('/api/rhythm', json=data)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json['notes'][0]['duration_beats'], 1)
            for tolerance in (-1,26,'bad'):
                self.assertEqual(client.post('/api/rhythm',json={**data,'tolerance':tolerance}).status_code,400)
            self.assertEqual(client.post('/api/rhythm',json={**data,'notes':[{'start':0,'duration':-1}]}).status_code,400)

    def test_invalid_meters(self):
        for numerator, denominator in [(0,4), (13,4), (4,3), (2.5,4)]:
            with self.assertRaises(ValueError):
                assign_note_values({'notes': []}, 100, numerator, denominator)

    def test_invalid_tempos(self):
        for bpm in (0, 39, 241, 120.5, float('nan'), float('inf')):
            with self.subTest(bpm=bpm), self.assertRaises(ValueError):
                assign_note_values({'notes': []}, bpm)

    def test_api_records_tempo_and_note_value(self):
        with app.test_client() as client:
            response = client.post('/api/transcribe', data={
                'audio': (wav_bytes(tone(48, duration=.5, rate=48000), rate=48000), 'take.wav'),
                'tempo': '120',
            })
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json['tempo'], 120)
            self.assertEqual(response.json['notes'][0]['notation'][0]['value'], 'quarter')
            response.close()

    def test_api_rejects_bad_tempo(self):
        with app.test_client() as client:
            for bpm in ('', 'garbage', 'nan', 'inf', '0', '241', '80.5'):
                response = client.post('/api/transcribe', data={
                    'audio': (wav_bytes(tone(48)), 'take.wav'), 'tempo': bpm,
                })
                self.assertEqual(response.status_code, 400)
                self.assertIn('Tempo', response.json['error'])
                response.close()
