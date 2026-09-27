export const ENDPOINT = 'https://artificialanalysis.ai/api/v2/language/models/free';
export const LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
const finite = value => typeof value === 'number' && Number.isFinite(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const requiredString = value => typeof value === 'string' && value.length > 0;

export function parsePage(body, expectedPage) {
  if (!object(body) || !Array.isArray(body.data) || !finite(body.intelligence_index_version)) throw new Error('Invalid AA response');
  const p = body.pagination;
  if (!object(p) || p.page !== expectedPage || !Number.isInteger(p.total_pages) || p.total_pages < expectedPage || p.total_pages > 100 || p.has_more !== (p.page < p.total_pages)) throw new Error('Invalid AA pagination');
  const rows = body.data.map(row => {
    if (!object(row) || !requiredString(row.id) || !requiredString(row.slug) || !requiredString(row.name) || !object(row.evaluations) || !object(row.pricing)) throw new Error('Invalid AA model');
    const score = row.evaluations.artificial_analysis_intelligence_index;
    const input = row.pricing.price_1m_input_tokens;
    const output = row.pricing.price_1m_output_tokens;
    if ([score, input, output].some(value => value !== null && !finite(value))) throw new Error('Invalid AA numeric value');
    if (score === null || input === null || output === null || input < 0 || output < 0) return null;
    return { id: row.id, slug: row.slug, name: row.name, score, price: input * 0.75 + output * 0.25 };
  }).filter(Boolean);
  return { rows, pages: p.total_pages, version: body.intelligence_index_version };
}

export async function fetchRows(key, signal, request = fetch) {
  let totalPages = 1;
  let version;
  const rows = [];
  const ids = new Set();
  for (let page = 1; page <= totalPages; page++) {
    const response = await request(`${ENDPOINT}?page=${page}`, {
      headers: { 'x-api-key': key, accept: 'application/json' }, signal, redirect: 'error',
    });
    if (!response.ok) throw new Error(`AA API returned HTTP ${response.status}`);
    const parsed = parsePage(await response.json(), page);
    if (page > 1 && (version !== parsed.version || totalPages !== parsed.pages)) throw new Error('AA catalog changed during pagination; try again');
    totalPages = parsed.pages;
    version = parsed.version;
    for (const row of parsed.rows) {
      if (ids.has(row.id)) throw new Error('Duplicate AA model across pages; try again');
      ids.add(row.id);
      rows.push(row);
    }
  }
  if (!rows.length) throw new Error('No AA models have complete intelligence and price data');
  return { rows, version };
}

export function frontier(rows) {
  return rows.filter(a => !rows.some(b => b.score >= a.score && b.price <= a.price && (b.score > a.score || b.price < a.price)))
    .sort((a, b) => a.price - b.price || b.score - a.score || a.slug.localeCompare(b.slug));
}

export function validateConfig(value) {
  if (!object(value)) throw new Error('Config must be an object');
  if (value.enabled !== undefined && typeof value.enabled !== 'boolean') throw new Error('enabled must be boolean');
  if (value.aliases !== undefined && !object(value.aliases)) throw new Error('aliases must be an object');
  for (const targets of Object.values(value.aliases ?? {})) {
    if (!Array.isArray(targets)) throw new Error('Each alias must be an array');
    for (const target of targets) {
      if (!object(target) || !requiredString(target.model) || !target.model.includes('/') || (target.thinkingLevel !== undefined && !LEVELS.includes(target.thinkingLevel))) throw new Error('Invalid alias target');
    }
  }
  return { ...value, enabled: value.enabled ?? true, aliases: value.aliases ?? {} };
}

const normalize = value => value.toLowerCase().replace(/[^a-z0-9]/g, '');
function identity(row) {
  const match = row.name.match(/\s*\(([^()]+)\)$/);
  const tags = match ? match[1].toLowerCase().split(',').map(tag => tag.trim()) : [];
  const efforts = tags.filter(tag => /^(off|minimal|low|medium|high|xhigh|max)( effort)?$|^non-reasoning$/.test(tag));
  const supported = tags.every(tag => efforts.includes(tag) || ['reasoning', 'adaptive reasoning', 'thinking', 'default fallback'].includes(tag));
  const name = match ? row.name.slice(0, match.index) : row.name;
  if (!supported || efforts.length > 1 || /[()]/.test(name)) return undefined;
  const effort = efforts[0]?.replace(/ effort$/, '');
  const level = effort === 'non-reasoning' ? 'off' : effort;
  const slug = level ? row.slug.replace(new RegExp(`-(?:${level}|non-reasoning)$`, 'i'), '') : row.slug;
  return { keys: new Set([normalize(name), normalize(slug)]), level, reasoning: tags.some(tag => ['reasoning', 'adaptive reasoning', 'thinking'].includes(tag)) };
}

export function selectModels(rows, available, aliases, supportedLevels) {
  const selected = [];
  const unmatched = [];
  const used = new Map();
  const diagnostics = [];
  const identities = rows.map(identity);
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    const id = identities[index];
    const explicit = Object.hasOwn(aliases, row.slug);
    const reasons = new Set();
    if (explicit && !aliases[row.slug].length) reasons.add('Excluded by an empty alias.');
    if (!explicit && !id) reasons.add('Unrecognized or conflicting AA variant labels; configure an exact alias.');
    const targets = explicit ? aliases[row.slug] : available.flatMap(model => {
      const keys = [normalize(model.id.split('/').at(-1)), normalize(model.name)];
      if (!id || !keys.some(key => id.keys.has(key))) return [];
      const matchingRows = identities.filter(other => other && other.level === id.level && keys.some(key => other.keys.has(key)));
      if (matchingRows.length !== 1) { reasons.add('Ambiguous model identity; configure an exact alias.'); return []; }
      if ((model.reasoning || id.reasoning) && id.level === undefined) {
        reasons.add('AA does not specify a reasoning effort; configure an alias with the evaluated effort.');
        return [];
      }
      return [{ model: `${model.provider}/${model.id}`, thinkingLevel: id.level ?? 'off' }];
    });
    const matches = [];
    for (const target of targets) {
      const model = available.find(model => `${model.provider}/${model.id}` === target.model);
      if (!model) { reasons.add(`Provider/setup needed: ${target.model} is not in Pi's authenticated model catalog.`); continue; }
      const level = target.thinkingLevel ?? (model.reasoning ? undefined : 'off');
      if (level === undefined) { reasons.add('Alias needs an explicit evaluated reasoning effort.'); continue; }
      if (!supportedLevels(model).includes(level)) {
        reasons.add(`${target.model} does not support the evaluated effort (${level}).`);
        continue;
      }
      matches.push(`${target.model}:${level}`);
      const previous = used.get(target.model);
      if (previous && previous.score >= row.score) continue;
      const entry = { model, thinkingLevel: level };
      if (previous) selected[previous.index] = entry;
      else selected.push(entry);
      used.set(target.model, { index: previous?.index ?? selected.length - 1, score: row.score });
    }
    if (!matches.length) {
      unmatched.push(row);
      if (!reasons.size) reasons.add('Provider/setup needed: no exact match in Pi’s authenticated model catalog; configure a provider or an exact alias.');
    }
    diagnostics.push({ row, matches, reasons: [...reasons] });
  }
  return { selected, unmatched, diagnostics };
}

export function formatFrontierStatus(version, result, refreshedAt) {
  return [
    `AA Intelligence Index v${version}; refreshed ${refreshedAt}.`,
    `Full global frontier: ${result.diagnostics.length} AA models (intelligence / blended API price, 3:1 input:output).`,
    ...result.diagnostics.map(({ row, matches, reasons }) => [
      `${row.name} [${row.slug}]: intelligence ${row.score}, $${row.price.toFixed(3)}/1M tokens`,
      matches.length ? `  Available in Pi: ${matches.join(', ')}` : `  Not enabled — ${reasons.join(' ')}`,
    ].join('\n')),
    '',
    `Compatible frontier matches: ${result.selected.length} Pi provider/model/effort entries (not the full global frontier).`,
    ...result.selected.map(entry => `${entry.model.provider}/${entry.model.id}:${entry.thinkingLevel}`),
    `${result.unmatched.length} frontier models not enabled; see reasons above.`,
  ].join('\n');
}
