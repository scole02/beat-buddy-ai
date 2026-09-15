"""Import a bounded single-part, single-voice MusicXML reference into our practice timeline."""
import math
import uuid
from defusedxml import ElementTree as ET

def import_reference(raw):
    if not raw or len(raw) > 1024 * 1024:
        raise ValueError('Choose an uncompressed .musicxml or .xml file under 1 MB.')
    try:
        root = ET.fromstring(raw)
        for element in root.iter(): element.tag = element.tag.split('}')[-1]
        if root.tag != 'score-partwise' or len(root.findall('part')) != 1:
            raise ValueError('Upload a partwise MusicXML score containing exactly one melody part.')
        if len(list(root.iter())) > 20000:
            raise ValueError('This score is too large.')
        for tag in ['chord','backup','forward','grace','time-modification','repeat','ending','transpose','unpitched']:
            if root.find('.//'+tag) is not None:
                raise ValueError('Use a single melody without chords, multiple voices, repeats, transposition, grace notes or tuplets. Expand repeats before uploading.')
        notes=[];position=0.;divisions=1.;meter=None;key=None;pending=None
        for measure in root.findall('part/measure'):
            if measure.get('implicit') == 'yes':
                raise ValueError('Pickup measures are not supported yet. Add leading rests to fill the first measure.')
            attr=measure.find('attributes')
            if attr is not None:
                divisions=float(attr.findtext('divisions',str(divisions)))
                if not math.isfinite(divisions) or divisions<=0: raise ValueError('Invalid divisions.')
                if int(attr.findtext('staves','1')) != 1: raise ValueError('Use one staff.')
                time=attr.find('time')
                if time is not None:
                    new=(int(time.findtext('beats')),int(time.findtext('beat-type')))
                    if meter and new!=meter: raise ValueError('Use one time signature throughout the piece.')
                    meter=new
                fifths=attr.findtext('key/fifths')
                if fifths is not None:
                    new=int(fifths)
                    if key is not None and key!=new: raise ValueError('Key changes are not supported yet.')
                    key=new
            meter=meter or (4,4)
            if not 1<=meter[0]<=12 or meter[1] not in (2,4,8,16) or not -7<=(key or 0)<=7:
                raise ValueError('Unsupported time or key signature.')
            start=position
            for node in measure.findall('note'):
                if node.findtext('voice','1')!='1' or node.findtext('staff','1')!='1':
                    raise ValueError('Use a single voice on staff 1.')
                duration=float(node.findtext('duration'))/divisions
                if not math.isfinite(duration) or duration<=0 or abs(duration*4-round(duration*4))>1e-7:
                    raise ValueError('Use note/rest durations on a sixteenth-note grid.')
                pitch=node.find('pitch')
                if pitch is None:
                    if node.find('rest') is None or pending: raise ValueError('Invalid rest or broken tie.')
                else:
                    step=pitch.findtext('step');alter=float(pitch.findtext('alter','0'));octave=int(pitch.findtext('octave'))
                    if alter not in (-2,-1,0,1,2): raise ValueError('Microtonal pitches are not supported.')
                    midi=12*(octave+1)+{'C':0,'D':2,'E':4,'F':5,'G':7,'A':9,'B':11}[step]+int(alter)
                    if not 24<=midi<=88: raise ValueError('Use pitches between C1 and E6.')
                    ties={t.get('type') for t in node.findall('tie')}
                    if 'stop' in ties:
                        if pending is None or notes[pending]['midi']!=midi: raise ValueError('Broken tie.')
                        notes[pending]['quarterDuration']+=duration
                    else:
                        if pending is not None: raise ValueError('Broken tie.')
                        notes.append({'midi':midi,'quarterStart':position,'quarterDuration':duration})
                    pending=(len(notes)-1) if 'start' in ties else None
                position+=duration
            bar=meter[0]*4/meter[1]
            # Normalize overfull bars in the supplied scale format; pad incomplete bars.
            padded=start+max(1,math.ceil((position-start)/bar-1e-8))*bar
            if pending is not None and padded>position+1e-8: raise ValueError('A tie crosses missing time; fill the measure.')
            position=padded
            if position>960 or len(notes)>1000: raise ValueError('Choose a shorter practice excerpt.')
        if not notes or pending is not None: raise ValueError('The piece needs notes and complete ties.')
        return {'id':'upload-'+uuid.uuid4().hex,'title':(root.findtext('work/work-title') or root.findtext('movement-title') or 'Uploaded melody')[:160],
            'numerator':meter[0],'denominator':meter[1],'quarters':position,'key_fifths':key or 0,'notes':notes}
    except ValueError: raise
    except Exception as exc:
        raise ValueError('Could not read this MusicXML. Use an uncompressed, single-melody .musicxml or .xml file.') from exc
