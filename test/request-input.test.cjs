const test = require('node:test'), assert = require('node:assert/strict');
const { ask } = require('../builtin/request-input.cjs');
test('Agent questions return selected and typed answers and hide secret input', async () => {
  const prompts = [], vscode = { window: { showQuickPick: async items => items[0], showInputBox: async options => { prompts.push(options); return options.password ? 'private fixture' : 'typed fixture'; } } };
  const result = await ask(vscode, { questions: [{ id: 'choice', header: 'Choice', question: 'Choose', options: [{ label: 'A', description: 'First' }] }, { id: 'text', header: 'Text', question: 'Write' }, { id: '__proto__', header: 'Secret', question: 'Secret', isSecret: true }] }, () => true);
  assert.deepEqual(result.answers.choice, { answers: ['A'] }); assert.deepEqual(result.answers.text, { answers: ['typed fixture'] }); assert.equal(prompts[1].password, true);
  assert.deepEqual(JSON.parse(JSON.stringify(result)).answers.__proto__, { answers: ['private fixture'] });
});
test('cancel or changed conversation discards all answers and invalid questions never show UI', async () => {
  let current = true, calls = 0;
  const vscode = { window: { showInputBox: async () => { calls++; current = false; return 'stale'; } } };
  const params = { questions: [{ id: 'a', header: 'A', question: 'Answer' }] };
  assert.deepEqual(await ask(vscode, params, () => current), { answers: {} });
  await assert.rejects(ask(vscode, { questions: [...params.questions, ...params.questions] }, () => true), /格式无效/); assert.equal(calls, 1);
});
