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

# Then install:
npx commitgate
npm install
codex --version
codex login status
```

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
| `.claude/skills/commitgate/SKILL.md` | Claude Code (auto-invoked when it matches) |
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

### The reviewer persona is injected by the tool

`req:review-codex` puts `workflow/review-persona.md` in as the **first block** of the prompt. It is identical whether a human, Cursor, or Claude runs the command — it does not live where an agent can forget it. If the file is missing or empty, the review stops fail-closed.

Edit it for your project, or point `reviewPersonaPath` in `req.config.json` at a different file. Set it to `null` to disable.

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

`npx commitgate` adds the following to the target project. Existing files are not overwritten by default.

| Added item | Purpose |
|---|---|
| `scripts/req/` | `req:new`, `req:next`, `req:review-codex`, `req:doctor`, `req:commit` scripts |
| `workflow/*.schema.json` | Schemas for Codex responses and config |
| `workflow/review-persona.md` | Reviewer persona injected into the Codex review prompt |
| `req.config.json` | Project-level configuration |
| `AGENTS.md` | The contract (created only if absent) |
| `CLAUDE.md` | Claude Code pointer (created only if absent) |
| `.claude/skills/commitgate/SKILL.md` | Claude Code skill (pointer) |
| `.claude/commands/req.md` | `/req` slash command (pointer) |
| `.cursor/rules/commitgate.mdc` | Cursor rule (pointer) |
| `package.json` scripts | `req:*` commands and required devDependencies |

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

Treat the security floor warning as an install failure:

```sh
npx commitgate --strict
```

If an existing `cross-spawn` is below the verified floor, CommitGate stops before copying files.

> `workflow/machine.schema.json` and `workflow/req.config.schema.json` are always copied under `workflow/`, regardless of the `ticketRoot` setting in `req.config.json`.

---

## Removing CommitGate

First, the important part: **`npx commitgate` is not a global install.** npx downloads the package into the npm cache (`_npx/<hash>/`) and runs it once; it leaves nothing in your global `node_modules` and nothing on your PATH. The real "installation" is the set of files added to your repo, plus the `package.json` changes listed above.

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
| `npx commitgate` | Install CommitGate into a project |
| `npx commitgate --dry-run` | Preview the install plan without writing files |
| `npx commitgate --strict` | Treat low `cross-spawn` version warnings as install failures |
| `npx commitgate --no-agent-entrypoints` | Skip `.claude/`, `.cursor/`, and `CLAUDE.md` |
| `npx commitgate uninstall` | Preview the removal plan (read-only — deletes nothing) |
| `npm run req:new -- <slug> --run` | Create a REQ ticket, branch, and design docs |
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

---

## Configuration

Defaults are enough for most projects. If needed, edit `req.config.json` in the project root.

| Key | Default | Meaning |
|---|---|---|
| `branchPrefix` | `"feat/req-"` | Prefix for new branches |
| `ticketRoot` | `"workflow"` | REQ ticket directory |
| `packageManager` | auto-detected | `npm`, `pnpm`, or `yarn` |
| `designDocs` | `00/01/02` docs | Design document filenames |
| `reviewPersonaPath` | `"workflow/review-persona.md"` | First block of the review prompt. `null` disables it |

Empty `branchPrefix` values and paths that escape the project root are rejected.

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

The current release is **Stage A: vendored scaffold model**. `npx commitgate` copies workflow files into the target project.

Current verification:

- GitHub Actions runs a `ubuntu-latest`, `macos-latest`, `windows-latest` × Node 18/20/22 matrix.
- `npm run smoke` installs the packed tarball and runs the installed `commitgate` bin.
- A Windows `.cmd` wrapper injection regression test protects package-manager and Codex wrapper paths.

Future scope:

- Running directly from `node_modules` as a library-style model
- Non-git VCS support
- More design document templates

---

## License

[MIT](./LICENSE) © 2026 sol5288
