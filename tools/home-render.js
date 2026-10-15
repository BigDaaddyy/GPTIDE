function render() {
  this.shortcuts.replaceChildren();
  this.transientDisposables.clear();
  const generation = this.homeGeneration = (this.homeGeneration || 0) + 1;
  const workspace = this.contextService.getWorkspace();
  const hasProject = workspace.folders.length > 0 || !!workspace.configuration;
  this.shortcuts.closest('.editor-group-watermark-wrapper')?.classList.toggle('gptide-project-open', hasProject);
  this.enabled = !hasProject;
  if (hasProject) return;
  const commands = this.instantiationService.invokeFunction(accessor => accessor.get(Ie));
  const home = document.createElement('section'); home.className = 'gptide-home'; home.setAttribute('aria-label', 'GptIDE 项目首页');
  const make = (tag, className, text, parent) => { const node = document.createElement(tag); node.className = className; if (text) node.textContent = text; parent.append(node); return node; };
  const run = (command, ...args) => commands.executeCommand(command, ...args).catch(() => commands.executeCommand('gptide.homeError', command));
  const brand = make('div', 'gptide-home-brand', '', home);
  make('span', 'gptide-home-mark', 'G', brand); make('h1', '', 'GptIDE', brand);
  const meta = make('div', 'gptide-home-meta', '', home);
  const account = make('button', '', 'GPT 账户', meta); account.onclick = () => run('gptide.homeAccount');
  make('span', '', '·', meta); const settings = make('button', '', '设置', meta); settings.onclick = () => run('gptide.settings');
  make('span', '', '·', meta); const usage = make('button', '', '用量', meta); usage.onclick = () => run('gptide.usage');
  const actions = make('div', 'gptide-home-actions', '', home);
  const tiles = [['folder-opened', '打开项目', 'workbench.action.files.openFolder'], ['repo-clone', '克隆仓库', 'git.clone'], ['terminal', '通过 SSH 连接', 'gptide.homeSSH'], ['account', 'GPT 账户', 'gptide.homeAccount']];
  for (const [icon, title, command] of tiles) {
    const button = make('button', 'gptide-home-tile' + (command === 'gptide.homeAccount' ? ' primary' : ''), '', actions);
    make('span', 'codicon codicon-' + icon, '', button).setAttribute('aria-hidden', 'true');
    make('span', '', title, button); button.onclick = () => run(command);
  }
  const recent = make('div', 'gptide-home-recents', '', home);
  const heading = make('div', 'gptide-home-recent-heading', '', recent); make('span', '', '最近项目', heading);
  const all = make('button', '', '查看全部', heading); all.onclick = () => run('workbench.action.openRecent');
  const list = make('div', 'gptide-home-recent-list', '', recent);
  make('p', 'gptide-home-empty', '正在读取…', list);
  this.shortcuts.append(home);
  commands.executeCommand('_workbench.getRecentlyOpened').then(data => {
    if (this.homeGeneration !== generation) return;
    list.replaceChildren();
    const entries = data?.workspaces || [];
    if (entries.length) all.textContent = '查看全部 (' + entries.length + ')';
    for (const entry of entries.slice(0, 5)) {
      const uri = entry.folderUri || entry.workspace?.configPath; if (!uri) continue;
      const file = uri.fsPath || uri.path || '', parts = file.replaceAll('\\', '/').split('/').filter(Boolean);
      const name = parts.pop() || entry.label || '项目';
      const button = make('button', 'gptide-home-recent', '', list); button.title = file;
      make('span', 'name', name.replace(/\.code-workspace$/, ''), button);
      make('span', 'path', parts.join('/'), button);
      button.onclick = () => run('gptide.homeOpenRecent', uri.toString(), !!entry.workspace, entry.remoteAuthority);
    }
    if (!list.children.length) make('p', 'gptide-home-empty', '暂无最近项目', list);
  }).catch(() => { if (this.homeGeneration === generation) { list.replaceChildren(); make('p', 'gptide-home-empty', '暂无最近项目', list); } });
  commands.executeCommand('gptide.accountInfo').then(info => { if (this.homeGeneration === generation && info?.label) account.textContent = info.label.replace(/^GPT 账户 · /, ''); }).catch(() => {});
}
