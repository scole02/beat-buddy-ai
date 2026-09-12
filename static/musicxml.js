// Pure conversion: the exported score and alphaTab always use the same timeline.
(function (root) {
  const values = [[16,'whole',false], [12,'half',true], [8,'half',false],
    [6,'quarter',true], [4,'quarter',false], [3,'eighth',true], [2,'eighth',false], [1,'16th',false]];
  function exportMusicXml(result, clef = 'bass') {
    const meter = result.time_signature || {numerator: 4, denominator: 4};
    const bpm = result.tempo || 100;
    // Use an equivalent quarter-note metronome mark as well as sound tempo.
    // alphaTab 1.8.4 imports non-quarter metronome units inversely; using the
    // canonical quarter BPM avoids conflicting tempo automations on import.
    const quarterBpm = bpm * 4 / meter.denominator;
    const tickSeconds = 60 / quarterBpm / 4;
    const barTicks = meter.numerator * 16 / meter.denominator;
    // A monophonic voice cannot contain simultaneous attacks. Keep the strongest
    // detection if multiple attacks quantize to the same sixteenth-note position.
    const byStart = new Map();
    for (const note of result.notes) {
      const start = Math.max(0, Math.round((note.notation_start ?? note.start) / tickSeconds));
      const duration = Math.max(1, Math.round((note.duration_beats ?? note.duration / (tickSeconds * 4)) * 4));
      const previous = byStart.get(start);
      if (!previous || (note.confidence || 0) > (previous.note.confidence || 0)) byStart.set(start, {start, duration, note});
    }
    const events = [...byStart.values()].sort((a,b) => a.start - b.start);
    for (let i = 0; i < events.length - 1; i++) events[i].duration = Math.min(events[i].duration, events[i+1].start - events[i].start);
    const end = Math.max(Math.ceil(result.duration / tickSeconds - 1e-8), ...events.map(n => n.start + n.duration), 1);
    const barCount = Math.ceil(end / barTicks);
    const bars = Array.from({length: barCount}, () => []);
    function writeSpan(start, length, midi) {
      let remaining = length, offset = 0;
      while (remaining > 0) {
        const room = barTicks - (start + offset) % barTicks;
        const [ticks, type, dotted] = values.find(([v]) => v <= Math.min(room, remaining));
        const rest = midi === undefined;
        const tieStop = !rest && offset > 0, tieStart = !rest && remaining > ticks;
        const pitch = rest ? '<rest/>' : (() => {
          const names = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
          const name = names[midi % 12];
          return `<pitch><step>${name[0]}</step>${name.length > 1 ? '<alter>1</alter>' : ''}<octave>${Math.floor(midi / 12)-1}</octave></pitch>`;
        })();
        bars[Math.floor((start + offset) / barTicks)].push(`<note>${pitch}<duration>${ticks}</duration>${tieStop ? '<tie type="stop"/>' : ''}${tieStart ? '<tie type="start"/>' : ''}<voice>1</voice><type>${type}</type>${dotted ? '<dot/>' : ''}${tieStart || tieStop ? `<notations>${tieStop ? '<tied type="stop"/>' : ''}${tieStart ? '<tied type="start"/>' : ''}</notations>` : ''}</note>`);
        offset += ticks; remaining -= ticks;
      }
    }
    let cursor = 0;
    for (const event of events) {
      if (event.start > cursor) writeSpan(cursor, event.start - cursor);
      writeSpan(event.start, event.duration, event.note.midi);
      cursor = event.start + event.duration;
    }
    if (cursor < barCount * barTicks) writeSpan(cursor, barCount * barTicks - cursor);
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<score-partwise version="4.0"><work><work-title>Your melody</work-title></work><part-list><score-part id="P1"><part-name>Instrument</part-name><score-instrument id="I1"><instrument-name>Instrument</instrument-name></score-instrument><midi-instrument id="I1"><midi-channel>1</midi-channel><midi-program>1</midi-program></midi-instrument></score-part></part-list><part id="P1">${bars.map((notes, i) => `<measure number="${i+1}">${i && i % 3 === 0 ? '<print new-system="yes"/>' : ''}${i === 0 ? `<attributes><divisions>4</divisions><key><fifths>0</fifths></key><time><beats>${meter.numerator}</beats><beat-type>${meter.denominator}</beat-type></time><clef><sign>${clef === 'bass' ? 'F' : 'G'}</sign><line>${clef === 'bass' ? 4 : 2}</line></clef></attributes><direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${quarterBpm}</per-minute></metronome></direction-type><sound tempo="${quarterBpm}"/></direction>` : ''}${notes.join('')}</measure>`).join('')}</part></score-partwise>`;
    return {xml, barCount, barSeconds: meter.numerator * 60 / bpm};
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = {exportMusicXml};
  else root.MusicScore = {exportMusicXml};
})(globalThis);
