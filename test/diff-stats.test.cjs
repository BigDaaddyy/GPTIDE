const test=require('node:test'),assert=require('node:assert/strict'),{stats}=require('../builtin/diff-stats.cjs');
test('changed line counts exclude unchanged code and count added/deleted files and final newline',()=>{
 assert.deepEqual(stats('a\nb\nc\n','a\nx\nc\n'),{added:1,removed:1,approximate:false});assert.equal(stats(null,'one\ntwo\n').added,2);assert.equal(stats('one\n',null).removed,1);assert.equal(stats('a','a\n').added,1);assert.deepEqual(stats('a\nb','x\nb\n'),{added:2,removed:2,approximate:false});assert.equal(stats('same','same').added,0);
});
test('bounded line diff agrees with exact LCS for repeated/reordered small inputs',()=>{
 let seed=17;const next=()=>{seed=(seed*16807)%2147483647;return seed;};
 for(let trial=0;trial<100;trial++){const a=Array.from({length:next()%15},()=>String(next()%5)),b=Array.from({length:next()%15},()=>String(next()%5)),dp=Array.from({length:a.length+1},()=>new Uint16Array(b.length+1));for(let i=1;i<=a.length;i++)for(let j=1;j<=b.length;j++)dp[i][j]=a[i-1]===b[j-1]?dp[i-1][j-1]+1:Math.max(dp[i-1][j],dp[i][j-1]);const lcs=dp[a.length][b.length],result=stats(a.length?a.join('\n')+'\n':'',b.length?b.join('\n')+'\n':'');assert.equal(result.added,b.length-lcs);assert.equal(result.removed,a.length-lcs);assert.equal(result.approximate,false);}
 assert.equal(stats('a\n'.repeat(2000),'b\n'.repeat(2000)).approximate,true);
});
