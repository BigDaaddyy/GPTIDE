const { execFileSync } = require('node:child_process');
const fs = require('node:fs'); const path = require('node:path');
const root = path.resolve(__dirname, '..');
for (const folder of ['tools', 'builtin', 'test']) for (const file of fs.readdirSync(path.join(root, folder))) if (file.endsWith('.cjs')) execFileSync(process.execPath, ['--check', path.join(root, folder, file)]);
const html = fs.readFileSync(path.join(root, 'builtin', 'view.html'), 'utf8'); const js = html.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1];
new (require('node:vm').Script)(js);
console.log('全部 JavaScript 和内置聊天脚本语法检查通过');
