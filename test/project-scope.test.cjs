const test = require('node:test'), assert = require('node:assert/strict'), path = require('node:path');
const scope = require('../builtin/project-scope.cjs');
test('project binding excludes siblings, children, foreign and unverified chats', () => {
  const a = path.resolve('scope-alpha'), b = path.resolve('scope-beta');
  assert.notEqual(scope.key(a), scope.key(b)); assert.equal(scope.key(a), scope.key(path.join(a, '.')));
  assert.equal(scope.matches(a, b), false); assert.equal(scope.matches(a, path.join(a, 'child')), false);
  const own = { id: 'a', projectKey: scope.key(a) }, foreign = { id: 'b', projectKey: scope.key(b) }, legacy = { id: 'legacy' };
  const result = scope.partition([own, foreign, legacy], scope.key(a));
  assert.deepEqual(result.owned, [own]); assert.deepEqual(result.unverified, [foreign, legacy]);
});
