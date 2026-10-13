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
  constructor(executable, cwd, options = {}) { super(); this.executable = executable; this.cwd = cwd; this.timeout = options.timeout || 45000; this.pending = new Map(); this.nextId = 1; }
  async start() {
    if (this.closed || this.child) throw new Error('Codex 连接已关闭或已启动');
    // Ignore API credentials inherited from shells. Force the official OpenAI provider.
    const env = { ...process.env };
    delete env.OPENAI_API_KEY; delete env.OPENAI_BASE_URL;
    delete env.AZURE_OPENAI_API_KEY;
    this.child = spawn(this.executable, ['-c', 'model_provider="openai"', '-c', 'forced_login_method="chatgpt"', 'app-server'], {
      cwd: this.cwd, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']
    });
    this.child.on('error', e => this.fail(e));
    this.child.on('exit', (code) => this.fail(new Error(`Codex 已退出 (${code})`)));
    this.child.stdin.on('error', e => this.fail(e));
    this.child.stderr.on('error', e => this.fail(e));
    this.child.stderr.on('data', d => { this.lastDiagnostic = String(d).slice(-2000); });
    createInterface({ input: this.child.stdout }).on('error', e => this.fail(e)).on('line', line => this.receive(line));
    await this.call('initialize', { clientInfo: { name: 'gptide_desktop', title: 'GptIDE', version: require('./package.json').version } });
    this.send({ method: 'initialized', params: {} });
    return this;
  }
  send(value) {
    if (this.closed || !this.child || this.child.killed || this.child.stdin.destroyed || this.child.stdin.writable === false) throw this.closeError || new Error('Codex 未连接');
    this.child.stdin.write(JSON.stringify(value) + '\n', error => { if (error) this.fail(error); });
  }
  receive(line) {
    if (this.closed) return;
    let value; try { value = JSON.parse(line); } catch { return; }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    if (value.method !== undefined) { if (typeof value.method === 'string' && value.method) this.emit(value.id === undefined ? 'notification' : 'request', value); return; }
    const entry = this.pending.get(value.id); if (!entry) return;
    clearTimeout(entry.timer); this.pending.delete(value.id);
    if (value.error) entry.reject(new Error(typeof value.error.message === 'string' ? value.error.message : 'Codex 请求失败')); else entry.resolve(value.result);
  }
  call(method, params = {}, timeout = this.timeout) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} 超时${this.lastDiagnostic ? ': ' + this.lastDiagnostic : ''}`)); }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      try { this.send({ id, method, params }); } catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
  reply(id, result) { this.send({ id, result }); }
  fail(error) {
    if (this.closed) return;
    this.closed = true; this.closeError = error;
    for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(error); }
    this.pending.clear(); if (this.child && !this.child.killed) this.child.kill(); this.emit('disconnected', error);
  }
  dispose() { this.fail(new Error('Codex 连接已关闭')); }
}
module.exports = { Bridge, findCodex };
