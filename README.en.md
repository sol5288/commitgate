# CommitGate

🌐 [한국어](./README.md) · **English**

**A commit gate that blocks AI-generated code from being committed until Codex has reviewed and approved it.**

AI coding agents can move quickly, but unreviewed changes should not go straight into your history. CommitGate wraps each change in a REQ ticket and only allows the staged tree approved by Codex to be committed. If the code changes after approval, or if evidence is missing, it fails closed.

> **⚠️ Two things to know before you start.**
>
> 1. **Review sends your staged diff off-machine.** `req:review-codex` passes the **entire** `git diff --cached` to Codex (OpenAI). Codex reads your repository root under `--sandbox read-only`, so files outside the diff can be read too. There is **no** masking, filtering, or size cap. Check the staged content for credentials, tokens, and personal data before running a review.
> 2. **No git hook is installed.** Running `git commit` directly instead of `req:commit` bypasses the gate, the approval binding, and the evidence trail. CommitGate's enforcement keeps a **cooperating agent on the contract's rails** — it is not a barrier against a human going around it.

[![CI](https://github.com/sol5288/commitgate/actions/workflows/ci.yml/badge.svg)](https://github.com/sol5288/commitgate/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/commitgate.svg)](https://www.npmjs.com/package/commitgate)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

---

## Quick Start

Run this from your project root. The project must be a **git repository with a `package.json`**.

```sh
# If this is a fresh folder that is not yet a git repo or has no package.json, first:
git init
npm init -y

# 1) Install CommitGate as a devDependency — this is where the runtime lives:
npm install -D commitgate

# 2) Add config, contract, schemas, and the req:* scripts to your project:
npx commitgate init

codex --version
codex login status
```

> **Why two steps?** CommitGate does **not** copy its runtime code into your project. Step 1 puts the runtime in `node_modules/commitgate`; step 2 adds only **governance assets** (config, contract, schemas, persona) plus `req:* = commitgate <verb>` scripts.
> Removing the runtime is a single `npm uninstall -D commitgate`. **For updates, follow the [Upgrading (0.x)](#upgrading-0x) section below** — the runtime (`node_modules`) is bumped with `npm`, but the vendored assets (schemas, persona) in your project must be re-synced separately with `commitgate sync`, and a 0.x caret range (`^0.y`) does not cross a minor automatically.
> `init` **stops** if `devDependencies.commitgate` is not declared — there would be no runtime for `req:*` to point at.

Installation writes files but never commits them. `req:new` **requires a clean working tree**, so commit the scaffold first. The installer's `다음:` (next steps) output prints the exact paths to stage.

```sh
git add -- <the paths the installer printed>
git status                    # confirm only what you intended is staged
git commit -m "chore: install commitgate"
```

> **Do not stage everything (`-A` / `.`).** Unrelated changes and untracked files such as `.env` would be swept into the commit, and the next `req:review-codex` transmits that staged diff in full to an external service.
> Park any changes that predate the install **by pathspec** after the install commit: `git stash push -u -- <paths>`.
> Without `-u`, untracked files remain and `req:new` stays blocked; without the pathspec, a bare `git stash -u` also sweeps up directories that are not ignored, such as `node_modules/`. The installer prints that path list too.

**You do not paste a long prompt.** Installation lays down agent entrypoints for you.

| File | Read by |
|---|---|
| `AGENTS.md` | Codex CLI, Cursor — **the contract** |
| `.claude/skills/commitgate/SKILL.md` | Claude Code (auto-discovered — the model decides whether to use it) |
| `.claude/commands/req.md` | Claude Code (`/req` explicit call) |
| `.cursor/rules/commitgate.mdc` | Cursor (`alwaysApply`) |
| `CLAUDE.md` | Claude Code (always loaded) — created only if absent |

Just give the agent a requirement.

```text
/req Add a profile edit API

- What: PATCH /profile to change nickname and bio
- Why: users cannot change their profile after signup
- Constraints: reuse the existing auth middleware, no schema change
- Done when: unit tests pass, unauthorized users get 403
```

Outside Claude Code you can skip the slash command and state the requirement directly — `.cursor/rules` and `AGENTS.md` load the rules. If the four fields are missing, the agent asks first.

The agent's first reply should look roughly like this.

```text
REQ-2026-002 created
Branch: feat/req-2026-002-profile-edit-api
Phases:
- phase-1: implement PATCH /profile
- phase-2: tests and regression checks
Control points: before req:commit --run / [B1] before a direct push to main (or [I1] open PR → [I2] merge)
```

### The agent follows whatever `req:next` says

The agent never guesses the next action. The tool computes it from `state.json` and git state.

```sh
npm run req:next -- 2026-002
```

```text
[req:next] RUN  REQ-2026-002
  phase `phase-1`의 staged 변경을 리뷰받는다.

  $ npm run req:review-codex -- 2026-002 --kind phase --phase phase-1 --run
```

| kind | Meaning | exit |
|---|---|---|
| `RUN` | Run the printed command verbatim, then `req:next` again | 0 |
| `AGENT` | Work the tool cannot do (implement, write docs, `git add`) | 0 |
| `AWAIT_HUMAN` | **Control point** — do not proceed without the exact approval sentence | 10 |
| `DONE` | Nothing left for the tool. Integration is a separate control point | 11 |
| `BLOCKED` | Escalate to a human. Do not retry the same review | 2 |

Use `--json` for machine-readable output. It is **read-only** and changes no state.

Repeat this loop without stopping and it drives design → Codex review → implementation → re-review → commit. You only confirm at `AWAIT_HUMAN`.

> **Per-phase auto-commit (opt-in).** By default the loop stops at `AWAIT_HUMAN` before every phase commit. Set
> `"phaseCommit": { "autoApprove": "low-only" }` in `req.config.json` and Codex-approved phases of **LOW-risk**
> tickets commit without a human stop (`req:next` issues `req:commit --run` as a RUN), moving the single human
> confirmation to just **before the feature→main merge** (the terminal becomes `AWAIT_HUMAN` (integration) instead
> of `DONE`). **HIGH-risk tickets still stop at every phase** regardless of the policy. The Codex review gate is
> unchanged either way — only the *human stop* on LOW phases is removed.

### The reviewer persona is injected by the tool

`req:review-codex` puts `workflow/review-persona.md` in as the **first block** of the prompt. It is identical whether a human, Cursor, or Claude runs the command — it does not live where an agent can forget it. If the file is missing or empty, the review stops fail-closed.

Edit it for your project, or point `reviewPersonaPath` in `req.config.json` at a different file. Set it to `null` to disable — but **delta design reviews still inject the built-in delta contract** (the contract that tells the reviewer to re-check only what changed since the approved baseline, so it is attached regardless of the configured persona).

### Design re-reviews narrow to a delta

Once a design is approved, CommitGate remembers that snapshot of the design docs (default `00/01/02`, configurable via `designDocs`) as a baseline. When you then edit the design and re-review, the prompt is built so the reviewer assesses **only the changed documents and their direct impact**. Changed docs are tagged `[변경됨 — 심사 대상]` (changed — under review), unchanged docs `[승인 baseline — 변경 없음, 참조]` (approved baseline — unchanged, for reference), with a contract not to re-litigate the approved areas. Unchanged docs carry only an omission marker instead of their body, to save tokens. This reduces the failure mode where a small post-approval edit triggered a full re-review and the approval got reverted.

If a change is too fundamental to judge as a delta, the reviewer requests a full re-review with `full_review_requested: "yes"` (which must come with `commit_approved: "no"`). The baseline is then cleared so the next design review returns to full mode; once that design is approved again, a new baseline is captured and delta review resumes.

Both integration paths are valid: **through a PR (optional)** and **direct push**. A PR is not mandatory. But a direct push to a protected branch **bypasses the required status checks**, so it needs a separate "branch protection bypass를 사용한 direct push 승인" — holding bypass permission is not approval. In that case CI runs **after** the push, so its green is post-hoc verification, and the agent must not omit that from its report. tag, npm publish, and GitHub release are control points of their own, requested after CI is green and never bundled with the integration approval. See [AGENTS.template.md](AGENTS.template.md) and [docs/RELEASING.md](docs/RELEASING.md) for the full contract.

---

## What Does It Enforce?

CommitGate is designed to block **unreviewed changes from being committed**, not just to wrap commands.

- No Codex approval means no commit.
- If the approved staged tree differs from the current staged tree, the commit is blocked.
- Workflow files such as `state.json` and `responses/` cannot be mixed into the source commit.
- If Codex CLI is missing or fails, the workflow fails instead of silently passing.
- Review exit codes are outcome-based: `0` approved, `1` invalid/fail-closed, `2` blocked/no actionable findings, `3` needs fix.
- A no-findings/no-approval response is BLOCKED, not NEEDS_FIX, so agents must not loop on it.
- Re-review attempts are counted per open `(review_kind, phase_id)` review series. With `{ autoBudget: 5, hardCap: 8 }`, rounds 1–5 run automatically, rounds 6–8 each require a human exception record, and once `hardCap` is spent the next attempt (round 9 onward) is blocked even with an exception — this prevents infinite re-review loops. An approval closes the series; if a human terminates an unconverged series with a `human-resolution`, automatic resumption for that key is stopped.
- The reviewer returns every P1 it finds in a single call together in `findings[]` (batching). This avoids the serial one-finding-per-round flow that inflated review rounds — it does not lower the P1 bar; it just stops deferring already-known P1s to a later round.
- During install, existing `cross-spawn` versions below the verified floor warn by default and fail with `--strict`.
- Approval responses and evidence are kept under `workflow/REQ-.../responses/`.

In short: **approved changes pass, ambiguous changes stop.**

### What It Does *Not* Enforce

So that you do not miscalculate where your real defenses are:

- **This is not hard enforcement.** No git hook is installed, so running `git commit` directly instead of `req:commit` bypasses doctor, the approval binding, and the evidence trail. Your real defense for production is still CI and the deployment pipeline.
- **It does not keep your staged content secret.** `req:review-codex` transmits the full `git diff --cached` to Codex (OpenAI), and codex reads the repository root under `--sandbox read-only`. There is no masking, scrubbing, or size cap. For payment or credential-bearing codebases, write a "inspect the staged diff before review" step into your contract (`AGENTS.md`).
- **It does not guarantee anything after the commit.** Approval binds the staged tree at commit time; merge, tag, and publish are each separate control points.

---

## What Installation Adds

`npx commitgate init` adds the following to the target project. Existing files are not overwritten by default.

| Added item | Purpose |
|---|---|
| `workflow/*.schema.json` | Schemas for Codex responses and config |
| `workflow/review-persona.md` | Reviewer persona injected into the Codex review prompt (created only if absent) |
| `req.config.json` | Project-level configuration |
| `AGENTS.md` | The contract (created only if absent) |
| `CLAUDE.md` | Claude Code pointer (created only if absent) |
| `.claude/skills/commitgate/SKILL.md` | Claude Code skill (pointer) |
| `.claude/commands/req.md` | `/req` slash command (pointer) |
| `.cursor/rules/commitgate.mdc` | Cursor rule (pointer) |
| `.claude/skills/commitgate-*/SKILL.md` | **Companion Skills** — four of them, see below (existing files preserved) |
| `package.json` scripts | `req:new`·`req:next`·`req:review-codex`·`req:doctor`·`req:commit` = `commitgate <verb>` (missing keys only) |

### Companion Skills

CommitGate is a **governance layer** — `req:next` computes the next action, and review/approval/evidence gate the commit.
What was missing was **method**: how to sharpen a vague request, how to write the test first, how to corner a bug.
Four skills, adapted from Matt Pocock's public skills (MIT) to fit CommitGate's authority boundaries, ship with it.

| Skill | When |
|---|---|
| `commitgate-discovery` | **Before** `req:new` — turn a vague request into a REQ Brief. **User-invoked** |
| `commitgate-tdd` | When `req:next` returns `AGENT` — Red → Green → Refactor → stage |
| `commitgate-diagnosing-bugs` | Bugs, regressions, perf — feedback loop → reproduce/minimise → hypothesise → instrument → fix |
| `commitgate-research` | External technology choices — primary sources, findings with citations and limits |

**Auto-discovered, model-invoked.** The harness **discovers** skills automatically, but **the model decides**
whether to use one — that is probabilistic, so don't expect a skill to always fire. In Claude Code you can also
invoke one directly with `/commitgate-<name>`. On other harnesses, use whatever invocation that harness offers,
or follow the entry flow in `AGENTS.md`.

**Suggested flow**: `commitgate-discovery` to sharpen the request → `/req` (Claude Code) or the `AGENTS.md` entry
flow → `req:new` → repeat `req:next`.

#### Boundaries — read this

- 🔴 **`AGENTS.md` is the contract.** Skills carry **method**, not contract.
  Without the skills installed, the **core workflow behaves identically**.
- 🔴 **Skill output is not approval evidence.** Neither a companion skill's output nor the result of running
  Matt's external skills separately is **approval evidence** for CommitGate or Codex. Running the review, judging
  approval, transitioning state, and committing are **CommitGate's alone**, and `req:next` is the authority on
  what comes next.
- Skills are **cooperative text** — a skill doesn't block a commit; CommitGate's gate does.

#### Install, preservation, options

- **`--no-agent-entrypoints`**: skips the whole `.claude/` layer (including the four companion skills).
- **Existing files preserved (seed-once)**: skills are **meant to be edited**. A skill you modified is
  **not overwritten, even with `--force`.** `AGENTS.md`, `CLAUDE.md`, and `workflow/.gitignore` follow the same policy.
- **gitignore warning**: if `.claude/` is gitignored, the skills never reach a teammate's fresh clone.
  Install still proceeds, but CommitGate **warns** and tells you how to track them. **`--strict` stops before installing.**
- **Coexists with third-party skills**: third-party `tdd`, `grill-me`, etc. live at `.claude/skills/<name>/`, companions at
  `.claude/skills/commitgate-<name>/` — **different paths, so neither touches the other.**

#### Attribution

Adapted from Matt Pocock's MIT-licensed public skills at baseline SHA `d574778f94cf620fcc8ce741584093bc650a61d3`
and **included as package payload**. CommitGate **does not run or depend on any external skill installer** at
runtime — these are pinned copies inside the package. Each SKILL.md carries the full MIT notice; see
`skills/ATTRIBUTION.md` in the package for details.

### What it does **not** install

| Item | Where it lives instead |
|---|---|
| `scripts/req/**` runtime code | `node_modules/commitgate` — never copied into your project |
| `tsx` · `ajv` · `cross-spawn` | runtime dependencies of the `commitgate` package — never injected into your `package.json` |

What stays in your project is **governance and audit data** only: config, contract, schemas, persona, and `workflow/REQ-*` evidence. The **runtime code** lives in the package, so `npm update commitgate` refreshes it with no drift. But the **vendored assets** (schemas, persona) are separate from the runtime — on a minor upgrade you must also run `commitgate sync` (see [Upgrading (0.x)](#upgrading-0x)) or the runtime and assets will drift apart.

The `req:*` scripts call the installed package bin — `npm run req:new -- <slug>` → `commitgate req:new <slug>` → `node_modules/.bin/commitgate`.

The entrypoint files are **thin pointers**. The contract itself lives only in `AGENTS.md`.

If another tool already owns `.claude/` or `.cursor/`, skip that layer.

```sh
npx commitgate --no-agent-entrypoints
```

If an `AGENTS.md` already exists without the CommitGate contract marker (`<!-- commitgate:contract -->`), the contract template is installed alongside it as `AGENTS.commitgate.md` and you are told to merge it. Your existing file is never touched.

Preview without writing files:

```sh
npx commitgate --dry-run
```

Treat integrity warnings as an install failure:

```sh
npx commitgate --strict
```

CommitGate stops **before writing any file** if a contract pointer would be swallowed by `.gitignore`, if the `workflow/.gitignore` policy file would not reach a fresh clone, if the working tree makes a safe install commit impossible, or if an existing `cross-spawn` is below the verified floor.

> `--strict` also treats the `package.json`/lockfile changes left by the required `npm install -D commitgate` as pre-existing dirt. Recommended order: `npm i -D commitgate` → **commit** → `npx commitgate init --strict` → commit the scaffold.

> `workflow/machine.schema.json` and `workflow/req.config.schema.json` are always copied under `workflow/`, regardless of the `ticketRoot` setting in `req.config.json`.

---

## Upgrading (0.x)

Bumping the runtime takes **two** steps — `npm update` alone is not enough.

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
delta reviews) are silently disabled. `commitgate sync` restores those assets from the installed package copy:

```sh
npx commitgate sync                    # plan only (dry-run — see what would change)
npx commitgate sync --apply            # re-sync the schema axis
npx commitgate sync --apply --persona  # persona too (restore if missing; your edits are preserved)
```

- `sync` restores the **schema axis only** (contracts, always kept current). It does not touch companion skills,
  `workflow/.gitignore`, `package.json`, or `req:*`.
- The **persona (`review-persona.md`) is handled only with `--persona`**, and only as a **restore-if-missing**. A
  persona you edited yourself is never overwritten (if it differs, it is preserved and only reported) — to customize
  it, point `reviewPersonaPath` in `req.config.json` at a separate file.
- `req:doctor`'s **D20** WARNs when the vendored schema drifts from the installed copy (it never blocks the commit).

**③ If you are on an older (vendored) install**, follow up with `migrate` below to move to the Stage B runtime.

> In short: install `commitgate@latest` → `commitgate sync --apply` → (if needed) `commitgate migrate`.

---

## Migrating from an older install (`migrate`)

If `scripts/req/` is copied into your project and `req:*` points at `tsx scripts/req/*.ts`, you have an **older (vendored) install**. `init` detects this and **stops** rather than creating a silent mix, pointing you here.

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

---

## Support scope

| Environment | Status |
|---|---|
| **npm** | Fully supported — verified on every release by a packed-tarball smoke test |
| **pnpm · yarn** (`node_modules` linker) | Supported — uses the standard `node_modules/.bin/commitgate` resolution |
| **Yarn PnP** | **Not supported in this release** (untested). Use `nodeLinker: node-modules` |
| **workspaces / monorepo** | **Workspace-root installs** are supported (`req.config.json` and `workflow/` at the root). Installing independently in a sub-package is not supported |

**Reproducibility**: the review model/effort pins in `req.config.json`, plus the schemas and persona, stay in your project, so past review inputs are reproducible from git history. Runtime versions are pinned by your lockfile — **commit `package-lock.json`** (or the pnpm/yarn equivalent).

### Companion Skills discovery scope

**Installation is identical everywhere.** What follows is about whether a harness **discovers** those files.

| harness | Discovery |
|---|---|
| **Claude Code** | Reads `.claude/skills/<name>/SKILL.md` natively |
| **Cursor (editor)** | Reads `.claude/skills` as a compatibility path |
| **Cursor (CLI)** | ⚠️ **May differ by version and run mode — not guaranteed** |
| **Codex** | **Out of product scope** — no companion entrypoint is installed. In CommitGate, Codex is the **Reviewer**; these four are **Builder aids** |

⚠️ **This is based on vendor primary documentation — the CommitGate team did not verify it empirically.**
Checked **2026-07-17** on win32 x64 / Node v20.19.5. If a vendor changes behaviour, this table goes stale.

⚠️ **We do not claim Cursor CLI is either supported or unsupported.** Cursor announced Agent Skills for both
editor and CLI, but discovery via the `.claude/skills` compatibility path is reported to differ by version and
run mode, and we could not verify it. If discovery doesn't happen, **the core workflow is unaffected** — skills
are a quality aid, and `AGENTS.md` is the contract.

We do **not** double-install into `.cursor/skills` to work around this: that path's CLI behaviour is also
uncertain, and the same content in two places invites drift. If the vendor fixes it, it works **with no change
on our side** — same path.

---

## Removing CommitGate

CommitGate lives in two places: the **runtime** (`node_modules/commitgate`) and the **governance files installed into your project**.

The package manager removes the runtime:

```sh
npm uninstall -D commitgate      # pnpm remove -D commitgate · yarn remove commitgate
```

For the project files, review the plan below and clean up yourself. First, the important part: **`npx commitgate` is not a global install.** npx downloads the package into the npm cache (`_npx/<hash>/`) and runs it once; it leaves nothing in your global `node_modules` and nothing on your PATH.

Start by previewing the removal plan. This command **deletes nothing**:

```sh
npx commitgate uninstall
```

It reads your repo and classifies what it finds: (1) CommitGate-owned files that are byte-identical to the package originals, (2) files that differ and need your review, (3) files that must not be removed automatically, and (4) audit evidence. Then it prints the revert commands that match your commit state. You review them and run the deletions yourself.

### Why isn't removal automatic?

`init` **does not record on disk what it created.** At removal time it is therefore impossible to tell apart:

- `AGENTS.md` is created **only when absent**. If you already had one, init leaves it alone — so a file init wrote and a file you wrote look identical on disk.
- `req.config.json` is **merged** (missing keys only) when it already exists. The original is not kept, so the merge cannot be undone.
- `package.json` only gets keys that are **absent**. A pre-existing `req:doctor` or `cross-spawn` is not CommitGate's. And `ajv`, `cross-spawn`, and `tsx` are devDependencies other packages commonly use too.
- Your `ticketRoot` (default `workflow/`) accumulates REQ ticket `state.json` and `approvals.jsonl` — this tool's **audit evidence**.

Deleting all of that without a ledger would destroy user data. CommitGate installs no git hooks and touches no git config — it is a pure in-tree scaffolder, so git is the source of truth for undoing it.

### If you have not committed the scaffold

```sh
git status --porcelain -uall     # see what was added
git diff -- package.json         # see the injected req:* scripts and devDependencies
```

Then revert it yourself. Always restore `package.json` from `HEAD`:

```sh
git checkout HEAD -- package.json
```

> ⚠️ Without `HEAD`, git restores from the **index**, so after a `git add` the injected `req:*` scripts survive.
> ⚠️ This command also discards **any other uncommitted edits** to `package.json`. Check the diff first.

Delete only the paths `npx commitgate uninstall` listed. Removing `scripts/req/` or `workflow/` as whole directories would also take your own files and your ticket evidence with them.

> git does not track empty directories. After deleting the files, `git status` can report a clean tree while empty `scripts/`, `workflow/`, `.claude/`, and `.cursor/` directories remain on disk.

### If you already committed the scaffold

Revert the commit that introduced it.

```sh
git log --diff-filter=A --format='%H %s' -- scripts/req/req-new.ts
git revert <sha>
```

`npx commitgate uninstall` finds the introducing commit for you. If that commit also contains unrelated work, reverting it undoes that work too — inspect it with `git show <sha>` first. If the scaffold was introduced across several commits, no single revert will undo it.

### Clearing the npx cache (unrelated to your repo)

Check for a global install first:

```sh
npm ls -g commitgate            # empty output means it is not installed globally
npm uninstall -g commitgate     # only if you did install it globally
```

The package npx downloaded stays under `_npx/` in the npm cache.

```powershell
# Windows (PowerShell)
Remove-Item -Recurse -Force "$(npm config get cache)\_npx"
```

```sh
# macOS / Linux
rm -rf "$(npm config get cache)/_npx"
```

> ⚠️ **`npm cache clean --force` is not a CommitGate removal command.** It empties `_cacache` only and leaves `_npx` intact. It has nothing to do with the scaffolding in your repo.

---

## Prerequisites

| Requirement | Check | Notes |
|---|---|---|
| Git | `git --version` | Required |
| Node.js 18.17+ | `node --version` | Required |
| npm, pnpm, or yarn | `npm --version` | Examples use npm |
| Codex CLI | `codex --version` | Required for review runs |

If Codex CLI is not installed:

```sh
npm install -g @openai/codex
codex login
codex login status
```

On Windows, if `codex` is not found right after installation, open a new terminal so PATH is reloaded.

---

## Manual Commands

Most users should use the prompt flow above. This section is for understanding what the workflow runs internally or for debugging.

```sh
# 1. Create a ticket and branch
npm run req:new -- my-feature --run

# 2. Write design docs, then stage them
git add workflow/REQ-2026-001/00-requirement.md workflow/REQ-2026-001/01-design.md workflow/REQ-2026-001/02-plan.md

# 3. Design review
npm run req:review-codex -- 2026-001 --kind design --run

# 4. Implement code, then stage source files
git add <changed-source-files>

# 5. Gate check
npm run req:doctor -- 2026-001

# 6. Implementation review
npm run req:review-codex -- 2026-001 --kind phase --run

# 7. Commit approved code
npm run req:commit -- 2026-001 --run -m "feat: my feature"
```

Important: only stage code and documents you authored for the source commit. `state.json` and `responses/` are managed by the tool.

For multi-line commit messages, use a file instead of `-m`.

```sh
npm run req:commit -- 2026-001 --run --message-file commit-message.txt
```

---

## Command Cheat Sheet

| Command | Purpose |
|---|---|
| `npm install -D commitgate` | **Install the runtime (required first)** — the executable code lives in `node_modules/commitgate` |
| `npx commitgate init` | Install config, contract, schemas, and the `req:*` scripts into a project |
| `npx commitgate init --dry-run` | Preview the install plan without writing files |
| `npx commitgate init --strict` | Treat integrity warnings as install failures — stops before writing any file |
| `npx commitgate init --no-agent-entrypoints` | Skip `.claude/`, `.cursor/`, and `CLAUDE.md` |
| `npx commitgate migrate [--apply]` | Move an older vendored install to the runtime package (plan-only by default, non-destructive) |
| `npx commitgate uninstall` | Preview the removal plan (read-only — deletes nothing) |
| `npm uninstall -D commitgate` | Remove the runtime |
| `npm run req:new -- <slug> --run [--successor-of <REQ-id>]` | Create a REQ ticket, branch, and design docs. `--successor-of` creates a replacement REQ (see below) |
| `npm run req:next -- <id> [--json]` | **Compute the next action** (read-only) |
| `npm run req:review-codex -- <id> --kind design --run` | Review the design |
| `npm run req:review-codex -- <id> --kind phase --phase <p> --run` | Review the implementation |
| `npm run req:doctor -- <id>` | Check gate status |
| `npm run req:commit -- <id> --run -m "message"` | Commit approved changes |

`req:*` are **`package.json` scripts**, not executables on your PATH. npm needs the `--` separator to pass arguments.

```sh
npm  run req:next -- 2026-002    # npm
pnpm req:next 2026-002           # pnpm
yarn req:next 2026-002           # yarn
```

**Replacement REQ (`--successor-of`)**: only when a human has terminated a review series with a `human-resolution` **replace** decision can you create a replacement REQ that preserves the parent's lineage (total attempts and the resolution record) via `req:new --successor-of <REQ-id>`. If the parent has no valid replace resolution, ticket creation fails closed — this does not block ordinary new-REQ creation.

---

## Configuration

Defaults are enough for most projects. If needed, edit `req.config.json` in the project root.

| Key | Default | Meaning |
|---|---|---|
| `branchPrefix` | `"feat/req-"` | Prefix for new branches |
| `ticketRoot` | `"workflow"` | REQ ticket directory |
| `packageManager` | auto-detected | `npm`, `pnpm`, or `yarn` |
| `designDocs` | `00/01/02` docs | Design document filenames |
| `reviewPersonaPath` | `"workflow/review-persona.md"` | First block of the review prompt. `null` disables it — but delta design reviews still inject the built-in delta contract |
| `reviewModel` | `"gpt-5.6-terra"` | codex review model (pinned via `-c model=`). `null` inherits your global codex config |
| `reviewReasoningEffort` | `"high"` | codex review reasoning effort. One of `none`, `minimal`, `low`, `medium`, `high`, `xhigh`. `null` inherits the global setting |
| `reviewBudget` | `{ "autoBudget": 5, "hardCap": 8 }` | Re-review attempt budget for an open `(review_kind, phase_id)` review series. With the defaults, rounds 1–5 run automatically, rounds 6–8 each require a human exception record bound to that series and round, and once `hardCap` is spent the next attempt (round 9 onward) is blocked even with an exception. `hardCap ≤ 8`, `autoBudget ≤ hardCap` |
| `phaseCommit` | `{ "autoApprove": "never" }` | Per-phase auto-commit policy. `never` (default) stops for a human before every phase commit (current behavior). `low-only` auto-commits Codex-approved phases of **LOW-risk** tickets without a human stop and moves the single human confirmation to just before the feature→main merge. HIGH-risk tickets still stop at every phase under any value (`userConfirmGate` backstop). There is no `"all"` value (it would livelock on HIGH) |

Empty `branchPrefix` values and paths that escape the project root are rejected.

**Pinned review model & effort**: `req:review-codex` injects `-c model=` and `-c model_reasoning_effort=` into the codex arguments to **pin the model and reasoning effort**. Without pinning, a review inherits your global `~/.codex/config.toml` (e.g. `model_reasoning_effort="ultra"`), making a single review take minutes and burn tokens. The defaults are `gpt-5.6-terra`/`high`; if your codex doesn't support that model, change it in `req.config.json` or set it to `null` to inherit the global config. Whether the overrides are actually honored can be checked with `npm run verify:overrides` (requires the codex CLI).

**Stateless re-reviews**: each re-review starts a **fresh codex thread** (it does not resume/accumulate the prior conversation — which drove token growth and goalpost drift). Only the previous same-target NEEDS_FIX findings are carried into the prompt as reference data, to confirm closure.

---

## FAQ

**What happens if Codex CLI is missing?**
The review command fails. It is not treated as approval.

**Can I edit code after approval and still commit?**
No. If the staged tree changes after approval, CommitGate treats the approval as stale and requires review again.

**Why should I not stage `state.json` or `responses/`?**
They are workflow state and evidence files. Mixing them into the source commit weakens the approval binding, so `req:commit` blocks it.

**What should I do if I see a cross-spawn version warning?**
It means the target project may already have a `cross-spawn` version below CommitGate's verified floor. Upgrade it with `npm i -D cross-spawn@^7.0.6`. In CI or security-sensitive installs, use `npx commitgate --strict` to treat the warning as a failure.

**Does running install twice overwrite files?**
No. Existing files are skipped. Use `--force` if you intentionally want to refresh them.

---

## Current Scope

The current release is a **runtime package model**. Executable code and runtime dependencies live only in `node_modules/commitgate`; your project keeps governance/audit data and the `req:* = commitgate <verb>` scripts. (Older vendored installs move over with [`migrate`](#migrating-from-an-older-install-migrate).)

Current verification:

- GitHub Actions runs a `ubuntu-latest`, `macos-latest`, `windows-latest` × Node 18/20/22 matrix.
- `npm run smoke` installs the packed tarball into a throwaway project and asserts that the target has **no** `scripts/req/`, that `tsx`/`ajv`/`cross-spawn` are **not** injected, that all five `req:*` scripts point at the package bin, and that `npm run req:doctor` actually dispatches into the module inside the package. It verifies `migrate`'s non-destructiveness the same way.
- A Windows `.cmd` wrapper injection regression test protects package-manager and Codex wrapper paths.

Future scope:

- Yarn PnP support; independent installs in workspace sub-packages
- Asset↔runtime version drift detection
- Non-git VCS support
- More design document templates

---

## License

[MIT](./LICENSE) © 2026 sol5288
