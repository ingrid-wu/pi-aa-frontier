# Pi AA Frontier

A personal Pi extension that adds models on the **Artificial Analysis Intelligence Index vs. price Pareto frontier** to your saved/manual scope, restricted to models available through your authenticated providers.

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

The script verifies version 0.85.1 and exact patch targets, backs up originals outside this repository, and refuses changed installations. It patches the CLI bundle, SDK implementation, public types, and scoped-model selector. Rerunning upgrades an older AA Frontier patch from its verified original backups. Use `node scripts/patch-core.mjs --check` for a read-only preflight. **Restart Pi once** after applying or upgrading it; `/reload` does not reload core code.

In `/scoped-models`, saved entries missing from Pi's authenticated model catalog remain visible with a red `✗`. The message suggests checking provider credentials or the catalog; it does not claim to diagnose the cause or test whether a key has expired.

On first load, the extension automatically creates `~/.pi/agent/aa-frontier/` with owner-only permissions. In an enabled interactive session, a missing key opens a masked setup prompt. Obtain your key at https://artificialanalysis.ai/api and paste it into that prompt—not chat. It is saved as `api-key` with `0600` permissions, then the frontier refreshes automatically.

Escape skips setup without changing your scope. Run `/aa-frontier setup` to try again. Check `/aa-frontier status` and `/scoped-models` after setup.

Existing `AA_API_KEY` environment values or non-empty private key files skip onboarding. Environment values take precedence. Disabled, headless and RPC sessions never automatically prompt; hourly refreshes never prompt. The key is not stored in chat or config.json. Manually created key files must have private permissions (`chmod 600`). Never commit keys.

## Commands

| Command | Effect |
| --- | --- |
| `/aa-frontier setup` | Prompt for a missing key and refresh (interactive, enabled sessions only) |
| `/aa-frontier status` | Full global frontier with scores/prices, available Pi matches, per-model setup/matching explanations, enabled entries, latest error |
| `/aa-frontier refresh` | Refresh immediately if enabled |
| `/aa-frontier on` | Enable persistently and refresh |
| `/aa-frontier off` | Disable and remove unchanged plugin-added entries, preserving saved/manual selections |

Refreshes preserve your saved/manual selections, ordering, and reasoning efforts, and append missing compatible frontier entries. If you already selected a model at a different effort, your effort wins. Later refreshes replace only unchanged entries the plugin itself added, so former frontier models do not accumulate. Manually changing an added model's effort makes it a manual selection. An unrestricted scope (Pi's empty list, meaning all models) stays unrestricted.

The plugin does not write model selections to settings. Ctrl+S in `/scoped-models` still saves the displayed selection, including frontier additions; they become baseline selections on the next session. Turn the plugin off before saving if you want to save only your manual choices. Removing a current frontier model can be undone by the next refresh; turn the extension off for fully manual control. No automatic refresh runs in headless, RPC, or print sessions.

## Frontier and matching rules

- Fetches all pages from the official AA free language-model endpoint.
- Maximizes Intelligence Index and minimizes blended token price: `(3 × input + output) / 4`, USD per million tokens.
- Uses AA API prices, not subscription marginal costs or provider-specific Pi pricing.
- Computes the **global AA frontier first**, then intersects it with authenticated Pi models. It does not calculate a different frontier restricted to your providers.
- Retains exact ties. Excludes missing scores/prices and negative prices; zero is valid.
- Uses conservative normalized exact ID/name matching. No fuzzy prefixes or guessed model versions.
- Reasoning models require a supported explicit effort from the AA name or your alias configuration. Recognizes simple `(max)` labels and compound labels such as `(Adaptive Reasoning, Max Effort, Default Fallback)` and `(Reasoning, High Effort)`. Unknown variants and conflicting efforts are not guessed; unsupported efforts are never downgraded.
- Status lists **every global frontier model**, even if Pi cannot use it. Each model shows its available Pi matches or why it is not enabled: missing provider/exact identity, unspecified or unsupported effort, ambiguous variant, or explicit exclusion. A missing exact match may require a configured provider or an alias; it does not mean the model is off the frontier. The footer separates global model count from compatible Pi matches. Status also reports the merged active scope, which can be larger than the frontier.
- Models with generic `(Thinking)` or `(Reasoning)` labels, or reasoning models with no effort label, require an alias specifying the evaluated effort. This also applies to MiMo if its Pi entry is reasoning-enabled but AA does not state an effort.
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

Integration tests require patched Pi installations; lifecycle tests resolve Pi packages through the selected installation:

```sh
npm run test:integration
```

Set `PI_CORE_ROOTS` for non-default installation locations. Integration tests use fake API responses, never a live key. They cover real Pi extension loading, the scope bridge, restoration, stale-refresh cancellation, headless no-op behavior, onboarding, private file permissions, masked input, and cancellation.

Tests include compound reasoning labels, unavailable frontier models, separate global-versus-compatible status counts, additive scopes, manual-effort preservation, and unavailable selector markings. Integration tests use fixtures; live provider access is not tested. A full TypeScript check was not run.
