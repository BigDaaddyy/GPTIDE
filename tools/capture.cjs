// Developer-only proof capture; never capture a user's arbitrary project.
const fs = require('node:fs');
const path = require('node:path');
async function call(url, method, params = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url), timer = setTimeout(() => { ws.close(); reject(new Error('CDP timeout')); }, 10000);
    ws.onopen = () => ws.send(JSON.stringify({ id: 1, method, params }));
    ws.onerror = () => { clearTimeout(timer); reject(new Error('CDP connection error')); };
    ws.onmessage = e => { const r = JSON.parse(e.data); if (r.id === 1) { clearTimeout(timer); ws.close(); r.error ? reject(new Error(r.error.message)) : resolve(r.result); } };
  });
}
(async () => {
  const targets = await (await fetch('http://127.0.0.1:9337/json/list')).json();
  for (const target of targets.filter(t => t.type === 'page')) {
    const title = await call(target.webSocketDebuggerUrl, 'Runtime.evaluate', { expression: 'document.title', returnByValue: true });
    if (!String(title.result?.value).includes('example-project')) continue;
    const capture = await call(target.webSocketDebuggerUrl, 'Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.resolve(__dirname, '..', 'preview.png'), Buffer.from(capture.data, 'base64'));
    console.log('Captured only the bundled example project'); return;
  }
  throw new Error('No example-project window found');
})().catch(e => { console.error(e.message); process.exitCode = 1; });
