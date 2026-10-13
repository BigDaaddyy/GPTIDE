const fs = require('node:fs'), path = require('node:path'), zlib = require('node:zlib');
const { Readable, Transform, Writable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
function jsonc(text, empty) {
  let out = '', quoted = false, escape = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i + 1];
    if (quoted) { out += c; if (escape) escape = false; else if (c === '\\') escape = true; else if (c === '"') quoted = false; }
    else if (c === '"') { quoted = true; out += c; }
    else if (c === '/' && n === '/') { while (i < text.length && text[i] !== '\n') i++; out += '\n'; }
    else if (c === '/' && n === '*') { i += 2; while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++; if (i >= text.length) throw new Error('JSONC 注释未结束'); i++; out += ' '; }
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
  clean = clean.replace(/^\uFEFF/, ''); return !clean.trim() && empty !== undefined ? empty : JSON.parse(clean);
}
function configuration(text, kind) {
  const value = jsonc(text, kind === 'keys' ? [] : {});
  if (kind === 'keys' ? !Array.isArray(value) : !value || Array.isArray(value) || typeof value !== 'object') throw new Error(kind === 'keys' ? 'keybindings.json 必须为数组' : 'settings.json 必须为对象');
  return value;
}
function scan(user, extensions) {
  const settingsFile = path.join(user, 'settings.json');
  const settings = fs.existsSync(settingsFile) ? configuration(fs.readFileSync(settingsFile, 'utf8'), 'settings') : {};
  if (!settings || Array.isArray(settings) || typeof settings !== 'object') throw new Error('settings.json 必须为对象');
  const plugins = [], warnings = [];
  let index;
  try { index = JSON.parse(fs.readFileSync(path.join(extensions, 'extensions.json'), 'utf8')); } catch {}
  const names = Array.isArray(index) ? index.map(e => e && typeof e === 'object' && (typeof e.relativeLocation === 'string' ? path.resolve(extensions, e.relativeLocation) : typeof e.location?.fsPath === 'string' ? path.resolve(e.location.fsPath) : null)).filter(Boolean) : fs.existsSync(extensions) ? fs.readdirSync(extensions).filter(n => !n.startsWith('.')).map(n => path.join(extensions, n)) : [];
  const seen = new Set();
  for (const directory of names) {
    try {
      const relative = path.relative(path.resolve(extensions), directory); if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error('插件目录越界');
      const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
      const id = `${manifest.publisher}.${manifest.name}`;
      if (!/^[a-z0-9][a-z0-9-]*$/i.test(manifest.publisher) || !/^[a-z0-9][a-z0-9-]*$/i.test(manifest.name) || typeof manifest.version !== 'string' || seen.has(id.toLowerCase())) continue;
      seen.add(id.toLowerCase()); plugins.push({ id, directory, manifest });
    } catch { warnings.push(`无法读取插件：${path.basename(directory)}`); }
  }
  const keysFile = path.join(user, 'keybindings.json');
  const keybindings = fs.existsSync(keysFile) ? configuration(fs.readFileSync(keysFile, 'utf8'), 'keys') : [];
  if (!Array.isArray(keybindings)) throw new Error('keybindings.json 必须为数组');
  return { settings, keybindings, plugins, warnings };
}
function mergeKeybindings(current, source, overwrite) {
  const result = [...current];
  for (const binding of source) {
    if (!binding || typeof binding.key !== 'string' || typeof binding.command !== 'string') continue;
    const matches = result.map((b, i) => typeof b?.key === 'string' && b.key.toLowerCase() === binding.key.toLowerCase() && (b.when || '') === (binding.when || '') ? i : -1).filter(i => i >= 0);
    if (result.some(b => typeof b?.key === 'string' && b.key.toLowerCase() === binding.key.toLowerCase() && typeof b.command === 'string' && b.command.replace(/^-/, '').startsWith('gptide.'))) continue;
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
const crcTable = Array.from({ length: 256 }, (_, value) => { for (let i = 0; i < 8; i++) value = (value >>> 1) ^ (0xedb88320 & -(value & 1)); return value >>> 0; });
function crcUpdate(crc, data) { for (const b of data) crc = (crc >>> 8) ^ crcTable[(crc ^ b) & 255]; return crc; }
// Package an already installed extension for the editor's native VSIX installer.
// Native installation validates engine compatibility and registers the extension.
async function packagePlugin(plugin, file, { signal, maximumBytes = 512 * 1024 * 1024, maximumEntries = 65530 } = {}) {
  const m = plugin.manifest, entries = [], central = []; let offset = 0, total = 0;
  // Use the same native resolver for the root and every entry. Windows runners
  // may expose temporary directories through aliases/junctions which the sync
  // JS resolver and async native resolver represent differently.
  const sourceRoot = await fs.promises.realpath(plugin.directory);
  if (fs.lstatSync(plugin.directory).isSymbolicLink()) throw new Error('插件包含符号链接，请通过扩展面板重新安装');
  const checkPath = async source => { const relative = path.relative(sourceRoot, await fs.promises.realpath(source)); if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative) || (await fs.promises.lstat(source)).isSymbolicLink()) throw new Error('插件目录已变化或包含符号链接'); };
  const walk = async (dir, prefix) => { for (const item of await fs.promises.readdir(dir, { withFileTypes: true })) {
    signal?.throwIfAborted();
    if (item.isSymbolicLink()) throw new Error('插件包含符号链接，请通过扩展面板重新安装');
    const full = path.join(dir, item.name), name = prefix + item.name;
    await checkPath(full);
    if (item.isDirectory()) await walk(full, name + '/'); else if (item.isFile()) {
      const stat = await fs.promises.stat(full); total += stat.size;
      if (entries.length >= maximumEntries || total > maximumBytes) throw new Error('插件包过大，请通过扩展面板安装');
      entries.push({ name, source: full, stat });
    }
  } };
  await walk(plugin.directory, 'extension/');
  entries.push({ name: 'extension.vsixmanifest', data: Buffer.from(`<?xml version="1.0"?><PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011"><Metadata><Identity Language="en-US" Id="${xml(m.name)}" Version="${xml(m.version)}" Publisher="${xml(m.publisher)}"/><DisplayName>${xml(m.displayName || m.name)}</DisplayName><Description xml:space="preserve">${xml(m.description || m.name)}</Description><Properties><Property Id="Microsoft.VisualStudio.Code.Engine" Value="${xml(m.engines?.vscode || '*')}"/></Properties></Metadata><Installation><InstallationTarget Id="Microsoft.VisualStudio.Code"/></Installation><Dependencies/><Assets><Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true"/></Assets></PackageManifest>`) });
  entries.push({ name: '[Content_Types].xml', data: Buffer.from('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="json" ContentType="application/json"/><Default Extension="vsixmanifest" ContentType="text/xml"/></Types>') });
  let handle, finished = false;
  try {
    signal?.throwIfAborted(); handle = await fs.promises.open(file, 'wx');
    const write = async (buffer, position = offset) => { let count = 0; while (count < buffer.length) { const { bytesWritten } = await handle.write(buffer, count, buffer.length - count, position + count); if (!bytesWritten) throw new Error('插件包写入失败'); count += bytesWritten; } if (position === offset) offset += count; };
    for (const entry of entries) {
      signal?.throwIfAborted(); const filename = Buffer.from(entry.name); if (filename.length > 65535) throw new Error('插件文件名过长');
      const local = Buffer.alloc(30), start = offset; local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6); local.writeUInt16LE(8, 8); local.writeUInt16LE(filename.length, 26);
      await write(local); await write(filename); const contentStart = offset; let size = 0, crc = -1, sourceHandle;
      try {
        if (entry.source) { await checkPath(entry.source); sourceHandle = await fs.promises.open(entry.source, 'r'); const stat = await sourceHandle.stat(); if (stat.size !== entry.stat.size || stat.mtimeMs !== entry.stat.mtimeMs || stat.ino !== entry.stat.ino) throw new Error('插件正在更新，请稍后重试'); }
        const source = sourceHandle ? sourceHandle.createReadStream({ autoClose: false, highWaterMark: 65536 }) : Readable.from([entry.data]);
        const counter = new Transform({ transform(chunk, encoding, callback) { size += chunk.length; if (size > (entry.stat?.size ?? entry.data.length)) return callback(new Error('插件正在更新，请稍后重试')); crc = crcUpdate(crc, chunk); callback(null, chunk); } });
        await pipeline(source, counter, zlib.createDeflateRaw(), new Writable({ write(chunk, encoding, callback) { write(chunk).then(() => callback(), callback); } }), { signal });
        if (sourceHandle) { const stat = await sourceHandle.stat(); if (size !== entry.stat.size || stat.size !== entry.stat.size || stat.mtimeMs !== entry.stat.mtimeMs) throw new Error('插件正在更新，请稍后重试'); }
      } finally { if (sourceHandle) await sourceHandle.close(); }
      const compressedSize = offset - contentStart; crc = (crc ^ -1) >>> 0; local.writeUInt32LE(crc, 14); local.writeUInt32LE(compressedSize, 18); local.writeUInt32LE(size, 22); await write(local, start);
      const record = Buffer.alloc(46); record.writeUInt32LE(0x02014b50); record.writeUInt16LE(20, 4); record.writeUInt16LE(20, 6); record.writeUInt16LE(0x800, 8); record.writeUInt16LE(8, 10); record.writeUInt32LE(crc, 16); record.writeUInt32LE(compressedSize, 20); record.writeUInt32LE(size, 24); record.writeUInt16LE(filename.length, 28); record.writeUInt32LE(start, 42); central.push(record, filename);
    }
    const directory = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16); await write(directory); await write(end); await handle.sync(); finished = true;
  } finally { if (handle) { await handle.close(); if (!finished) await fs.promises.unlink(file).catch(() => {}); } }
}
module.exports = { jsonc, configuration, scan, mergeSettings, mergeKeybindings, packagePlugin };
