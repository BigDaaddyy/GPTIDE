function lines(text){if(!text)return[];const result=text.split('\n');if(result.at(-1)==='')result.pop();else result[result.length-1]+='\0';return result;}
function stats(before,after){
  if(before===after)return{added:0,removed:0,approximate:false};
  const a=lines(before),b=lines(after);let start=0,endA=a.length,endB=b.length;
  while(start<endA&&start<endB&&a[start]===b[start])start++;
  while(endA>start&&endB>start&&a[endA-1]===b[endB-1]){endA--;endB--;}
  const n=endA-start,m=endB-start;
  if(!n&&!m)return{added:b.length?1:0,removed:a.length?1:0,approximate:false};
  if(!n||!m)return{added:m,removed:n,approximate:false};
  const v=new Map([[1,0]]);let work=0;
  for(let d=0;d<=n+m;d++)for(let k=-d;k<=d;k+=2){
    if(++work>200000)return{added:m,removed:n,approximate:true};
    let x=k===-d||k!==d&&(v.get(k-1)??-1)<(v.get(k+1)??-1)?v.get(k+1)||0:(v.get(k-1)||0)+1,y=x-k;
    while(x<n&&y<m&&a[start+x]===b[start+y]){x++;y++;}
    v.set(k,x);if(x>=n&&y>=m)return{added:(d+m-n)/2,removed:(d+n-m)/2,approximate:false};
  }
}
module.exports={stats};
