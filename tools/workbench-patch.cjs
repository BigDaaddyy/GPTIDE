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
  const start = source.indexOf('B4=class extends cOe{');
  const marked = source.indexOf(accountMarker, start);
  const begin = marked >= 0 ? marked : source.indexOf('async resolveMainMenuActions(e,t){', start);
  const end = source.indexOf('async resolveContextMenuActions(e){', begin);
  const name = 'name:d(6559,null)';
  if (start < 0 || begin < 0 || end < 0 || ![name, 'name:"GPT 账户"'].some(n => source.slice(start, begin).includes(n))) throw new Error('原生账户入口结构已变化，请更新定制补丁');
  const menu = 'async resolveMainMenuActions(e,t){let a;try{a=await this.commandService.executeCommand("gptide.accountInfo")}catch{}return[Ht({id:"gptide.account.status",label:a?.label||"GPT 账户",enabled:!1,run:()=>{}}),Ht({id:"gptide.account.usage",label:"快速查看用量",run:()=>this.commandService.executeCommand("gptide.usage")}),Ht({id:"gptide.account.settings",label:"Codex 配置",run:()=>this.commandService.executeCommand("gptide.settings")}),Ht({id:"gptide.account.login",label:"登录 / 切换 ChatGPT 账户",run:()=>this.commandService.executeCommand("gptide.accountLogin")})]}';
  return source.slice(0, start) + source.slice(start, begin).replace(name, 'name:"GPT 账户"') + accountMarker + menu + source.slice(end);
}
function homePage(source, renderSource) {
  const marker = '/* GPTIDE: project home */';
  const classStart = source.indexOf('ECt=class extends L{');
  const existing = source.indexOf(marker, classStart);
  const begin = existing >= 0 ? existing : source.indexOf('render(){if(this.enabled=', classStart);
  const end = source.indexOf('filterEntries(e){', begin);
  if (classStart < 0 || begin < 0 || end < 0) throw new Error('原生空白编辑器结构已变化，请更新首页补丁');
  const method = renderSource.trim().replace(/^function render\(\)/, 'render()');
  return source.slice(0, begin) + marker + method + source.slice(end);
}
module.exports = { hideTunnelMenu, gptAccountMenu, homePage };
