import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchRows, frontier, parsePage, selectModels, validateConfig } from '../extensions/aa-frontier/frontier.mjs';
const row = (slug, score, price, name = slug) => ({ id: slug, slug, name, score, price });
const raw = (id, score = 50, input = 1, output = 3) => ({ id, slug: id, name: id, evaluations: { artificial_analysis_intelligence_index: score }, pricing: { price_1m_input_tokens: input, price_1m_output_tokens: output } });
const page = (data, n = 1, total = 1, version = 4) => ({ data, intelligence_index_version: version, pagination: { page: n, total_pages: total, has_more: n < total } });
const model = (id, reasoning = false, provider = 'test') => ({ id, name: id, provider, reasoning });
const levels = m => m.reasoning ? ['off', 'low', 'high'] : ['off'];

test('global frontier preserves ties, excludes dominated points, and accepts free models', () => {
  const rows = [row('free', 20, 0), row('a', 40, 1), row('tie', 40, 1), row('dominated', 39, 1), row('expensive', 60, 5), row('same-quality', 40, 2)];
  assert.deepEqual(frontier(rows).map(r => r.slug), ['free', 'a', 'tie', 'expensive']);
});
test('AA blended price is 3:1; null and negative prices excluded, zero valid', () => {
  const result = parsePage(page([raw('a'), raw('null', null), raw('missing-price', 50, null), raw('negative', 50, -1), raw('free', 0, 0, 0)]), 1);
  assert.deepEqual(result.rows.map(r => [r.slug, r.price]), [['a', 1.5], ['free', 0]]);
  assert.throws(() => parsePage(page([raw('bad', '50')]), 1));
  assert.throws(() => parsePage(page([raw('bad', Infinity)]), 1));
  assert.throws(() => parsePage(page([raw('a')], 2, 2), 1));
});
test('fetches complete pagination with fixed key header', async () => {
  const calls = [];
  const result = await fetchRows('test-key', undefined, async (url, options) => {
    calls.push(url); assert.equal(options.headers['x-api-key'], 'test-key'); assert.equal(options.redirect, 'error');
    return { ok: true, json: async () => page([raw(`m${calls.length}`)], calls.length, 2) };
  });
  assert.equal(calls.length, 2); assert.equal(result.rows.length, 2);
});
test('rejects partial, inconsistent, duplicate, and unauthorized catalogs', async () => {
  for (const fault of ['http', 'version', 'duplicate']) {
    let n = 0;
    await assert.rejects(fetchRows('key', undefined, async () => {
      n++;
      if (fault === 'http' && n === 2) return { ok: false, status: 500 };
      return { ok: true, json: async () => page([raw(fault === 'duplicate' ? 'same' : `m${n}`)], n, 2, fault === 'version' ? n : 4) };
    }));
  }
  await assert.rejects(fetchRows('secret', undefined, async () => ({ ok: false, status: 401 })), /HTTP 401/);
});
test('abort signal is forwarded', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(fetchRows('key', controller.signal, async (_url, options) => { options.signal.throwIfAborted(); }), /abort/i);
});
test('matches exact normalized identity across connected providers without fuzzy prefixes', () => {
  const result = selectModels([row('gpt-5', 50, 1)], [model('gpt-5'), model('gpt-5-mini'), model('gpt-5', false, 'other')], {}, levels);
  assert.deepEqual(result.selected.map(s => s.model.provider), ['test', 'other']);
});
test('never substitutes a locally nondominated model for an unavailable global leader', () => {
  const rows = frontier([row('leader', 60, 1), row('available', 50, 2)]);
  assert.equal(selectModels(rows, [model('available')], {}, levels).selected.length, 0);
});
test('requires explicit supported effort for reasoning models', () => {
  const models = [model('gpt-5', true)];
  assert.equal(selectModels([row('gpt-5', 50, 1)], models, {}, levels).selected.length, 0);
  assert.equal(selectModels([row('gpt-5-high', 50, 1, 'GPT-5 (high)')], models, {}, levels).selected[0].thinkingLevel, 'high');
  assert.equal(selectModels([row('gpt-5-max', 50, 1, 'GPT-5 (max)')], models, {}, levels).selected.length, 0);
  assert.equal(selectModels([row('gpt-5-thinking', 50, 1, 'GPT-5 (Thinking)')], models, {}, levels).selected.length, 0);
});
test('aliases are exact and require available model and supported effort', () => {
  const rows = [row('aa-slug', 50, 1)];
  const available = [model('api-id', true)];
  assert.equal(selectModels(rows, available, { 'aa-slug': [{ model: 'test/api-id', thinkingLevel: 'high' }] }, levels).selected.length, 1);
  assert.equal(selectModels(rows, available, { 'aa-slug': [{ model: 'test/api-id' }] }, levels).selected.length, 0);
  assert.equal(selectModels(rows, available, { 'aa-slug': [] }, levels).selected.length, 0);
  assert.throws(() => validateConfig({ aliases: { a: [{ model: 'test/id', thinkingLevel: 'bogus' }] } }));
});
test('ambiguous auto identities are skipped; multiple efforts keep highest intelligence per model', () => {
  assert.equal(selectModels([row('a', 50, 1, 'same'), row('b', 60, 2, 'same')], [model('same')], {}, levels).selected.length, 0);
  const result = selectModels([row('gpt-5-low', 40, 1, 'GPT-5 (low)'), row('gpt-5-high', 60, 2, 'GPT-5 (high)')], [model('gpt-5', true)], {}, levels);
  assert.equal(result.selected.length, 1); assert.equal(result.selected[0].thinkingLevel, 'high');
});
