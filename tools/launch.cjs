const { spawn } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const paths=require('../app/resources/app/extensions/gptide-chat/data-paths.cjs'),where=paths.locations();paths.migrate(root,where);
paths.ensureDefaults(where.data);
const env = { ...process.env, GPTIDE_DATA_HOME:where.data, GPTIDE_EXTENSIONS_HOME:where.extensions }; delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(path.join(root, 'app', 'GPTIDE.exe'), ['--user-data-dir', where.data, '--shared-data-dir', path.join(where.data,'shared'), '--extensions-dir', where.extensions, '--new-window', ...process.argv.slice(2)], { env, detached: true, stdio: 'ignore', windowsHide: false });
child.on('error', e => { console.error(e.message); process.exitCode = 1; }); child.unref();
