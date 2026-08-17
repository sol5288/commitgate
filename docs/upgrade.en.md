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
npx commitgate sync --apply --scripts  # insert only the req:* scripts missing from package.json
```

- `sync` restores the **schema axis only** (contracts, always kept current). It does not touch companion skills,
  `workflow/.gitignore`, or `req.config.json`, and it touches `req:*` in `package.json` **only with `--scripts`**.
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

### Command surface — new verbs do not appear in existing installs by themselves

`req:*` scripts are injected by `init` **at install time**. So when a release adds a verb (`req:delegate` in
0.22.0, `req:repolicy` in 0.21.0), an existing project's `package.json` simply does not have that key. In that
state the command `req:next` prints at a control point fails **when you run it**:

```
$ pnpm req:delegate --scope ticket:REQ-2026-242 … --run
ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL  Command "req:delegate" not found
```

```sh
npx commitgate check                   # C6 names the missing verbs
npx commitgate sync --apply --scripts  # inserts only the missing keys
```

- **Only missing keys are inserted.** An existing key is left alone whatever its value — if you replaced
  `req:new` with your own wrapper, it stays. Indentation, key order, trailing whitespace, BOM and line endings
  are preserved, so the diff is **limited to the inserted keys**.
- `commitgate check`'s **C6** and `req:doctor`'s **D33** report the same verdict (both WARN — neither blocks a
  commit). Development repos (dogfood) are not checked.
- 🔴 **`req:doctor`'s D19 cannot tell you this.** D19 classifies the install *mode* (Stage A/B) from the **value
  shape** of five sample keys, so it reports `OK D19: Stage B` even when `req:delegate` is absent. Different question.

**③ If you are on an older (vendored) install**, follow up with the `migrate` step below to move to the Stage B runtime.

**④ Managed blocks also do not reach existing files automatically (0.9.2+).** A fresh install puts the blocks
CommitGate manages into `CLAUDE.md`/`AGENTS.md`, but `init` is seed-once, so they are **not applied to files that
already existed**. After upgrading, sync existing files with `commitgate quickstart`:

```sh
npx commitgate quickstart              # plan only (dry-run — see what would change)
npx commitgate quickstart --apply      # inject/replace managed blocks only (preserves the rest, idempotent)
```

🔴 **The name comes from Quick Start, but it now handles every managed block**:

| Block | Targets | Contents |
|---|---|---|
| `quickstart` | `CLAUDE.md`, `AGENTS.md` | The always-loaded onboarding quick start |
| `autonomy` | `AGENTS.md` | The **autonomy contract** (§4-1 — don't ask on `RUN`, plus the exception list) |

- `AGENTS.md` is targeted only when it carries the CommitGate contract marker. Absent files are left untouched.
- Without that marker the file is **not modified**; you are told what to copy over from `AGENTS.commitgate.md`
  (the contract copy that `init` places).
- Files whose markers are **damaged** (half, duplicated, nested, crossed) are **not written at all**, and the
  breakage is named.
- `req:doctor`'s **D21** WARNs about **which block** is missing or drifted in **which file** (it never blocks the commit).

> In short: install `commitgate@latest` → `commitgate sync --apply --scripts` → `commitgate quickstart --apply`
> → `commitgate check` (read C5 and C6) → (if needed) `commitgate migrate`.

## Upgrade axes — what to check and what to run

🔴 **One command does the checking: `npx commitgate check`.** Its `C7` item **counts all eight axes below**
(action · ok · manual · unknown) and lists **only the ones that are not ok**, each with its cause and remedy —
when everything is fine you get just the count line. It runs without a ticket (`req:doctor` requires a REQ id).
The table below explains which axes can appear in that output.

After bumping the version, go through **all eight axes** below. Each row pairs the diagnosis with the command that resolves it.

<!-- commitgate:upgrade-axes -->

| Axis | What drifts | Diagnosis | Remedy |
|---|---|---|---|
| `caret-range` | The installed version is pinned by the caret range (`^0.x`) and cannot cross a minor | `n/a` | `npm i -D commitgate@<version>` |
| `req-scripts` | A `req:*` verb added by a release is missing from `package.json` | `C6` · `D33` | `npx commitgate sync --apply --scripts` |
| `vendored-schema` | The vendored schema differs from the installed package copy | `D20` | `npx commitgate sync --apply` |
| `workflow-gitignore` | `workflow/.gitignore` lacks kit rules, so the next review is blocked by D10 | `D22` | `npx commitgate sync --apply --gitignore` |
| `managed-blocks` | Managed commitgate blocks in always-loaded files differ from the installed version | `D21` | `npx commitgate quickstart --apply` |
| `review-persona` | `review-persona.md` is missing or differs from the shipped copy, so review policy never lands | `npx commitgate sync --persona` | `npx commitgate sync --apply --persona --persona-apply` |
| `mixed-install` | `req:*` mixes Stage A (`tsx …`) and Stage B (`commitgate <verb>`) forms | `D19` | `npx commitgate migrate --apply` |
| `contract-claims` | `AGENTS.md` still carries retired CommitGate claims, so agents follow the old contract | `C5` | Manual merge (compare with `node_modules/commitgate/AGENTS.template.md`) |

<!-- /commitgate:upgrade-axes -->

🔴 **Only `caret-range` has no diagnosis.** `^0.x` is enforced by the package manager in the consumer's
`package.json`, so the tool cannot detect or fix it — installing an explicit version is the only lever.

🔴 **`mixed-install` fires only on a mix.** A pure Stage A install (`tsx scripts/req/*.ts`) is a
**supported** form and `D19` reports `OK`. Migration is needed only when the two forms are mixed.

🔴 **Only `contract-claims` is not fixed by the tool.** `AGENTS.md` is user-owned and carries
project-specific content, so automatic replacement would erase it. `C5` prints the offending sentences
verbatim — merge just those by hand.

## Per-version notes

Anything you only need to handle **for a specific version** lives here. Sections are never removed, so if you
are coming from an older version, read **every section after yours, in order**.

### 0.23.0 → 0.23.1 — upgrade if you use `auto` (patch)

**It is inside your caret range, so `npm i -D commitgate@0.23.1` picks it up directly.**

- 🔴 **The installed contract contradicted the tool.** In 0.23.0, `AGENTS.template.md` listed only
  `phase`/`req`/`merge` and stated that integration approval is required under every value. Under
  `auto` with a valid delegation the tool does not ask again, so an agent following that contract
  **stops when it should not.**
- 🔴 **Three ways around the `auto` integration gate existed** — each let the policy fixed when the
  ticket was created weaken at the final merge (a later settings change, a renamed branch, or an
  undeterminable state).

```sh
npm i -D commitgate@0.23.1
npx commitgate sync --apply --gitignore   # re-sync shipped template assets
npx commitgate check                      # C5 points at the outdated contract sentences
```

🔴 **`AGENTS.md` is yours, so the tool does not rewrite it.** Refresh the managed block
(`commitgate:autonomy`) with `npx commitgate quickstart --apply`; apply the rest by hand using what
C5 reports.

### 0.22 → 0.23 — two new policy axes (both opt-in) + policy snapshots for in-flight tickets

**① Install explicitly.** A caret does not cross minors (`^0.22.0` means `>=0.22.0 <0.23.0`).

```sh
npm install -D commitgate@^0.23.0
npx commitgate sync --apply --gitignore   # re-sync shipped template assets
npx commitgate doctor                     # check policy-snapshot state via D32
```

**② Nothing changes until you turn it on.** 0.23 adds two policy axes, but **the defaults are what you
are already running.**

| Axis | What it decides | Default | How to change |
|---|---|---|---|
| `stopGate` | **where a human confirms** during commit/integration | `req` (unchanged) | `npx commitgate setup` |
| `reviewBudget.onSoftLimit` | whether to continue **without human approval** once the review budget is exceeded | `ask` (unchanged) | `npx commitgate setup` |

- 🔴 **The two axes decide different things.** `stopGate` is **safety** (where you stop);
  `onSoftLimit` is **cost** (how many more re-reviews to allow). Changing one leaves the other alone.
- 🔴 **The name `auto` appears in two places.** `stopGate: "auto"` proceeds through integration
  **only when a delegation exists**; `onSoftLimit: "auto"` continues re-reviews **without a human
  exception approval** past the soft budget. **Neither lifts `hardCap`.**
- 🔴 `setup` is an **interactive command a human runs**. Do not have an agent run it — these two axes
  decide which gates the agent must pass, so letting the agent choose them opens a path where
  **the agent picks its own gates**.

**③ If you enable `stopGate: "auto"` — "auto" is not "unlimited".** It integrates only verified changes
**within the scope of an advance delegation**.

```sh
npx commitgate req:delegate --scope ticket:<REQ> --source <branch> \
    --sentence "<the approval sentence the human actually said>" [--allow-push] [--allow-bypass] --run
```

- A delegation is consumed **exactly once**; consumed, revoked, or expired delegations cannot be
  revived (issue a new one).
- Even with a delegation, **reaching `hardCap`, an undelegated HIGH-risk ticket, a BLOCKED review, or
  mismatched evidence** still stops integration.
- Integrating an `auto` ticket without a delegation stops the tool — it does not fall through.

**④ If you have tickets in flight, read `doctor` D32.** From 0.23 a ticket runs to completion under
**the policy it was created with** (policy snapshot). Tickets started on 0.22 or earlier have no
snapshot, so `req:doctor` reports **D32 WARN**. To adopt the current settings for such a ticket:

```sh
npx commitgate req:doctor <REQ>          # read what D32 says first
npx commitgate req:repolicy <REQ> --run  # adopt the current config policy for that ticket
```

D32 is a **WARN, not a block** — the ticket proceeds either way.

**⑤ The 0.22 ②-b caveat still applies.** `sync` does **not** update the contract body of `AGENTS.md`.
0.23 changed the setup description and policy wording in the shipped template
(`AGENTS.template.md`), so check whether your installed `AGENTS.md` still carries the old wording
(see C5 in `npx commitgate check`).

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

**②-b 🔴 `sync` does not update the contract text in `AGENTS.md`.** This is the easiest thing to miss when upgrading.

- `sync --apply --gitignore` touches **only the schema axis and `workflow/.gitignore`**.
- `quickstart --apply` likewise handles **only the managed blocks (`quickstart`, `autonomy`)**; it does not
  replace the whole `I2`/CI contract.
- `AGENTS.md` is a **user-owned file** that mixes in project-specific rules. Overwriting it automatically
  would delete that content, so CommitGate **tells you instead of fixing it**.

So when you come from 0.21 or earlier, the old contract stays in `AGENTS.md` — for example sentences that
make CI green a precondition for merge/publish, the old `I2` approval sentence, or the claim that CI runs
after a push.

**②-c Check for the C5 WARN from `commitgate check`.** Run it right after upgrading and it points this out.

```sh
npx commitgate check          # a C5 WARN means the merge below is needed
npx commitgate check --json   # machine consumers get the same diagnosis
```

- C5 reads `AGENTS.md` and `AGENTS.commitgate.md` and WARNs when they contain **retired CommitGate claims**.
- It is a **WARN, not a FAIL** — stale docs never block your commits or reviews (`check` still exits 0).
- `check` **never writes any file**.

**②-d What to do about a C5 WARN.** Do **not** replace the file wholesale; you would lose project-specific
content. Compare against the installed template (`node_modules/commitgate/AGENTS.template.md`) and merge
**only the CommitGate contract sections** by hand.

The current contract says:

- **CommitGate never dispatches GitHub CI on its own.** A workflow runs only when you pass
  `--run-github-ci` or answer `y` to the interactive prompt (whose default is No).
- **Skipping CI is a normal state**, not a failure condition for merge or publish.
- **Local `verify-range --strict` is a separate, required evidence check.** `integrate` always runs it, and
  release approvals R1/R2/R3 are requested only on the final HEAD after protected-branch integration and a
  successful strict check.
- The canonical `I2` approval sentence is **`검증 결과 확인 후 PR merge 승인`**.
- **CI green is not a precondition for merge or publish.** Report the result if you ran it, and report
  the fact that you skipped it if you did not.

🔴 **"CommitGate does not run it" and "no CI in this repository runs automatically" are different claims.**
If your project has its own workflows, `push`, `tag`, and `pull_request` triggers can start Actions
**independently of CommitGate**. To control cost fully, inspect the `on:` block of that repository's
`.github/workflows/*.yml` **separately**. CommitGate neither creates nor edits your project's workflows.
Do **not** write blanket sentences like "CI never runs automatically" into your contract file — that is
an assertion you have not verified against the actual triggers.

Re-run `npx commitgate check` after merging and C5 turns OK.

**③ Behavior changes coming from 0.21 (relevant when upgrading from 0.20).**

- **secretScan defaults to `block`** — if a high-confidence secret pattern is staged, the review
  prompt is not sent. For false positives set `"secretScan": "warn"` or `"off"` in `req.config.json`.
- **D31 is WARN-only** — the sensitive-path warning never blocks a commit.
- **GitHub CI is optional** — CommitGate neither requires nor auto-runs CI. The verify-range CI check
  is opt-in ([y/N], default No) and only *queries* existing results; it never dispatches workflows.
  The entire local verification path works without GitHub auth or network.
  Keeping your own `.github/workflows/*.yml` on `workflow_dispatch` only stops push, tag, and PR events
  from starting Actions at all (this is how the CommitGate repository itself runs). CommitGate never
  creates or edits your workflow files.
- **New in 0.22: doctor observation schema v2** — new `.doctor-runs.jsonl` rows carry per-check
  applicability, outcome, blocked, and reason codes (additive — old rows and old consumers stay
  valid). `commitgate report` computes per-check denominators/firing rates from v2 rows only and
  labels old rows as "denominator unavailable". Logs are never rewritten or migrated.
- **New in 0.22: deep verification + `commitgate attest`** — classification expands to six categories
  (approved, bookkeeping, merge, attested, invalid-evidence, unproven), and approvals are verified down
  to row schema, archive existence, and SHA-256. Legitimate exceptions (release commits, etc.) are
  recorded with `commitgate attest <sha> --reason "..." --run` and classify as attested
  (`workflow/attestations.jsonl` — append-only, committed). Old 4-category `.verify-runs.jsonl` rows
  remain readable.
- **New in 0.22: `commitgate integrate`** — a seam that owns the pre-merge procedure (strict evidence
  verification, CI-run opt-in, human confirmation, local merge, no push). *Running* CI (distinct from
  querying) happens only with `"githubCi": { "workflow": "ci.yml" }` in `req.config.json` plus an
  explicit request (`integrate --run --run-github-ci`) — without config it is never even offered. A new local log,
  `workflow/.integrate-runs.jsonl` (gitignored), appears; the `sync --apply --gitignore` backfill above
  adds this rule too.
  - **Only what was verified gets merged**: once evidence verification passes, the feature and trunk SHAs
    are bound and re-checked just before the merge (after the CI wait and the human confirmation). If either
    moved, nothing is merged and you are told to re-run. The merge uses those SHAs, not branch names, and
    trunk is updated only through an `update-ref` compare-and-swap.
  - **When CI runs, only `success` passes** — `skipped` (the requested check did not run) and `neutral`
    (no verdict) do not. The run is identified solely by the id returned from the dispatch, which requires
    `gh` v2.87.0 or newer.

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
