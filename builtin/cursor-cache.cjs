const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), { fileURLToPath } = require('node:url');
const scope = require('./project-scope.cjs');
function fingerprint(userRoot) {
  try {
    const entries = [], stamp = file => {
      try { const s = fs.statSync(file); entries.push([file,s.size,s.mtimeMs,s.ctimeMs]); }
      catch (error) { if (error.code !== 'ENOENT') throw error; entries.push([file,null]); }
    };
    const database = file => { for (const suffix of ['', '-wal', '-shm']) stamp(file + suffix); };
    database(path.join(userRoot,'globalStorage/state.vscdb'));
    const storage = path.join(userRoot,'workspaceStorage'); stamp(storage);
    for (const name of fs.existsSync(storage) ? fs.readdirSync(storage).sort() : []) {
      const folder = path.join(storage,name), workspace = path.join(folder,'workspace.json'); stamp(workspace); database(path.join(folder,'state.vscdb'));
      try { const value = JSON.parse(fs.readFileSync(workspace,'utf8')); if (value.workspace) stamp(fileURLToPath(value.workspace)); }
      catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
    }
    return crypto.createHash('sha256').update(JSON.stringify(entries)).digest('hex');
  } catch { return null; }
}
async function cachedImport({ project, userRoot, file, load, force = false }) {
  const projectKey = scope.key(project), source = scope.normalize(userRoot), before = fingerprint(userRoot);
  if (before && !force) try {
    const cache = JSON.parse(fs.readFileSync(file,'utf8'));
    if (cache.version === 1 && cache.projectKey === projectKey && cache.source === source && cache.fingerprint === before && valid(cache.result)) return cache.result;
  } catch {}
  if (force) try { fs.rmSync(file,{force:true}); } catch {}
  const result = await load();
  if (before && valid(result) && !result.warnings.length && fingerprint(userRoot) === before) {
    const temp = file + '.tmp-' + crypto.randomUUID();
    try {
      fs.mkdirSync(path.dirname(file),{recursive:true});
      fs.writeFileSync(temp,JSON.stringify({version:1,projectKey,source,fingerprint:before,result}));fs.renameSync(temp,file);
    } catch {} finally { try { fs.rmSync(temp,{force:true}); } catch {} }
  }
  return result;
}
function valid(result) { return !!result && Array.isArray(result.chats) && Array.isArray(result.warnings) && result.chats.every(c => typeof c?.id === 'string' && c.source === 'cursor' && Array.isArray(c.messages)); }
module.exports = { cachedImport, fingerprint };
