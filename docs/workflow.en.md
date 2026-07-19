# Workflow — the flow `req:next` drives

## The agent follows whatever `req:next` says

The agent never guesses the next action. The tool computes it from `state.json` and git state.

```sh
npm run req:next -- 2026-002
```

```text
[req:next] RUN  REQ-2026-002
  review the staged change of phase `phase-1`.

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

## The reviewer persona is injected by the tool

`req:review-codex` puts `workflow/review-persona.md` in as the **first block** of the prompt. It is identical whether a human, Cursor, or Claude runs the command — it does not live where an agent can forget it. If the file is missing or empty, the review stops fail-closed.

Edit it for your project, or point `reviewPersonaPath` in `req.config.json` at a different file. Set it to `null` to disable — but **delta design reviews still inject the built-in delta contract** (the contract that tells the reviewer to re-check only what changed since the approved baseline, so it is attached regardless of the configured persona).

## Design re-reviews narrow to a delta

Once a design is approved, CommitGate remembers that snapshot of the design docs (default `00/01/02`, configurable via `designDocs`) as a baseline. When you then edit the design and re-review, the prompt is built so the reviewer assesses **only the changed documents and their direct impact**. Changed docs are tagged `[변경됨 — 심사 대상]` (changed — under review), unchanged docs `[승인 baseline — 변경 없음, 참조]` (approved baseline — unchanged, for reference), with a contract not to re-litigate the approved areas. Unchanged docs carry only an omission marker instead of their body, to save tokens. This reduces the failure mode where a small post-approval edit triggered a full re-review and the approval got reverted.

If a change is too fundamental to judge as a delta, the reviewer requests a full re-review with `full_review_requested: "yes"` (which must come with `commit_approved: "no"`). The baseline is then cleared so the next design review returns to full mode; once that design is approved again, a new baseline is captured and delta review resumes.

Both integration paths are valid: **through a PR (optional)** and **direct push**. A PR is not mandatory. But a direct push to a protected branch **bypasses the required status checks**, so it needs a separate "branch protection bypass를 사용한 direct push 승인" — holding bypass permission is not approval. In that case CI runs **after** the push, so its green is post-hoc verification, and the agent must not omit that from its report. tag, npm publish, and GitHub release are control points of their own, requested after CI is green and never bundled with the integration approval. See [AGENTS.template.md](../AGENTS.template.md) and [docs/RELEASING.md](../docs/RELEASING.md) for the full contract.

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

## Command Cheat Sheet

| Command | Purpose |
|---|---|
| `npm install -D commitgate` | **Install the runtime (required first)** — the executable code lives in `node_modules/commitgate` |
| `npx commitgate init` | Install config, contract, schemas, and the `req:*` scripts into a project |
| `npx commitgate init --dry-run` | Preview the install plan without writing files |
| `npx commitgate init --strict` | Treat integrity warnings as install failures (gitignored contract pointers, a working tree that makes a safe install commit impossible, etc.) — stops before writing any file |
| `npx commitgate init --no-agent-entrypoints` | Skip `.claude/`, `.cursor/`, and `CLAUDE.md` |
| `npx commitgate sync [--apply] [--persona]` | Re-sync vendored **schema-axis** assets (machine/req.config schema) to the installed package copy after an upgrade (plan-only by default). `--persona` **restores a missing persona only** (never overwrites your edits). See [Upgrading (0.x)](./upgrade.en.md) |
| `npx commitgate quickstart [--apply]` | Idempotently inject the Quick Start block into an existing `CLAUDE.md`/`AGENTS.md` (plan-only by default). Inserts only the managed block, preserves the rest. `AGENTS.md` only when it carries the contract marker. Backfills [REQ-2026-039], whose seed-once install does not touch existing files |
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

**Replacement REQ (`--successor-of`)**: only when a human has judged a review series unconverged and terminated it with a `human-resolution` **replace** decision can you create a replacement REQ that preserves the parent's lineage (total attempts and the termination record) via `req:new --successor-of <REQ-id>`. If the parent has no valid replace resolution, ticket creation fails closed — this does not block ordinary new-REQ creation itself.
