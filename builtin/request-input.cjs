function questions(params) {
  const list = params?.questions;
  if (!Array.isArray(list) || !list.length || list.length > 10) throw new Error('Agent 问题数量无效');
  const ids = new Set();
  for (const question of list) {
    if (!question || typeof question.id !== 'string' || !question.id || ids.has(question.id) || typeof question.question !== 'string' || typeof question.header !== 'string') throw new Error('Agent 问题格式无效');
    ids.add(question.id);
    if (question.options != null && (!Array.isArray(question.options) || question.options.length > 30 || !question.options.every(option => option && typeof option.label === 'string' && typeof option.description === 'string'))) throw new Error('Agent 选项格式无效');
  }
  return list;
}
async function ask(vscode, params, isCurrent, token) {
  const list = questions(params), answers = Object.create(null);
  for (const question of list) {
    if (!isCurrent() || token?.isCancellationRequested) return { answers: {} };
    let value;
    if (question.options?.length && !question.isSecret) {
      const items = question.options.map(option => ({ label: option.label, description: option.description, value: option.label }));
      if (question.isOther) items.push({ label: '输入自定义答案…', custom: true });
      const selected = await vscode.window.showQuickPick(items, { title: question.header, placeHolder: question.question, ignoreFocusOut: true }, token);
      if (!selected) return { answers: {} };
      if (!selected.custom) value = selected.value;
    }
    if (value === undefined) value = await vscode.window.showInputBox({ title: question.header, prompt: question.question, password: !!question.isSecret, ignoreFocusOut: true, validateInput: value => value.trim() ? null : '请输入答案' }, token);
    if (value === undefined || !isCurrent() || token?.isCancellationRequested) return { answers: {} };
    answers[question.id] = { answers: [value] };
  }
  return { answers };
}
module.exports = { ask, questions };
