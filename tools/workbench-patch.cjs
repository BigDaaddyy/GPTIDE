const marker = '/* GPTIDE: hide remote tunnel account menu */';
function hideTunnelMenu(source) {
  if (source.startsWith(marker)) return source;
  // Only remove Accounts menu contributions; keep commands and tunnel service.
  const pattern = /,?\{id:T\.AccountsContext,group:"2_remoteTunnel",when:y\.equals\(pR,"(?:disconnected|connected|connecting)"\)\}/g;
  const matches = source.match(pattern) || [];
  if (matches.length !== 3) throw new Error('原生远程隧道菜单结构已变化，请更新定制补丁');
  return marker + '\n' + source.replace(pattern, '');
}
const accountMarker = '/* GPTIDE: GPT account entry */';
function gptAccountMenu(source) {
  if (source.includes(accountMarker)) return source;
  const start = source.indexOf('B4=class extends cOe{');
  const begin = source.indexOf('async resolveMainMenuActions(e,t){', start);
  const end = source.indexOf('async resolveContextMenuActions(e){', begin);
  const name = 'name:d(6559,null)';
  if (start < 0 || begin < 0 || end < 0 || !source.slice(start, begin).includes(name)) throw new Error('原生账户入口结构已变化，请更新定制补丁');
  const menu = 'async resolveMainMenuActions(e,t){let a;try{a=await this.commandService.executeCommand("gptide.accountInfo")}catch{}return[Ht({id:"gptide.account.status",label:a?.label||"GPT 账户",enabled:!1,run:()=>{}}),Ht({id:"gptide.account.login",label:"登录 / 切换 ChatGPT 账户",run:()=>this.commandService.executeCommand("gptide.accountLogin")})]}';
  return source.slice(0, start) + source.slice(start, begin).replace(name, 'name:"GPT 账户"') + accountMarker + menu + source.slice(end);
}
module.exports = { hideTunnelMenu, gptAccountMenu };
