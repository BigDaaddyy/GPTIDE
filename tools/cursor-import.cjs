const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { fileURLToPath } = require('node:url');
const { DatabaseSync } = require('node:sqlite');

function normalize(p) { return path.resolve(p).replace(/[\\/]+$/, '').replaceAll('\\', '/').toLowerCase(); }
function decode(value) { try { return JSON.parse(Buffer.isBuffer(value) || value instanceof Uint8Array ? Buffer.from(value).toString('utf8') : value); } catch { return null; } }
function uriPath(uri) { try { return fileURLToPath(uri); } catch { return ''; } }
function snapshot(file, temp, name) {
  if (!fs.existsSync(file)) return null;
  const destination = path.join(temp, name);
  // SQLite runs on a copy, including the WAL, never on the live Cursor database.
  for (const suffix of ['', '-wal', '-shm']) if (fs.existsSync(file + suffix)) fs.copyFileSync(file + suffix, destination + suffix);
  return new DatabaseSync(destination);
}
function readJson(db, table, key) {
  if (!db) return null;
  try { const row = db.prepare(`SELECT value FROM ${table} WHERE key = ?`).get(key); return row ? decode(row.value) : null; } catch { return null; }
}
function extractMessages(composer, db, id) {
  let bubbles = composer.conversation;
  if (!Array.isArray(bubbles) || !bubbles.length) {
    const headers = composer.fullConversationHeadersOnly || [];
    bubbles = headers.map(h => readJson(db, 'cursorDiskKV', `bubbleId:${id}:${h.bubbleId}`) || composer.conversationMap?.[h.bubbleId]).filter(Boolean);
  }
  if ((!bubbles || !bubbles.length) && composer.conversationMap) bubbles = Object.values(composer.conversationMap);
  return (bubbles || []).map(b => ({ role: b.type === 1 || b.role === 'user' ? 'user' : 'assistant', text: typeof b.text === 'string' ? b.text : typeof b.content === 'string' ? b.content : '', createdAt: b.createdAt || 0 })).filter(m => m.text.trim());
}
function importProject(project, userRoot) {
  userRoot ||= path.join(process.env.APPDATA || '', 'Cursor', 'User');
  const storage = path.join(userRoot, 'workspaceStorage');
  if (!fs.existsSync(storage)) return { chats: [], warnings: [], matchedWorkspaces: 0 };
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'gptide-cursor-'));
  const chats = new Map(), warnings = []; const open = []; let matchedWorkspaces = 0;
  try {
    const global = snapshot(path.join(userRoot, 'globalStorage', 'state.vscdb'), temp, 'global.db');
    if (global) open.push(global);
    for (const name of fs.readdirSync(storage)) {
      const folder = path.join(storage, name);
      let workspace; try { workspace = JSON.parse(fs.readFileSync(path.join(folder, 'workspace.json'), 'utf8')); } catch { continue; }
      let folders = workspace.folder ? [uriPath(workspace.folder)] : [];
      if (workspace.workspace) {
        try { const configPath = uriPath(workspace.workspace); const config = JSON.parse(fs.readFileSync(configPath, 'utf8')); folders = (config.folders || []).map(f => f.uri ? uriPath(f.uri) : path.resolve(path.dirname(configPath), f.path)); } catch { continue; }
      }
      // A multi-root Cursor composer belongs to the workspace, not one project.
      // Never expose that shared conversation under an individual project.
      if (folders.length !== 1 || !folders[0] || normalize(folders[0]) !== normalize(project)) continue;
      matchedWorkspaces++;
      let db; try { db = snapshot(path.join(folder, 'state.vscdb'), temp, name + '.db'); if (db) open.push(db); } catch (e) { warnings.push(`读取工作区失败：${e.message}`); continue; }
      const index = readJson(db, 'ItemTable', 'composer.composerData');
      const headers = index?.allComposers || index?.composers || (Array.isArray(index) ? index : []);
      for (const header of headers) {
        const id = header.composerId || header.id; if (!id) continue;
        const composer = readJson(global, 'cursorDiskKV', 'composerData:' + id) || readJson(db, 'cursorDiskKV', 'composerData:' + id) || header;
        const explicitOwner = composer.projectPath || header.projectPath;
        if (typeof explicitOwner === 'string' && normalize(explicitOwner) !== normalize(project)) continue;
        const messages = extractMessages(composer, global, id);
        if (!messages.length) messages.push(...extractMessages(composer, db, id));
        if (messages.length) chats.set(id, { id: 'cursor:' + id, source: 'cursor', name: header.name || composer.name || messages[0].text.slice(0, 36), updatedAt: header.lastUpdatedAt || composer.lastUpdatedAt || composer.createdAt || 0, messages });
      }
      // Older Cursor versions store chat tabs directly in the workspace ItemTable.
      const legacy = readJson(db, 'ItemTable', 'workbench.panel.aichat.view.aichat.chatdata');
      for (const tab of legacy?.tabs || []) {
        const messages = (tab.bubbles || []).map(b => ({ role: b.type === 'user' || b.type === 1 ? 'user' : 'assistant', text: b.text || '' })).filter(m => m.text.trim());
        if (messages.length) chats.set(tab.id, { id: 'cursor:legacy:' + tab.id, source: 'cursor', name: tab.name || messages[0].text.slice(0, 36), updatedAt: tab.lastUpdatedAt || 0, messages });
      }
    }
  } catch (e) { warnings.push(e.message); }
  finally { for (const db of open) db.close(); fs.rmSync(temp, { recursive: true, force: true }); }
  return { chats: [...chats.values()].sort((a, b) => b.updatedAt - a.updatedAt), warnings, matchedWorkspaces };
}
if (require.main === module) {
  const result = importProject(process.argv[2], process.argv[3]?.startsWith('--') ? undefined : process.argv[3]);
  if (process.argv.includes('--summary')) console.log(JSON.stringify({ matchedWorkspaces: result.matchedWorkspaces, chats: result.chats.length, messages: result.chats.reduce((n, c) => n + c.messages.length, 0), warnings: result.warnings }));
  else process.stdout.write(JSON.stringify(result));
}
module.exports = { importProject, extractMessages, normalize };
