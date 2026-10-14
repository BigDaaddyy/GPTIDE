const path = require('node:path'), storage = require('./storage.cjs'), review = require('./review.cjs');
class ProjectContext {
  constructor(file, root, projectKey) {
    this.file = file; this.root = root; this.projectKey = projectKey;
    this.validate = state => {
      const error = message => { const value = new Error(message); value.code = 'GPTIDE_INVALID'; throw value; };
      if (state.projectKey !== projectKey || !require('./project-scope.cjs').matches(state.projectPath, root)) { const value = new Error('固定上下文不属于当前项目'); value.code = 'GPTIDE_FOREIGN'; throw value; }
      for (const key of ['files', 'excluded']) {
        if (!Array.isArray(state[key]) || state[key].length > 20) error('固定上下文路径数量无效');
        for (const item of state[key]) if (typeof item !== 'string' || !item || item.length > 1000 || path.isAbsolute(item) || /^[\\/]|^[a-z]:/i.test(item) || item.split(/[\\/]/).includes('..')) error('固定上下文路径无效');
      }
      if (typeof state.rules !== 'string' || state.rules.length > 30000) error('项目规则最多 30000 字符');
    };
    const loaded = storage.read(file, this.validate); this.revision = loaded.revision; this.recovered = loaded.recovered;
    this.state = loaded.state || { projectKey, projectPath: root, chats: [], files: [], excluded: [], rules: '' };
  }
  save(values) {
    const next = { ...this.state, ...values, projectKey: this.projectKey, projectPath: this.root, chats: [] };
    this.validate(next);
    for (const key of ['files', 'excluded']) {
      const paths = new Map(); for (const value of next[key]) { const name = path.posix.normalize(value.replaceAll('\\', '/')); paths.set(process.platform === 'win32' ? name.toLowerCase() : name, name); } next[key] = [...paths.values()];
    }
    const revision = storage.write(this.file, next, this.revision, this.validate);
    this.state = next; this.revision = revision; this.recovered = false;
  }
  excluded(relative) {
    const normalized = value => process.platform === 'win32' ? value.replaceAll('\\', '/').toLowerCase() : value;
    const name = normalized(relative);
    return this.state.excluded.some(value => name === normalized(value).replace(/\/$/, '') || name.startsWith(normalized(value).replace(/\/$/, '') + '/'));
  }
  labels() { return [...(this.state.rules.trim() ? ['项目规则'] : []), ...this.state.files.filter(file => !this.excluded(file))]; }
  read(maximum = 60000) {
    let text = '', remaining = maximum; const labels = [], warnings = [];
    const append = value => { const part = value.slice(0, remaining); text += part; remaining -= part.length; if (part.length < value.length) warnings.push('固定上下文已截断'); };
    if (this.state.rules.trim()) { append('\n\n项目开发规则：\n' + this.state.rules); labels.push('固定 · 项目规则'); }
    for (const relative of this.state.files) {
      if (this.excluded(relative)) continue;
      if (!remaining) { warnings.push('固定上下文已截断'); break; }
      const file = path.resolve(this.root, relative);
      try {
        if (!review.within(this.root, file)) throw new Error('文件不属于项目');
        const value = review.readText(file); if (value === null || value === undefined) throw new Error('文件不可读取');
        append('\n\n固定项目文件：' + relative + '\n' + value); labels.push('固定 · ' + relative);
      } catch { warnings.push('无法引用：' + relative); }
    }
    return { text, labels, warnings: [...new Set(warnings)] };
  }
}
module.exports = { ProjectContext };
