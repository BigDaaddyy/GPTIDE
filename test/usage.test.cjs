const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const usage = require('../builtin/usage.cjs'), preferences = require('../builtin/preferences.cjs');
test('quota windows distinguish unknown values, clamp percentages and preserve source time', () => {
  const time = '2026-10-13T11:30:00Z';
  const value = usage.normalize({ primary: { used_percent: 12, window_minutes: 300, resets_at: 123 }, secondary: { usedPercent: 150, windowDurationMins: 10080 } }, time, 'fixture');
  assert.equal(value.primary.remainingPercent, 88); assert.equal(value.secondary.remainingPercent, 0);
  assert.equal(value.timestamp, time); assert.equal(usage.label(value.secondary), '每周');
  assert.equal(usage.normalize({ primary: { usedPercent: null } }, time, 'fixture'), null);
  assert.equal(usage.normalize({ primary: { usedPercent: 10 } }, 'invalid', 'fixture'), null);
});
test('local usage reads latest quota event only and excludes conversation content', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gptide-usage-'));
  try {
    const dir = path.join(root, 'sessions/2026/10/13'); await fs.mkdir(dir, { recursive: true });
    const event = (timestamp, used) => JSON.stringify({ type: 'event_msg', timestamp, payload: { type: 'token_count', rate_limits: { primary: { used_percent: used, window_minutes: 300 } } } });
    await fs.writeFile(path.join(dir, 'rollout-2.jsonl'), event('2026-10-13T12:00:00Z', 5) + '\n' + JSON.stringify({ type: 'response_item', payload: { content: 'private conversation text' } }) + '\n');
    await fs.writeFile(path.join(dir, 'rollout-1.jsonl'), event('2026-10-13T13:00:00Z', 10) + '\n{ partial');
    const result = await usage.read(root, root); assert.equal(result.primary.remainingPercent, 90);
    assert.ok(!JSON.stringify(result).includes('private'));
    await usage.save(root, { rateLimits: { primary: { usedPercent: 20 } } });
    const cached = await usage.read(root, path.join(root, 'missing')); assert.equal(cached.primary.remainingPercent, 80);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
test('preferences reject invalid enums and bound limits', () => {
  const data = { 'connection.autoConnect': false, approvalPolicy: 'danger', 'connection.timeoutSeconds': -5, 'context.importLimit': 999999 };
  const result = preferences.values({ get: (key, fallback) => data[key] ?? fallback });
  assert.equal(result.autoConnect, false); assert.equal(result.approvalPolicy, 'on-request'); assert.equal(result.rpcTimeout, 10000); assert.equal(result.importLimit, 300000); assert.equal(result.networkAccess, false);
});
test('new projects load offline unless automatic connection is explicitly enabled',()=>{
  assert.equal(preferences.values({get:(_key,fallback)=>fallback}).autoConnect,false);
  assert.equal(preferences.values({get:(key,fallback)=>key==='connection.autoConnect'?true:fallback}).autoConnect,true);
  assert.equal(require('../builtin/package.json').contributes.configuration.properties['gptide.connection.autoConnect'].default,false);
});

test('expired and old records never imply current available quota or invented reset', () => {
  const now = Date.parse('2026-10-13T14:00:00Z'), record = usage.normalize({ primary: { usedPercent: 20, resetsAt: (now + 60000) / 1000 }, secondary: { usedPercent: 30, windowDurationMins: Infinity, resetsAt: NaN } }, new Date(now).toISOString(), 'fixture');
  assert.equal(usage.status(record, record.primary, now), 'cached'); assert.equal(usage.status(record, record.primary, now + 60001), 'expired');
  assert.equal(usage.status(record, record.secondary, now + 16 * 60000), 'stale'); assert.equal(record.secondary.resetsAt, null); assert.equal(record.secondary.windowDurationMins, null);
  assert.equal(usage.status(null, null, now), 'unknown'); assert.equal(usage.status({ ...record, timestamp: new Date(now + 10 * 60000).toISOString() }, record.primary, now), 'stale');
});

test('cache writes stay ordered and only notify listeners after persistence', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gptide-usage-events-')), events = [];
  const listener = usage.onChange(changed => events.push(changed));
  try {
    await Promise.all([usage.save(root, { primary: { usedPercent: 10 } }), usage.save(root, { primary: { usedPercent: 20 } })]);
    const cache = JSON.parse(await fs.readFile(path.join(root, 'data/usage.json'))); assert.equal(cache.primary.usedPercent, 20); assert.deepEqual(events, [path.resolve(root), path.resolve(root)]);
    listener.dispose(); await usage.save(root, { primary: { usedPercent: 30 } }); assert.equal(events.length, 2);
  } finally { listener.dispose(); await fs.rm(root, { recursive: true, force: true }); }
});
