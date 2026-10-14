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
function inlineInput(source, widgetSource) {
  const start = '/* GPTIDE INLINE START */', end = '/* GPTIDE INLINE END */';
  source = source.replace(/\/\* GPTIDE INLINE START \*\/[\s\S]*?\/\* GPTIDE INLINE END \*\//g, '');
  const anchor = '$e.registerCommand("noop",()=>{});';
  if (source.split(anchor).length !== 2 || !source.includes('const o=e.get(Ai),r=o.getFocusedCodeEditor()||o.getActiveCodeEditor()')) throw new Error('原生编辑器命令结构已变化，请更新 Ctrl+K 补丁');
  return source.replace(anchor, start + widgetSource + end + anchor);
}
function compactChatChrome(source){
  const relayoutMarker='/* GPTIDE: relayout chat chrome */';
  if(!source.includes(relayoutMarker)){
    const open='this.activePaneContextKey.set(t),this.element.dataset.activeComposite=t}',close='this.activePaneContextKey.reset(),delete this.element.dataset.activeComposite)';
    if(!source.includes(open)||!source.includes(close))throw new Error('原生侧栏切换结构已变化，请更新聊天栏补丁');
    source=source.replace(open,'this.activePaneContextKey.set(t),this.element.dataset.activeComposite=t;'+relayoutMarker+'this.partId==="workbench.parts.auxiliarybar"&&this.relayout()}').replace(close,'this.activePaneContextKey.reset(),delete this.element.dataset.activeComposite,this.partId==="workbench.parts.auxiliarybar"&&this.relayout())');
  }
  const marker='/* GPTIDE: compact chat chrome */',condition='const gptideCompact=this.contentArea?.parentElement?.id==="workbench.parts.auxiliarybar"&&this.contentArea?.parentElement?.dataset.activeComposite==="workbench.view.extension.gptide";';if(source.includes(marker))return source.replace(/const gptideCompact=[^;]+;/,condition);
  const start=source.indexOf('layout(e,t){const s=this.layoutService.isFloatingPanelsEnabled();let n;if(this.options.hasTitle)'),end=source.indexOf('setFooterVisibility(e)',start);
  if(start<0||end<0||end-start>1600)throw new Error('原生侧栏布局结构已变化，请更新聊天栏补丁');
  const original=source.slice(start,end),patched=original.replace('let n;if(this.options.hasTitle)',marker+condition+'let n;if(this.options.hasTitle&&!gptideCompact)').replace('if(this.headerVisible)','if(this.headerVisible&&!gptideCompact)').replace('if(this.footerVisible)','if(this.footerVisible&&!gptideCompact)');
  return source.slice(0,start)+patched+source.slice(end);
}
module.exports = { hideTunnelMenu, gptAccountMenu, homePage, inlineInput, compactChatChrome };
