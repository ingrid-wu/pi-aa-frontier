import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

await test('extension live scope lifecycle, failure preservation, off, and stale refresh cancellation', async () => {
  const home = await mkdtemp(join(tmpdir(), 'aa-frontier-test-'));
  const originalHome = process.env.HOME;
  const originalKey = process.env.AA_API_KEY;
  const originalFetch = globalThis.fetch;
  process.env.HOME = home;
  process.env.AA_API_KEY = 'test-key';
  const { default: install } = await import('../extensions/aa-frontier/index.ts');
  const handlers = new Map();
  let command;
  const api = { on: (name, callback) => handlers.set(name, callback), registerCommand: (_name, value) => { command = value; } };
  const oldModel = { id: 'old', name: 'old', provider: 'test', reasoning: false };
  const newModel = { id: 'new', name: 'new', provider: 'test', reasoning: false };
  const initial = [{ model: oldModel }];
  let scope = [...initial];
  const notices: string[] = [];
  const ctx = {
    mode: 'tui', hasUI: true, model: oldModel,
    get scopedModels() { return scope; },
    setScopedModels: value => { scope = [...value]; },
    modelRegistry: { getAvailable: () => [oldModel, newModel] },
    ui: { notify: text => notices.push(text), setStatus: () => {} },
  };
  const body = { intelligence_index_version: 4, pagination: { page: 1, total_pages: 1, has_more: false }, data: [{ id: 'new', slug: 'new', name: 'new', evaluations: { artificial_analysis_intelligence_index: 50 }, pricing: { price_1m_input_tokens: 1, price_1m_output_tokens: 1 } }] };
  const success = async () => new Response(JSON.stringify(body), { status: 200 });
  try {
    install(api as any);
    globalThis.fetch = success;
    await handlers.get('session_start')({}, ctx);
    assert.equal(scope[0].model.id, 'new');
    assert.equal(ctx.model.id, 'old', 'refresh must not change active model');
    globalThis.fetch = async () => new Response('', { status: 401 });
    await command.handler('refresh', ctx);
    assert.equal(scope[0].model.id, 'new', 'failed refresh preserves scope');
    assert.ok(notices.some(n => n.includes('HTTP 401')));
    globalThis.fetch = async () => new Response(JSON.stringify({ ...body, data: [{ ...body.data[0], name: 'unmatched', slug: 'unmatched' }] }));
    await command.handler('refresh', ctx);
    assert.equal(scope[0].model.id, 'new', 'zero matches preserve scope');
    await command.handler('off', ctx);
    assert.deepEqual(scope, initial);
    globalThis.fetch = success;
    await command.handler('on', ctx);
    assert.equal(scope[0].model.id, 'new');
    let resolveFetch;
    let started;
    const startedPromise = new Promise(resolve => { started = resolve; });
    globalThis.fetch = () => { started(); return new Promise(resolve => { resolveFetch = resolve; }); };
    const refresh = command.handler('refresh', ctx);
    await startedPromise;
    await command.handler('off', ctx);
    resolveFetch(await success());
    await refresh;
    assert.deepEqual(scope, initial, 'late refresh must not undo off');
    globalThis.fetch = success;
    await command.handler('on', ctx);
    scope = [{ model: oldModel, thinkingLevel: 'off' }];
    await command.handler('off', ctx);
    assert.equal(scope[0].thinkingLevel, 'off', 'off preserves a manual scope change');
    await handlers.get('session_shutdown')({}, ctx);
    await mkdir(join(home, '.pi/agent/aa-frontier'), { recursive: true });
    await writeFile(join(home, '.pi/agent/aa-frontier/config.json'), '{"enabled":true}');
    const noPatch = { ...ctx, setScopedModels: undefined };
    await handlers.get('session_start')({}, noPatch);
    assert.ok(notices.some(n => n.includes('restart Pi')));
    await handlers.get('session_shutdown')({}, noPatch);
    let fetches = 0;
    globalThis.fetch = async () => { fetches++; return success(); };
    await handlers.get('session_start')({}, { ...ctx, mode: 'print' });
    assert.equal(fetches, 0, 'headless runs do not fetch or alter scope');
  } finally {
    await handlers.get('session_shutdown')({}, ctx);
    globalThis.fetch = originalFetch;
    if (originalHome === undefined) delete process.env.HOME; else process.env.HOME = originalHome;
    if (originalKey === undefined) delete process.env.AA_API_KEY; else process.env.AA_API_KEY = originalKey;
    await rm(home, { recursive: true, force: true });
  }
});
