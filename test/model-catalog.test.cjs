const test = require('node:test'), assert = require('node:assert/strict'), catalog = require('../builtin/model-catalog.cjs');
test('catalog reads all pages, deduplicates and exposes only safe advertised model metadata', async () => {
  const calls=[]; const model={model:'first',displayName:{invalid:true},supportedReasoningEfforts:[null,{reasoningEffort:'high'},{reasoningEffort:'high'},{}]};
  const bridge={call:async(method,params)=>{calls.push({method,params});return params.cursor?{data:[{model:'gpt-6.1-sol',defaultReasoningEffort:'ultra'},{model:'first'},null],nextCursor:null}:{data:[model,{model:'hidden',hidden:true},{model:4}],nextCursor:'opaque'};}};
  const result=await catalog.read(bridge);assert.deepEqual(result.map(m=>m.model),['first','gpt-6.1-sol']);assert.equal(result[0].displayName,'first');assert.deepEqual(result[0].supportedReasoningEfforts,[{reasoningEffort:'high',description:''}]);assert.equal(result[1].defaultReasoningEffort,'ultra');
  assert.deepEqual(calls.map(c=>c.params),[{limit:50,includeHidden:false},{limit:50,includeHidden:false,cursor:'opaque'}]);
});
test('stale catalog pages stop before publishing or requesting another page', async () => {
  let current=true,calls=0; const bridge={call:async()=>{calls++;current=false;return{data:[{model:'old'}],nextCursor:'next'};}};
  assert.equal(await catalog.read(bridge,()=>current),null);assert.equal(calls,1);
});
test('malformed, repeated or endless catalog cursors fail instead of hanging or exposing partial results', async () => {
  for(const response of [null,{data:{}},{data:[],nextCursor:4},{data:[],nextCursor:'same'}])await assert.rejects(catalog.read({call:async()=>response}),/模型列表/);
  let pages=0;await assert.rejects(catalog.read({call:async()=>({data:[],nextCursor:String(++pages)})}),/分页过多/);assert.equal(pages,10);
});
test('effort selection only uses a requested, default or first advertised value',()=>{
  const model={defaultReasoningEffort:'not-listed',supportedReasoningEfforts:[{reasoningEffort:'high'},{reasoningEffort:'future-value'}]};
  assert.equal(catalog.effort(model,'future-value'),'future-value');assert.equal(catalog.effort(model,'medium'),'high');assert.equal(catalog.effort({supportedReasoningEfforts:[]},'medium'),undefined);
});
