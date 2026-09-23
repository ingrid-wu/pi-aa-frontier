# Pi AA Frontier

A personal Pi extension that keeps scoped models on the **Artificial Analysis Intelligence Index vs. price Pareto frontier**, restricted to models available through your authenticated providers.

Refreshes on interactive session start and every hour. Updates scope live without changing the active model or startup default. This is an independent personal project, not an official Artificial Analysis integration.

## Requirements

- Node.js 22.23+ and Pi.
- An Artificial Analysis API key with access to `/api/v2/language/models/free`.
- Live scope support: the included **version-specific Pi 0.85.1 core patch**, or a compatible `ctx.setScopedModels` API.

**The patch is experimental and may need adapting after Pi updates.** It is not installed automatically. API errors, a missing patch, and zero matching models leave the existing scope unchanged.

## Setup

Clone this repository, then install it as a local Pi package:

```sh
git clone git@github.com:ingrid-wu/pi-aa-frontier.git
cd pi-aa-frontier
pi install "$PWD"
```

Do not load another copy of the extension simultaneously. If you already have the original personal installation at `~/.pi/agent/extensions/aa-frontier`, keep using that copy or disable it before installing this package.

Review and apply the core patch:

```sh
node scripts/patch-core.mjs
```

It defaults to the Homebrew global Pi installation and `~/.pi/agent/node_modules/@earendil-works/pi-coding-agent`, where present. Override installation paths with `PI_CORE_ROOTS` (platform path delimiter, `:` on macOS/Linux):

```sh
PI_CORE_ROOTS=/absolute/path/to/@earendil-works/pi-coding-agent node scripts/patch-core.mjs
```

The script verifies version 0.85.1 and exact patch targets, backs up originals outside this repository, and refuses changed installations. It patches the CLI bundle, SDK implementation, and public types. **Restart Pi once** after applying it; `/reload` does not reload core code.

Provide your key through `AA_API_KEY` in Pi's environment, or save it privately in:

```text
~/.pi/agent/aa-frontier/api-key
```

For the file option, use `chmod 600` on the file. Never commit keys or paste them into chat. Then run `/aa-frontier refresh` and open `/scoped-models`.

## Commands

| Command | Effect |
| --- | --- |
| `/aa-frontier status` | Last result, frontier scores/prices, selected and unmatched models, latest error |
| `/aa-frontier refresh` | Refresh immediately if enabled |
| `/aa-frontier on` | Enable persistently and refresh |
| `/aa-frontier off` | Disable and restore the original scope unless manually changed since the last application |

Manual scope changes can be replaced at the next refresh; turn the extension off for manual control. No automatic refresh runs in headless, RPC, or print sessions. Pi's single-model cycling behavior may require selecting the sole scoped model through `/model`.

## Frontier and matching rules

- Fetches all pages from the official AA free language-model endpoint.
- Maximizes Intelligence Index and minimizes blended token price: `(3 × input + output) / 4`, USD per million tokens.
- Uses AA API prices, not subscription marginal costs or provider-specific Pi pricing.
- Computes the **global AA frontier first**, then intersects it with authenticated Pi models. It does not calculate a different frontier restricted to your providers.
- Retains exact ties. Excludes missing scores/prices and negative prices; zero is valid.
- Uses conservative normalized exact ID/name matching. No fuzzy prefixes or guessed model versions.
- Reasoning models require a supported explicit effort from the AA name or your alias configuration. Generic `(Thinking)` names are not guessed; inspect unmatched models with the status command.
- For multiple evaluated efforts on one provider/model, selects the highest-intelligence matched variant. Pi cycles by model identity, not effort.
- Keeps the current scope on malformed data, inconsistent pagination, failed requests, timeouts, or no matches. Empty scope means all models in Pi, so errors never clear it.
- Does not persist AA responses. A new session without API access keeps its normal scope.

## Explicit aliases

Optional configuration lives at `~/.pi/agent/aa-frontier/config.json`:

```json
{
  "enabled": true,
  "aliases": {
    "exact-aa-slug": [
      { "model": "provider/exact-model-id", "thinkingLevel": "high" }
    ]
  }
}
```

These are placeholders. Use the exact AA slug from `/aa-frontier status`, the exact Pi provider/model ID, and the supported evaluated effort. Non-reasoning models default to `off`. An empty target array excludes an AA slug. Aliases never add dominated models to the frontier. Refresh after editing.

## Core patch maintenance

Backups and their hash manifest live in `~/.pi/agent/local/aa-frontier/core-backup`, not in this repository. Rerunning the patch verifies an existing installation.

Disable the extension, then restore before updating Pi when possible:

```sh
node scripts/patch-core.mjs --restore
```

Restart Pi afterward. If Pi was updated first, the script refuses to overwrite changed core files. Review the new version rather than forcing the old patch. The extension warns when the runtime setter is unavailable.

## Tests

Pure logic tests need only Node:

```sh
npm test
```

Integration tests require patched Pi installations and the Pi peer packages resolvable locally:

```sh
npm run test:integration
```

Set `PI_CORE_ROOTS` for non-default installation locations. Integration tests use fake API responses, never a live key. They cover real Pi extension loading, the scope bridge, restoration, stale-refresh cancellation, and headless no-op behavior.

All 13 tests passed on the original installation. Live authenticated AA fetching remains unverified until an API key is configured; a full TypeScript check was not run because `tsgo` was unavailable.
