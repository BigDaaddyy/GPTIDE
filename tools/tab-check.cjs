const assert = require('node:assert/strict');
async function call(url, expression) { return new Promise((resolve, reject) => { const ws = new WebSocket(url), timer = setTimeout(() => { ws.close(); reject(new Error('Tab QA timeout')); }, 15000); ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } })); ws.onerror = reject; ws.onmessage = e => { const r = JSON.parse(e.data); if (r.id === 1) { clearTimeout(timer); ws.close(); r.result?.exceptionDetails ? reject(new Error(JSON.stringify(r.result.exceptionDetails))) : resolve(r.result?.result?.value); } }; }); }
async function verify() {
  const d = [...document.querySelectorAll('iframe')].map(f => f.contentDocument).find(d => d?.querySelector('#input'));
  if (!d || !/GptIDE[\\/]example-project$/i.test(d.querySelector('#project').title)) return null;
  const w = d.defaultView, tabs = () => [...d.querySelectorAll('[role=tab]')], active = () => tabs().find(t => t.getAttribute('aria-selected') === 'true');
  const wait = async fn => { for (let i = 0; i < 50; i++) { if (fn()) return; await new Promise(r => setTimeout(r, 50)); } throw new Error('Tab transition timed out'); };
  await wait(() => active() && !d.querySelector('#new').disabled);
  const before = tabs().length, originalId = active().dataset.chatId, originalDraft = d.querySelector('#input').value;
  const type = text => { d.querySelector('#input').value = text; d.querySelector('#input').dispatchEvent(new w.Event('input')); };
  d.querySelector('#history').click(); const historyBefore = d.querySelectorAll('.history-row').length; d.querySelector('#close-history').click();
  type('QA original tab draft'); d.querySelector('#new').click(); await wait(() => tabs().length === before + 1);
  const newId = active().dataset.chatId, newEmpty = d.querySelector('#input').value === '' && d.querySelectorAll('.message').length === 0 && d.querySelectorAll('.task-row').length === 0;
  type('QA new tab draft'); tabs().find(t => t.dataset.chatId === originalId).click(); await wait(() => active().dataset.chatId === originalId);
  const oldRestored = d.querySelector('#input').value === 'QA original tab draft';
  tabs().find(t => t.dataset.chatId === newId).click(); await wait(() => active().dataset.chatId === newId);
  const newRestored = d.querySelector('#input').value === 'QA new tab draft'; type('');
  active().parentElement.querySelector('.chat-tab-close').click(); await wait(() => tabs().length === before);
  const closeRestored = active().dataset.chatId === originalId; type(originalDraft);
  d.querySelector('#history').click(); const retainedHistory = d.querySelectorAll('.history-row').length === historyBefore; d.querySelector('#close-history').click();
  return { newEmpty, oldRestored, newRestored, closeRestored, retainedHistory };
}
(async () => { const targets = await (await fetch('http://127.0.0.1:9337/json/list')).json(); for (const target of targets.filter(t => t.type === 'iframe')) { const result = await call(target.webSocketDebuggerUrl, '(' + verify.toString() + ')()'); if (!result) continue; for (const value of Object.values(result)) assert.equal(value, true); console.log(JSON.stringify(result)); return; } throw new Error('No bundled example window'); })().catch(error => { console.error(error.message); process.exitCode = 1; });
