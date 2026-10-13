const fs = require('node:fs'), path = require('node:path'), zlib = require('node:zlib');
function jsonc(text) {
  let out = '', quoted = false, escape = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i + 1];
    if (quoted) { out += c; if (escape) escape = false; else if (c === '\\') escape = true; else if (c === '"') quoted = false; }
    else if (c === '"') { quoted = true; out += c; }
    else if (c === '/' && n === '/') { while (i < text.length && text[i] !== '\n') i++; out += '\n'; }
    else if (c === '/' && n === '*') { i += 2; while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++; i++; out += ' '; }
    else if (c === ',' && /^\s*[}\]]/.test(text.slice(i + 1))) out += ' ';
    else out += c;
  }
  let clean = ''; quoted = false; escape = false;
  for (let i = 0; i < out.length; i++) {
    const c = out[i];
    if (quoted) { clean += c; if (escape) escape = false; else if (c === '\\') escape = true; else if (c === '"') quoted = false; }
    else if (c === '"') { quoted = true; clean += c; }
    else if (c !== ',' || !/^\s*[}\]]/.test(out.slice(i + 1))) clean += c;
  }
  return JSON.parse(clean.replace(/^\uFEFF/, ''));
}
function scan(user, extensions) {
  const settingsFile = path.join(user, 'settings.json');
  const settings = fs.existsSync(settingsFile) ? jsonc(fs.readFileSync(settingsFile, 'utf8')) : {};
  if (!settings || Array.isArray(settings) || typeof settings !== 'object') throw new Error('settings.json 必须为对象');
  const plugins = [], warnings = [];
  let index;
  try { index = JSON.parse(fs.readFileSync(path.join(extensions, 'extensions.json'), 'utf8')); } catch {}
  const names = Array.isArray(index) ? index.map(e => e.location?.fsPath || (e.relativeLocation && path.join(extensions, e.relativeLocation))).filter(Boolean) : fs.existsSync(extensions) ? fs.readdirSync(extensions).filter(n => !n.startsWith('.')).map(n => path.join(extensions, n)) : [];
  const seen = new Set();
  for (const directory of names) {
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
      const id = `${manifest.publisher}.${manifest.name}`;
      if (!manifest.publisher || !manifest.name || !manifest.version || seen.has(id)) continue;
      seen.add(id); plugins.push({ id, directory, manifest });
    } catch { warnings.push(`无法读取插件：${path.basename(directory)}`); }
  }
  const keysFile = path.join(user, 'keybindings.json');
  const keybindings = fs.existsSync(keysFile) ? jsonc(fs.readFileSync(keysFile, 'utf8')) : [];
  if (!Array.isArray(keybindings)) throw new Error('keybindings.json 必须为数组');
  return { settings, keybindings, plugins, warnings };
}
function mergeKeybindings(current, source, overwrite) {
  const result = [...current];
  for (const binding of source) {
    if (!binding || typeof binding.key !== 'string' || typeof binding.command !== 'string') continue;
    const matches = result.map((b, i) => b.key.toLowerCase() === binding.key.toLowerCase() && (b.when || '') === (binding.when || '') ? i : -1).filter(i => i >= 0);
    if (result.some(b => b.key.toLowerCase() === binding.key.toLowerCase() && b.command.startsWith('gptide.'))) continue;
    if (matches.length && !overwrite) continue;
    for (const i of matches.reverse()) result.splice(i, 1);
    result.push(binding);
  }
  return result;
}
function mergeSettings(current, source, overwrite) {
  const result = { ...current };
  for (const [key, value] of Object.entries(source)) {
    if (key.startsWith('gptide.') || ['extensions.gallery', 'update.mode', 'extensions.autoUpdate'].includes(key)) continue;
    if (overwrite || !Object.hasOwn(result, key)) Object.defineProperty(result, key, { value, enumerable: true, writable: true, configurable: true });
  }
  return result;
}
const xml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
function crc32(data) { let crc = -1; for (const b of data) { crc ^= b; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); } return (crc ^ -1) >>> 0; }
// Package an already installed extension for the editor's native VSIX installer.
// Native installation validates engine compatibility and registers the extension.
function packagePlugin(plugin, file) {
  const m = plugin.manifest, entries = [], chunks = [], central = []; let offset = 0;
  const walk = (dir, prefix) => { for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    if (item.isSymbolicLink()) throw new Error('插件包含符号链接，请通过扩展面板重新安装');
    const full = path.join(dir, item.name), name = prefix + item.name;
    if (item.isDirectory()) walk(full, name + '/'); else if (item.isFile()) entries.push([name, fs.readFileSync(full)]);
  } };
  walk(plugin.directory, 'extension/');
  if (entries.length > 65530 || entries.reduce((n, e) => n + e[1].length, 0) > 512 * 1024 * 1024) throw new Error('插件包过大，请通过扩展面板安装');
  entries.push(['extension.vsixmanifest', Buffer.from(`<?xml version="1.0"?><PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011"><Metadata><Identity Language="en-US" Id="${xml(m.name)}" Version="${xml(m.version)}" Publisher="${xml(m.publisher)}"/><DisplayName>${xml(m.displayName || m.name)}</DisplayName><Description xml:space="preserve">${xml(m.description || m.name)}</Description><Properties><Property Id="Microsoft.VisualStudio.Code.Engine" Value="${xml(m.engines?.vscode || '*')}"/></Properties></Metadata><Installation><InstallationTarget Id="Microsoft.VisualStudio.Code"/></Installation><Dependencies/><Assets><Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true"/></Assets></PackageManifest>`)]);
  entries.push(['[Content_Types].xml', Buffer.from('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="json" ContentType="application/json"/><Default Extension="vsixmanifest" ContentType="text/xml"/></Types>')]);
  for (const [name, data] of entries) {
    const filename = Buffer.from(name), compressed = zlib.deflateRawSync(data), crc = crc32(data);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6); local.writeUInt16LE(8, 8); local.writeUInt32LE(crc, 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(filename.length, 26);
    const record = Buffer.alloc(46); record.writeUInt32LE(0x02014b50); record.writeUInt16LE(20, 4); record.writeUInt16LE(20, 6); record.writeUInt16LE(0x800, 8); record.writeUInt16LE(8, 10); record.writeUInt32LE(crc, 16); record.writeUInt32LE(compressed.length, 20); record.writeUInt32LE(data.length, 24); record.writeUInt16LE(filename.length, 28); record.writeUInt32LE(offset, 42);
    chunks.push(local, filename, compressed); central.push(record, filename); offset += local.length + filename.length + compressed.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  fs.writeFileSync(file, Buffer.concat([...chunks, directory, end]));
}
module.exports = { jsonc, scan, mergeSettings, mergeKeybindings, packagePlugin };
