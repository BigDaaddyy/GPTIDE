async function call(url, method, params = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url); const timer = setTimeout(() => { ws.close(); reject(new Error('CDP timeout')); }, 10000);
    ws.onopen = () => ws.send(JSON.stringify({ id: 1, method, params }));
    ws.onerror = () => { clearTimeout(timer); reject(new Error('CDP connection error')); };
    ws.onmessage = e => { const r = JSON.parse(e.data); if (r.id === 1) { clearTimeout(timer); ws.close(); r.error ? reject(new Error(r.error.message)) : resolve(r.result); } };
  });
}
const expression = `JSON.stringify([...document.querySelectorAll('iframe')].map(f=>f.contentDocument).filter(d=>d?.querySelector('#sessions')).map(d=>({status:d.querySelector('#status').textContent,warning:d.querySelector('#warning').textContent,sessions:d.querySelector('#sessions').options.length-1,messages:d.querySelectorAll('.message').length,models:[...d.querySelector('#model').options].map(o=>o.value),plan:d.querySelector('#plan').textContent,project:d.querySelector('#project').textContent})))`;
async function targets() { return (await (await fetch('http://127.0.0.1:9337/json/list')).json()); }
(async () => {
  const list = await targets();
  if (process.argv.includes('--close')) { await call(list.find(t => t.type === 'page').webSocketDebuggerUrl, 'Browser.close').catch(() => {}); return; }
  for (const t of list.filter(t => t.type === 'iframe')) {
    const r = await call(t.webSocketDebuggerUrl, 'Runtime.evaluate', { expression, returnByValue: true }); console.log(r.result?.value);
    const summaries = JSON.parse(r.result?.value || '[]');
    const own = summaries.some(s => /[\\/]GptIDE(?:[\\/]example-project)?$/i.test(s.project));
    if (own && (process.argv.includes('--send-test') || process.argv.includes('--send-agent'))) {
      const agent = process.argv.includes('--send-agent');
      const mode = agent ? 'agent' : 'ask';
      const prompt = agent ? '仅创建 test/smoke-result.txt，内容为 GPTIDE_FILE_OK。不要修改其他文件。完成后只回复 GPTIDE_FILE_OK。' : '只回复 GPTIDE_OK，不读取文件，不运行命令。';
      await call(t.webSocketDebuggerUrl, 'Runtime.evaluate', { expression: `(()=>{const d=[...document.querySelectorAll('iframe')].map(f=>f.contentDocument).find(d=>d?.querySelector('#sessions'));if(!d)return false;d.querySelector('#new').click();setTimeout(()=>{d.querySelector('#mode').value=${JSON.stringify(mode)};d.querySelector('#input').value=${JSON.stringify(prompt)};d.querySelector('#send').click()},200);return true})()`, returnByValue: true });
    }
  }
})().catch(e => { console.error(e.message); process.exitCode = 1; });
