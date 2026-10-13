const fs = require('node:fs');
const path = require('node:path');
const { isUtf8 } = require('node:buffer');
const LIMIT = 512 * 1024;
const key = file => process.platform === 'win32' ? path.resolve(file).toLowerCase() : path.resolve(file);
function within(root, file) {
  const relative = path.relative(path.resolve(root), path.resolve(file));
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) return false;
  let parent = path.resolve(file);
  while (!fs.existsSync(parent)) { const next = path.dirname(parent); if (next === parent) return false; parent = next; }
  const real = path.relative(fs.realpathSync(root), fs.realpathSync(parent));
  return real !== '..' && !real.startsWith('..' + path.sep) && !path.isAbsolute(real);
}
function readText(file) {
  if (!fs.existsSync(file)) return null;
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size > LIMIT) return undefined;
  const data = fs.readFileSync(file);
  if (data.includes(0) || !isUtf8(data)) return undefined;
  return data.toString('utf8');
}
function snapshot(root, maximum = 2500) {
  const files = new Map(), seen = new Set(), paths = new Map(), skipped = new Set(); let limited = false, total = 0;
  const excluded = new Set(['.git', 'node_modules', 'dist', 'build', '.next', '.venv', '__pycache__']);
  const localRuntime = new Set();
  try { if (JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).name === 'gptide-desktop') for (const name of ['app', 'data', 'downloads', 'runtime']) localRuntime.add(name); } catch {}
  function visit(folder) {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      if (files.size >= maximum || total >= 32 * 1024 * 1024) { limited = true; return; }
      const file = path.join(folder, entry.name);
      if (entry.isSymbolicLink()) { skipped.add(key(file)); continue; }
      if (entry.isDirectory()) { if (!excluded.has(entry.name) && !(folder === root && localRuntime.has(entry.name))) visit(file); }
      else if (entry.isFile()) { seen.add(key(file)); paths.set(key(file), file); try { const value = readText(file); if (value !== undefined) { files.set(key(file), value); total += Buffer.byteLength(value || ''); } } catch {} }
    }
  }
  visit(root); return { files, seen, paths, skipped, limited };
}
function collectChanges(root, baseline, candidates) {
  const result = [], visited = new Set(); let total = 0;
  for (const file of candidates.keys()) {
    const absolute = path.resolve(root, file), normalized = key(absolute);
    if (visited.has(normalized)) continue; visited.add(normalized);
    if (result.length >= 2500) { result.limited = true; break; }
    if (!within(root, absolute)) continue;
    const after = readText(absolute), before = baseline.files.get(key(absolute));
    if (after === undefined || before === after) continue;
    // A file absent from the snapshot can be newly created or excluded: only
    // explicit add events establish a safe empty baseline for such a path.
    if (before === undefined && (candidates.get(file) !== 'add' || baseline.seen?.has(key(absolute)) || [...(baseline.skipped || [])].some(skipped => key(absolute) === skipped || key(absolute).startsWith(skipped + path.sep)))) continue;
    const size = Buffer.byteLength(before || '') + Buffer.byteLength(after || '');
    if (total + size > 32 * 1024 * 1024) { result.limited = true; continue; } total += size;
    result.push({ path: absolute, relative: path.relative(root, absolute), before: before ?? null, after, status: 'pending' });
  }
  return result;
}
function collectRoundChanges(root, baseline, candidates = new Map()) {
  const current = snapshot(root), all = new Map();
  for (const [file, kind] of candidates) all.set(path.resolve(root, file), kind);
  for (const file of baseline.files.keys()) all.set(baseline.paths?.get(file) || file, 'update');
  if (!baseline.limited) for (const file of current.files.keys()) {
    const unknown = [...(baseline.skipped || [])].some(skipped => file === skipped || file.startsWith(skipped + path.sep));
    if (!unknown && !baseline.files.has(file) && !baseline.seen?.has(file)) all.set(current.paths.get(file), 'add');
  }
  const result = collectChanges(root, baseline, all);
  result.limited = !!(result.limited || baseline.limited || current.limited);
  return result;
}
function canRevert(change) { return readText(change.path) === change.after; }
module.exports = { within, readText, snapshot, collectChanges, collectRoundChanges, canRevert };
