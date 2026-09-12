// Exercise the actual recording setup with browser audio API doubles.
const {readFileSync} = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
async function check(channel, availableChannels, reject = false, captureClick = false) {
  const nodes = new Map(), connections = [], requests = [], worklets = [];
  let stopped = false;
  function element(id) {
    if (!nodes.has(id)) nodes.set(id, {value: id === 'audio-channel' ? String(channel) : id === 'audio-device' ? 'scarlett-usb' : ['meter-numerator','meter-denominator'].includes(id) ? '4' : id === 'tempo' ? '100' : id === 'click-volume' ? '35' : '', children: [], classList: {toggle(){},remove(){}}, setAttribute(){},addEventListener(){}, pause(){}, replaceChildren(){}, add(){}, clientWidth: 200, clientHeight: 60, getContext: () => ({setTransform(){},clearRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){}})});
    return nodes.get(id);
  }
  const track = {label:'Scarlett Solo',getSettings:()=>({channelCount:availableChannels,sampleRate:48000}),stop(){stopped=true;}};
  const audioStream = {getAudioTracks:()=>[track],getTracks:()=>[track]};
  class AudioContext {
    constructor(options){assert.equal(options.sampleRate,48000);this.sampleRate=48000;this.currentTime=10;this.audioWorklet={addModule:async()=>{}};this.destination={};}
    async resume(){} async close(){this.state='closed';}
    createMediaStreamSource(){return {connect:()=>connections.push('source-to-splitter'),disconnect(){}};}
    createAnalyser(){return {fftSize:2048,getFloatTimeDomainData(){},disconnect(){}};}
    createChannelSplitter(count){assert.equal(count,2);return {connect:(_target,output)=>connections.push(output),disconnect(){}};}
  }
  const sandbox = {
    document:{getElementById:element,querySelectorAll:()=>[],body:{classList:{toggle(){}}}},
    navigator:{mediaDevices:{getUserMedia:async options=>{requests.push(options);if(reject)throw Object.assign(new Error('missing'),{name:'OverconstrainedError'});return audioStream;},enumerateDevices:async()=>[],addEventListener(){}}},
    window:{AudioContext,AudioWorkletNode:true,devicePixelRatio:1,addEventListener(){}},
    AudioContext, AudioWorkletNode:class {constructor(_ctx,name,options){this.name=name;this.options=options;this.port={postMessage(){}};worklets.push(this);}connect(){connections.push(this.name+'-output');}disconnect(){}},
    Float32Array, Option:class{}, performance:{now:()=>0},requestAnimationFrame(){},cancelAnimationFrame(){},setTimeout(){},clearTimeout(){},console
  };
  vm.createContext(sandbox);
  vm.runInContext(readFileSync('static/app.js','utf8'),sandbox);
  await new Promise(resolve=>setImmediate(resolve));
  element('audio-device').value='scarlett-usb';
  element('capture-click').checked=captureClick;
  await vm.runInContext('startRecording()',sandbox);
  assert.equal(requests[0].audio.deviceId.exact,'scarlett-usb');
  assert.equal(requests[0].audio.echoCancellation,false);
  if (reject || (channel===1 && availableChannels!==2)) {
    assert.equal(vm.runInContext('mode',sandbox),'idle');
    assert.equal(connections.length,0);
    if(!reject)assert.ok(stopped);
  } else {
    assert.equal(vm.runInContext('mode',sandbox),'countin');
    assert.deepEqual(connections,['source-to-splitter',channel,channel,'pcm-recorder-output','metronome-output', ...(captureClick ? ['metronome-output'] : [])]);
    const recorder=worklets.find(w=>w.name==='pcm-recorder');
    assert.equal(recorder.options.processorOptions.startTime,12.55);
    assert.equal(recorder.options.numberOfInputs, captureClick ? 2 : 1);
    assert.equal(recorder.options.processorOptions.includeClick, captureClick);
    if (captureClick) {
      const click = worklets.find(w=>w.name==='metronome');
      assert.equal(click.options.processorOptions.beatLimit, 0);
      recorder.port.onmessage({data:{type:'mix',samples:new Float32Array([.1])}});
      assert.equal(vm.runInContext('mixedChunks.length',sandbox),1);
    }
    vm.runInContext('context.currentTime = recordingStartTime',sandbox);
    recorder.port.onmessage({data:{type:'started'}});
    assert.equal(vm.runInContext('mode',sandbox),'recording');
    await vm.runInContext('cleanup()',sandbox);
    assert.ok(stopped);
  }
}
(async()=>{
  await check(0,2); // Guitar goes to both recorder and meter without downmixing.
  await check(1,2); // XLR channel is independently selectable.
  await check(0,1); // Laptop microphone still works.
  await check(1,1); // Missing second channel must not yield a silent take.
  await check(0,2,true); // Disconnected USB source must not fall back to microphone.
  await check(0,2,false,true); // Embedded click forces continuous metronome and separate capture input.
  console.log('6 audio routing cases passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
