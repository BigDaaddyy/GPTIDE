const test = require('node:test'), assert = require('node:assert/strict');
const { actionQuery, matchingActions, commandAction } = require('../builtin/quick-actions.cjs');
test('slash commands and standalone context tokens never match emails or ordinary paths', () => {
  assert.deepEqual(actionQuery('/di'), { kind: 'command', query: 'di', start: 0, end: 3 });
  assert.deepEqual(actionQuery('Review @fi'), { kind: 'context', query: 'fi', start: 7, end: 10 });
  for (const input of ['email@example@', 'email@', '/usr/local', 'text /usage', 'const s = "@"']) assert.equal(actionQuery(input), null);
  assert.equal(actionQuery('Review @file', 10, 11), null); assert.equal(actionQuery('Review @file', 9), null);
});
test('busy and blocked states hide changes while retaining useful read-only actions', () => {
  assert.deepEqual(matchingActions(actionQuery('@')).map(action => action.id), ['file', 'selection', 'diagnostics', 'diff', 'folder']);
  const busy = matchingActions(actionQuery('/'), { busy: true }); assert.ok(busy.some(action => action.id === 'usage')); assert.ok(!busy.some(action => action.id === 'new' || action.mode));
  assert.deepEqual(matchingActions(actionQuery('/'), { storageBlocked: true }), []);
  assert.deepEqual(matchingActions(actionQuery('/'), { reviewBusy: true }), []);
});
test('known mode arguments preserve code and unknown or argument-bearing utility text remains literal', () => {
  const parsed = commandAction('/ask\nExplain\nconst x = 1;'); assert.equal(parsed.action.mode, 'ask'); assert.equal(parsed.remainder, 'Explain\nconst x = 1;');
  assert.equal(commandAction('/usage').action.action, 'usage'); assert.equal(commandAction('/usage explain'), null); assert.equal(commandAction('/unknown'), null); assert.equal(commandAction('/usr/local'), null);
});
