const identity = entry => `${entry.model.provider}/${entry.model.id}`;
const sameEntry = (a, b) => identity(a) === identity(b) && a.thinkingLevel === b.thinkingLevel;

export function removeFrontierAdditions(current, additions) {
  return current.filter(entry => !additions.some(added => sameEntry(entry, added)));
}

export function addFrontierToScope(current, previousAdditions, frontier) {
  // An empty Pi scope means all models, not no models.
  if (!current.length) return { scope: [], additions: [] };
  const scope = removeFrontierAdditions(current, previousAdditions);
  const ids = new Set(scope.map(identity));
  const additions = [];
  for (const entry of frontier) {
    if (ids.has(identity(entry))) continue;
    ids.add(identity(entry));
    scope.push(entry);
    additions.push(entry);
  }
  return { scope, additions };
}
