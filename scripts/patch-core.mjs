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
    ['getScopedModels=()=>[];', 'getScopedModels=()=>[];setScopedModelsFn=()=>{throw new Error("Scoped models runtime is not bound")};'],
    ['this.getScopedModels=contextActions.getScopedModels,', 'this.getScopedModels=contextActions.getScopedModels,this.setScopedModelsFn=contextActions.setScopedModels,'],
    ['getScopedModels:()=>this._scopedModels,', 'getScopedModels:()=>this._scopedModels,setScopedModels:models=>this.setScopedModels([...models]),'],
    ['get scopedModels(){return runner.assertActive(),getScopedModels()},', 'get scopedModels(){return runner.assertActive(),getScopedModels()},setScopedModels:models=>{runner.assertActive();runner.setScopedModelsFn(models)},'],
  ],
};

const restore = process.argv.includes('--restore');
if (existsSync(manifestPath)) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  for (const entry of manifest) {
    if (hash(readFileSync(entry.path)) !== entry.patchedHash) throw new Error(`Core changed since patch: ${entry.path}. Refusing to overwrite.`);
    if (hash(readFileSync(entry.backup)) !== entry.originalHash) throw new Error(`Backup changed: ${entry.backup}`);
  }
  if (!restore) { console.log('Core patch already installed and verified.'); process.exit(0); }
  for (const entry of manifest) atomicWrite(entry.path, readFileSync(entry.backup));
  renameSync(manifestPath, `${manifestPath}.restored-${Date.now()}`);
  console.log('Original core restored. Restart Pi.');
  process.exit(0);
}
if (restore) throw new Error('No installed patch manifest found.');
const planned = [];
for (const root of roots) {
  if (!existsSync(root)) continue;
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  if (pkg.version !== '0.85.1') throw new Error(`Unsupported Pi version ${pkg.version} at ${root}; review patch first.`);
  for (const [relative, replacements] of Object.entries(edits)) {
    const path = join(root, relative);
    const original = readFileSync(path, 'utf8');
    let patched = original;
    for (const [before, after] of replacements) {
      if (patched.split(before).length !== 2) throw new Error(`Expected unique patch target in ${path}: ${before}`);
      patched = patched.replace(before, after);
    }
    planned.push({ path, original, patched });
  }
}
if (!planned.length) throw new Error('No Pi installations found.');
mkdirSync(backupDir, { recursive: true });
const manifest = planned.map((entry, i) => {
  const backup = join(backupDir, `${i}-${Date.now()}.original`);
  writeFileSync(backup, entry.original, { flag: 'wx' });
  return { path: entry.path, backup, originalHash: hash(entry.original), patchedHash: hash(entry.patched) };
});
try {
  for (const entry of planned) atomicWrite(entry.path, entry.patched);
  atomicWrite(manifestPath, JSON.stringify(manifest, null, 2));
} catch (error) {
  for (const entry of planned) atomicWrite(entry.path, entry.original);
  throw error;
}
console.log(`Patched ${planned.length} files across ${roots.length} Pi installations. Restart Pi once.`);
