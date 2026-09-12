const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync('static/app.js', 'utf8');
const fn = source.slice(source.indexOf('function scorePosition('), source.indexOf('function updatePlaybackCursor('));
const scope = {scoreLayout: {rowCount: 4, rowSeconds: 5.4, barSeconds: 1.8}};
vm.createContext(scope); vm.runInContext(fn, scope);
const at = time => scope.scorePosition(time);
assert.equal(at(0).row, 0);
assert.ok(Math.abs(at(1.8).x - 380) < .001);
assert.equal(at(3.6 + 1.8).row, 1); // Floating-point boundary must wrap, not render at previous row end.
assert.ok(Math.abs(at(5.4).x - 130) < .001);
assert.equal(at(10.8).row, 2);
assert.equal(at(1000).row, 3);
assert.ok(at(1000).x <= 880);
console.log('Score layout tests passed: three bars, row transitions, floating-point boundaries, and end clamping.');

for (const boundary of [1.8, 3.6]) assert.ok(Math.abs(at(boundary+.00001).x-at(boundary-.00001).x)<.01);
