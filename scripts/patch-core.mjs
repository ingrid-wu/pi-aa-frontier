import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { join, delimiter } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';

const roots = process.env.PI_CORE_ROOTS?.split(delimiter) ?? [
  '/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent',
  join(homedir(), '.pi/agent/node_modules/@earendil-works/pi-coding-agent'),
];
const backupDir = join(homedir(), '.pi/agent/local/aa-frontier/core-backup');
const manifestPath = join(backupDir, 'manifest.json');
const hash = text => createHash('sha256').update(text).digest('hex');
const atomicWrite = (path, text) => { writeFileSync(`${path}.aa-frontier-tmp`, text); renameSync(`${path}.aa-frontier-tmp`, path); };
const edits = {
  'dist/modes/interactive/components/scoped-models-selector.js': [
    ['const status = item.model && item.enabled ? theme.fg("accent", "✓ ") : "  ";', 'const status = !item.model ? theme.fg("error", "✗ ") : item.enabled ? theme.fg("accent", "✓ ") : "  ";'],
    ['"Model unavailable"', '"Unavailable: check provider credentials or model catalog"'],
  ],
  'dist/modes/interactive/interactive-mode.js': [
    ['let selectionChanged = false;', 'if (currentEnabledIds !== null) {\n            for (const id of configuredEnabledIds(availableModels) ?? []) {\n                if (!availableModelIds.has(id) && !currentEnabledIds.includes(id)) currentEnabledIds.push(id);\n            }\n        }\n        let selectionChanged = false;'],
  ],
  'dist/core/extensions/runner.js': [
    ['getScopedModels = () => [];', 'getScopedModels = () => [];\n    setScopedModelsFn = () => { throw new Error("Scoped models runtime is not bound"); };'],
    ['this.getScopedModels = contextActions.getScopedModels;', 'this.getScopedModels = contextActions.getScopedModels;\n        this.setScopedModelsFn = contextActions.setScopedModels;'],
    ['return getScopedModels();\n            },', 'return getScopedModels();\n            },\n            setScopedModels: (models) => { runner.assertActive(); runner.setScopedModelsFn(models); },'],
  ],
  'dist/core/agent-session.js': [
    ['getScopedModels: () => this._scopedModels,', 'getScopedModels: () => this._scopedModels,\n            setScopedModels: (models) => this.setScopedModels([...models]),'],
  ],
  'dist/core/extensions/types.d.ts': [
    ['scopedModels: readonly ScopedModel[];', 'scopedModels: readonly ScopedModel[];\n    setScopedModels(models: readonly ScopedModel[]): void;'],
    ['getScopedModels: () => readonly ScopedModel[];', 'getScopedModels: () => readonly ScopedModel[];\n    setScopedModels: (models: readonly ScopedModel[]) => void;'],
  ],
  'dist/bundle/chunks/chunk-JVUZSMYM.js': [
    ['status=item.model&&item.enabled?theme.fg("accent","\\u2713 "):"  "', 'status=!item.model?theme.fg("error","\\u2717 "):item.enabled?theme.fg("accent","\\u2713 "):"  "'],
    ['"Model unavailable"', '"Unavailable: check provider credentials or model catalog"'],
    ['sessionScopedModels.map(scoped=>`${scoped.model.provider}/${scoped.model.id}`):configuredEnabledIds(availableModels)', '[...new Set([...sessionScopedModels.map(scoped=>`${scoped.model.provider}/${scoped.model.id}`),...(configuredEnabledIds(availableModels)??[]).filter(id=>!availableModelIds.has(id))])]:configuredEnabledIds(availableModels)'],
    ['getScopedModels=()=>[];', 'getScopedModels=()=>[];setScopedModelsFn=()=>{throw new Error("Scoped models runtime is not bound")};'],
    ['this.getScopedModels=contextActions.getScopedModels,', 'this.getScopedModels=contextActions.getScopedModels,this.setScopedModelsFn=contextActions.setScopedModels,'],
    ['getScopedModels:()=>this._scopedModels,', 'getScopedModels:()=>this._scopedModels,setScopedModels:models=>this.setScopedModels([...models]),'],
    ['get scopedModels(){return runner.assertActive(),getScopedModels()},', 'get scopedModels(){return runner.assertActive(),getScopedModels()},setScopedModels:models=>{runner.assertActive();runner.setScopedModelsFn(models)},'],
  ],
};

const restore = process.argv.includes('--restore');
const check = process.argv.includes('--check');
const installed = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : [];
if (installed.length) {
  const manifest = installed;
  for (const entry of manifest) {
    if (hash(readFileSync(entry.path)) !== entry.patchedHash) throw new Error(`Core changed since patch: ${entry.path}. Refusing to overwrite.`);
    if (hash(readFileSync(entry.backup)) !== entry.originalHash) throw new Error(`Backup changed: ${entry.backup}`);
  }
  if (restore) {
    for (const entry of manifest) atomicWrite(entry.path, readFileSync(entry.backup));
    renameSync(manifestPath, `${manifestPath}.restored-${Date.now()}`);
    console.log('Original core restored. Restart Pi.');
    process.exit(0);
  }
}
if (restore) throw new Error('No installed patch manifest found.');
const planned = [];
for (const root of roots) {
  if (!existsSync(root)) continue;
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  if (pkg.version !== '0.85.1') throw new Error(`Unsupported Pi version ${pkg.version} at ${root}; review patch first.`);
  for (const [relative, replacements] of Object.entries(edits)) {
    const path = join(root, relative);
    const previous = installed.find(entry => entry.path === path);
    const current = readFileSync(path, 'utf8');
    const original = previous ? readFileSync(previous.backup, 'utf8') : current;
    let patched = original;
    for (const [before, after] of replacements) {
      if (patched.split(before).length !== 2) throw new Error(`Expected unique patch target in ${path}: ${before}`);
      patched = patched.replace(before, after);
    }
    planned.push({ path, original, patched, current, previous });
  }
}
if (!planned.length) throw new Error('No Pi installations found.');
const changed = planned.filter(entry => entry.current !== entry.patched);
if (!changed.length) { console.log('Core patch already installed and verified.'); process.exit(0); }
if (check) { console.log(`Preflight passed: ${changed.length} files need patching. No files changed.`); process.exit(0); }
mkdirSync(backupDir, { recursive: true });
const manifest = [...installed.filter(entry => !planned.some(plan => plan.path === entry.path)), ...planned.map((entry, i) => {
  const backup = entry.previous?.backup ?? join(backupDir, `${i}-${Date.now()}.original`);
  if (!entry.previous) writeFileSync(backup, entry.original, { flag: 'wx' });
  return { path: entry.path, backup, originalHash: hash(entry.original), patchedHash: hash(entry.patched) };
})];
try {
  for (const entry of planned) atomicWrite(entry.path, entry.patched);
  atomicWrite(manifestPath, JSON.stringify(manifest, null, 2));
} catch (error) {
  for (const entry of planned) atomicWrite(entry.path, entry.current);
  throw error;
}
console.log(`Patched ${planned.length} files across ${roots.length} Pi installations. Restart Pi once.`);
