const assert = require('node:assert/strict');
async function call(url, expression) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url), timer = setTimeout(() => { ws.close(); reject(new Error('CDP timeout')); }, 10000);
    ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
    ws.onerror = () => { clearTimeout(timer); reject(new Error('CDP error')); };
    ws.onmessage = e => { const r = JSON.parse(e.data); if (r.id === 1) { clearTimeout(timer); ws.close(); r.error || r.result.exceptionDetails ? reject(new Error(JSON.stringify(r.error || r.result.exceptionDetails))) : resolve(r.result.result.value); } };
  });
}
function verify() {
  const d = [...document.querySelectorAll('iframe')].map(f => f.contentDocument).find(d => d?.querySelector('#input'));
  if (!d || !/[\\/]GptIDE[\\/]example-project$/i.test(d.querySelector('#project').title)) return null;
  const w = d.defaultView, messages = Array.from({ length: 1000 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', itemId: 'qa-' + i, text: 'Synthetic message ' + i }));
  const id = 'qa-' + Date.now(), state = { type: 'state', activeId: id, project: d.querySelector('#project').title, chats: [], messages, models: [], attachments: [], changes: [], status: 'QA', busy: false };
  const send = () => w.dispatchEvent(new w.MessageEvent('message', { data: state }));
  const began = performance.now(); send(); const initial = d.querySelectorAll('.message').length, first = d.querySelector('.message');
  messages[999] = { ...messages[999], text: 'Synthetic streamed update' }; send();
  const stable = d.querySelector('.message') === first, updated = d.querySelector('#messages').textContent.includes('Synthetic streamed update');
  d.querySelector('.load-older').click(); const expanded = d.querySelectorAll('.message').length;
  d.querySelector('#input').value = 'QA draft A'; d.querySelector('#input').dispatchEvent(new w.Event('input'));
  state.activeId = id + '-other'; send(); const otherEmpty = d.querySelector('#input').value === '';
  d.querySelector('#input').value = 'QA draft B'; d.querySelector('#input').dispatchEvent(new w.Event('input'));
  state.activeId = id; send(); const draftRestored = d.querySelector('#input').value === 'QA draft A';
  state.tasks = [{ id: 'task', turnId: 'turn', turn: 1, kind: 'command', title: 'synthetic command', status: 'running', output: 'literal <script>text</script>' }]; send();
  const taskRow = d.querySelector('.task-row'); taskRow.open = true;
  state.tasks[0] = { ...state.tasks[0], status: 'failed', exitCode: 1, output: 'updated output' }; send();
  const taskStable = d.querySelector('.task-row') === taskRow && taskRow.open && taskRow.querySelector('.task-state').textContent === '失败' && taskRow.querySelector('.task-output').textContent === 'updated output';
  d.querySelector('#refresh').click();
  const bodyStyle = w.getComputedStyle(d.body), compact = bodyStyle.paddingLeft === '0px' && bodyStyle.paddingRight === '0px' && d.querySelector('.composer').getBoundingClientRect().height <= 90;
  return { initial, stable, updated, expanded, otherEmpty, draftRestored, taskStable, compact, durationMs: Math.round(performance.now() - began) };
}
(async () => {
  const targets = await (await fetch('http://127.0.0.1:9337/json/list')).json();
  for (const target of targets.filter(t => t.type === 'iframe')) {
    const result = await call(target.webSocketDebuggerUrl, '(' + verify.toString() + ')()'); if (!result) continue;
    assert.equal(result.initial, 100); assert.equal(result.stable, true); assert.equal(result.updated, true); assert.equal(result.expanded, 200);
    assert.equal(result.otherEmpty, true); assert.equal(result.draftRestored, true); assert.equal(result.taskStable, true); assert.equal(result.compact, true); console.log(JSON.stringify(result)); return;
  }
  throw new Error('Open bundled example-project with debug port 9337');
})().catch(e => { console.error(e.message); process.exitCode = 1; });
