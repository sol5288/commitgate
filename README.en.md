# CommitGate

🌐 [한국어](./README.md) · **English**

**A commit gate that blocks unreviewed AI-authored changes on the standard REQ path and records legitimate
exceptions without disguising them as approvals.**

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

By default **you are not called at every phase commit** — you confirm when a piece of work finishes and when results get merged. If a re-check runs past its automatic limit, though, the default policy asks you to approve each further round. You can also switch to looking at every step yourself — where the stops actually are is defined in [Where a human stops](#where-a-human-stops) below.

> 💳 **Those loop-back arrows are not unbounded.** Re-checks for one phase run **automatically up to 5 times**. Rounds 6–8 each require a human exception record, and **from round 9 even an exception will not get you through.** Reviews are paid calls, so there is a ceiling — the values are configurable in [Configuration](https://github.com/sol5288/commitgate/blob/main/docs/configuration.en.md).

| What you would otherwise track yourself | What CommitGate does instead |
|---|---|
| Paste the change into another AI to get it reviewed | Hand the change you are about to save to the reviewing AI automatically |
| Eyeball whether the code moved after the review | Bind the approved content to what you are about to save, and demand a re-check when they differ |
| Decide what to verify before saving, sharing, or shipping | Let the tool compute the next action and the points where you confirm |
| Step into every stage | Ask for approval only at the defined checkpoints |

## What changed in 0.22.0 — lower CI cost, stronger evidence before merge

0.22.0 separates three checks that serve different purposes. The most important rule is:
**GitHub CI is optional, but local approval-evidence verification is not.**

| Check | What it checks | When it is needed | Cost and network |
|---|---|---|---|
| **Codex review** | Whether this code change has defects | Before `req:commit` in the standard REQ path | External Codex call; consumes usage |
| **`verify-range --strict`** | Whether every commit in the range has valid approval, bookkeeping, or exception evidence | During `integrate` and before a release | Local Git only; no GitHub Actions usage |
| **GitHub CI** | Whether the change works in remote environments such as multiple OS and Node versions | Only when the user wants it | May consume Actions quota or incur cost |

Think of a car: Codex review is the **repair inspection**, `verify-range --strict` checks the
**maintenance records**, and GitHub CI is a **test drive on several road types**. You may skip the test drive,
but you still check the records.

### What merging looks like

```sh
npx commitgate integrate          # inspect the plan and strict result first (dry-run)
npx commitgate integrate --run    # perform the local merge; final confirmation defaults to No
```

`integrate` checks for a clean worktree, **always** verifies approval evidence in strict mode, asks for final
human confirmation, and merges locally. It re-verifies if either branch moves, and restores the original state
when it can after a conflict. **It never pushes.**

In a project that has GitHub CI run configuration, it asks this before the merge:

```text
GitHub CI workflow를 실행하시겠습니까?
GitHub Actions 사용량 또는 비용이 발생할 수 있습니다. [y/N]
```

Enter, an empty answer, and `n` all mean **do not run it**. With no configuration, the question is not shown.
To request a run explicitly, use `integrate --run --run-github-ci`.

> ⚠️ **"CommitGate does not run CI" does not mean "this repository can never auto-run CI."** If a project's
> `.github/workflows/*.yml` reacts to `push`, `pull_request`, or a tag, that repository-owned workflow may start
> after a push even though CommitGate did not dispatch it.

`verify-range --check-github-ci` only **queries** existing GitHub check-runs; it never starts a workflow.
`integrate --run --run-github-ci`, on the other hand, actually starts the configured workflow.

### Record a legitimate exception without pretending it was reviewed

For an emergency commit that could not receive a normal Codex review, record the reason explicitly:

```sh
npx commitgate attest <commit-sha> --reason "Emergency production fix — approved by user" --run
```

`attest` **does not turn an exception into a review approval.** It records who accepted which commit and why in
an append-only log, so `verify-range` classifies it as `attested`. It cannot repair or cover up corrupt approval
evidence.

0.22.0 also deep-classifies commits into six categories — approved, bookkeeping, merge, attested,
invalid-evidence, and unproven. Check C5 points out an old CommitGate contract left in `AGENTS.md` after an
upgrade. Approval-evidence calculation in `report` improved from about 29.5 seconds to 1.2 seconds on this
repository (the result varies with environment and history size).

### Upgrading from 0.21.x

```sh
npm install -D commitgate@^0.22.0
npx commitgate sync --apply --gitignore
npx commitgate check
```

If C5 says WARN, do not replace `AGENTS.md` wholesale. Compare it with
`node_modules/commitgate/AGENTS.template.md` and manually merge **only the CommitGate contract sections**.
`sync` deliberately leaves `AGENTS.md` alone so project-specific instructions survive. See
[Upgrading](https://github.com/sol5288/commitgate/blob/main/docs/upgrade.en.md) for the full procedure.

## What it guarantees — and what it does not

| Guaranteed | Not guaranteed |
|---|---|
| 🔒 **On the standard REQ path, nothing is committed without an approved Codex review** — `req:commit` stays blocked until the reviewing AI passes it | A commit approval authorizing later actions — merging, tagging, and publishing are each confirmed separately |
| 🔁 If the change moves after approval, it **must be checked again** | **Secrecy** of the code you send — nothing is masked or filtered |
| 🧾 A directly created commit still appears as **unproven** in `verify-range` and is blocked by strict integration and release checks | **Physically preventing** anything — a person who runs `git commit` directly can still bypass the standard path |
| 🧯 **When in doubt it fails closed** — an answer with neither findings nor approval, a missing review tool, a failed run: all blocked | Turning a no-review exception into a review approval — `attest` transparently records only the exception reason |

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

**Two** axes create a stop. `stopGate`, which setup asks about, decides **where a human confirms at commits and integration**; the review budget (`reviewBudget.onSoftLimit`) decides **whether a long re-review run stops on its own**.

### At commits and integration — `stopGate`

| Value | Stops at | Choose it when |
|---|---|---|
| `phase` | **before every phase commit** | you want to look at each change yourself |
| `req` *(default)* | **the commit that completes the REQ** | you want to confirm per ticket and delegate the middle |
| `merge` | if you grouped several REQs into a delivery set, **when that set finishes**; if you did not group them, **just before that REQ's integration** | you want to review large work as one batch |

🔴 Choosing `merge` **does not remove the stop.** With no delivery set it stops in the same place `req` does — right before that REQ is integrated into main.

Under every value the **Codex review gate and the integration (main merge) approval are unchanged** — `stopGate` only moves where the *human stop* happens. How `HIGH` risk is treated and which confirmation `scope` each point requires are defined in **[Workflow](https://github.com/sol5288/commitgate/blob/main/docs/workflow.en.md#human-confirmation-for-high-risk-tickets)**.

### When a re-review runs long — `reviewBudget.onSoftLimit`

Once a review passes the soft limit (`autoBudget`) and keeps going, this axis decides what happens next, **regardless of `stopGate`**.

| Value | On a round past the soft limit |
|---|---|
| `ask` *(default)* | every such round needs **a human exception approval** — you stop here even with `stopGate: merge` |
| `auto` | the round proceeds without human approval, and the grounds are recorded in the review ledger |

Reaching `hardCap` blocks **under both values** — choosing automatic progress never buys an unbounded loop. The defaults and how to set them are defined in **[Configuration — Review budget](https://github.com/sol5288/commitgate/blob/main/docs/configuration.en.md#review-budget--reviewbudget)**.

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
[OK] C5: 계약 문서에 폐기된 CommitGate 서술 없음(AGENTS.md · AGENTS.commitgate.md)
PASS — OK 5 · WARN 0
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
| `npx commitgate report` | Summarize local review, verification, and CI-choice history (read-only) |
| `npx commitgate verify-range --strict` | Deep-check approval evidence for a commit range; fail on unproven or invalid evidence |
| `npx commitgate integrate` | Inspect the strict verification and local merge plan (dry-run by default) |
| `npx commitgate integrate --run` | Merge locally after final confirmation (no push; GitHub CI skipped by default) |
| `npx commitgate attest <sha> --reason "..." --run` | Record the reason for a legitimate exception that had no normal review |
| `npx commitgate sync --apply --gitignore` | Apply upgraded assets and backfill local-log `.gitignore` rules |
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
| **delivery set** | Several REQs grouped into one larger unit. Used by `stopGate: merge`, and **optional** — without one, each REQ stops just before its own integration |
| **strict verification** | A check that fails instead of warning when evidence is ambiguous. It reads local Git history, not GitHub CI |
| **attestation** | A record naming the commit and reason for a no-review exception, without disguising it as an approval |
| **GitHub CI** | A remote check run by GitHub Actions. It is optional in CommitGate and is skipped by default |
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
