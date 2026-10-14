const { execFileSync } = require('node:child_process');
const fs = require('node:fs'); const path = require('node:path');
const root = path.resolve(__dirname, '..');
function check(folder) { for (const entry of fs.readdirSync(folder, { withFileTypes: true })) { const file = path.join(folder, entry.name); if (entry.isDirectory()) check(file); else if (/\.(cjs|js)$/.test(entry.name)) execFileSync(process.execPath, ['--check', file]); } }
for (const folder of ['tools', 'builtin', 'test']) check(path.join(root, folder));
const source = name => fs.readFileSync(path.join(root, 'builtin', name), 'utf8');
const html = source('view.html').replace('__MARKDOWN__', () => source('markdown.cjs')).replace('__FIND__', () => source('find.cjs')).replace('__ACTIONS__', () => source('quick-actions.cjs')).replace('__SCRIPT__', () => source('view.js'));
new (require('node:vm').Script)(html.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1]);
new (require('node:vm').Script)(source('settings-panel.html').replace('__SCRIPT__', () => source('settings-panel.js')).match(/<script[^>]*>([\s\S]*?)<\/script>/)[1]);
console.log('全部 JavaScript 和内置聊天脚本语法检查通过');
