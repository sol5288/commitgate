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

**Code an AI wrote only gets saved once a different AI has checked it.**

Having an AI write your code gets you results fast. The question is **who checks them**. An AI reviewing its own work tends to repeat its own blind spots, and pasting the change into a second AI by hand is tedious — on top of that, *you* end up remembering how much was reviewed and whether the code changed again afterwards.

CommitGate runs that back-and-forth for you. **Until the check passes, saving is blocked.**

```text
        you state a requirement
               |
               v
  +--------------------+
  |  code-writing AI   |   writes the change
  +--------------------+
               |
               v
  +--------------------+
  |  reviewing AI      |   inspects that change
  +--------------------+
               |
               v
        anything to fix?  --- yes ---> go back up and rewrite
               |
              no (= approved)
               |
               v
  +--------------------+
  |  save (= commit)   |   only the approved change is saved
  +--------------------+
               |
               v
        any work left?  --- yes ---> go back up and rewrite
               |
              no
               |
               v
  +--------------------+
  |  human check       |   this is where you step in
  +--------------------+       (wrap up · merge)
```

**What matters is not the loop but the promise at the end.** Only the **exact change** that passed the check is saved — if a single line moves after approval, that approval is treated as stale and **a fresh check is required**.

By default **you are not stopped in the middle.** You confirm when a piece of work finishes and when results get merged. If you would rather look at every step yourself, you can set it that way — see [Where a human stops](#where-a-human-stops) below.

| What you would otherwise track yourself | What CommitGate does instead |
|---|---|
| Paste the change into another AI to get it reviewed | Hand the change you are about to save to the reviewing AI automatically |
| Eyeball whether the code moved after the review | Bind the approved content to what you are about to save, and demand a re-check when they differ |
| Decide what to verify before saving, sharing, or shipping | Let the tool compute the next action and the points where you confirm |
| Step into every stage | Ask for approval only at the defined checkpoints |

## What it guarantees — and what it does not

| Guaranteed | Not guaranteed |
|---|---|
| 🔒 **Nothing is committed without an approved Codex review** — until the reviewing AI passes it, saving is blocked | Anything **after** the save — merging, tagging, and publishing are each confirmed separately |
| 🔁 If the change moves after approval, it **must be checked again** | **Secrecy** of the code you send — nothing is masked or filtered |
| 🧯 **When in doubt it fails closed** — an answer with neither findings nor approval, a missing review tool, a failed run: all blocked | **Physically preventing** anything — a person who sets out to go around it still can |

The two below are not in the table. They are **things to read before you start**.

> ⚠️ **Review sends your staged diff in full to an external service (Codex/OpenAI).** The change you are about to save goes out **whole, with nothing trimmed**. The reviewing AI can also read **other files in your project folder**, not just that change (read-only). There is **no** masking, filtering, or size limit — before running a check, make sure no passwords, API keys, or personal data are mixed in.
>
> ⚠️ **No git hook is installed — the gate can be bypassed.** Save without going through this tool and the check and the record are both skipped. CommitGate's power is in **keeping a cooperating AI inside the agreed procedure**, not in physically stopping a person who decides to go around it.

For the full list of what is and is not guaranteed, see **[Guarantees & limits](https://github.com/sol5288/commitgate/blob/main/docs/guarantees.en.md)**.

## Prerequisites

| Required | Check with | Note |
|---|---|---|
| Git | `git --version` | Required |
| Node.js 20+ | `node --version` | Required |
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
