const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');

function findCodex(explicit) {
  if (explicit) return explicit;
  const base = path.join(process.env.LOCALAPPDATA || '', 'OpenAI', 'Codex', 'bin');
  if (fs.existsSync(base)) {
    const found = fs.readdirSync(base).map(n => path.join(base, n, 'codex.exe')).filter(p => fs.existsSync(p));
    found.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    if (found.length) return found[0];
  }
  return process.platform === 'win32' ? 'codex.exe' : 'codex';
}

class Bridge extends EventEmitter {
  constructor(executable, cwd) { super(); this.executable = executable; this.cwd = cwd; this.pending = new Map(); this.nextId = 1; }
  async start() {
    // Ignore API credentials inherited from shells. Force the official OpenAI provider.
    const env = { ...process.env };
    delete env.OPENAI_API_KEY; delete env.OPENAI_BASE_URL;
    delete env.AZURE_OPENAI_API_KEY;
    this.child = spawn(this.executable, ['-c', 'model_provider="openai"', '-c', 'forced_login_method="chatgpt"', 'app-server'], {
      cwd: this.cwd, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']
    });
    this.child.on('error', e => this.fail(e));
    this.child.on('exit', (code) => this.fail(new Error(`Codex 已退出 (${code})`)));
    this.child.stderr.on('data', d => { this.lastDiagnostic = String(d).slice(-2000); });
    createInterface({ input: this.child.stdout }).on('line', line => {
      let value; try { value = JSON.parse(line); } catch { return; }
      if (value.method) { this.emit(value.id === undefined ? 'notification' : 'request', value); return; }
      const entry = this.pending.get(value.id); if (!entry) return;
      clearTimeout(entry.timer); this.pending.delete(value.id);
      if (value.error) entry.reject(new Error(value.error.message)); else entry.resolve(value.result);
    });
    await this.call('initialize', { clientInfo: { name: 'gptide_desktop', title: 'GptIDE', version: require('./package.json').version } });
    this.send({ method: 'initialized', params: {} });
    return this;
  }
  send(value) { if (!this.child || this.child.killed) throw new Error('Codex 未连接'); this.child.stdin.write(JSON.stringify(value) + '\n'); }
  call(method, params = {}, timeout = 45000) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} 超时${this.lastDiagnostic ? ': ' + this.lastDiagnostic : ''}`)); }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      try { this.send({ id, method, params }); } catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
  reply(id, result) { this.send({ id, result }); }
  fail(error) { for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(error); } this.pending.clear(); this.emit('disconnected', error); }
  dispose() { if (this.child) this.child.kill(); }
}
module.exports = { Bridge, findCodex };
