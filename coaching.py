"""Provider boundary for coaching. Credentials are server-only environment settings."""
import json
import os
from pathlib import Path
from openai import OpenAI, OpenAIError
from pydantic import BaseModel, Field, ConfigDict
from defusedxml import ElementTree as ET

ROOT = Path(__file__).parent

class Event(BaseModel):
    model_config = ConfigDict(extra='ignore', allow_inf_nan=False)
    midi: int = Field(ge=0, le=127)
    start: float = Field(ge=0, le=60.2)
    duration: float = Field(gt=0, le=60.2)
    confidence: float | None = Field(default=None, ge=0, le=1)

class Take(BaseModel):
    model_config = ConfigDict(extra='ignore', allow_inf_nan=False)
    title: str = Field(default='', max_length=200)
    tempo: float = Field(ge=40, le=240)
    duration: float = Field(gt=0, le=60.2)
    notes: list[Event] = Field(max_length=1000)

class CoachingRequest(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)
    reference_xml: str = Field(min_length=1, max_length=180000)
    recording_xml: str = Field(min_length=1, max_length=180000)
    reference: Take
    performance: Take
    comparison: dict
    meter: dict
    timing_allowance_ms: float = Field(ge=20, le=300)
    notation_tolerance_percent: float = Field(ge=0, le=25)

def prepare_request(data):
    try:
        parsed = CoachingRequest.model_validate(data)
        for xml in (parsed.reference_xml, parsed.recording_xml):
            root = ET.fromstring(xml)
            if root.tag.split('}')[-1] != 'score-partwise':
                raise ValueError()
        payload = parsed.model_dump()
        # Also rejects non-finite numbers and bounds nested comparison/metadata.
        if len(json.dumps(payload, allow_nan=False).encode()) > 450000:
            raise ValueError()
        catalog = json.loads((ROOT / 'static/references/catalog.json').read_text())
        payload['available_pieces'] = [p['title'] for p in catalog]
        return payload
    except Exception as exc:
        raise ValueError('Provide two valid MusicXML scores and finite practice timings (up to 60 seconds).') from exc

class CoachingError(Exception):
    pass

class OpenAICoach:
    """Replace this adapter for providers with a different API contract."""
    def generate(self, payload):
        key = os.getenv('OPENAI_API_KEY', '').strip()
        model = os.getenv('OPENAI_MODEL', '').strip()
        if not key or not model:
            raise CoachingError('AI coaching needs OPENAI_API_KEY and OPENAI_MODEL in the server .env file. Restart the server after configuring them.')
        mode = os.getenv('COACH_API_MODE', 'responses')
        if mode not in ('responses', 'chat_completions'):
            raise CoachingError('COACH_API_MODE must be responses or chat_completions.')
        prompt = (ROOT / 'prompts/coaching_system.txt').read_text(encoding='utf-8')
        try:
            with OpenAI(api_key=key, base_url=os.getenv('OPENAI_BASE_URL') or None, timeout=60, max_retries=0) as client:
                if mode == 'responses':
                    response = client.responses.create(model=model, instructions=prompt,
                        input=json.dumps(payload, ensure_ascii=False, allow_nan=False), store=False, max_output_tokens=2500)
                    if response.status != 'completed':
                        raise CoachingError('The model did not finish its coaching response. Try again or choose another model.')
                    text = response.output_text
                else:
                    response = client.chat.completions.create(model=model, messages=[
                        {'role':'system','content':prompt},
                        {'role':'user','content':json.dumps(payload, ensure_ascii=False, allow_nan=False)}], max_tokens=2500)
                    if not response.choices or response.choices[0].finish_reason != 'stop':
                        raise CoachingError('The model did not finish its coaching response. Try another model.')
                    text = response.choices[0].message.content
            if not text or not text.strip():
                raise CoachingError('The model returned no coaching advice. Try again.')
            return {'advice':text.strip(), 'model':model}
        except OpenAIError as exc:
            # Never send provider exception bodies, request headers or credentials to the browser.
            code = getattr(exc, 'status_code', None)
            if code in (401,403): message = 'The AI provider rejected the credentials or model access. Check the server configuration.'
            elif code == 429: message = 'The AI provider is rate-limited or out of quota. Check billing or try later.'
            else: message = 'The AI provider could not complete the request. Check the model/base URL settings or try again later.'
            raise CoachingError(message) from exc
