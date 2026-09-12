// Round-trip through the real, vendored alphaTab MusicXML importer.
const assert = require('node:assert/strict');
const at = require('../static/vendor/alphatab/alphaTab.min.js');
const {exportMusicXml} = require('../static/musicxml.js');
const load = (result, clef) => {
  const exported = exportMusicXml(result, clef);
  return {exported, score: at.importer.ScoreLoader.loadScoreFromBytes(new TextEncoder().encode(exported.xml))};
};
for (const bpm of [40, 90, 100, 137, 240]) {
  for (const numerator of [1,3,4,6,7,12]) for (const denominator of [2,4,8,16]) {
    const result = {tempo:bpm, time_signature:{numerator,denominator}, duration:11.1,
      notes:[{start:.2,duration:.7,midi:36}, {start:1.6,duration:3,midi:38}, {start:6,duration:.32,midi:40}]};
    const original = JSON.stringify(result);
    const {score, exported} = load(result, 'bass');
    assert.equal(JSON.stringify(result), original, 'export must preserve measured data');
    assert.equal(score.masterBars.length, exported.barCount);
    assert.equal(score.tempo, bpm * 4 / denominator);
    for (const bar of score.masterBars) {
      assert.equal(bar.timeSignatureNumerator, numerator);
      assert.equal(bar.timeSignatureDenominator, denominator);
      for (const tempo of bar.tempoAutomations) assert.equal(tempo.value, bpm * 4 / denominator, 'no conflicting metronome tempo');
    }
    for (const bar of score.tracks[0].staves[0].bars) {
      const beats = bar.voices[0].beats;
      assert.equal(beats.reduce((sum,b)=>sum+b.playbackDuration,0), numerator * 4 / denominator * 960, 'every measure is complete');
      assert.equal(bar.clef, at.model.Clef.F4);
    }
    // The tick-to-time conversion must hit each measure boundary, without
    // fitting the padded notation to the (usually partial-measure) audio length.
    const points = score.masterBars.map((_,i)=>({barIndex:i,barPosition:0,barOccurence:0,millisecondOffset:i*exported.barSeconds*1000}));
    points.push({barIndex:score.masterBars.length-1,barPosition:1,barOccurence:0,millisecondOffset:score.masterBars.length*exported.barSeconds*1000});
    score.applyFlatSyncPoints(points);
    const sync = at.midi.MidiFileGenerator.generateSyncPoints(score);
    for (const point of sync) {
      assert.ok(Math.abs(point.syncTime - point.synthTick/960 * 60000/(bpm*4/denominator)) < .01);
    }
  }
}
{
  const {score, exported} = load({tempo:100,duration:5,notes:[
    {start:0,duration:3,midi:36,duration_beats:5},
    {start:3.6,duration:.6,midi:38,duration_beats:1}
  ]}, 'treble');
  assert.equal(score.tracks[0].staves[0].bars[0].clef, at.model.Clef.G2);
  assert.match(exported.xml, /<tied type="start"\/>/);
  assert.match(exported.xml, /<tied type="stop"\/>/);
  assert.match(exported.xml, /<rest\/>/);
  const pitches = score.tracks[0].staves[0].bars.flatMap(b=>b.voices[0].beats.flatMap(n=>n.notes.map(p=>p.realValue)));
  assert.deepEqual([...new Set(pitches)], [36,38], 'clef must not transpose C2/D2');
}
{
  const {score} = load({tempo:100,duration:3,notes:[
    {start:0,duration:2,midi:36,confidence:.8},
    {start:.01,duration:.6,midi:37,confidence:.5},
    {start:.6,duration:.6,midi:38}
  ]});
  const beats = score.tracks[0].staves[0].bars[0].voices[0].beats;
  assert.equal(beats[0].playbackDuration,960, 'trim quantization overlaps to next attack');
  assert.equal(beats[0].notes[0].realValue,36, 'keep stronger colliding detection');
  assert.equal(beats[1].notes[0].realValue,38);
}
console.log('alphaTab round-trip passed: 120 tempo/meter combinations, complete bars, sync points, rests, ties, low pitches and collision handling.');
