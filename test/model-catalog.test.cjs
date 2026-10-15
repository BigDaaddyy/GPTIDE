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

test('recommended presets remain unverified offline and never add unavailable models to a live catalog',()=>{
 const offline=catalog.choices([]);assert.deepEqual(offline.map(m=>m.model),['gpt-6.1-sol','gpt-6-astra','gpt-6-sol','gpt-6-luna']);assert.ok(offline.every(m=>m.unverified&&!m.serviceTiers));
 const live=catalog.choices([{model:'other'},{model:'gpt-6-luna'},{model:'gpt-6.1-sol'}]);assert.deepEqual(live.map(m=>m.model),['gpt-6.1-sol','gpt-6-luna','other']);assert.equal(live[0].recommended,true);assert.equal(live[2].recommended,false);
});
test('Fast mode only accepts service tiers explicitly advertised for the selected model',()=>{
 const model=catalog.normalize({model:'fixture',serviceTiers:[{id:'fast',name:'Fast'},{id:'fast',name:'Fast'},{id:'ultrafast'},{id:'injected'},null]});assert.deepEqual(model.serviceTiers,[{id:'fast',name:'Fast'}]);assert.equal(catalog.tier(model,'fast'),'fast');assert.equal(catalog.tier(model,'priority'),'default');assert.equal(catalog.tier(undefined,'fast'),'default');assert.equal(catalog.tier(model,'default'),'default');
});
