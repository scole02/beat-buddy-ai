const assert=require('node:assert/strict');
const fs=require('node:fs');const vm=require('node:vm');
const elements=new Map();
const element=id=>{if(!elements.has(id))elements.set(id,{hidden:false,disabled:false,textContent:'',addEventListener(event,fn){this[event]=fn;}});return elements.get(id);};
const calls=[];let resolveFetch;
const scope={window:{},$:element,mode:'idle',selectedClef:'bass',AbortController,setTimeout,clearTimeout,
  MusicScore:{exportMusicXml:data=>({xml:`<score-partwise>${data.title||'take'}</score-partwise>`})},
  Practice:{compare:()=>({rows:[]})},
  fetch:async(url,options)=>{calls.push({url,options});return new Promise(resolve=>resolveFetch=resolve);}};
vm.createContext(scope);vm.runInContext(fs.readFileSync('static/coaching-ui.js','utf8'),scope);
const ui=scope.window.CoachingUI;
const result={tempo:100,duration:4.8,notes:[],practice:{reference:{title:'Reference',duration:4.8,time_signature:{numerator:4,denominator:4}},allowanceMs:100}};
(async()=>{
 ui.setResult(result);assert.equal(calls.length,0,'never automatically request advice');
 const click=element('get-coaching').click;
 const first=click();assert.equal(element('get-coaching').disabled,true);
 await click();assert.equal(calls.length,1,'suppress duplicate clicks');
 ui.clear();resolveFetch({ok:true,json:async()=>({advice:'old advice',model:'test'})});await first;
 assert.equal(element('coaching-panel').hidden,true);assert.equal(element('coaching-advice').textContent,'');
 ui.setResult(result);const success=click();
 resolveFetch({ok:true,json:async()=>({advice:'Focus on note 3. <script>unsafe</script>',model:'test'})});await success;
 assert.equal(element('coaching-advice').textContent,'Focus on note 3. <script>unsafe</script>');
 assert.equal(element('get-coaching').disabled,false);
 const body=JSON.parse(calls.at(-1).options.body);
 assert.notEqual(body.reference_xml,body.recording_xml);assert.equal(body.timing_allowance_ms,100);
 const failure=click();resolveFetch({ok:false,json:async()=>({error:'Unavailable'})});await failure;
 assert.equal(element('coaching-status').textContent,'Unavailable');assert.equal(element('get-coaching').disabled,false);
 console.log('Coaching UI passed: on-demand only, request payload, duplicate prevention, stale-response suppression, text rendering and retry.');
})().catch(error=>{console.error(error);process.exitCode=1;});
