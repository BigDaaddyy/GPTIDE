const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { localInfo } = require('../builtin/account.cjs');
test('GPT account menu reads local status without exposing tokens or accepting API credentials', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gptide-account-'));
  try {
    assert.ok(localInfo(root).label.includes('未登录'));
    fs.writeFileSync(path.join(root, 'auth.json'), JSON.stringify({ auth_mode: 'apikey', OPENAI_API_KEY: 'private-api-key' }));
    assert.ok(localInfo(root).label.includes('未登录'));
    const claims = { email: 'private@example.test', 'https://api.openai.com/auth': { chatgpt_plan_type: 'plus' } };
    const token = 'header.' + Buffer.from(JSON.stringify(claims)).toString('base64url') + '.signature';
    fs.writeFileSync(path.join(root, 'auth.json'), JSON.stringify({ auth_mode: 'chatgpt', tokens: { id_token: token, access_token: 'private-access-token' } }));
    const info = localInfo(root); assert.ok(info.label.includes('PLUS')); assert.ok(info.label.includes('本机已登录'));
    assert.deepEqual(Object.keys(info), ['label']); assert.ok(!JSON.stringify(info).includes('private'));
    fs.writeFileSync(path.join(root, 'auth.json'), '{ corrupt'); assert.ok(localInfo(root).label.includes('未登录'));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
