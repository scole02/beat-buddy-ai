// This first catalog is fixed. Original supplied MusicXML files are kept alongside it.
window.PracticeUI = (() => {
  let catalog = [], ready = false;
  function selected(tempo) {
    const piece = catalog.find(piece => piece.id === $('reference-piece').value);
    if (!piece) return null;
    const allowanceMs = Number($('practice-timing').value);
    if (!Number.isFinite(allowanceMs) || allowanceMs < 20 || allowanceMs > 300) throw new Error('Choose an attack timing allowance between 20 and 300 ms.');
    const reference=Practice.referenceAt(piece,tempo,Number($('reference-octave').value));
    if (reference.duration>60 || reference.duration<.15) throw new Error('Choose a faster tempo or upload a shorter excerpt: reference recordings must fit within 60 seconds.');
    if (reference.notes.some(note=>note.midi<24 || note.midi>88)) throw new Error('This octave puts notes outside C1–E6. Choose another octave.');
    return {reference,allowanceMs};
  }
  function lock(locked) {
    ['reference-piece','reference-octave','practice-timing','upload-reference'].forEach(id=>$(id).disabled=locked || !ready);
    if ($('reference-piece').value) ['meter-numerator','meter-denominator'].forEach(id=>$(id).disabled=true);
  }
  function preview(practice) {
    window.CoachingUI?.clear();
    $('audio-playback').pause();
    $('playback').hidden=true;
    if (!scoreView) scoreView = new AlphaScoreView($('staff'), $('audio-playback'), message=>status(message,true));
    scoreView.liveClock = () => ({currentTime:mode==='recording'&&context ? Math.min(practice.reference.duration,Math.max(0,context.currentTime-recordingStartTime)) : 0,
      duration:practice.reference.duration, playbackRate:1, volume:1, paused:mode!=='recording', ended:false, seeking:false, readyState:4});
    $('score-result').hidden=false; $('score-empty').hidden=true;
    $('practice-feedback').hidden=true; $('note-list').replaceChildren();
    $('score-subtitle').textContent=`${practice.reference.title} · ${practice.reference.tempo} BPM · ${practice.reference.duration.toFixed(2)} seconds`;
    $('score-footer-text').textContent='Follow the reference. Recording starts after four count-in beats and stops at the final barline.';
    $('note-count').textContent='REFERENCE'; $('rhythm-caption').textContent='Reference notes · pitch includes the selected octave';
    scoreView.render(practice.reference,selectedClef);
    $('download-musicxml').hidden=true;
  }
  function selectionChanged() {
    if (mode!=='idle') return;
    window.CoachingUI?.clear();
    try {
      const practice=selected(readTempo());
      updateMetronomeControls(); lock(false);
      if (!practice) {
        $('reference-hint').textContent='Free recording: stop whenever you are ready.';
        if (scoreView) scoreView.liveClock=null;
        if (latestScore) renderResult(latestScore.result,latestScore.demo);
        else {$('score-result').hidden=true;$('score-empty').hidden=false;}
        return;
      }
      const ref=practice.reference;
      $('meter-numerator').value=ref.time_signature.numerator;
      $('meter-denominator').value=ref.time_signature.denominator;
      $('reference-hint').textContent=`${ref.notes.length} notes · ${Math.ceil(ref.duration / (ref.time_signature.numerator*60/ref.tempo))} bars of ${ref.time_signature.numerator}/${ref.time_signature.denominator} · ${ref.duration.toFixed(2)}s at ${ref.tempo} BPM. Match the written pitch and octave. Red: wrong/missed. Amber: early/late. Purple: extra. Green: matched.`;
      preview(practice);
    } catch(error) {status(error.message,true);}
  }
  function feedback(result) {
    const target=$('practice-feedback');target.replaceChildren();target.hidden=!result.practice;
    if (!result.practice) return;
    const {reference,allowanceMs}=result.practice, report=Practice.compare(reference,result,allowanceMs);
    const counts={correct:0,wrong:0,missed:0,extra:0,timing:0};
    report.rows.forEach(row=>{counts[row.status]++; if(row.status==='wrong'&&row.timing)counts.timing++;});
    const summary=document.createElement('p');
    summary.textContent=`${reference.title} — ${counts.correct}/${reference.notes.length} matched · ${counts.wrong} wrong pitch · ${counts.missed} missed · ${counts.extra} extra · ${counts.timing} early/late. Attack allowance: ±${allowanceMs} ms.`;
    target.append(summary);
    const legend=document.createElement('p');legend.textContent='Reference above; you played below. Green = matched, red = wrong/missed, amber = timing, purple = extra. Timing uses measured attacks; device latency can shift all attacks together.';target.append(legend);
    const list=document.createElement('ul');
    report.rows.forEach(row=>{
      const item=document.createElement('li');item.style.color=Practice.colors[row.status];
      const expected=row.expected===undefined?null:reference.notes[row.expected];
      const actual=row.actual===undefined?null:result.notes[row.actual];
      const position=expected ? `Note ${row.expected+1}: ${expected.label}` : `Extra ${Practice.label(actual.midi)} at ${actual.start.toFixed(2)}s`;
      item.textContent=position+(row.status==='missed'?' — missed':row.status==='extra'?'':` — played ${Practice.label(actual.midi)}; ${row.wrong?'wrong pitch; ':''}${row.timing?`${Math.abs(row.delta)} ms ${row.delta<0?'early':'late'}`:'on time'}`);
      list.append(item);
    });target.append(list);
    $('score-subtitle').textContent=`${reference.title} · Reference / You played · ${reference.tempo} BPM`;
  }
  fetch('/static/references/catalog.json').then(r=>{if(!r.ok)throw new Error('Reference catalog unavailable');return r.json();}).then(pieces=>{
    catalog=pieces;ready=true;
    for(const piece of pieces)$('reference-piece').add(new Option(piece.title,piece.id));
    $('reference-hint').textContent='Choose a scale, octave and practice tempo. Recording stops automatically after the two-bar scale.';
    lock(mode!=='idle');
  }).catch(error=>{$('reference-hint').textContent=error.message;});
  ['reference-piece','reference-octave','tempo'].forEach(id=>$(id).addEventListener('change',selectionChanged));
  ['bass-clef','treble-clef'].forEach(id=>$(id).addEventListener('click',()=>{if(scoreView?.liveClock)selectionChanged();}));
  $('upload-reference').addEventListener('click',()=>$('reference-file').click());
  $('reference-file').addEventListener('change',async()=>{
    const file=$('reference-file').files[0]; $('reference-file').value='';
    if (!file || mode!=='idle') return;
    if (file.size>1024*1024) {$('upload-status').textContent='Use a MusicXML file under 1 MB.';return;}
    $('upload-reference').disabled=true;$('upload-status').textContent='Reading score…';
    try {
      const body=new FormData();body.append('file',file);
      const response=await fetch('/api/references/import',{method:'POST',body});
      const piece=await response.json();if(!response.ok)throw new Error(piece.error);
      // Store only in this page's catalog; never overwrite a take started meanwhile.
      catalog.push(piece);$('reference-piece').add(new Option(piece.title+' (uploaded)',piece.id));
      if(mode==='idle') {$('reference-piece').value=piece.id;$('reference-octave').value='0';selectionChanged();}
      $('upload-status').textContent='Added for this session. Re-upload after refreshing.';
    } catch(error) {$('upload-status').textContent=error.message||'Upload failed. Please try again.';}
    finally {lock(mode!=='idle');}
  });
  return {selected,lock,preview,feedback};
})();
