import io
import unittest
from pathlib import Path
from app import app
from reference_import import import_reference

BASE='<score-partwise><part id="P1"><measure number="1"><attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>{}</measure></part></score-partwise>'
NOTE='<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration>{}</note>'
class ReferenceImportTests(unittest.TestCase):
    def test_catalog_files_normalize_overfull_bars(self):
        for file in Path('static/references').glob('*.musicxml'):
            piece=import_reference(file.read_bytes())
            self.assertEqual(piece['quarters'],8)
            self.assertEqual(len(piece['notes']),8)
    def test_rest_padding_and_ties(self):
        xml=BASE.format('<note><rest/><duration>4</duration></note>'+NOTE.format('<tie type="start"/>')+NOTE.format('<tie type="stop"/>'))
        piece=import_reference(xml.encode())
        self.assertEqual(piece['quarters'],4)
        self.assertEqual(piece['notes'],[{'midi':60,'quarterStart':1,'quarterDuration':2}])
    def test_unsupported_scores_fail(self):
        for fragment in ['<chord/>','<voice>2</voice>','<time-modification/>','<grace/>','<tie type="stop"/>']:
            with self.assertRaises(ValueError):import_reference(BASE.format(NOTE.format(fragment)).encode())
        for xml in ['bad xml','<!DOCTYPE x [<!ENTITY a SYSTEM "file:///etc/passwd">]><score-partwise>&a;</score-partwise>',BASE.format('')]:
            with self.assertRaises(ValueError):import_reference(xml.encode())
    def test_upload_route_and_size(self):
        client=app.test_client()
        response=client.post('/api/references/import',data={'file':(io.BytesIO(BASE.format(NOTE.format('')).encode()),'piece.musicxml')})
        self.assertEqual(response.status_code,200);self.assertEqual(response.json['quarters'],4)
        self.assertEqual(client.post('/api/references/import',data={'file':(io.BytesIO(b'a'),'piece.mxl')}).status_code,400)
        self.assertEqual(client.post('/api/references/import',data={'file':(io.BytesIO(b'a'*(1024*1024+1)),'piece.xml')}).status_code,400)
