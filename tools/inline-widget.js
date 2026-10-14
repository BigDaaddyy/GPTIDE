// Injected into the pinned editor workbench, beside the command registry.
$e.registerCommand('gptide.nativeInlineInput', (accessor, options) => {
  const service = accessor.get(Ai), editor = service.getFocusedCodeEditor() || service.getActiveCodeEditor();
  if (!editor || !editor.getModel() || editor.getModel().uri.toString() !== options?.uri) return undefined;
  editor.__gptideInlineInput?.();
  return new Promise(resolve => {
    const model = editor.getModel(), box = document.createElement('div'), input = document.createElement('textarea'), actions = document.createElement('div'), status = document.createElement('span'), submit = document.createElement('button'), cancel = document.createElement('button');
    box.className = 'gptide-inline-input'; actions.className = 'gptide-inline-actions'; input.placeholder = '描述选区修改要求…'; input.setAttribute('aria-label', 'Ctrl+K 修改要求'); input.rows = 2; input.maxLength = 4000;
    submit.textContent = '生成'; cancel.textContent = '取消'; status.textContent = 'Enter 生成 · Shift+Enter 换行'; actions.append(status, submit, cancel); box.append(input, actions);
    const position = model.validatePosition({ lineNumber: options.lineNumber, column: options.column }), widget = { getId: () => 'gptide.inline.' + options.nonce, getDomNode: () => box, getPosition: () => ({ position, preference: [2, 1] }), allowEditorOverflow: false };
    let done = false; const subscriptions = [];
    const finish = value => { if (done) return; done = true; subscriptions.forEach(item => item.dispose()); if (editor.__gptideInlineInput === dismiss) delete editor.__gptideInlineInput; try { editor.removeContentWidget(widget); editor.focus(); } catch {} finally { resolve(value); } };
    const dismiss = () => finish(undefined); editor.__gptideInlineInput = dismiss;
    submit.onclick = () => { const value = input.value.trim(); if (value) finish(value); else status.textContent = '请输入修改要求'; }; cancel.onclick = dismiss;
    input.onkeydown = event => { if (event.isComposing || event.keyCode === 229) return; if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dismiss(); } else if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.stopPropagation(); submit.onclick(); } };
    box.onmousedown = event => event.stopPropagation();
    box.style.width = Math.max(180, Math.min(430, editor.getLayoutInfo().contentWidth - 20)) + 'px';
    subscriptions.push(editor.onDidChangeModel(dismiss), editor.onDidChangeModelContent(dismiss), editor.onDidDispose(dismiss));
    if (typeof ResizeObserver !== 'undefined') { const observer = new ResizeObserver(() => { if (!done) editor.layoutContentWidget(widget); }); observer.observe(box); subscriptions.push({ dispose: () => observer.disconnect() }); }
    editor.addContentWidget(widget); editor.layoutContentWidget(widget); input.focus();
  });
});
$e.registerCommand('gptide.cancelInlineInput', accessor => {
  const service = accessor.get(Ai); for (const editor of service.listCodeEditors()) editor.__gptideInlineInput?.();
});
