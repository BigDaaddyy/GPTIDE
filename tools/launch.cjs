const { spawn } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const child = spawn(path.join(root, 'app', 'VSCodium.exe'), ['--user-data-dir', path.join(root, 'data', 'user'), '--extensions-dir', path.join(root, 'data', 'extensions'), '--new-window', ...process.argv.slice(2)], { detached: true, stdio: 'ignore', windowsHide: false });
child.on('error', e => { console.error(e.message); process.exitCode = 1; }); child.unref();
