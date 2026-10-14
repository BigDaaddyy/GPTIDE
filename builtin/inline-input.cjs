async function prompt(vscode, editor) {
  const commands = await vscode.commands?.getCommands?.(true);
  if (commands?.includes('gptide.nativeInlineInput')) return vscode.commands.executeCommand('gptide.nativeInlineInput', { uri: editor.document.uri.toString(), lineNumber: editor.selection.start.line + 1, column: editor.selection.start.character + 1, nonce: require('node:crypto').randomUUID() });
  return vscode.window.showInputBox({ title: 'GptIDE · Ctrl+K 改写代码', prompt: editor.selection.isEmpty ? '描述要在光标处生成的代码' : '描述要如何修改选中的代码', placeHolder: '例如：转换为 async 函数，保持现有行为', ignoreFocusOut: true, validateInput: value => !value.trim() ? '请输入修改要求' : value.length > 4000 ? '修改要求过长' : null });
}
module.exports = { prompt };
