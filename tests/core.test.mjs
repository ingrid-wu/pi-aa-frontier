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
    const { initTheme, theme } = await import(`${root}/dist/modes/interactive/theme/theme.js`);
    const { InteractiveMode } = await import(`${root}/dist/modes/interactive/interactive-mode.js`);
    initTheme('dark');
    const available = { provider: 'test', id: 'available', name: 'Available' };
    let view;
    const fake = {
      session: {
        scopedModels: [{ model: available }],
        modelRuntime: { getAvailableSnapshot: () => [available], refresh: async () => ({ errors: new Map() }) },
        setScopedModels() {},
      },
      settingsManager: { getEnabledModels: () => ['test/available', 'test/missing-key'] },
      showSelector: factory => { view = factory(() => {}); },
      updateAvailableProviderCount() {},
      ui: { requestRender() {} },
    };
    InteractiveMode.prototype.showModelsSelector.call(fake);
    try {
      const text = view.component.render(160).join('\n');
      assert.ok(text.includes('missing-key'), 'saved unavailable models remain visible with an active scope');
      assert.ok(text.includes(theme.fg('error', '✗ ')), 'unavailable entry has a red cross');
      await new Promise(resolve => setImmediate(resolve));
      assert.ok(view.component.render(160).join('\n').includes('missing-key'), 'catalog refresh preserves unavailable entry');
    } finally { view.dispose(); }
  });
}
