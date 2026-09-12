const {readFileSync} = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
function load(file, rate = 48000) {
  let Processor;
  const messages = [];
  const scope = {sampleRate: rate, currentFrame: 0, Float32Array, Math,
    AudioWorkletProcessor: class { constructor(){this.port={postMessage:m=>messages.push(structuredClone(m))};} },
    registerProcessor: (_name, klass) => {Processor=klass;}};
  vm.createContext(scope);vm.runInContext(readFileSync(file,'utf8'),scope);
  return {scope, messages, make:options=>new Processor({processorOptions:options})};
}
for(const rate of [44100,48000]) {
  const {scope,messages,make} = load('static/recorder-worklet.js',rate);
  const startTime=.137, startFrame=Math.round(startTime*rate), maxDuration=.05;
  const processor=make({startTime,maxDuration});
  for(let frame=0;frame<rate*.3;frame+=128) {
    scope.currentFrame=frame;
    // Pre-roll is deliberately a different signal; none may enter the WAV.
    const input=Float32Array.from({length:128},(_,i)=>frame+i<startFrame ? .9 : .25);
    if(!processor.process([[input]]))break;
  }
  const samples=messages.filter(m=>m instanceof Float32Array).flatMap(m=>[...m]);
  assert.equal(samples.length,Math.round(maxDuration*rate));
  assert.ok(samples.every(v=>v===.25));
  assert.equal(messages.filter(m=>m?.type==='started').length,1);
  assert.equal(messages.filter(m=>m?.type==='limit').length,1);
}
{
  const {scope,messages,make}=load('static/recorder-worklet.js');
  const recorder=make({startTime:3});
  recorder.process([[new Float32Array(128).fill(.8)]]);
  recorder.port.onmessage({data:'stop'});
  assert.equal(messages.filter(m=>m instanceof Float32Array).length,0);
  assert.equal(messages.at(-1),'stopped');
}
for(const bpm of [40,100,137,240]) {
  const {scope,messages,make}=load('static/metronome-worklet.js');
  const startTime=.1, duration=startTime+6*60/bpm;
  const node=make({bpm,startTime,beatLimit:4,volume:.2});
  let lastAudible=0, firstAudible=Infinity;
  for(let frame=0;frame<duration*48000;frame+=128) {
    scope.currentFrame=frame;
    const out=new Float32Array(128);node.process([],[[out]]);
    for(let i=0;i<128;i++) if(out[i]!==0){firstAudible=Math.min(firstAudible,frame+i);lastAudible=frame+i;}
  }
  assert.deepEqual(messages.map(m=>m.beat),[0,1,2,3]);
  assert.ok(firstAudible>=Math.round(startTime*48000));
  assert.ok(lastAudible<(startTime+4*60/bpm)*48000);
  node.port.onmessage({data:'stop'});
  assert.equal(node.process([],[[new Float32Array(128)]]),false);
}
{
  const {scope,messages,make}=load('static/metronome-worklet.js');
  const node=make({bpm:137,startTime:0,volume:.2});
  for(let frame=0;frame<48000*30;frame+=128){scope.currentFrame=frame;node.process([],[[new Float32Array(128)]]);}
  assert.equal(messages.length,Math.ceil(30*137/60));
  assert.equal(messages.at(-1).beat,messages.length-1);
}
console.log('Audio-clock tests passed: count-in exclusion, capture limit, cancellation, four beats, and drift-free preview.');
for (const beatsPerMeasure of [3,6]) {
  const {scope,make}=load('static/metronome-worklet.js');
  const node=make({bpm:120,startTime:0,volume:.2,beatsPerMeasure,countInBeats:4});
  for(let beat=0;beat<12;beat++) {
    scope.currentFrame=beat*24000+48;
    const out=new Float32Array(128);node.process([],[[out]]);
    const accent=beat<4 ? beat===0 : (beat-4)%beatsPerMeasure===0;
    assert.equal(out[0]>0,accent);
  }
}
console.log('3/4 and 6/8 accent tests passed, including the fresh downbeat after four count-in clicks.');
