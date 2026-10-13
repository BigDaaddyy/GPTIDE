const assert = require('node:assert/strict'), path = require('node:path');
const { findCodex } = require('../builtin/bridge.cjs');
const { generate } = require('../builtin/inline-agent.cjs');
const snapshot = { file: 'synthetic-inline.js', language: 'javascript', text: 'const answer = 1;', start: 0, end: 17, version: 1, eol: '\n' };
(async () => {
  const replacement = await generate({ executable: findCodex(), cwd: path.resolve(__dirname, '..', 'example-project'), model: 'gpt-6.1-sol', effort: 'low', snapshot, instruction: '仅将数字 1 改为 2。replacement 必须恰好为 const answer = 2; 不要调用工具。' });
  assert.equal(replacement.trim(), 'const answer = 2;'); console.log('Plus / GPT-6.1 structured inline generation passed; no files written');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
