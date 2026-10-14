const test=require('node:test'),assert=require('node:assert/strict'),Module=require('node:module'),{EventEmitter}=require('node:events');
const {create}=require('../builtin/inline-stream.cjs');
test('inline stream rejects foreign turns, ignores malformed events and bounds output',()=>{
 let resolved,rejected,stops=0;const stream=create('own',{resolve:value=>resolved=value,reject:error=>rejected=error},()=>stops++);
 for(const event of [null,{method:'turn/completed',params:{threadId:'own'}},{method:'item/agentMessage/delta',params:{threadId:'own',turnId:'malformed',delta:{}}},{method:'unknown',params:{threadId:'own',turnId:'other'}}])assert.doesNotThrow(()=>stream.receive(event));
 stream.receive({method:'turn/started',params:{threadId:'own',turn:{id:'turn'}}});stream.receive({method:'turn/completed',params:{threadId:'foreign',turn:{id:'turn',status:'failed'}}});
 stream.receive({method:'item/agentMessage/delta',params:{threadId:'own',turnId:'turn',itemId:'answer',delta:'{"replacement":"QA"}'}});stream.receive({method:'turn/completed',params:{threadId:'own',turn:{id:'turn',status:'completed'}}});assert.equal(resolved,'QA');assert.equal(rejected,undefined);assert.equal(stops,0);
 const large=create('own',{resolve(){},reject:error=>rejected=error},()=>stops++);large.receive({method:'item/agentMessage/delta',params:{threadId:'own',turnId:'turn',itemId:'large',delta:'x'.repeat(2*1024*1024+1)}});assert.match(rejected.message,/过大/);assert.equal(stops,1);
});
let behavior='early-complete';
class FakeBridge extends EventEmitter{
 async start(){} send(){} dispose(){this.closed=true;this.rejectStart?.(new Error('QA disposed'));this.emit('disconnected',new Error('QA disposed'));}
 async call(method){if(method==='account/read')return{account:{type:'chatgpt'}};if(method==='thread/start')return{thread:{id:'own'}};return new Promise((resolve,reject)=>{this.rejectStart=reject;queueMicrotask(()=>{this.emit('notification',{method:'turn/started',params:{threadId:'own',turn:{id:'turn'}}});if(behavior==='confirmed-timeout'){reject(new Error('turn/start 超时'));setTimeout(()=>this.complete(),10);}else this.complete();});});}
 complete(){this.emit('notification',{method:'item/agentMessage/delta',params:{threadId:'own',turnId:'turn',itemId:'answer',delta:'{"replacement":"QA result"}'}});this.emit('notification',{method:'turn/completed',params:{threadId:'own',turn:{id:'turn',status:'completed'}}});}
}
const original=Module.prototype.require,file=require.resolve('../builtin/inline-agent.cjs'),cached=require.cache[file];let generate;
try{delete require.cache[file];Module.prototype.require=function(id){return id==='./bridge.cjs'?{Bridge:FakeBridge}:original.apply(this,arguments);};generate=require('../builtin/inline-agent.cjs').generate;}finally{Module.prototype.require=original;if(cached)require.cache[file]=cached;else delete require.cache[file];}
test('inline completion before RPC acknowledgment and confirmed timeout preserve valid output',async()=>{
 const args={executable:'unused',cwd:'QA',model:'fixture',snapshot:{file:'QA',text:'code',start:0,end:4},instruction:'QA'};
 behavior='early-complete';assert.equal(await generate(args),'QA result');behavior='confirmed-timeout';assert.equal(await generate(args),'QA result');
});
