import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir, readFile, stat } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join, delimiter } from 'node:path';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';

await test('extension live scope lifecycle, failure preservation, off, and stale refresh cancellation', async () => {
  const home = await mkdtemp(join(tmpdir(), 'aa-frontier-test-'));
  const originalHome = process.env.HOME;
  const originalKey = process.env.AA_API_KEY;
  const originalFetch = globalThis.fetch;
  const roots = process.env.PI_CORE_ROOTS?.split(delimiter) ?? ['/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent', join(homedir(), '.pi/agent/node_modules/@earendil-works/pi-coding-agent')];
  const root = roots.find(existsSync);
  if (!root) throw new Error('Set PI_CORE_ROOTS to a Pi installation to run lifecycle tests');
  process.env.HOME = home;
  process.env.AA_API_KEY = 'test-key';
  const require = createRequire(join(root, 'package.json'));
  const { createJiti } = require('jiti');
  const resolver = createJiti(join(root, 'package.json'));
  const jiti = createJiti(import.meta.url, { alias: {
    '@earendil-works/pi-tui': resolver.esmResolve('@earendil-works/pi-tui'),
    '@earendil-works/pi-ai': resolver.esmResolve('@earendil-works/pi-ai/compat'),
  } });
  const { default: install } = await jiti.import('../extensions/aa-frontier/index.ts');
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
    await install(api as any);
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
    delete process.env.AA_API_KEY;
    const keyPath = join(home, '.pi/agent/aa-frontier/api-key');
    assert.equal((await stat(join(home, '.pi/agent/aa-frontier'))).mode & 0o777, 0o700);
    let prompts = 0;
    let entered: string | undefined;
    ctx.ui.custom = async () => { prompts++; return entered; };
    await handlers.get('session_start')({}, { ...ctx, mode: 'rpc' });
    assert.equal(prompts, 0);
    await handlers.get('session_start')({}, ctx);
    assert.equal(prompts, 1);
    assert.equal(fetches, 0, 'cancelled onboarding must not fetch');
    await assert.rejects(stat(keyPath), { code: 'ENOENT' });
    entered = 'onboarding-test-key';
    await command.handler('setup', ctx);
    assert.equal(prompts, 2);
    assert.equal((await readFile(keyPath, 'utf8')).trim(), entered);
    assert.equal((await stat(keyPath)).mode & 0o777, 0o600);
    assert.equal(fetches, 1, 'saving the key refreshes automatically');
    assert.ok(!notices.some(n => n.includes(entered!)), 'notices never include the secret');
    await command.handler('refresh', ctx);
    assert.equal(prompts, 2, 'saved key skips onboarding');
    await handlers.get('session_shutdown')({}, ctx);
    await rm(keyPath);
    await writeFile(join(home, '.pi/agent/aa-frontier/config.json'), '{"enabled":false}');
    await handlers.get('session_start')({}, ctx);
    assert.equal(prompts, 2, 'disabled extension does not prompt');
    const { promptApiKey } = await jiti.import('../extensions/aa-frontier/key-prompt.ts');
    let component;
    const uiCtx = { ui: { custom: factory => new Promise(resolve => {
      component = factory({ requestRender() {} }, {}, {}, resolve);
    }) } };
    const prompt = promptApiKey(uiCtx, new AbortController().signal);
    component.handleInput('\r');
    assert.match(component.render(80).join('\n'), /non-empty/);
    component.handleInput('\x1b[200~secret-test-key\x1b[201~');
    const rendered = component.render(80).join('\n');
    assert.ok(!rendered.includes('secret-test-key'));
    assert.ok(rendered.includes('********'));
    component.handleInput('\r');
    assert.equal(await prompt, 'secret-test-key');
    component.dispose();
    const cancelled = promptApiKey(uiCtx, new AbortController().signal);
    component.handleInput('\x1b');
    assert.equal(await cancelled, undefined);
    component.dispose();
    const controller = new AbortController();
    const aborted = promptApiKey(uiCtx, controller.signal);
    controller.abort();
    assert.equal(await aborted, undefined);
    component.dispose();
  } finally {
    await handlers.get('session_shutdown')({}, ctx);
    globalThis.fetch = originalFetch;
    if (originalHome === undefined) delete process.env.HOME; else process.env.HOME = originalHome;
    if (originalKey === undefined) delete process.env.AA_API_KEY; else process.env.AA_API_KEY = originalKey;
    await rm(home, { recursive: true, force: true });
  }
});
