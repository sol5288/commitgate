# CommitGate

🌐 [한국어](./README.md) · **English**

**A commit gate that keeps AI-authored changes from being committed without an approved Codex review.**

[![CI](https://github.com/sol5288/commitgate/actions/workflows/ci.yml/badge.svg)](https://github.com/sol5288/commitgate/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/commitgate.svg)](https://www.npmjs.com/package/commitgate)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

<p align="center">
  <img src="https://raw.githubusercontent.com/sol5288/commitgate/main/assets/commitgate-workflow-hero.webp" alt="A builder AI and an independent reviewer AI review a change, a human confirms it, and it passes the final commit gate" width="1200">
</p>

## What is CommitGate?

AI coding agents can plan, implement, and test at remarkable speed. But when the same agent also reviews its own change, it can miss defects through the same assumptions and context that produced the code. The usual workaround is to copy the change into another model for a second opinion — which is tedious, and leaves **you** tracking which diff was reviewed and whether it changed afterwards.

CommitGate turns that handoff into a REQ workflow.

```text
      a requirement
           │
           ▼
    ┌─────────────┐
    │  builder AI │   design · implement · test
    └──────┬──────┘
           │ git add
           ▼
    ┌─────────────┐
    │ staged tree │
    └──────┬──────┘
           │ req:review-codex
           ▼
    ┌──────────────────┐
    │ Codex (Reviewer) │   findings (P1) → fix, go back up, review again
    └──────┬───────────┘
           │ approved
           ▼
    ┌──────────────────┐
    │    req:commit    │   ◀── a human confirms at the AWAIT_HUMAN
    └──────────────────┘       control point (commit · integrate · release)
       commits that exact tree, and only that tree
```

**The point is not the arrows — it is the last box.** Only the **exact staged tree** that passed the human confirmation and the Codex approval gets committed; if a single line changes after approval, it is blocked as stale and re-reviewed.

| What you would otherwise track yourself | What CommitGate connects |
|---|---|
| Copy a builder's change into another model for review | Send the current **staged tree** to the Codex Reviewer |
| Check manually whether code changed after review | Bind the approved tree to the staged tree and require a new review when it moves |
| Decide what to check before commit, push, or release | Let `req:next` compute the next action and human control point |
| Step into every stage | Request an explicit approval only at an `AWAIT_HUMAN` control point |

## What it guarantees — and what it does not

| Guaranteed | Not guaranteed |
|---|---|
| 🔒 Nothing is committed without an approved Codex review | Anything **after** the commit (merge, tag, publish are separate control points) |
| 🔁 A staged change that moves after approval is re-reviewed | **Secrecy** of your staged content — there is no masking or filtering |
| 🧯 When in doubt it fails closed — no-findings-but-unapproved responses, a missing or failing Codex CLI | **Hard enforcement** — no git hook is installed |

Two of those are spelled out here rather than left in a table cell. Read them before you start.

> ⚠️ **Review sends your staged diff in full to an external service (Codex/OpenAI).** `req:review-codex` transmits the entire `git diff --cached`, and Codex reads your repository root under `--sandbox read-only`, so files outside the diff can be read too. There is **no** masking, filtering, or size cap — check the staged content for credentials, tokens, and personal data before running a review.
>
> ⚠️ **No git hook is installed — the gate can be bypassed.** Running `git commit` directly instead of `req:commit` bypasses the gate, the approval binding, and the evidence trail. Enforcement keeps a **cooperating agent on the contract's rails**; it is not a physical barrier against a human going around it.

For the full list, see **[Guarantees & limits](https://github.com/sol5288/commitgate/blob/main/docs/guarantees.en.md)**.

## Prerequisites

| Required | Check with | Note |
|---|---|---|
| Git | `git --version` | Required |
| Node.js 18.17+ | `node --version` | Required |
| npm, pnpm, or yarn | `npm --version` | Instructions below use npm |
| **Codex CLI** | `codex --version` | 🔴 **Needed to run reviews** — without it the install succeeds and you get blocked at the review step |

How to install and sign in to the Codex CLI is in the **[Quick Start](https://github.com/sol5288/commitgate/blob/main/docs/quick-start.en.md)**.

## Install in 3 minutes

From a folder that is a git repository with a `package.json`, three steps:

```sh
npm install -D commitgate     # 1) install the runtime — the executable code lives in node_modules/commitgate
npx commitgate init           # 2) add config, contract, schemas + the req:* scripts to your project
npx commitgate setup          # 3) pick the review model, reasoning effort, and stop point; sign in to codex
```

🔴 **Step 3 cannot be skipped.** Until setup completes, `req:new` and the other workflow commands are blocked. **A human runs it directly in a terminal** — it is interactive-only and exits immediately, without asking anything, in agent sessions and CI.

Installation writes files but **does not commit** them. `req:new` requires a clean working tree, so commit the scaffold first — the installer's `다음:` (next steps) output prints the exact paths to stage (do not stage everything with `-A`/`.`). For pathspec staging and the full first flow, see **[Quick Start](https://github.com/sol5288/commitgate/blob/main/docs/quick-start.en.md)**.

## Your first REQ

Just give the agent a requirement.

```text
/req Add a profile edit API

- What: PATCH /profile updates the nickname and bio
- Why: after signup there is no way to change the profile
- Constraints: reuse the existing auth middleware, no schema change
- Done when: unit tests pass, an unauthorized user gets 403
```

The first response typically sets up the ticket, branch, phase plan, and control points.

```text
REQ-2026-002 created
branch: feat/req-2026-002-profile-edit-api
phases:
- phase-1: implement PATCH /profile
- phase-2: tests and regression check
control points: before req:commit --run / before [B1] main direct push (or [I1] open PR → [I2] merge)
```

The agent then follows whatever `req:next` says: **design → Codex review → implement → re-review → commit**. The next action is always **computed** by `req:next` from `state.json` and git state (read-only — the agent does not guess). You step in only at an `AWAIT_HUMAN` control point with the approval sentence. (Outside Claude Code you can skip `/req` and just state the requirement — `AGENTS.md` and `.cursor/rules` load the rules.)

### It also helps the AI work more carefully

Beyond **enforcing** quality through the gate (review, approval, commit), CommitGate installs a companion skill (`commitgate-quality`) that **guides** the AI to understand the requirement properly and make fewer mistakes.

For example, it **suggests** reading existing code and docs before starting, splitting large work into small steps, and running the checks a change calls for — these are cooperative instructions, so they do not always fire; what actually blocks a commit is the gate. ([Details](https://github.com/sol5288/commitgate/blob/main/docs/agent-prompt.en.md))

## Where a human stops

Setup's third question (`stopGate`) decides **where you confirm**. That single value decides the stop point on its own.

| Value | Stops at | Choose it when |
|---|---|---|
| `phase` | **before every phase commit** | you want to look at each change yourself |
| `req` *(default)* | **the commit that completes the REQ** | you want to confirm per ticket and delegate the middle |
| `merge` | **when a delivery set of several REQs is done** | you want to review large work as one batch |

Under every value the **Codex review gate and the integration (main merge) approval are unchanged** — `stopGate` only moves where the *human stop* happens. How `HIGH` risk is treated and which confirmation `scope` each point requires are defined in **[Workflow](https://github.com/sol5288/commitgate/blob/main/docs/workflow.en.md#human-confirmation-for-high-risk-tickets)**.

## Command Cheat Sheet

| Command | Purpose |
|---|---|
| `npm run req:new -- <slug> --run` | Create the REQ ticket, branch, and design docs |
| `npm run req:next -- <id>` | **Compute the next action** (read-only) |
| `npm run req:doctor -- <id>` | Check gate status |
| `npm run req:commit -- <id> --run -m "..."` | Commit the approved change |
| `npm run req:confirm -- <id> --scope <s> --method "..." --run` | Record the human confirmation for a HIGH-risk ticket |

`req:*` are **`package.json` scripts**, not PATH executables (npm needs `--` to forward arguments). The full command list and `pnpm`/`yarn` forms are in the **[Workflow](https://github.com/sol5288/commitgate/blob/main/docs/workflow.en.md)**.

## Learn more

| Document | Contents |
|---|---|
| [Quick Start](https://github.com/sol5288/commitgate/blob/main/docs/quick-start.en.md) | Install, prerequisites, first run |
| [Workflow](https://github.com/sol5288/commitgate/blob/main/docs/workflow.en.md) | The `req:next` loop, kinds, persona, commands |
| [Agent guide](https://github.com/sol5288/commitgate/blob/main/docs/agent-prompt.en.md) | Entry points, stating requirements, companion skills |
| [Guarantees & limits](https://github.com/sol5288/commitgate/blob/main/docs/guarantees.en.md) | Safety contract and support scope |
| [Configuration](https://github.com/sol5288/commitgate/blob/main/docs/configuration.en.md) | `req.config.json` |
| [Upgrading (0.x)](https://github.com/sol5288/commitgate/blob/main/docs/upgrade.en.md) | Runtime updates, `sync`, `quickstart`, `migrate` |
| [Uninstalling](https://github.com/sol5288/commitgate/blob/main/docs/uninstall.en.md) | Safe removal procedure |
| [Troubleshooting](https://github.com/sol5288/commitgate/blob/main/docs/troubleshooting.en.md) | FAQ |
| [Development & current scope](https://github.com/sol5288/commitgate/blob/main/docs/development.en.md) | CI, verification, roadmap |

## License

[MIT](./LICENSE) © 2026 sol5288
