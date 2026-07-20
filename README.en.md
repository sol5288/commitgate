# CommitGate

🌐 [한국어](./README.md) · **English**

**A commit gate that blocks AI-generated code from being committed until Codex has reviewed and approved it.**

[![CI](https://github.com/sol5288/commitgate/actions/workflows/ci.yml/badge.svg)](https://github.com/sol5288/commitgate/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/commitgate.svg)](https://www.npmjs.com/package/commitgate)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

<p align="center">
  <img src="https://raw.githubusercontent.com/sol5288/commitgate/main/assets/commitgate-workflow-hero.webp" alt="A builder AI and an independent reviewer AI are followed by a human approval point and a final commit gate" width="1200">
</p>

## One AI builds. Another one reviews.

AI coding agents can plan, implement, and test at remarkable speed. But when the same agent also reviews its own change, it can miss defects through the same assumptions and context that produced the code.

The usual workaround is to copy a change into another model and ask for a second opinion. That is tedious, and it leaves you to track which diff was reviewed, whether it changed afterwards, and when a person actually needs to decide.

CommitGate turns that handoff into a REQ workflow. **Your builder AI makes the change, Codex reviews it independently, and a human is asked only at the control points that need a decision.**

## Humans decide only at control points

| What you would otherwise track yourself | What CommitGate connects |
|---|---|
| Copy a builder's change into another model for review | Send the current **staged tree** to the Codex Reviewer |
| Check manually whether code changed after review | Bind the approved tree to the staged tree and require a new review when it moves |
| Decide what to check before commit, push, or release | Let `req:next` compute the next action and human control point |
| Step into every stage | Request an explicit approval only at an `AWAIT_HUMAN` control point |

## The workflow

1. **A builder AI starts the work.** `req:new` creates the REQ ticket, branch, and design documents.
2. **Codex reviews from an independent perspective.** It reviews the staged tree for design and implementation, then approves it or returns findings.
3. **A human confirms the important decisions.** Commit, integration, and release are explicit control points because they can be hard to undo or have broader impact.
4. **The final gate binds the commit.** `req:commit` commits only the exact staged tree that passed the human confirmation and Codex approval.

## What it guarantees

- 🔒 **Nothing is committed without an approved Codex review.** If the review fails or is absent, `req:commit` does not let it through.
- 🔁 **A staged change that moves after approval is re-reviewed.** If the approved tree differs from the tree you are about to commit, it is blocked as stale.
- 🧯 **When in doubt, it fails closed.** A no-findings-but-unapproved response, or a missing/failing Codex CLI, never passes silently.

For the full list of what is and is not guaranteed, see **[Guarantees & limits](https://github.com/sol5288/commitgate/blob/main/docs/guarantees.en.md)**.

## ⚠️ Before you start

- **Review sends your staged diff in full to an external service (Codex/OpenAI).** `req:review-codex` transmits the entire `git diff --cached`, and Codex reads your repository root under `--sandbox read-only`, so files outside the diff can be read too. There is **no** masking, filtering, or size cap — check the staged content for credentials, tokens, and personal data before running a review.
- **No git hook is installed — the gate can be bypassed.** Running `git commit` directly instead of `req:commit` bypasses the gate, the approval binding, and the evidence trail. Enforcement keeps a **cooperating agent on the contract's rails**; it is not a physical barrier against a human going around it.

## Get started in 3 minutes

From a folder that is a git repository with a `package.json`, two steps:

```sh
npm install -D commitgate     # 1) install the runtime — the executable code lives in node_modules/commitgate
npx commitgate init           # 2) add config, contract, schemas + the req:* scripts to your project
```

Installation writes files but **does not commit** them. `req:new` requires a clean working tree, so commit the scaffold first — the installer's `다음:` (next steps) output prints the exact paths to stage (do not stage everything with `-A`/`.`). For prerequisites (Codex CLI, etc.), pathspec staging, and the full first flow, see **[Quick Start](https://github.com/sol5288/commitgate/blob/main/docs/quick-start.en.md)**.

Then just give the agent a requirement.

```text
/req Add a profile edit API

- What: PATCH /profile to edit nickname and bio
- Why: there is currently no way to change a profile after signup
- Constraints: reuse the existing auth middleware, no schema changes
- Done when: unit tests pass, unauthorized users get 403
```

The first response usually sets up the ticket, branch, phase plan, and control points.

```text
REQ-2026-002 issued
branch: feat/req-2026-002-profile-edit-api
phases:
- phase-1: implement PATCH /profile
- phase-2: tests and regression check
control point: before req:commit --run / [B1] before a main direct push (or [I1] open PR → [I2] merge)
```

The agent then follows whatever `req:next` says — **design → Codex review → implement → re-review → commit**. You only step in at a control point (`AWAIT_HUMAN`) to give an approval sentence. (Outside Claude Code, a plain requirement works without `/req` — `AGENTS.md` and `.cursor/rules` load the rules.)

### Helps AI work more carefully

Beyond enforcing quality through gates (review, approval, commit), CommitGate also installs a companion skill (`commitgate-quality`) that **guides** the AI to understand the request and avoid mistakes.

For example, it guides the AI to check existing code and docs first, break large work into smaller steps, and run the needed checks after a change — cooperative guidance that won't always fire; the gates are what actually enforce. ([more](https://github.com/sol5288/commitgate/blob/main/docs/agent-prompt.en.md))

## How it works

`req:new` creates the ticket, branch, and design docs, and the next action at every step is always **computed** by `req:next` from `state.json` and git state (read-only — the agent does not guess).

```text
req:new → design review → implement → phase review → approval → req:commit → (integration & release are separate control points)
```

For the loop details, the `kind` table, the reviewer persona, and delta re-reviews, see **[Workflow](https://github.com/sol5288/commitgate/blob/main/docs/workflow.en.md)**; for agent entrypoints, passing a requirement, and companion skills, see the **[Agent guide](https://github.com/sol5288/commitgate/blob/main/docs/agent-prompt.en.md)**.

## Common commands

| Command | Purpose |
|---|---|
| `npm run req:new -- <slug> --run` | Create the REQ ticket, branch, and design docs |
| `npm run req:next -- <id>` | **Compute the next action** (read-only) |
| `npm run req:doctor -- <id>` | Check gate status |
| `npm run req:commit -- <id> --run -m "..."` | Commit the approved change |

`req:*` are `package.json` scripts, not PATH executables (npm needs `--` to pass arguments). The full command set and `pnpm`/`yarn` forms are in **[Workflow](https://github.com/sol5288/commitgate/blob/main/docs/workflow.en.md)**.

## Learn more

| Doc | Contents |
|---|---|
| [Quick Start](https://github.com/sol5288/commitgate/blob/main/docs/quick-start.en.md) | Install, prerequisites, first run |
| [Workflow](https://github.com/sol5288/commitgate/blob/main/docs/workflow.en.md) | `req:next` loop, kinds, persona, commands |
| [Agent guide](https://github.com/sol5288/commitgate/blob/main/docs/agent-prompt.en.md) | Entrypoints, passing a requirement, companion skills |
| [Guarantees & limits](https://github.com/sol5288/commitgate/blob/main/docs/guarantees.en.md) | Safety contract, support scope |
| [Configuration](https://github.com/sol5288/commitgate/blob/main/docs/configuration.en.md) | `req.config.json` |
| [Upgrading (0.x)](https://github.com/sol5288/commitgate/blob/main/docs/upgrade.en.md) | Runtime updates, `sync`, `quickstart`, `migrate` |
| [Removing](https://github.com/sol5288/commitgate/blob/main/docs/uninstall.en.md) | Safe removal procedure |
| [Troubleshooting](https://github.com/sol5288/commitgate/blob/main/docs/troubleshooting.en.md) | FAQ |
| [Development & scope](https://github.com/sol5288/commitgate/blob/main/docs/development.en.md) | CI, verification, roadmap |

## License

[MIT](./LICENSE) © 2026 sol5288
