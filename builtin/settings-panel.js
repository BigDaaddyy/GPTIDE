const api = acquireVsCodeApi(), el = id => document.getElementById(id);
let data, pending = null, contextDirty = false, editVersion = 0;
const rows = new Map(), edits = new Map();
const send = (type, values = {}) => api.postMessage({ type, projectKey: data?.projectKey, ...values });
function status(value, error = false) { el('status').textContent = value || ''; el('status').classList.toggle('error', error); }
function contextValue() {
  return { files: el('files').value.split(/\r?\n/).map(value => value.trim()).filter(Boolean), excluded: el('excluded').value.split(/\r?\n/).map(value => value.trim()).filter(Boolean), rules: el('rules').value };
}
function controls() {
  el('scope').disabled = !!pending;
  for (const row of rows.values()) { row.input.disabled = row.reset.disabled = !!pending || !!row.field.applicationOnly && el('scope').value === 'project'; }
  const available = !!data?.project && !!data?.contextAvailable;
  for (const id of ['files','excluded','rules']) el(id).disabled = !available;
  el('choose').disabled = !available || !!pending;
  el('save').disabled = !available || !!pending || !contextDirty;
  el('context-reset').disabled = !available || !!pending || !contextDirty;
  el('context-status').textContent = pending?.kind === 'context' ? '保存中…' : contextDirty ? '未保存' : available ? '已保存' : '';
}
function restoreContext() {
  for (const [id, value] of Object.entries({ files: (data.context.files || []).join('\n'), excluded: (data.context.excluded || []).join('\n'), rules: data.context.rules || '' })) el(id).value = value;
  contextDirty = false; editVersion++; controls();
}
function commit(field, input, reset = false) {
  if (pending) return;
  if (!reset && field.type === 'number' && (!input.value.trim() || !input.checkValidity())) { status('请填写有效的 ' + field.label, true); input.focus(); return; }
  pending = { kind: 'setting', key: field.key, scope: el('scope').value }; controls(); status('保存中…');
  send('set', { key: field.key, scope: pending.scope, ...(reset ? { reset: true } : { value: field.type === 'boolean' ? input.checked : field.type === 'number' ? Number(input.value) : input.value }) });
}
function render(value) {
  if (data && data.projectKey !== value.projectKey) { edits.clear(); contextDirty = false; }
  data = value; el('scope').querySelector('[value=project]').disabled = !value.project;
  if (!value.project) el('scope').value = 'user'; el('effective').textContent = value.effective;
  const keys = new Set(value.fields.map(field => field.key));
  for (const [key, row] of rows) if (!keys.has(key)) { row.node.remove(); rows.delete(key); edits.delete(key); }
  for (const field of value.fields) {
    let row = rows.get(field.key);
    if (!row) {
      const node = document.createElement('div'); node.className = 'row';
      const label = document.createElement('label'), title = document.createElement('span'), hint = document.createElement('small'); label.append(title,hint);
      const input = document.createElement(field.enum ? 'select' : 'input'); input.id = 'setting-' + field.key; label.htmlFor = input.id;
      if (field.enum) for (const item of field.enum) input.add(new Option(item,item)); else input.type = field.type === 'boolean' ? 'checkbox' : field.type === 'number' ? 'number' : 'text';
      const reset = document.createElement('button'); reset.textContent = '重置'; reset.setAttribute('aria-label', '重置' + field.label);
      input.oninput = () => edits.set(field.key, input.type === 'checkbox' ? input.checked : input.value);
      input.onchange = () => commit(row.field,input); reset.onclick = () => commit(row.field,input,true);
      node.append(label,input,reset); el('fields').append(node); row = { node,label,title,hint,input,reset }; rows.set(field.key,row);
    }
    row.field = field; row.title.textContent = field.label; row.label.title = field.hint || '';
    const effective = field.effectiveValue ?? field.value;
    row.hint.textContent = field.source + ' · 生效：' + (typeof effective === 'boolean' ? effective ? '开启' : '关闭' : effective);
    const configured = el('scope').value === 'user' ? field.userValue ?? field.value : field.projectValue ?? field.value;
    const current = edits.has(field.key) ? edits.get(field.key) : configured;
    if (field.type === 'boolean') row.input.checked = !!current; else row.input.value = current ?? '';
    if (field.minimum !== undefined) row.input.min = field.minimum; if (field.maximum !== undefined) row.input.max = field.maximum;
  }
  el('project').textContent = value.project || '先打开一个项目文件夹'; if (!contextDirty) restoreContext(); controls();
}
window.addEventListener('message', event => {
  const value = event.data; if (!value || typeof value !== 'object') return;
  if (value.type === 'live') el('effective').textContent = value.effective;
  if (value.type === 'settingSaved' && pending?.kind === 'setting' && value.key === pending.key && value.scope === pending.scope) { edits.delete(value.key); pending = null; controls(); }
  if (value.type === 'state') { render(value); if (value.status !== undefined) status(value.status); }
  if (value.type === 'files' && Array.isArray(value.files)) { el('files').value = [...new Set([...el('files').value.split(/\r?\n/).filter(Boolean), ...value.files])].join('\n'); contextDirty = true; editVersion++; controls(); }
  if (value.type === 'contextSaved') { if (value.editVersion === editVersion) contextDirty = false; if (pending?.kind === 'context') pending = null; controls(); }
  if (value.type === 'error') { pending = null; status(value.message,true); controls(); }
});
for (const button of document.querySelectorAll('[data-command]')) button.onclick = () => send(button.dataset.command);
for (const id of ['files','excluded','rules']) el(id).oninput = () => { contextDirty = true; editVersion++; controls(); };
el('choose').onclick = () => send('choose'); el('context-reset').onclick = restoreContext;
el('save').onclick = () => { if (pending || !contextDirty) return; pending = { kind: 'context', version: editVersion }; controls(); send('context', { editVersion,...contextValue() }); };
el('scope').onchange = () => { if (pending) return; edits.clear(); if (data) render(data); send('refresh'); };
send('refresh');
