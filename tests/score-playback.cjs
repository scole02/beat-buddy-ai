const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const at = require('../static/vendor/alphatab/alphaTab.min.js');
const {exportMusicXml} = require('../static/musicxml.js');
const audio = {currentTime:0, duration:6.8, paused:true, ended:false, seeking:false, readyState:4, playbackRate:1, volume:1,
  pause(){this.paused=true;}, async play(){this.paused=false;}};
let view, speedWrites = 0, seeks = 0;
const positions = [], downloads = {hidden:true};
class FakeApi {
  constructor(element, settings) {
    this.settings = new at.Settings(); this.settings.fillFromJson(settings);
    this.options = settings; this.speed = 1; this.isReadyForPlayback = true;
    this.error = this.playerReady = this.renderFinished = {on(){}};
    this.player = {output:{handler:null,updatePosition:t=>positions.push(t)}};
  }
  get playbackSpeed(){return this.speed;}
  set playbackSpeed(value){this.speed=value;speedWrites++;this.player.output.handler.seekTo(0);}
  renderScore(score){this.score=score;this.player.output.handler.seekTo(0);this.pause();}
  play(){this.player.output.handler.play();}
  pause(){this.player.output.handler.pause();}
  destroy(){}
}
const scope = {window:{alphaTab:{...at,AlphaTabApi:FakeApi}}, MusicScore:{exportMusicXml},
  TextEncoder, Blob, URL:{createObjectURL:()=> 'blob:test',revokeObjectURL(){}}, document:{getElementById:()=>downloads}};
vm.createContext(scope);
vm.runInContext(fs.readFileSync('static/score-view.js','utf8')+'\nglobalThis.View = AlphaScoreView;',scope);
view=new scope.View({},audio,message=>assert.fail(message));
const result={duration:6.8,tempo:100,time_signature:{numerator:4,denominator:4},notes:[{start:0,duration:1,midi:36}]};
view.render(result,'bass');
assert.equal(view.api.options.display.barsPerRow,3);
assert.equal(view.api.options.player.playerMode,at.PlayerMode.EnabledExternalMedia);
assert.equal(downloads.hidden,false);
for(const time of [0,.5,1,2.4,4.8,6.8]) {
  audio.currentTime=time;audio.paused=false;
  view.sync();
  assert.equal(positions.at(-1),time*1000);
  assert.equal(audio.currentTime,time,'position update must not seek the recording');
}
assert.equal(speedWrites,0,'unchanged speed must never be reassigned per frame');
audio.currentTime=3;audio.playbackRate=1.5;view.sync();
assert.equal(speedWrites,1);assert.equal(positions.at(-1),2000);assert.equal(audio.currentTime,3);
view.sync();assert.equal(speedWrites,1);
view.api.player.output.handler.seekTo(1000);assert.equal(audio.currentTime,1.5);
audio.currentTime=4; audio.seeking=true;view.sync();assert.equal(audio.paused,false);
audio.seeking=false; audio.readyState=2;view.sync();assert.equal(audio.paused,false);
audio.readyState=4;
view.render(result,'treble');assert.equal(audio.currentTime,4);assert.equal(audio.paused,false);
audio.paused=true;view.sync();assert.equal(audio.paused,true);
const sync=view.api.score.exportFlatSyncPoints();
assert.ok(Math.abs(sync.at(-1).millisecondOffset-7200)<1e-8,'do not squeeze the padded 7.2s score into 6.8s audio');
view.clear();assert.equal(downloads.hidden,true);
console.log('Score/media bridge passed: clock units, rate changes, no seek feedback, buffering, rerender preservation, and partial final bars.');
// Exercise the real alphaTab model construction for stacked reference/recording.
scope.Practice = require('../static/practice.js');
const reference=scope.Practice.referenceAt(JSON.parse(fs.readFileSync('static/references/catalog.json'))[0],100,-2);
const played={tempo:100,time_signature:reference.time_signature,duration:reference.duration,
  practice:{reference,allowanceMs:100},notes:reference.notes.map((n,i)=>({...n,midi:n.midi+(i===2?1:0)}))};
view.render(played,'bass');
assert.equal(view.api.score.tracks.length,2);
assert.equal(view.api.score.masterBars.length,2);
assert.equal(view.api.score.tracks[0].name,'Reference');
assert.equal(view.api.score.tracks[1].name,'You played');
for (const track of view.api.score.tracks) {
  assert.equal(track.staves[0].bars.length,2);
  const notes=track.staves[0].bars[0].voices[0].beats.flatMap(b=>b.notes);
  assert.ok(notes[0].style.colors.size>0);
  assert.notEqual(notes[0].style.colors.get(at.model.NoteSubElement.StandardNotationNoteHead).rgba,
    notes[2].style.colors.get(at.model.NoteSubElement.StandardNotationNoteHead).rgba);
}
view.render({...played,notes:[]},'treble');
assert.equal(view.api.score.tracks.length,2);
assert.ok(view.api.score.tracks[1].staves[0].bars.every(b=>b.voices[0].beats.every(n=>n.isRest)));
audio.paused=true;audio.currentTime=0;
view.liveClock=()=>({currentTime:2.4,duration:4.8,playbackRate:1,paused:false,ended:false,seeking:false,readyState:4});
view.sync();assert.equal(positions.at(-1),2400);assert.equal(audio.paused,true,'live practice must not start the old recording');
console.log('Stacked score and live capture clock passed: two aligned tracks, colored notes, silent take and no old-audio playback.');
// The cursor is independent of either track's attacks, gaps and tied durations.
let drawn, transition;
view.cursors = {beatCursor:{transitionToX:(ms,x)=>{transition={ms,x};},setBounds:(x,y,w,h)=>{drawn={x,y,w,h};}},barCursor:{setBounds(){}}};
view.api.renderer={boundsLookup:{findMasterBarByIndex:index=>({lineAlignedBounds:{x:100+index%3*250,y:Math.floor(index/3)*200,w:250,h:150}})}};
view.barCount=6;view.barSeconds=2.4;
for (const time of [0,.6,1.2,2.399,2.4,2.401,4.8,7.2,8.4,14.4]) {
  const media={currentTime:time,paused:true};
  view.placeTimeCursor(media);
  const live={...drawn};
  view.liveClock=()=>media;
  view.sync();
  assert.deepEqual(drawn,live,'capture and replay must use identical geometry at the same time');
  assert.equal(transition.ms,0,'no competing CSS animation');
}
view.placeTimeCursor({currentTime:2.4-.00001,paused:true});const before=drawn.x;
view.placeTimeCursor({currentTime:2.4+.00001,paused:true});assert.ok(Math.abs(drawn.x-before)<.01);
for (let measure=0;measure<6;measure++)for(const fraction of [0,.25,.5,.75]) {
  view.placeTimeCursor({currentTime:(measure+fraction)*2.4,paused:true});
  assert.ok(Math.abs(drawn.x-(100+(measure%3+fraction)*250))<1e-8);
}
assert.equal(view.api.options.player.enableAnimatedBeatCursor,false);
console.log('Uniform cursor passed: equal time increments, identical live/replay positions, barline continuity, row wraps and no CSS animation.');
