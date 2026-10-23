const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm');
const { aboutVersion } = require('../tools/workbench-patch.cjs');
const source = 'function urr(i,e){let t=i.version;i.target?t=`${t} (${i.target} setup)`:i.darwinUniversalAssetId&&(t=`${t} (Universal)`);const s=r=>"Version: "+t,n=s(!0),o=s(!1);return{title:i.nameLong,details:n,detailsToCopy:o}}var fje=class{};';
test('About shows GPTIDE release and base versions in both display and copied details without changing engine identity', () => {
  const patched = aboutVersion(source), render = vm.runInNewContext(patched + ';urr');
  const product = { version: '1.135.0', gptideVersion: '1.9.8', nameLong: 'GPTIDE', target: 'user' }, snapshot = { ...product };
  const result = render(product, {});
  for (const text of [result.details, result.detailsToCopy]) { assert.ok(text.startsWith('Version: 1.9.8 (user setup)')); assert.ok(text.includes('VSCodium: 1.135.0')); }
  assert.equal(result.title, 'GPTIDE'); assert.deepEqual(product, snapshot);
  assert.equal(aboutVersion(patched), patched);
});
test('About falls back to the engine version when no GPTIDE version is provided and rejects changed native structures', () => {
  const render = vm.runInNewContext(aboutVersion(source) + ';urr');
  assert.equal(render({ version: '1.135.0' }, {}).details, 'Version: 1.135.0');
  assert.throws(() => aboutVersion('changed'), /结构已变化/);
  assert.throws(() => aboutVersion(source.replace('details:n', 'details:changed')), /返回结构已变化/);
});
