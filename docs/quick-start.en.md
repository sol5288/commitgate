# Quick Start (install and first run)

Below is the shortest path to get started. The project root must be a **git repository with a `package.json`**.

```sh
# If this is a fresh folder that is not yet a git repo or has no package.json, first:
git init
npm init -y

# 1) Install CommitGate as a devDependency — this is where the runtime lives:
npm install -D commitgate

# 2) Add config, contract, schemas, and the req:* scripts to your project:
npx commitgate init

# 3) Pick the review model, reasoning effort, and stop point; finish codex login (interactive):
npx commitgate setup

# You can verify readiness at any time (non-interactive, read-only):
npx commitgate check
```

> 🔴 **Step 3 is not optional.** On a fresh install, workflow commands such as `req:new` are blocked until setup completes — calling a review without a confirmed model/effort and codex login fails in a way that **also consumes review budget**.
> **A human runs it at a terminal.** It is interactive-only, so in pipes, CI, or agent sessions it exits immediately without asking anything — agents do not run it, they **ask you to**.
> Projects already using CommitGate are **not blocked** (existing-install exemption — see [Configuration](./configuration.en.md#setup-completion-marker)).
> setup changes `req.config.json`, so your working tree becomes dirty. Include it in the install commit below.

### What setup asks

It asks three questions. Each one is answered by **moving with ↑/↓ and confirming with Enter** (Ctrl+C cancels). The answers are written to `req.config.json`.

| Question | Default | Choices |
|---|---|---|
| Review model (`reviewModel`) | `gpt-5.6-terra` | `gpt-5.6-sol` · `gpt-5.6-terra` · `gpt-5.6-luna` · **type your own…** · empty (inherit codex global settings) |
| Reasoning effort (`reviewReasoningEffort`) | `medium` | `none` · `minimal` · `low` · `medium` · `high` · `xhigh` · empty |
| Stop point (`stopGate`) | `req` | `phase` · `req` · `merge` |

- **Model** has a "type your own…" item because values outside the list are valid. The other two are schema enums, so you pick from the list only.
- **Empty** does not clear the setting — it means *follow the codex global configuration*.
- **Stop point** decides where a human confirms: `phase` = before every phase commit; `req` = at the commit that completes the REQ; `merge` = when the delivery set is done (with no set, just before this REQ's integration, like `req`). The single source, including how `HIGH` risk is treated, is [Workflow — Human confirmation for HIGH-risk tickets](./workflow.en.md#human-confirmation-for-high-risk-tickets).
- setup finishes by checking your **codex login** and signing you in if needed.
- To change an answer later, run setup again or edit `req.config.json` directly.

> **Why is the install two steps?** CommitGate does **not** copy its runtime code into your project. Step 1 puts the runtime in `node_modules/commitgate`; step 2 adds only **governance assets** (config, contract, schemas, persona) plus `req:* = commitgate <verb>` scripts.
> Removing the runtime is a single `npm uninstall -D commitgate`. **For updates, follow the [Upgrading (0.x)](./upgrade.en.md) section below** — the runtime (`node_modules`) is bumped with `npm`, but the vendored assets (schemas, persona) in your project must be re-synced separately with `commitgate sync`, and a 0.x caret range (`^0.y`) does not cross a minor automatically.
> `init` **stops** if `devDependencies.commitgate` is not declared — there would be no runtime for `req:*` to point at.

Installation writes files but never commits them. `req:new` **requires a clean working tree**, so commit the scaffold first. The installer's `다음:` (next steps) output prints the exact paths to stage.

```sh
git add -- <the paths the installer printed>
git status                    # confirm only what you intended is staged
git commit -m "chore: install commitgate"
```

> **Do not stage everything (`-A` / `.`).** Unrelated changes in an existing project and untracked files such as `.env` would be swept into the commit, and the next `req:review-codex` transmits that staged diff in full to an external service.
> Park any changes that predate the install **by pathspec** after the install commit: `git stash push -u -- <paths>`.
> Without `-u`, untracked files remain and `req:new` stays blocked; without the pathspec, a bare `git stash -u` also sweeps up directories that are not ignored, such as `node_modules/`. The installer prints that path list too.

## What Installation Adds

`npx commitgate init` adds the following files and settings to the target project. Existing files are not overwritten by default.

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
| `.claude/skills/commitgate-*/SKILL.md` | **Companion Skills** — five of them, see below (existing files preserved) |
| `package.json` scripts | `req:new`·`req:next`·`req:review-codex`·`req:doctor`·`req:commit` = `commitgate <verb>` (missing keys only) |

### What it does **not** install

| Item | Where it lives instead |
|---|---|
| `scripts/req/**` runtime code | `node_modules/commitgate` — never copied into your project |
| `tsx` · `ajv` · `cross-spawn` | runtime dependencies of the `commitgate` package — never injected into your `package.json` |

What stays in your project is **governance and audit data** only: config, contract, schemas, persona, and `workflow/REQ-*` evidence. The **runtime code** lives in the package, so `npm update commitgate` refreshes it with no drift. But the **vendored assets** (schemas, persona) in your project are separate from the runtime — on a minor upgrade you must follow the [Upgrading (0.x)](./upgrade.en.md) section and run `commitgate sync`, or the runtime and assets will drift apart.

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

CommitGate stops **before writing any file**. The cases are:

- When a contract pointer (`.claude/`, `.cursor/`, `AGENTS.md`, `CLAUDE.md`) is swallowed by `.gitignore` and would not be shared with the team or CI
- When the `workflow/.gitignore` policy file is ignored, so scratch rules are not delivered to a fresh clone or CI
- When the working tree has staged changes before install, or edits that overlap the install artifacts, making a commit that contains only the scaffold impossible
- When an existing `cross-spawn` is below the verified floor (if the project already uses that package)

> `--strict` also treats the `package.json`/lockfile changes left by a preceding `npm install -D commitgate` as pre-existing dirt. Recommended order: `npm i -D commitgate` → **commit** → `npx commitgate init --strict` → commit the scaffold.

> `workflow/machine.schema.json` and `workflow/req.config.schema.json` are always copied under `workflow/`, regardless of the `ticketRoot` setting in `req.config.json`.

## Prerequisites

| Requirement | Check | Notes |
|---|---|---|
| Git | `git --version` | Required |
| Node.js 20+ | `node --version` | Required |
| npm, pnpm, or yarn | `npm --version` | Examples use npm |
| Codex CLI | `codex --version` | Required for review runs |

> 💳 **Reviews are not free.** CommitGate itself is MIT open source, but a review **actually calls Codex**, which consumes the usage or billing of the account you signed in with (a ChatGPT account or an OpenAI API key). What it costs depends on the model you pick and the size of the change, so no figure is quoted here — check your account's pricing.
> The number of re-reviews in one series is capped (default: 5 automatic, rounds 6–8 need a human exception, blocked from round 9) — see [Configuration — `reviewBudget`](./configuration.en.md).

If Codex CLI is not installed:

```sh
npm install -g @openai/codex
codex login
codex login status
```

On Windows, if `codex` is not found right after installation, open a new terminal so PATH is reloaded.
