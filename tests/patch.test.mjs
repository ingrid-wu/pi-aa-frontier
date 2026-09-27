import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, dirname, delimiter } from 'node:path';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = (process.env.PI_CORE_ROOTS?.split(delimiter) ?? ['/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent']).find(existsSync);
const script = fileURLToPath(new URL('../scripts/patch-core.mjs', import.meta.url));
const files = ['dist/core/extensions/runner.js', 'dist/core/agent-session.js', 'dist/core/extensions/types.d.ts', 'dist/bundle/chunks/chunk-JVUZSMYM.js', 'dist/modes/interactive/interactive-mode.js', 'dist/modes/interactive/components/scoped-models-selector.js'];

test('core patch preflight, install, idempotence, tamper protection and restore', async () => {
  assert.ok(root, 'PI_CORE_ROOTS must point to Pi');
  const temp = await mkdtemp(join(tmpdir(), 'aa-patch-'));
  const fake = join(temp, 'pi');
  const installed = JSON.parse(await readFile(join(homedir(), '.pi/agent/local/aa-frontier/core-backup/manifest.json'), 'utf8'));
  const originals = new Map();
  const run = (...args) => execFileSync(process.execPath, [script, ...args], { env: { ...process.env, HOME: temp, PI_CORE_ROOTS: fake }, encoding: 'utf8', stdio: 'pipe' });
  try {
    await mkdir(fake);
    await writeFile(join(fake, 'package.json'), '{"version":"0.85.1"}');
    for (const file of files) {
      const actual = join(root, file);
      const entry = installed.find(item => item.path === actual);
      const original = await readFile(entry?.backup ?? actual, 'utf8');
      originals.set(file, original);
      await mkdir(dirname(join(fake, file)), { recursive: true });
      await writeFile(join(fake, file), original);
    }
    assert.match(run('--check'), /No files changed/);
    for (const file of files) assert.equal(await readFile(join(fake, file), 'utf8'), originals.get(file));
    assert.match(run(), /Patched/);
    assert.match(run(), /already installed and verified/);
    const target = join(fake, files[0]);
    const patched = await readFile(target, 'utf8');
    await writeFile(target, patched + '\n// external change');
    assert.throws(() => run(), /Core changed since patch/);
    await writeFile(target, patched);
    assert.match(run('--restore'), /Original core restored/);
    for (const file of files) assert.equal(await readFile(join(fake, file), 'utf8'), originals.get(file));
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
