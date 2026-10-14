const fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '..');
const artifacts = process.env.GPTIDE_ACCEPTANCE_OUTPUT || path.join(root, 'downloads', 'acceptance', Date.now() + '-' + process.pid);
fs.mkdirSync(artifacts, { recursive: true });
let playwright;
try { playwright = require(process.env.GPTIDE_PLAYWRIGHT_MODULE || 'playwright'); }
catch { throw new Error('离线界面验收需要 Playwright。安装开发测试依赖，或设置 GPTIDE_PLAYWRIGHT_MODULE 为已有模块的完整路径。'); }
const chrome = process.env.GPTIDE_CHROMIUM || (process.platform === 'win32' && fs.existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe') ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : undefined);
// The editor's recent paths use a separate application-shared store, even with
// --user-data-dir. Every acceptance launch must isolate both stores.
const launch = playwright._electron.launch.bind(playwright._electron);
playwright._electron.launch = options => { const args = [...(options.args || [])], index = args.indexOf('--user-data-dir'); if (!args.includes('--shared-data-dir')) { if (index < 0 || !args[index + 1]) throw new Error('原生验收必须指定独立用户目录'); args.push('--shared-data-dir', path.join(args[index + 1], 'shared')); } return launch({ ...options, args }); };
module.exports = { playwright, artifacts, root, chromiumOptions: { headless: true, ...(chrome ? { executablePath: chrome } : {}) } };
