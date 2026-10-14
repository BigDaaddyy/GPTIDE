const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const patch = require('../tools/workbench-patch.cjs');
test('native inline patch is idempotent and rejects a changed editor registry', () => {
  const source = '$e.registerCommand("noop",()=>{});const o=e.get(Ai),r=o.getFocusedCodeEditor()||o.getActiveCodeEditor();', widget = fs.readFileSync(path.join(__dirname, '../tools/inline-widget.js'), 'utf8');
  const once = patch.inlineInput(source, widget); assert.equal(patch.inlineInput(once, widget), once); assert.throws(() => patch.inlineInput('changed', widget), /结构已变化/);
});
test('native input supports IME, newline, submit and cancellation without modifying a document', async () => {
  const commands = new Map(), listeners = [], elements = [];
  const editor = { getModel: () => ({ uri: { toString: () => 'file:///qa.js' }, validatePosition: value => value }), getLayoutInfo: () => ({ contentWidth: 500 }), onDidChangeModel: fn => { listeners.push(fn); return { dispose() {} }; }, onDidChangeModelContent: fn => { listeners.push(fn); return { dispose() {} }; }, onDidDispose: fn => { listeners.push(fn); return { dispose() {} }; }, addContentWidget: value => { editor.widget = value; }, layoutContentWidget() {}, removeContentWidget() { editor.widget = null; }, focus() {} };
  const document = { createElement: tag => { const value = { tag, style: {}, append() {}, setAttribute() {}, focus() {}, value: '' }; elements.push(value); return value; } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../tools/inline-widget.js'), 'utf8'), { $e: { registerCommand: (key, value) => commands.set(key, value) }, Ai: 'editorService', document });
  const accessor = { get: () => ({ getFocusedCodeEditor: () => editor, getActiveCodeEditor: () => editor, listCodeEditors: () => [editor] }) };
  const pending = commands.get('gptide.nativeInlineInput')(accessor, { uri: 'file:///qa.js', lineNumber: 2, column: 1, nonce: 'qa' }), input = elements.find(element => element.tag === 'textarea');
  input.value = 'QA instruction'; input.onkeydown({ key: 'Enter', isComposing: true }); assert.ok(editor.widget); input.onkeydown({ key: 'Enter', shiftKey: true }); assert.ok(editor.widget);
  input.onkeydown({ key: 'Enter', preventDefault() {}, stopPropagation() {} }); assert.equal(await pending, 'QA instruction'); assert.equal(editor.widget, null);
  const canceled = commands.get('gptide.nativeInlineInput')(accessor, { uri: 'file:///qa.js', lineNumber: 2, column: 1, nonce: 'qa2' }); commands.get('gptide.cancelInlineInput')(accessor); assert.equal(await canceled, undefined);
});
