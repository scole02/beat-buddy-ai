import unittest

import numpy as np

from transcription import transcribe


def tone(midi, duration=0.5, rate=22050, amplitude=0.25):
    t = np.arange(int(duration * rate)) / rate
    frequency = 440 * 2 ** ((midi - 69) / 12)
    envelope = np.minimum(1, t / 0.008) * np.minimum(1, (duration - t) / 0.02)
    return amplitude * envelope * (np.sin(2 * np.pi * frequency * t)
                                  + 0.4 * np.sin(4 * np.pi * frequency * t)
                                  + 0.15 * np.sin(6 * np.pi * frequency * t))


class TranscriptionTests(unittest.TestCase):
    def test_guitar_range_and_browser_sample_rates(self):
        for rate in (8000, 22050, 44100, 48000, 96000):
            for midi in (28, 36, 38, 40, 45, 50, 55, 59, 64, 69, 76, 88):
                with self.subTest(rate=rate, midi=midi):
                    result = transcribe(tone(midi, rate=rate), rate)
                    self.assertEqual([n['midi'] for n in result['notes']], [midi])
                    # At 8 kHz, E6 has only six samples per cycle; pitch labels
                    # remain reliable while frequency interpolation is coarser.
                    self.assertLess(abs(result['notes'][0]['cents']), 25)

    def test_silence_and_noise_do_not_become_notes(self):
        rng = np.random.default_rng(23)
        for audio in (np.zeros(22050), rng.normal(0, .02, 22050)):
            with self.subTest(kind=float(np.max(audio))):
                self.assertEqual(transcribe(audio, 22050)['notes'], [])

    def test_order_repeated_notes_and_timing(self):
        expected = [64, 67, 69, 69, 60, 40]
        audio = np.concatenate([np.concatenate([tone(m), np.zeros(3307)]) for m in expected])
        result = transcribe(audio, 22050)
        self.assertEqual([n['midi'] for n in result['notes']], expected)
        for i, note in enumerate(result['notes']):
            self.assertLess(abs(note['start'] - i * .65), .07)
            self.assertGreater(note['duration'], .35)
            self.assertLess(note['duration'], .6)
            self.assertLessEqual(note['start'] + note['duration'], result['duration'] + .002)

    def test_contiguous_pitch_changes(self):
        expected = [40, 45, 50, 55, 59, 64]
        result = transcribe(np.concatenate([tone(m) for m in expected]), 22050)
        self.assertEqual([n['midi'] for n in result['notes']], expected)

    def test_small_noise_preserves_melody(self):
        audio = tone(57, duration=1)
        audio += np.random.default_rng(9).normal(0, .01, len(audio))
        self.assertEqual([n['midi'] for n in transcribe(audio, 22050)['notes']], [57])

    def test_e_minor_scale_from_e1(self):
        expected = [28, 30, 31, 33, 35, 36, 38, 40]
        for rate in (22050, 48000):
            for gap in (0, .12):
                with self.subTest(rate=rate, gap=gap):
                    audio = np.concatenate([np.concatenate([tone(m, rate=rate),
                        np.zeros(round(rate * gap))]) for m in expected])
                    notes = transcribe(audio, rate)['notes']
                    self.assertEqual([n['midi'] for n in notes], expected)
                    self.assertEqual([n['label'] for n in notes[:2]], ['E1', 'F#1'])

    def test_clipping_warning(self):
        audio = np.clip(tone(64, amplitude=1.5), -1, 1)
        self.assertTrue(transcribe(audio, 22050)['clipped'])


if __name__ == '__main__':
    unittest.main()
