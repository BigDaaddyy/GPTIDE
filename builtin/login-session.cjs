// One browser flow owns one loginId. No tokens or browser URLs are persisted.
class LoginSession {
  constructor(bridge, { open, refresh, state, end, timeout = 300000 }) {
    Object.assign(this, { bridge, open, refresh, state, end, timeout });
    this.early = new Map(); this.receive = event => {
      const p = event?.params;
      if (this.done || event?.method !== 'account/login/completed' || typeof p?.loginId !== 'string' || typeof p.success !== 'boolean') return;
      if (!this.id) { if (this.early.size < 4) this.early.set(p.loginId, p); return; }
      if (p.loginId === this.id) this.complete(p);
    };
    bridge.on('notification', this.receive);
    this.disconnected = () => this.dispose(); bridge.on('disconnected', this.disconnected);
  }
  async begin() {
    try {
      const result = await this.bridge.call('account/login/start', { type: 'chatgpt' });
      if (this.done) return;
      if (result?.type !== 'chatgpt' || typeof result.loginId !== 'string' || !result.loginId || typeof result.authUrl !== 'string') throw new Error('登录服务没有返回有效的 ChatGPT 浏览器流程');
      const url = new URL(result.authUrl); if (url.protocol !== 'https:') throw new Error('登录地址必须使用 HTTPS');
      this.id = result.loginId;
      const early = this.early.get(this.id); this.early.clear();
      if (early) { await this.complete(early); return; }
      this.timer = setTimeout(() => { this.state('登录等待已超时，请重新登录'); this.bridge.dispose(new Error('登录等待已超时，请重新连接')); this.dispose(); }, this.timeout); this.timer.unref?.();
      if (!await this.open(result.authUrl)) throw new Error('无法打开登录页面');
      if (!this.done && !this.completing) this.state('请在浏览器完成 ChatGPT 登录');
    } catch (error) { if (!this.done) { this.bridge.dispose(error); this.dispose(); throw error; } }
  }
  async complete(params) {
    if (this.done || this.completing) return;
    this.completing = true; clearTimeout(this.timer); this.state('正在确认 ChatGPT 账户…');
    try {
      if (!params.success) this.state(typeof params.error === 'string' ? 'ChatGPT 登录未完成：' + params.error.slice(0, 500) : 'ChatGPT 登录未完成');
      else { await this.refresh(); if (!this.done) this.state('ChatGPT 账户已登录'); }
    } catch (error) { if (!this.done) this.state('账户刷新失败：' + error.message); }
    finally { this.dispose(); }
  }
  async cancel() {
    if (this.done || this.canceling) return;
    if (!this.id || this.completing) throw new Error('正在准备或确认登录，请稍后重试');
    this.canceling = true; this.state('正在取消 ChatGPT 登录…');
    try {
      const result = await this.bridge.call('account/login/cancel', { loginId: this.id });
      if (this.done) return;
      if (!['canceled','notFound'].includes(result?.status)) throw new Error('登录取消响应无效');
      if (result.status === 'notFound') {
        this.completing = true; clearTimeout(this.timer);
        try { await this.refresh(); if (!this.done) this.state('登录等待已结束，账户状态已刷新'); }
        catch (error) { if (!this.done) this.state('登录等待已结束；请重新连接刷新账户：' + error.message); }
      } else this.state('已取消 ChatGPT 登录');
      this.dispose();
    } catch (error) { if (!this.done) { this.canceling = false; this.state('取消登录失败，请重试：' + error.message); throw error; } }
  }
  dispose() {
    if (this.done) return; this.done = true; clearTimeout(this.timer); this.early.clear();
    this.bridge.removeListener('notification', this.receive); this.bridge.removeListener('disconnected', this.disconnected); this.end();
  }
}
module.exports = { LoginSession };
