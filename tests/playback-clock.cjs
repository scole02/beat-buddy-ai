const {readFileSync} = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = readFileSync('static/app.js', 'utf8');
const functions = source.slice(source.indexOf('async function stopPlaybackMetronome'), source.indexOf('async function startRecording'));
const contexts = [], clicks = [], pending = [];
const audio = {paused: false, seeking: false, readyState: 4, currentTime: 2, playbackRate: 1};
const scope = {
  playbackContext: undefined, playbackClick: undefined,
  latestScore: {result: {tempo: 90, time_signature: {numerator: 4, denominator: 4}}},
  $: id => id === 'audio-playback' ? audio : {checked: true},
  AudioContext: class {
    constructor() { contexts.push(this); this.currentTime = 10; this.audioWorklet = {addModule: () => new Promise((resolve, reject) => pending.push({resolve, reject}))}; }
    async resume() {} async close() { this.state = 'closed'; }
  },
  routeClickOutput: async () => {}, resetBeatDisplay() {}, status() {},
  createClickTrack: (ctx, bpm, startTime) => {
    clicks.push({ctx, bpm, startTime});
    return {port: {postMessage() {}}, disconnect() {}};
  }
};
vm.createContext(scope); vm.runInContext(functions, scope);
const flush = () => new Promise(resolve => setImmediate(resolve));
(async () => {
  const first = scope.startPlaybackMetronome(); await flush();
  await scope.startPlaybackMetronome();
  assert.equal(contexts.length, 1, 'play + playing must not start two clocks');
  await scope.stopPlaybackMetronome();
  const second = scope.startPlaybackMetronome(); await flush();
  pending[0].reject(new Error('cancelled load')); await first;
  assert.equal(scope.playbackContext, contexts[1], 'old failure must not close the new clock');
  pending[1].resolve(); await second;
  assert.equal(clicks.length, 1);
  assert.equal(clicks[0].startTime, 8);
  await scope.stopPlaybackMetronome();
  audio.playbackRate = 1.5;
  const faster = scope.startPlaybackMetronome(); await flush();
  pending[2].resolve(); await faster;
  assert.equal(clicks[1].bpm, 135);
  assert.equal(clicks[1].startTime, 10 - 2 / 1.5);
  await scope.stopPlaybackMetronome();
  audio.seeking = true; await scope.startPlaybackMetronome();
  audio.seeking = false; audio.readyState = 2; await scope.startPlaybackMetronome();
  assert.equal(contexts.length, 3, 'do not run clicks while seeking or buffering');
  console.log('Playback clock tests passed: duplicate starts, cancellation, phase, speed, seeking and buffering.');
})().catch(error => {console.error(error); process.exitCode = 1;});
