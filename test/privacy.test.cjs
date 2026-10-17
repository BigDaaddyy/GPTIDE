const test=require('node:test'),assert=require('node:assert/strict'),{inspect}=require('../tools/check-privacy.cjs');
test('privacy checks reject personal data and redact the actual credential value',()=>{
  const token='gh'+'p_'+'a'.repeat(36),personal='C:'+'\\Users\\'+'owner'+'\\Desktop',email='developer'+'@'+'gmail.com';
  assert.deepEqual(inspect('data/history.json',Buffer.from('{}')),['private-file']);
  assert.deepEqual(inspect('auth.json',Buffer.from('{}')),['private-file']);
  assert.deepEqual(inspect('preview.png',Buffer.from([0,1,2])),['private-file']);
  assert.deepEqual(inspect('src/a.js',Buffer.from(token)),['credential']);
  assert.deepEqual(inspect('README.md',Buffer.from(personal)),['personal-path']);
  assert.deepEqual(inspect('README.md',Buffer.from(email)),['personal-email']);
  assert.deepEqual(inspect('.env.example',Buffer.from('MODEL=example')),[]);
  assert.deepEqual(inspect('test/fixture.cjs',Buffer.from('fake@example.test')),[]);
});
