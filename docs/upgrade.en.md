# Upgrading (0.x)

Bumping the runtime to a new version takes **two** steps — `npm update` alone is not enough.

**① The caret range blocks 0.x minors.** `npm install -D commitgate` writes a `^0.y.z` range. In npm semver,
`^0.7.0` means `>=0.7.0 <0.8.0`, so `npm update`/`pnpm update` **will not cross a 0.x minor** (it stays within 0.7.x).
To cross a minor, raise the range explicitly:

```sh
npm install -D commitgate@latest     # or a specific version: commitgate@^0.8.0
```

**② Vendored assets update separately from the runtime.** The command above refreshes the runtime
(`node_modules/commitgate`), but the contract assets in your project's `workflow/`
(`machine.schema.json`, `req.config.schema.json`) **stay as they were**. If you bump the runtime but leave the
assets, the new runtime **reads the old contract**, and newer features (e.g. the full-review escalation of design
delta reviews) can be silently disabled. `commitgate sync` restores those assets from the installed package copy:

```sh
npx commitgate sync                    # plan only (dry-run — see what would change)
npx commitgate sync --apply            # re-sync the schema axis
npx commitgate sync --apply --persona  # persona too (restore if missing; if it differs, show a diff and preserve)
npx commitgate sync --apply --persona --persona-apply  # after reviewing that diff, replace it (keeps a .bak)
```

- `sync` restores the **schema axis only** (contracts, always kept current). It does not touch companion skills,
  `workflow/.gitignore`, `package.json`, or `req:*`.
- The **persona (`review-persona.md`) is handled only with `--persona`**. It is restored when missing, and when it
  differs the tool **prints the real content diff before doing anything and preserves the file by default** (you see
  the diff in dry-run too).
- **To pick up review-policy updates**, review that diff and pass `--persona-apply` **together with** `--persona`.
  A backup is written to `workflow/review-persona.md.bak` first (last generation only), and **if the backup or the
  diff cannot be produced, nothing is replaced** (fail-closed). Personas installed by 0.9.8 and earlier carry no kit
  marker, so they get a louder "you may have written this yourself" warning — but the replace path is the same.
  Decide from the diff.
- To keep managing the persona yourself, point `reviewPersonaPath` in `req.config.json` at a separate file
  (`sync` then leaves it completely untouched).
- `req:doctor`'s **D20** WARNs when the vendored schema drifts from the installed copy (it never blocks the commit).

**③ If you are on an older (vendored) install**, follow up with the `migrate` step below to move to the Stage B runtime.

**④ The Quick Start block also does not reach existing files automatically (0.9.2+).** A fresh install puts the
onboarding Quick Start at the top of `CLAUDE.md`/`AGENTS.md`, but `init` is seed-once, so it is **not applied to
files that already existed**. After upgrading, backfill existing files with `commitgate quickstart`:

```sh
npx commitgate quickstart              # plan only (dry-run — see what would change)
npx commitgate quickstart --apply      # inject only the managed block (preserves the rest, idempotent)
```

- `AGENTS.md` is targeted only when it carries the CommitGate contract marker. Absent files are left untouched.
- `req:doctor`'s **D21** WARNs when an existing file is missing the Quick Start block (it never blocks the commit).

> In short: install `commitgate@latest` → `commitgate sync --apply` → `commitgate quickstart --apply` → (if needed) `commitgate migrate`.

## Per-version notes

Anything you only need to handle **for a specific version** lives here. Sections are never removed, so if you
are coming from an older version, read **every section after yours, in order**.

### 0.20/0.21 → 0.22 — caret does not cross minors: install explicitly + backfill gitignore

**① It does not upgrade automatically.** In npm semver, `^0.20.0` means `>=0.20.0 <0.21.0`, so
`npm update` never crosses into 0.21/0.22. Raise the range explicitly (this command also updates the
lockfile — make sure the `package-lock.json` change is part of your commit):

```sh
npm install -D commitgate@^0.22.0
npx commitgate sync --apply --gitignore   # re-sync vendored schemas + backfill missing kit rules into workflow/.gitignore
npx commitgate check                      # readiness diagnosis (read-only)
npx commitgate report                     # local observation summary (read-only) — sanity check
```

**② Why `sync --apply --gitignore` is needed.** 0.21 introduced a new local log,
`workflow/.verify-runs.jsonl` (gitignored). Existing installs don't have that rule in
`workflow/.gitignore`; without the backfill, verify-range skips logging and only prints a warning
(behavior is otherwise normal — you just lose the observation log). A `sync` without `--apply` is a
dry-run that only prints the plan and changes nothing.

**③ Behavior changes coming from 0.21 (relevant when upgrading from 0.20).**

