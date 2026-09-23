import { readFile, mkdir, writeFile, rename, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { getSupportedThinkingLevels } from '@earendil-works/pi-ai';
import { fetchRows, frontier, selectModels, validateConfig } from './frontier.mjs';

const directory = join(homedir(), '.pi/agent/aa-frontier');
const configPath = join(directory, 'config.json');
const keyPath = join(directory, 'api-key');
const intervalMs = 60 * 60 * 1000;

export default function (pi: ExtensionAPI) {
  let timer: ReturnType<typeof setInterval> | undefined;
  let pending: AbortController | undefined;
  let generation = 0;
  let original: ExtensionContext['scopedModels'] | undefined;
  let lastApplied: string | undefined;
  let details = 'Not refreshed yet.';
  let lastError = '';
  let enabled = true;
  let disposed = false;
  let owner: ExtensionContext | undefined;
  const signature = (models: ExtensionContext['scopedModels']) => JSON.stringify(models.map(entry => [entry.model.provider, entry.model.id, entry.thinkingLevel]));
  const notify = (ctx: ExtensionContext, message: string, error = false) => {
    if (ctx.hasUI) ctx.ui.notify(message, error ? 'warning' : 'info');
  };
  const status = (ctx: ExtensionContext, text?: string) => {
    if (ctx.hasUI) ctx.ui.setStatus('aa-frontier', text);
  };
  async function config() {
    try { return validateConfig(JSON.parse(await readFile(configPath, 'utf8'))); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return validateConfig({});
      throw error;
    }
  }
  async function saveEnabled(value: boolean) {
    const valueToSave = { ...await config(), enabled: value };
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const temp = `${configPath}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify(valueToSave, null, 2) + '\n', { mode: 0o600 });
    await rename(temp, configPath);
  }
  async function apiKey() {
    if (process.env.AA_API_KEY?.trim()) return process.env.AA_API_KEY.trim();
    try {
      const info = await stat(keyPath);
      if (info.mode & 0o077) throw new Error(`Restrict API key permissions: chmod 600 ${keyPath}`);
      const key = (await readFile(keyPath, 'utf8')).trim();
      if (key) return key;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    throw new Error(`Set AA_API_KEY or put your AA API key in ${keyPath} (chmod 600).`);
  }
  function cancel() {
    generation++;
    pending?.abort();
    pending = undefined;
  }
  function restore(ctx: ExtensionContext) {
    if (original && lastApplied === signature(ctx.scopedModels) && typeof ctx.setScopedModels === 'function') ctx.setScopedModels(original);
    original = undefined;
    lastApplied = undefined;
  }
  async function refresh(ctx: ExtensionContext, manual = false) {
    cancel();
    const current = generation;
    const controller = new AbortController();
    pending = controller;
    const timeout = setTimeout(() => controller.abort(), 30_000);
    const active = () => !disposed && generation === current;
    try {
      const settings = await config();
      if (!active()) return;
      enabled = settings.enabled;
      if (!enabled) { restore(ctx); details = 'Disabled.'; status(ctx); return; }
      if (typeof ctx.setScopedModels !== 'function') throw new Error('Live scoped-model API missing. Apply the core patch and restart Pi once.');
      const key = await apiKey();
      if (!active()) return;
      const data = await fetchRows(key, controller.signal);
      if (!active()) return;
      const edge = frontier(data.rows);
      const result = selectModels(edge, ctx.modelRegistry.getAvailable(), settings.aliases, getSupportedThinkingLevels);
      details = [
        `AA Intelligence Index v${data.version}; refreshed ${new Date().toISOString()}.`,
        'Global intelligence / blended API price frontier (3:1 input:output).',
        ...edge.map(row => `${row.slug}: intelligence ${row.score}, $${row.price.toFixed(3)}/1M tokens`),
        '',
        `Matched ${result.selected.length} provider/model/effort entries:`,
        ...result.selected.map(entry => `${entry.model.provider}/${entry.model.id}:${entry.thinkingLevel}`),
        ...(result.unmatched.length ? ['', 'Unmatched (unavailable, ambiguous, or needs an explicit effort/alias):', ...result.unmatched.map(row => row.slug)] : []),
      ].join('\n');
      if (!result.selected.length) throw new Error('No frontier models matched. Existing scope preserved; see /aa-frontier status and configure aliases.');
      original ??= [...ctx.scopedModels];
      ctx.setScopedModels(result.selected);
      lastApplied = signature(ctx.scopedModels);
      lastError = '';
      status(ctx, `AA frontier: ${result.selected.length}`);
      if (manual) notify(ctx, details);
    } catch (error) {
      if (!active()) return;
      const message = controller.signal.aborted ? 'AA refresh timed out; existing scope preserved.' : (error instanceof Error ? error.message : 'AA refresh failed');
      lastError = message;
      status(ctx, 'AA frontier: refresh needed');
      notify(ctx, message, true);
    } finally {
      clearTimeout(timeout);
      if (generation === current) pending = undefined;
    }
  }
  pi.on('session_start', async (_event, ctx) => {
    if (timer) clearInterval(timer);
    cancel();
    if (owner) restore(owner);
    owner = ctx;
    disposed = false;
    if (ctx.mode !== 'tui') return;
    await refresh(ctx);
    if (disposed) return;
    timer = setInterval(() => { if (enabled && !pending) void refresh(ctx); }, intervalMs);
    timer.unref();
  });
  pi.on('session_shutdown', async (_event, ctx) => {
    disposed = true;
    cancel();
    if (timer) clearInterval(timer);
    timer = undefined;
    restore(ctx);
    owner = undefined;
    status(ctx);
  });
  pi.registerCommand('aa-frontier', {
    description: 'AA intelligence/price scope: status, refresh, on, off',
    handler: async (args, ctx) => {
      const action = args.trim() || 'status';
      try {
        if (action === 'status') { notify(ctx, [lastError, details].filter(Boolean).join('\n\n')); return; }
        if (action === 'off') {
          await saveEnabled(false);
          enabled = false;
          cancel();
          restore(ctx);
          details = 'Disabled. Previous scope restored unless you changed it manually.';
          lastError = '';
          status(ctx);
          notify(ctx, details);
          return;
        }
        if (action === 'on') { await saveEnabled(true); enabled = true; }
        else if (action !== 'refresh') { notify(ctx, 'Usage: /aa-frontier [status|refresh|on|off]'); return; }
        await refresh(ctx, true);
      } catch (error) {
        notify(ctx, error instanceof Error ? error.message : 'AA frontier command failed', true);
      }
    },
  });
}
