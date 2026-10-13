const storage = require('./storage.cjs');
class Drafts {
  constructor(file, projectKey) {
    this.file = file; this.projectKey = projectKey;
    const loaded = storage.read(file); this.revision = loaded.revision;
    if (loaded.state && loaded.state.projectKey !== projectKey) throw new Error('草稿不属于当前项目');
    this.records = new Map((loaded.state?.chats || []).filter(c => typeof c.id === 'string' && typeof c.draft === 'string').map(c => [c.id, { id: c.id, draft: c.draft.slice(0, 100000), draftUpdatedAt: Number(c.draftUpdatedAt) || 0 }]));
    this.recovered = loaded.recovered;
  }
  apply(chats) {
    for (const chat of chats) { const draft = this.records.get(chat.id); if (draft && draft.draftUpdatedAt >= (chat.draftUpdatedAt || 0)) Object.assign(chat, draft); }
  }
  set(id, text, time = Date.now()) {
    const record = { id, draft: text.slice(0, 100000), draftUpdatedAt: time };
    this.records.set(id, record);
    const state = { projectKey: this.projectKey, chats: [...this.records.values()] };
    if (this.conflictFile) { storage.write(this.conflictFile, state); throw new Error('另一窗口已更新草稿，本窗口内容保留为冲突副本'); }
    try { this.revision = storage.write(this.file, state, this.revision); }
    catch (error) { if (error.code === 'GPTIDE_CONFLICT') this.conflictFile = error.conflictFile; throw error; }
    return record;
  }
  remove(id) { this.records.delete(id); this.revision = storage.write(this.file, { projectKey: this.projectKey, chats: [...this.records.values()] }, this.revision); }
}
module.exports = { Drafts };
