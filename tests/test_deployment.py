import os
import unittest
from unittest.mock import patch

from app import app
from test_coaching import payload


class PublicDeploymentTests(unittest.TestCase):
    def test_health_check(self):
        self.assertEqual(app.test_client().get('/healthz').json, {'status': 'ok'})

    def test_public_coaching_fails_closed_without_code(self):
        with patch.dict(os.environ, {'APP_PUBLIC': 'true', 'COACH_ACCESS_CODE': ''}), patch('app.OpenAICoach') as provider:
            self.assertEqual(app.test_client().post('/api/coaching', json=payload()).status_code, 503)
            provider.assert_not_called()

    def test_only_matching_code_reaches_provider(self):
        with patch.dict(os.environ, {'APP_PUBLIC': 'true', 'COACH_ACCESS_CODE': 'test-access-code'}), patch('app.OpenAICoach') as provider:
            client = app.test_client()
            page = client.get('/').get_data(as_text=True)
            self.assertIn('id="coaching-access-code"', page)
            self.assertNotIn('test-access-code', page)
            for value in ['', 'wrong', 'test-access-code-extra', 'é']:
                response = client.post('/api/coaching', json=payload(), headers={'X-Coaching-Code': value})
                self.assertEqual(response.status_code, 401)
            provider.assert_not_called()
            provider.return_value.generate.return_value = {'advice': 'Good work.', 'model': 'test'}
            self.assertEqual(client.post('/api/coaching', json=payload(), headers={'X-Coaching-Code': 'test-access-code'}).status_code, 200)
            provider.return_value.generate.assert_called_once()

    def test_recording_and_reference_ui_stay_public(self):
        with patch.dict(os.environ, {'APP_PUBLIC': 'true'}):
            client = app.test_client()
            self.assertEqual(client.get('/').status_code, 200)
            self.assertEqual(client.get('/static/references/catalog.json').status_code, 200)
            self.assertEqual(client.post('/api/transcribe').status_code, 400)
