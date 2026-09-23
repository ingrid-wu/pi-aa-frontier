import test from 'node:test';
import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { join, delimiter } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const roots = process.env.PI_CORE_ROOTS?.split(delimiter) ?? ['/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent', join(homedir(), '.pi/agent/node_modules/@earendil-works/pi-coding-agent')].filter(existsSync);
if (!roots.length) throw new Error('Set PI_CORE_ROOTS to a patched Pi installation to run core tests');
for (const root of roots) {
  test(`real Pi loader and live context bridge: ${root}`, async () => {
    const { loadExtensions, createExtensionRuntime } = await import(`${root}/dist/core/extensions/loader.js`);
    const { ExtensionRunner } = await import(`${root}/dist/core/extensions/runner.js`);
    const { AgentSession } = await import(`${root}/dist/core/agent-session.js`);
    const loaded = await loadExtensions([fileURLToPath(new URL('../extensions/aa-frontier/index.ts', import.meta.url))], homedir());
    assert.deepEqual(loaded.errors, []);
    assert.equal(loaded.extensions.length, 1);
    assert.ok(loaded.extensions[0].commands.has('aa-frontier'));
    const session = { _scopedModels: [], setScopedModels: AgentSession.prototype.setScopedModels };
    const activeModel = { id: 'active' };
    const runner = new ExtensionRunner([], createExtensionRuntime(), homedir(), {}, {});
    runner.bindCore({}, { getModel: () => activeModel, getScopedModels: () => session._scopedModels, setScopedModels: models => session.setScopedModels([...models]) });
    const ctx = runner.createContext();
    const selection = [{ model: { id: 'frontier' }, thinkingLevel: 'high' }];
    ctx.setScopedModels(selection);
    assert.deepEqual(ctx.scopedModels, selection);
    assert.notEqual(ctx.scopedModels, selection);
    assert.equal(ctx.model, activeModel);
    ctx.setScopedModels([]);
    assert.deepEqual(ctx.scopedModels, []);
  });
}
