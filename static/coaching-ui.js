window.CoachingUI = (()=>{
  let current=null, request=null, revision=0;
  function clear() {
    revision++;request?.abort();request=null;current=null;
    $('coaching-panel').hidden=true;$('get-coaching').disabled=false;
    $('coaching-status').textContent='';$('coaching-advice').textContent='';
  }
  function setResult(result) {
    clear();
    if(!result.practice)return;
    current=result;$('coaching-panel').hidden=false;
  }
  $('get-coaching').addEventListener('click',async()=>{
    if(!current || request || mode!=='idle')return;
    const take=current, version=revision, reference=take.practice.reference;
    const controller=request=new AbortController();
    const deadline=setTimeout(()=>controller.abort(),70000);
    $('get-coaching').disabled=true;$('coaching-status').textContent='Preparing your coaching advice…';
    $('coaching-advice').textContent='';
    try {
      const payload={reference_xml:MusicScore.exportMusicXml(reference,selectedClef).xml,
        recording_xml:MusicScore.exportMusicXml({...take,duration:reference.duration,scoreDuration:reference.duration,key_fifths:reference.key_fifths},selectedClef).xml,
        reference,performance:take,comparison:Practice.compare(reference,take,take.practice.allowanceMs),
        meter:reference.time_signature,timing_allowance_ms:take.practice.allowanceMs,notation_tolerance_percent:take.timing_tolerance||0};
      const headers={'Content-Type':'application/json'};
      const accessCode=$('coaching-access-code')?.value;
      if(accessCode)headers['X-Coaching-Code']=accessCode;
      const response=await fetch('/api/coaching',{method:'POST',headers,body:JSON.stringify(payload),signal:controller.signal});
      const result=await response.json();if(!response.ok)throw new Error(result.error||'Coaching failed.');
      if(version!==revision || current!==take)return;
      // Plain text avoids executing markup returned by a model or uploaded score.
      $('coaching-advice').textContent=result.advice;
      $('coaching-status').textContent=`AI coaching · ${result.model}. Based on this take.`;
    } catch(error) {
      if(version===revision)$('coaching-status').textContent=error.name==='AbortError'?'Coaching timed out. You can try again.':error.message;
    } finally {
      clearTimeout(deadline);
      if(version===revision){request=null;$('get-coaching').disabled=false;}
    }
  });
  return {clear,setResult};
})();
