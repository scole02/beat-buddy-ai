import copy
import io
import os
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch, MagicMock
from openai import OpenAIError
from app import app
from coaching import OpenAICoach, CoachingError, prepare_request

XML = Path('static/references/c-major-ionian.musicxml').read_text()
def payload():
    take = {'tempo':100,'duration':4.8,'notes':[{'midi':60,'start':0,'duration':.6}]}
    return {'reference_xml':XML,'recording_xml':XML,'reference':take,'performance':take,
        'comparison':{'rows':[{'expected':0,'actual':0,'status':'correct'}]},'meter':{'numerator':4,'denominator':4},
        'timing_allowance_ms':100,'notation_tolerance_percent':0}

class CoachingTests(unittest.TestCase):
    def setUp(self): self.client=app.test_client()
    def test_request_only_on_post_and_provider_response(self):
        with patch('app.OpenAICoach') as provider:
            provider.return_value.generate.return_value={'advice':'Practice slowly.','model':'test'}
            self.assertEqual(self.client.get('/api/coaching').status_code,405)
            provider.return_value.generate.assert_not_called()
            response=self.client.post('/api/coaching',json=payload())
            self.assertEqual(response.status_code,200)
            self.assertEqual(response.json['advice'],'Practice slowly.')
            sent=provider.return_value.generate.call_args.args[0]
            self.assertEqual(sent['reference_xml'],XML)
            self.assertIn('C Major · Ionian',sent['available_pieces'])
    def test_invalid_input_never_calls_provider(self):
        for body in [None,{},dict(payload(),reference_xml='<broken'),dict(payload(),audio='private'),dict(payload(),timing_allowance_ms=float('nan'))]:
            with patch('app.OpenAICoach') as provider:
                self.assertEqual(self.client.post('/api/coaching',json=body).status_code,400)
                provider.assert_not_called()
    def test_entities_rejected(self):
        body=payload();body['reference_xml']='<!DOCTYPE x [<!ENTITY a SYSTEM "file:///etc/passwd">]><score-partwise>&a;</score-partwise>'
        self.assertEqual(self.client.post('/api/coaching',json=body).status_code,400)
    def test_missing_configuration_is_actionable(self):
        with patch.dict(os.environ,{},clear=True):
            response=self.client.post('/api/coaching',json=payload())
        self.assertEqual(response.status_code,503)
        self.assertIn('OPENAI_MODEL',response.json['error'])
    def test_adapter_configuration_prompt_and_no_storage(self):
        with patch.dict(os.environ,{'OPENAI_API_KEY':'test-secret','OPENAI_MODEL':'chosen-model','COACH_API_MODE':'responses','OPENAI_BASE_URL':'https://example.test/v1'},clear=True), patch('coaching.OpenAI') as factory:
            client=factory.return_value.__enter__.return_value
            client.responses.create.return_value=SimpleNamespace(status='completed',output_text='Good steady attacks.')
            self.assertEqual(OpenAICoach().generate(prepare_request(payload()))['advice'],'Good steady attacks.')
            self.assertEqual(factory.call_args.kwargs['base_url'],'https://example.test/v1')
            args=client.responses.create.call_args.kwargs
            self.assertEqual(args['model'],'chosen-model');self.assertFalse(args['store'])
            self.assertEqual(args['instructions'],Path('prompts/coaching_system.txt').read_text())
            self.assertIn('reference_xml',args['input'])
    def test_safe_provider_errors_and_incomplete(self):
        with patch.dict(os.environ,{'OPENAI_API_KEY':'test-secret','OPENAI_MODEL':'test'},clear=True), patch('coaching.OpenAI') as factory:
            client=factory.return_value.__enter__.return_value
            client.responses.create.side_effect=OpenAIError('private provider body test-secret')
            response=self.client.post('/api/coaching',json=payload())
            self.assertEqual(response.status_code,503)
            self.assertNotIn('test-secret',response.get_data(as_text=True))
            client.responses.create.side_effect=None
            client.responses.create.return_value=SimpleNamespace(status='incomplete',output_text='partial')
            with self.assertRaises(CoachingError):OpenAICoach().generate(payload())
    def test_compatible_chat_adapter(self):
        with patch.dict(os.environ,{'OPENAI_API_KEY':'test','OPENAI_MODEL':'alternate','COACH_API_MODE':'chat_completions'},clear=True), patch('coaching.OpenAI') as factory:
            client=factory.return_value.__enter__.return_value
            client.chat.completions.create.return_value=SimpleNamespace(choices=[SimpleNamespace(finish_reason='stop',message=SimpleNamespace(content='Advice'))])
            self.assertEqual(OpenAICoach().generate(payload())['advice'],'Advice')
            client.responses.create.assert_not_called()
