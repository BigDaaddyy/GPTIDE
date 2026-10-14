const test = require('node:test'), assert = require('node:assert/strict');
const core = require('../builtin/inline-core.cjs');
test('inline proposals preserve surroundings, line endings and reject stale documents', () => {
  const snapshot = { file: 'sample.js', language: 'javascript', text: 'const x = 1;\r\nconst y = 2;\r\n', start: 0, end: 12, version: 5, eol: '\r\n' };
  const replacement = core.parse('{"replacement":"const x = 3;"}'), proposed = core.proposal(snapshot, replacement);
  assert.equal(proposed.text, 'const x = 3;\r\nconst y = 2;\r\n');
  assert.equal(core.proposal({ ...snapshot, start: 0, end: 0 }, 'a\nb\n').text, 'a\r\nb\r\n' + snapshot.text);
  assert.equal(core.unchanged(snapshot, { text: snapshot.text, version: 5 }), true);
  assert.equal(core.unchanged(snapshot, { text: snapshot.text, version: 6 }), false);
  assert.equal(core.unchanged(snapshot, { text: 'user change', version: 5 }), false);
  assert.throws(() => core.parse('```js\ncode\n```'));
  assert.throws(() => core.parse('{"replacement":false}'));
  assert.match(core.prompt(snapshot, 'modify selected'), /不要调用工具/);
  assert.ok(core.prompt({ ...snapshot, projectContext: 'QA project rules' }, 'modify selected').includes('QA project rules'));
});
