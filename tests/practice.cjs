const assert=require('node:assert/strict');
const fs=require('node:fs');
const Practice=require('../static/practice.js');
const catalog=JSON.parse(fs.readFileSync('static/references/catalog.json'));
assert.equal(catalog.length,7);
for(const piece of catalog) {
  assert.equal(piece.notes.length,8);assert.equal(piece.quarters,8);
  const root=piece.notes[0].midi;
  assert.deepEqual(piece.notes.map(n=>n.midi-root),[0,2,4,5,7,9,11,12]);
}
const reference=Practice.referenceAt(catalog[0],100,-2);
assert.equal(reference.notes[0].midi,36);assert.equal(reference.duration,4.8);
const run=notes=>Practice.compare(reference,{notes},100);
let result=run(reference.notes);
assert.equal(result.rows.filter(r=>r.status==='correct').length,8);
result=run(reference.notes.filter((_,i)=>i!==2));
assert.equal(result.rows.filter(r=>r.status==='missed').length,1);
assert.equal(result.rows.filter(r=>r.status==='correct').length,7);
const wrong=reference.notes.map(n=>({...n}));wrong[3].midi++;
result=run(wrong);assert.equal(result.rows.filter(r=>r.status==='wrong').length,1);
const late=reference.notes.map(n=>({...n,start:n.start+.15}));
assert.equal(run(late).rows.filter(r=>r.timing).length,8);
const extra=[...reference.notes.slice(0,2),{midi:39,start:.95,duration:.1},...reference.notes.slice(2)];
result=run(extra);assert.equal(result.rows.filter(r=>r.status==='extra').length,1);assert.equal(result.rows.filter(r=>r.status==='correct').length,8);
assert.equal(run([]).rows.filter(r=>r.status==='missed').length,8);
assert.equal(run(reference.notes.slice(0,3)).rows.filter(r=>r.status==='missed').length,5);
assert.equal(run(reference.notes.map(n=>({...n,midi:n.midi+12}))).rows.filter(r=>r.status==='wrong').length,8);
console.log('Practice comparison passed: all seven scales, octave choice, exact matches, missing/extra notes, wrong pitches, timing shifts, silence and early stops.');
