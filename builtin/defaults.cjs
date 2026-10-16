module.exports = { settings: {
  'workbench.colorTheme': 'Default Light Modern',
  'workbench.startupEditor': 'none',
  'workbench.sideBar.location': 'left',
  'workbench.activityBar.location': 'top',
  'workbench.editor.empty.hint': 'hidden',
  'window.title': '${rootName}${separator}GPTIDE',
  'window.commandCenter': true,
  'window.restoreWindows': 'one',
  'editor.fontSize': 14,
  'editor.minimap.enabled': false,
  'telemetry.telemetryLevel': 'off',
  'update.mode': 'none',
  'extensions.autoUpdate': false,
  'gptide.model': 'gpt-6.1-sol',
  'workbench.colorCustomizations': { 'focusBorder': '#5E6AD2', 'button.background': '#5E6AD2', 'button.hoverBackground': '#4D59BE', 'activityBarBadge.background': '#5E6AD2', 'sideBar.background': '#F8F9FB' }
}, keybindings: [
 {key:'ctrl+k',command:'gptide.inlineEdit',when:'editorTextFocus && workspaceFolderCount == 1'},
 {key:'ctrl+shift+k',command:'gptide.attachSelection',when:'editorTextFocus && workspaceFolderCount == 1'}
] };
