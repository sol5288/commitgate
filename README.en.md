# CommitGate

🌐 [한국어](./README.md) · **English**

**A commit gate that blocks AI-generated code from being committed until Codex has reviewed and approved it.**

AI coding agents can move quickly, but unreviewed changes should not go straight into your history. CommitGate wraps each change in a REQ ticket and only allows the staged tree approved by Codex to be committed. If the code changes after approval, or if evidence is missing, it fails closed.

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

Then paste this prompt into your AI coding agent.

```text
Do not handle this as a normal implementation. Use the CommitGate workflow installed in this project.

Create a new REQ ticket and run this flow end to end:
req:new → write design docs → Codex design review → implement and test → req:doctor → Codex phase review → req:commit

Proceed automatically:
- If `req:review-codex` returns NEEDS_FIX/exit 3, fix the findings and rerun review.
- If it returns BLOCKED/exit 2, do not retry the same review; escalate or change the review target. If a stuck thread is suspected, you may retry once with `--fresh-thread`.
- The review target is only what has been staged with git add.
- Do not manually git add state.json or responses/.

Stop for human confirmation only:
- Right before req:commit --run
- Before merging to main or pushing
- Before destructive actions such as reset, clean, or force push
- When the requested scope must change
- When Codex review returns BLOCKED or remains unclear after bounded retries

Requirement:
- What:
- Why:
- Constraints:
- Done when:
```

The agent's first reply should look roughly like this.

```text
REQ-2026-002 created
Branch: feat/req-2026-002-profile-edit-api
Phases:
- phase-1: implement PATCH /profile
- phase-2: tests and regression checks
Control points: before req:commit --run, before push
```

After that, the agent runs design, implementation, tests, and Codex review. You only confirm at control points such as commit or push.

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

---

## What Installation Adds

`npx commitgate` adds the following to the target project. Existing files are not overwritten by default.

| Added item | Purpose |
|---|---|
| `scripts/req/` | `req:new`, `req:review-codex`, `req:doctor`, `req:commit` scripts |
| `workflow/*.schema.json` | Schemas for Codex responses and config |
| `req.config.json` | Project-level configuration |
| `AGENTS.md` | Template rules for the agent and reviewer |
| `package.json` scripts | `req:*` commands and required devDependencies |

Preview without writing files:

```sh
npx commitgate --dry-run
```

Treat the security floor warning as an install failure:

```sh
npx commitgate --strict
```

If an existing `cross-spawn` is below the verified floor, CommitGate stops before copying files.

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
| `req:new <slug> --run` | Create a REQ ticket, branch, and design docs |
| `req:review-codex <id> --kind design --run` | Review the design |
| `req:review-codex <id> --kind phase --run` | Review the implementation |
| `req:doctor <id>` | Check gate status |
| `req:commit <id> --run -m "message"` | Commit approved changes |

---

## Configuration

Defaults are enough for most projects. If needed, edit `req.config.json` in the project root.

| Key | Default | Meaning |
|---|---|---|
| `branchPrefix` | `"feat/req-"` | Prefix for new branches |
| `ticketRoot` | `"workflow"` | REQ ticket directory |
| `packageManager` | auto-detected | `npm`, `pnpm`, or `yarn` |
| `designDocs` | `00/01/02` docs | Design document filenames |

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
