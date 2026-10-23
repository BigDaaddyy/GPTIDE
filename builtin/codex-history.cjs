const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const readline = require('node:readline');
const scope = require('./project-scope.cjs');

const home = () => process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
const timestamp = value => { const time = Date.parse(value); return Number.isFinite(time) ? time : 0; };
function publicText(content, role) {
  const parts = typeof content === 'string' ? [content] : (Array.isArray(content) ? content : []).filter(part => ['input_text', 'output_text', 'text', 'Text'].includes(part?.type)).map(part => part.text);
  return parts.filter(text => typeof text === 'string' && !(role === 'user' && /^\s*(?:<environment_context>|<external_codex_apps_open_page>|<in-app-browser-context|# AGENTS\.md instructions|<user_instructions>)/.test(text))).map(text => role === 'user' && text.includes('## My request:') ? text.slice(text.indexOf('## My request:') + 14).trim() : text).join('\n\n').trim();
}
async function* files(directory) {
  let entries;
  try { entries = await fs.promises.readdir(directory, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) yield* files(file);
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) yield file;
  }
}
async function readSession(file, project) {
  const stream = fs.createReadStream(file, { encoding: 'utf8' });
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let meta, cwd, hasContext = false, updatedAt = 0, ordinal = 0;
  const messages = [], seen = new Set();
  let events = [], responses = [];
  function flush() {
    // Codex records both public events and model input/output. Prefer public
    // events per role, so injected prompts and duplicate replies stay hidden.
    const roles = new Set(events.map(message => message.role));
    if (!scope.matches(cwd, project)) { events = []; responses = []; return; }
    for (const message of [...events, ...responses.filter(message => !roles.has(message.role))].sort((a, b) => a.ordinal - b.ordinal)) {
      if (message.id && seen.has(message.id)) continue;
      if (message.id) seen.add(message.id);
      const { id, ordinal: position, ...visible } = message;
      if (id) visible.codexMessageId = id;
      updatedAt = Math.max(updatedAt, visible.createdAt);
      messages.push(visible);
    }
    events = []; responses = [];
  }
  try {
    for await (const line of lines) {
      let record;
      try { record = JSON.parse(line.replace(/^\uFEFF/, '')); } catch { continue; } // A live writer may leave an incomplete last line.
      const payload = record?.payload;
      if (!payload || typeof payload !== 'object') continue;
      if (!meta) {
        if (record.type !== 'session_meta') continue;
        meta = payload;
        if (typeof meta.id !== 'string' || !meta.id || meta.source?.subagent || meta.thread_source?.subagent) return null;
        cwd = meta.cwd;
      }
      if (record.type === 'turn_context') { if (hasContext) flush(); cwd = payload.cwd || meta.cwd; hasContext = true; }
      if (record.type === 'event_msg' && ['task_started', 'task_complete'].includes(payload.type)) { flush(); if (payload.type === 'task_started') { cwd = meta.cwd; hasContext = false; } }
      let role, text, id, target;
      if (record.type === 'event_msg') {
        const item = payload.item;
        if (payload.type === 'item_completed' && ['UserMessage', 'AgentMessage'].includes(item?.type)) {
          role = item.type === 'UserMessage' ? 'user' : 'assistant'; text = publicText(item.content, role); id = item.id;
        } else if (['user_message', 'agent_message'].includes(payload.type)) {
          role = payload.type === 'user_message' ? 'user' : 'assistant'; text = publicText(payload.message, role);
        }
        target = events;
      } else if (record.type === 'response_item' && payload.type === 'message' && ['user', 'assistant'].includes(payload.role) && payload.channel !== 'analysis') {
        role = payload.role; text = publicText(payload.content, role); id = payload.id; target = responses;
      }
      if (text && role) target.push({ role, text, id, createdAt: timestamp(record.timestamp), ordinal: ordinal++ });
    }
    flush();
  } finally { lines.close(); stream.destroy(); }
  if (!meta || !messages.length) return null;
  return { id: 'codex:' + meta.id, source: 'codex', codexThreadId: meta.id, projectKey: scope.key(project), name: (messages.find(message => message.role === 'user')?.text || 'Codex').slice(0, 80), updatedAt, messages, tasks: [], changes: [], checkpoints: [] };
}
async function load({ project, codexHome = home() }) {
  if (!project) return { chats: [], warnings: [] };
  const chats = new Map(), warnings = [];
  for (const [directory, archived] of [['sessions', false], ['archived_sessions', true]]) {
    try {
      for await (const file of files(path.join(codexHome, directory))) {
        try {
          const chat = await readSession(file, project);
          if (!chat) continue;
          chat.archived = archived;
          const previous = chats.get(chat.id);
          if (!previous) chats.set(chat.id, chat);
          else {
            // Desktop context windows can share a thread ID across rollout files.
            // Merge those windows without repeating replayed message IDs.
            const key = (message, index) => message.codexMessageId || JSON.stringify([message.role, message.text, message.createdAt || index]);
            const combined = new Map(previous.messages.map((message, index) => [key(message, index), message]));
            for (const [index, message] of chat.messages.entries()) if (!combined.has(key(message, index))) combined.set(key(message, index), message);
            previous.messages = [...combined.values()].sort((a,b) => a.createdAt - b.createdAt);
            previous.updatedAt = Math.max(previous.updatedAt, chat.updatedAt);
            previous.archived = previous.archived && archived;
          }
        } catch { warnings.push('部分 Codex 会话暂时无法读取，刷新后重试。'); }
      }
    } catch { warnings.push('Codex 会话目录暂时无法读取。'); }
  }
  // Titles are optional; a corrupt or absent index never prevents recovery.
  const index = path.join(codexHome, 'session_index.jsonl');
  if (fs.existsSync(index)) {
    const stream = fs.createReadStream(index, { encoding: 'utf8' });
    const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
    try { for await (const line of lines) { try { const item = JSON.parse(line), chat = chats.get('codex:' + item.id); if (chat && typeof item.thread_name === 'string' && item.thread_name.trim()) chat.name = item.thread_name.trim().slice(0, 200); } catch {} } }
    catch { warnings.push('Codex 会话标题索引暂时无法读取。'); }
    finally { lines.close(); stream.destroy(); }
  }
  return { chats: [...chats.values()].sort((a, b) => b.updatedAt - a.updatedAt), warnings: [...new Set(warnings)] };
}
module.exports = { load, readSession };
