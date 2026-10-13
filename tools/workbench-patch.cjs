const marker = '/* GPTIDE: hide remote tunnel account menu */';
function hideTunnelMenu(source) {
  if (source.startsWith(marker)) return source;
  // Only remove Accounts menu contributions; keep commands and tunnel service.
  const pattern = /,?\{id:T\.AccountsContext,group:"2_remoteTunnel",when:y\.equals\(pR,"(?:disconnected|connected|connecting)"\)\}/g;
  const matches = source.match(pattern) || [];
  if (matches.length !== 3) throw new Error('原生远程隧道菜单结构已变化，请更新定制补丁');
  return marker + '\n' + source.replace(pattern, '');
}
module.exports = { hideTunnelMenu };
