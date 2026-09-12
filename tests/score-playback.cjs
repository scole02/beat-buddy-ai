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
