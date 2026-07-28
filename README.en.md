# CommitGate

🌐 [한국어](./README.md) · **English**

**A commit gate that keeps AI-authored changes from being committed without an approved Codex review.**

[![CI](https://github.com/sol5288/commitgate/actions/workflows/ci.yml/badge.svg)](https://github.com/sol5288/commitgate/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/commitgate.svg)](https://www.npmjs.com/package/commitgate)
[![node](https://img.shields.io/node/v/commitgate.svg)](https://nodejs.org)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

<p align="center">
  <img src="https://raw.githubusercontent.com/sol5288/commitgate/main/assets/commitgate-workflow-hero.webp" alt="A builder AI and an independent reviewer AI review a change, a human confirms it, and it passes the final commit gate" width="1200">
</p>

> **Where should I start?**
> ⚡ Just let me try it → [Install in 3 minutes](#install-in-3-minutes) · 🔍 What does it guarantee → [Guarantees](#what-it-guarantees--and-what-it-does-not) · 🆘 I'm stuck → [When you get stuck](#when-you-get-stuck) · 📖 Unfamiliar terms → [Glossary](#glossary)

## What is CommitGate?

**Code an AI wrote only gets saved once a different AI has checked it.**

Having an AI write your code gets you results fast. The question is **who checks them**. An AI reviewing its own work tends to repeat its own blind spots, and pasting the change into a second AI by hand is tedious — on top of that, *you* end up remembering how much was reviewed and whether the code changed again afterwards.

CommitGate runs that back-and-forth for you. **Until the check passes, saving is blocked.**

```text
  you state a requirement
       |
       v
  +--------------------+
  |  code-writing AI   |  writes the change
  +--------------------+
       |
       v
  +--------------------+
  |  reviewing AI      |  inspects that change
  +--------------------+
       |
       +-- something to fix --> go back up and rewrite
       |
       v  (nothing to fix = approved)
  +--------------------+
  |  save (= commit)   |  only the approved change is saved
  +--------------------+
       |
       +-- work still left --> go back up and rewrite
       |
       v
  +--------------------+
  |  human check       |  this is where you step in (wrap up · merge)
  +--------------------+
```

**What matters is not the loop but the promise at the end.** Only the **exact change** that passed the check is saved — if a single line moves after approval, that approval is treated as stale and **a fresh check is required**.

By default **you are not stopped in the middle.** You confirm when a piece of work finishes and when results get merged. If you would rather look at every step yourself, you can set it that way — see [Where a human stops](#where-a-human-stops) below.

> 💳 **Those loop-back arrows are not unbounded.** Re-checks for one phase run **automatically up to 5 times**. Rounds 6–8 each require a human exception record, and **from round 9 even an exception will not get you through.** Reviews are paid calls, so there is a ceiling — the values are configurable in [Configuration](https://github.com/sol5288/commitgate/blob/main/docs/configuration.en.md).

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

> 💳 **Reviews are not free.** CommitGate itself is MIT open source, but a check **actually calls Codex**, which consumes the usage or billing of the account you signed in with (a ChatGPT account or an OpenAI API key). What it costs depends on the model you pick and the size of the change, so no figure is quoted here — check your account's pricing. The per-phase call ceiling is described under [What is CommitGate?](#what-is-commitgate) above.

How to install and sign in to the Codex CLI is in the **[Quick Start](https://github.com/sol5288/commitgate/blob/main/docs/quick-start.en.md)**.

## Install in 3 minutes

**0) Prepare the folder.** It must be a git repository with a `package.json`. If it is not yet, run this in that folder:

```sh
git init      # if it is not a git repository yet
npm init -y   # if there is no package.json
```

**1–3) Install.**

```sh
npm install -D commitgate     # 1) install the runtime — the executable code lives in node_modules/commitgate
npx commitgate init           # 2) add config, contract, schemas + the req:* scripts to your project
npx commitgate setup          # 3) pick the review model, reasoning effort, and stop point; sign in to codex
```

🔴 **Step 3 cannot be skipped.** Until setup completes, `req:new` and the other workflow commands are blocked. **A human runs it directly in a terminal** — it is interactive-only and exits immediately, without asking anything, in agent sessions and CI. There are three questions and you answer them with ↑/↓.

**4) Commit the scaffold.** Installation writes files but **does not commit** them, and `req:new` requires that nothing is left unsaved.

```sh
git add -- <the paths printed under `다음:` (next steps) by the installer>
git status                                  # check with your own eyes that only what you intended is in
git commit -m "chore: install commitgate"
```

> 🔴 **Do not use `git add -A` or `git add .`.** They sweep in unrelated changes your project already had, plus files like `.env`, and **the review that follows sends all of it to an external service (Codex) in full.** The installer prints the exact paths to stage — list only those.

For pathspec staging and the full first flow, see **[Quick Start](https://github.com/sol5288/commitgate/blob/main/docs/quick-start.en.md)**.

> ↩️ **You can back out.** `npx commitgate uninstall` **deletes nothing and only prints a removal plan** — see what would go before you decide ([Uninstalling](https://github.com/sol5288/commitgate/blob/main/docs/uninstall.en.md)).

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

The agent then follows whatever `req:next` says: **design → Codex review → implement → re-review → commit**. The next action is always **computed** by `req:next` from `state.json` and git state (read-only — the agent does not guess).

### What do you actually do — the "approval sentence"

When a point needs a human, `req:next` stops (`AWAIT_HUMAN`) and **prints exactly what you should say back.** The CLI speaks Korean, so the block below is reproduced verbatim rather than translated — the line that matters is the one after `승인 문장:`.

```text
[req:next] AWAIT_HUMAN  REQ-2026-002
  phase 승인이 살아 있다. 커밋 전 사람 확인이 필요하다.

  통제점: req:commit --run 직전
  승인 문장: "req:commit --run 승인"
  승인 후 실행: $ npm run req:commit -- 2026-002 --run -m "<이 phase의 conventional 커밋 메시지>"
```

Your job here is one thing — reply to the agent with **exactly what follows `승인 문장:`** (*approval sentence*).

```text
req:commit --run 승인
```

You do not have to memorize any command. The approval sentence differs per control point and **is printed on screen each time.** Without it, the run does not move past that point.

(Outside Claude Code you can skip `/req` and just state the requirement — `AGENTS.md` and `.cursor/rules` load the rules.)

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

## When you get stuck

**Run this first.** It is read-only, fixes nothing, and is wired into no gate — a bad result here never blocks anything that was not already blocked.

```sh
npx commitgate check
```

```text
[OK] C1: req.config.json 유효(또는 부재 — 기본값 사용)
[OK] C2: 리뷰어 CLI 확인: codex-cli 0.144.1
[OK] C3: 리뷰어 로그인 확인: Logged in using ChatGPT
[OK] C4: 리뷰 모델·추론강도 고정: gpt-5.6-terra / medium
PASS — OK 4 · WARN 0
```

Versions and model names differ per environment. What you are reading is not the numbers but **whether each line says `[OK]` or `FAIL`**.

| Symptom | Cause | What to do |
|---|---|---|
| `req:new` is blocked saying setup is not finished | you skipped install step 3 | `npx commitgate setup` — **a human, in a terminal** |
| A review dies with `codex 종료 코드 1` (exit code 1) | usually not installed or not signed in | 🔴 **Before re-running it**, run `npx commitgate check` — that failure already spends review budget |
| `req:new` is blocked because of the working tree | unsaved changes remain | The commit block in step 4 of [Install in 3 minutes](#install-in-3-minutes) |

More symptoms and answers are in **[Troubleshooting](https://github.com/sol5288/commitgate/blob/main/docs/troubleshooting.en.md)**.

## Command Cheat Sheet

**Workflow** — these are `package.json` scripts, so you call them with `npm run`, and npm needs `--` to forward arguments.

| Command | Purpose |
|---|---|
| `npm run req:new -- <slug> --run` | Create the REQ ticket, branch, and design docs |
| `npm run req:next -- <id>` | **Compute the next action** (read-only) |
| `npm run req:doctor -- <id>` | Check gate status |
| `npm run req:commit -- <id> --run -m "..."` | Commit the approved change |
| `npm run req:confirm -- <id> --scope <s> --method "..." --run` | Record the human confirmation for a HIGH-risk ticket |

**Install & diagnostics** — these you run directly as `npx commitgate <verb>`.

| Command | Purpose |
|---|---|
| `npx commitgate setup` | Pick the review model and stop point, sign in to codex (interactive, required) |
| `npx commitgate check` | Diagnose readiness (read-only) |
| `npx commitgate sync` | After an upgrade, align the project's vendored assets with the runtime (plan only by default; `--apply` to write) |
| `npx commitgate uninstall` | Print a removal **plan only** (deletes nothing) |

The full command list and `pnpm`/`yarn` forms are in the **[Workflow](https://github.com/sol5288/commitgate/blob/main/docs/workflow.en.md)**. Per-command options are available via `npx commitgate <verb> --help`.

## Glossary

<details>
<summary>Expand this when a term is unfamiliar</summary>

| Term | Meaning |
|---|---|
| **REQ (ticket)** | One requirement as a unit of work. It gets a number like `REQ-2026-002` and its own branch |
| **phase** | A step a REQ is split into. Each is reviewed and saved separately |
| **stage (staged)** | The git state of "this is what I am about to save". `git add` is what puts things there |
| **staged diff** | Those selected changes. **This is exactly what gets sent to the reviewing AI, in full** |
| **clean working tree** | No unsaved (uncommitted) changes at all |
| **commit** | Recording changes into git. This is the "save" this tool talks about |
| **branch** | A separate line of work. One is created per REQ |
| **merging into main** | Folding a branch's work back into the trunk (`main`). This point needs human approval |
| **fail-closed** | The design rule of blocking rather than passing when the answer is ambiguous |
| **AWAIT_HUMAN** | The tool has stopped and is waiting for your approval. The approval sentence is printed with it |
| **delivery set** | Several REQs grouped into one larger unit. Used by `stopGate: merge` |
| **devDependency** | A package needed only while developing, never shipped to production. CommitGate installs here |
| **companion skill** | A guidance file telling the AI how to work. Advisory, not enforced |

</details>

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