- **secretScan defaults to `block`** — if a high-confidence secret pattern is staged, the review
  prompt is not sent. For false positives set `"secretScan": "warn"` or `"off"` in `req.config.json`.
- **D31 is WARN-only** — the sensitive-path warning never blocks a commit.
- **GitHub CI is optional** — CommitGate neither requires nor auto-runs CI. The verify-range CI check
  is opt-in ([y/N], default No) and only *queries* existing results; it never dispatches workflows.
  The entire local verification path works without GitHub auth or network.
- **New in 0.22: `commitgate integrate`** — a seam that owns the pre-merge procedure (strict evidence
  verification, CI-run opt-in, human confirmation, local merge, no push). *Running* CI (distinct from
  querying) happens only with `"githubCi": { "workflow": "ci.yml" }` in `req.config.json` plus an
  explicit request (`integrate --run --run-github-ci`) — without config it is never even offered. A new local log,
  `workflow/.integrate-runs.jsonl` (gitignored), appears; the `sync --apply --gitignore` backfill above
  adds this rule too.

**④ Log backward compatibility.** Existing local logs (`.doctor-runs.jsonl`, `.review-calls.jsonl`)
and committed ledgers (`review-ledger.jsonl`, `approvals.jsonl`) remain readable — schema changes are
additive and old rows are valid without the new fields. The new version never rewrites or migrates
existing logs.

**⑤ Consumer files are never overwritten automatically.** No command arbitrarily edits existing lines
in `AGENTS.md`, `CLAUDE.md`, `req.config.json`, or `workflow/.gitignore` — `sync`/`quickstart` only
touch opt-in axes and managed blocks.

**⑥ Rollback.** If something breaks, `npm install -D commitgate@0.20.0` (or `@0.21.0`) downgrades the
runtime. Vendored assets can stay (older versions ignore unknown fields), and the new local log files
can be left in place — older versions simply never read them.

### 0.11 → 0.12 — Node 20 or newer is required

`engines.node` moved from `>=18.17` to **`>=20`**. **Node 18 is no longer supported.**

Installing `commitgate@latest` on Node 18 prints:

```text
npm warn EBADENGINE Unsupported engine {
npm warn EBADENGINE   package: 'commitgate@0.12.0',
npm warn EBADENGINE   required: { node: '>=20' },
npm warn EBADENGINE   current: { node: 'v18.20.4', npm: '10.7.0' }
```

**Whether the install succeeds depends on your npm settings.**

| Setting | Result |
|---|---|
| Default | **Warning only** — it installs (but we do not promise it works) |
| `--engine-strict` (or `engine-strict=true` in `.npmrc`) | 🔴 **Install fails** — `npm error code EBADENGINE`, exit code 1 |

**You have three options.**

| Option | Result | |
|---|---|---|
| **Move to Node 20 or newer** | Works normally. CI verifies Node **20, 22, and 24** on every release | ✅ **Recommended** |
| **Stay on `commitgate@^0.11`** | You stop receiving anything after 0.12. 🔴 And **the intermittent test-suite freeze on macOS + Node 18 stays with you** — 0.11 never fixed it either | Stopgap |
| Force 0.12 on Node 18 (ignore the warning) | 🔴 **Unsupported.** The freeze is still there and we do not verify this combination | ❌ |

> 🔴 **The easy mistake**: dropping back to 0.11 does **not** make the freeze go away.
> **No version ever fixed it.** 0.12 did not repair the cause — it **removed Node 18 from the
> supported set**, which is where the problem showed up. The root cause is still unknown, and
> going back to Node 18 brings the symptom back with it.

## Migrating from an older install (`migrate`)

If `scripts/req/` is copied into your project and `req:*` points at `tsx scripts/req/*.ts`, you have an **older (vendored) install**. When `init` detects this state, it **stops** rather than creating a silent mix, and points you here.

```sh
npm install -D commitgate      # first, if it is not a devDependency yet
npx commitgate migrate         # plan only — writes nothing
npx commitgate migrate --apply # rewrites only the req:* scripts in package.json
```

`migrate` does exactly **one** thing: it rewrites the `req:*` keys **whose current value is byte-for-byte the old injected value** to `commitgate <verb>`.

- **It deletes nothing.** `scripts/req/`, schemas, persona, config, entrypoints, and `workflow/REQ-*` evidence are all left in place. The leftover `scripts/req/` is no longer executed; run `npx commitgate uninstall` to see a cleanup plan first.
- **It never overwrites scripts you edited.** Any value that differs — even by one character — is treated as yours, preserved, and reported for manual action.
- **It does not commit.** It writes `package.json` only; reviewing is up to you.

`req:doctor` also reports the install mode (old / current / mixed).
