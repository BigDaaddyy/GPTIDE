const test = require('node:test'), assert = require('node:assert/strict'), { EventEmitter } = require('node:events');
const { LoginSession } = require('../builtin/login-session.cjs');
function fixture(options = {}) {
  const bridge = new EventEmitter(), states = [], opened = []; let ends = 0, refreshes = 0;
  bridge.call = async () => ({ type: 'chatgpt', loginId: 'current', authUrl: 'https://example.invalid/fixture' });
  bridge.dispose=()=>{bridge.closed=true;bridge.emit('disconnected');};
  const session = new LoginSession(bridge, { open: async url => { opened.push(url); return true; }, refresh: async () => { refreshes++; }, state: value => states.push(value), end: () => ends++, ...options });
  const notify = (loginId, success = true) => bridge.emit('notification', { method: 'account/login/completed', params: { loginId, success } });
  return { bridge, session, notify, states, opened, get ends() { return ends; }, get refreshes() { return refreshes; } };
}
test('login stays pending through browser and refresh, ignores foreign and duplicate completions', async () => {
  let finish; const f = fixture({ refresh: () => new Promise(resolve => { finish = resolve; }) });
  try {
    await f.session.begin(); assert.equal(f.ends, 0); f.notify('foreign'); assert.equal(f.session.completing, undefined);
    f.notify('current'); f.notify('current'); assert.equal(f.ends, 0); finish(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.ends, 1); assert.equal(f.bridge.listenerCount('notification'), 0); f.notify('current'); assert.equal(f.ends, 1);
  } finally { f.session.dispose(); }
});
test('completion before start reply is matched by loginId and opens no stale browser', async () => {
  const f = fixture(); f.bridge.call = async () => { f.notify('foreign'); f.notify('current'); return { type: 'chatgpt', loginId: 'current', authUrl: 'https://example.invalid/fixture' }; };
  await f.session.begin(); assert.equal(f.refreshes, 1); assert.deepEqual(f.opened, []); assert.equal(f.ends, 1);
});
test('failed browser and non ChatGPT or unsafe URLs release flow without successful state', async () => {
  const f = fixture({ open: async () => false }); await assert.rejects(f.session.begin(), /无法打开/); assert.equal(f.ends, 1);
  for (const response of [{ type: 'apiKey' }, { type: 'chatgpt', loginId: 'x', authUrl: 'javascript:alert(1)' }]) {
    const invalid = fixture(); invalid.bridge.call = async () => response;
    await assert.rejects(invalid.session.begin(), /ChatGPT|HTTPS/); assert.deepEqual(invalid.opened, []); assert.equal(invalid.ends, 1);
  }
});
test('timeout and disconnect release listeners and cannot consume late login completions', async () => {
  const f = fixture({ timeout: 10 }); await f.session.begin(); await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(f.ends, 1); assert.equal(f.bridge.closed,true); assert.ok(f.states.at(-1).includes('超时')); f.notify('current'); assert.equal(f.refreshes, 0);
  const disconnected = fixture(); await disconnected.session.begin(); disconnected.bridge.emit('disconnected'); disconnected.notify('current');
  assert.equal(disconnected.ends, 1); assert.equal(disconnected.refreshes, 0);
});
test('explicit cancel uses only its loginId and releases after cancellation acknowledgment',async()=>{
  const f=fixture();await f.session.begin();let finish,calls=0;f.bridge.call=async(method,params)=>{calls++;assert.equal(method,'account/login/cancel');assert.deepEqual(params,{loginId:'current'});return new Promise(resolve=>{finish=resolve;});};
  const pending=f.session.cancel();await f.session.cancel();assert.equal(f.ends,0);assert.equal(calls,1);finish({status:'canceled'});await pending;assert.equal(f.ends,1);assert.equal(f.states.at(-1),'已取消 ChatGPT 登录');f.notify('current');assert.equal(f.refreshes,0);
});
test('cancel failure retains the lock for retry while notFound refreshes the actual account',async()=>{
  const f=fixture();await f.session.begin();f.bridge.call=async()=>{throw Error('fixture timeout');};await assert.rejects(f.session.cancel(),/timeout/);assert.equal(f.ends,0);assert.equal(f.session.canceling,false);
  f.bridge.call=async()=>({status:'notFound'});await f.session.cancel();assert.equal(f.refreshes,1);assert.equal(f.ends,1);
});
