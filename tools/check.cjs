const { execFileSync } = require('node:child_process');
const fs = require('node:fs'); const path = require('node:path');
const root = path.resolve(__dirname, '..');
for (const folder of ['tools', 'builtin', 'test']) for (const file of fs.readdirSync(path.join(root, folder))) if (/\.(cjs|js)$/.test(file)) execFileSync(process.execPath, ['--check', path.join(root, folder, file)]);
const source = name => fs.readFileSync(path.join(root, 'builtin', name), 'utf8');
const html = source('view.html').replace('__MARKDOWN__', () => source('markdown.cjs')).replace('__SCRIPT__', () => source('view.js'));
new (require('node:vm').Script)(html.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1]);
console.log('全部 JavaScript 和内置聊天脚本语法检查通过');
