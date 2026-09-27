import test from 'node:test';
import assert from 'node:assert/strict';
import { addFrontierToScope, removeFrontierAdditions } from '../extensions/aa-frontier/scope.mjs';
const entry = (id, thinkingLevel = 'high') => ({ model: { provider: 'test', id }, thinkingLevel });

test('preserves saved models, ordering and effort while adding frontier without duplicates', () => {
  const saved = [entry('kimi-k3'), entry('glm'), entry('opus', 'low')];
  const result = addFrontierToScope(saved, [], [entry('opus', 'max'), entry('mimo')]);
  assert.deepEqual(result.scope, [...saved, entry('mimo')]);
  assert.deepEqual(result.additions, [entry('mimo')]);
  assert.deepEqual(saved, [entry('kimi-k3'), entry('glm'), entry('opus', 'low')]);
});
test('rotates only plugin additions and keeps manual edits across refresh and off', () => {
  const first = addFrontierToScope([entry('kimi-k3')], [], [entry('old-frontier')]);
  const second = addFrontierToScope([...first.scope, entry('manual')], first.additions, [entry('new-frontier')]);
  assert.deepEqual(second.scope, [entry('kimi-k3'), entry('manual'), entry('new-frontier')]);
  assert.deepEqual(removeFrontierAdditions(second.scope, second.additions), [entry('kimi-k3'), entry('manual')]);
  assert.deepEqual(removeFrontierAdditions([entry('new-frontier', 'low')], second.additions), [entry('new-frontier', 'low')]);
});
test('unrestricted scope stays unrestricted and repeated refreshes are idempotent', () => {
  assert.deepEqual(addFrontierToScope([], [], [entry('frontier')]), { scope: [], additions: [] });
  const first = addFrontierToScope([entry('saved')], [], [entry('frontier')]);
  assert.deepEqual(addFrontierToScope(first.scope, first.additions, [entry('frontier')]), first);
  assert.deepEqual(addFrontierToScope([], first.additions, [entry('frontier')]), { scope: [], additions: [] });
});
