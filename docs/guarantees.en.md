# Guarantees and Limits (Safety Contract)

## What Does It Enforce?

CommitGate is designed to block **unreviewed changes from being committed**, not just to wrap commands.

- No Codex approval means no commit.
- If the approved staged tree differs from the current staged tree, the commit is blocked.
- Workflow files such as `state.json` and `responses/` cannot be mixed into the source commit.
- If Codex CLI is missing or fails, the workflow fails instead of silently passing.
- Review exit codes are outcome-based: `0` approved, `1` invalid/fail-closed, `2` blocked (no findings and no approval), `3` needs fix.
- A no-findings/no-approval response is BLOCKED, not NEEDS_FIX, so agents must not loop on it.
- A ticket with `risk_level: HIGH` **cannot pass the point `stopGate` designates without a human confirmation.** This is not a *per-commit* guarantee — under the default `req`, intermediate phases commit on Codex approval alone and the confirmation is required at **the commit that completes the REQ** (with `merge`, when the delivery set ends; with `phase`, at every phase). Each point accepts only a confirmation whose `scope` matches it **exactly** — a broader confirmation cannot pass a narrower point ([Workflow — Human confirmation for HIGH-risk tickets](./workflow.en.md#human-confirmation-for-high-risk-tickets)).
- If `risk_level` is neither `LOW` nor `HIGH` (missing, typo, `MEDIUM`), nothing auto-commits — "undetermined" is not "allowed".
- Re-review attempts are counted per open `(review_kind, phase_id)` review series. With the defaults `{ autoBudget: 5, hardCap: 8 }`, rounds 1–5 run automatically, rounds 6–8 each require a human exception record, and once `hardCap` is spent the next attempt (round 9 onward) is blocked even with an exception — this prevents infinite re-review loops. An approval closes the series; if a human terminates an unconverged series with a `human-resolution`, automatic resumption for that key is stopped.
- The reviewer returns every P1 it finds in a single call together in `findings[]` (batching). This avoids the serial one-finding-per-round flow that inflated review rounds — it does not lower the P1 bar; it just stops deferring already-known P1s to a later round.
- During install, existing `cross-spawn` versions below the verified floor warn by default and fail with `--strict`.
- Approval responses and evidence are kept under `workflow/REQ-.../responses/`.
- Review attempts are recorded in a **committed append-only ledger** (`workflow/REQ-.../responses/review-ledger.jsonl`). Each attempt becomes two rows — `attempt-opened` **before** the external call and `attempt-closed` after the verdict — so an attempt with an `attempt-opened` but no `attempt-closed` is exactly a "budget was spent but the call never completed." Whether a human exception was consumed is recorded here too. The ledger is committed automatically on design approval and phase evidence finalization, and it **never stores prompt/response bodies** (hashes only — bodies live in the archives). If the ledger content is corrupt (e.g. a truncated JSONL line), the next review stops fail-closed before it starts.

  Each row also carries the **review model, reasoning effort, and provider pinned for that call**. 🔴 These are *what CommitGate specified in the request*, not *what the reviewer actually ran* — the tool cannot know the latter and does not claim it. A `null` value means "not pinned (inherits the reviewer's global config)"; a **missing key** means the row predates these fields (before 0.9.11).

  > **When extending the ledger schema**: add new keys as **optional** (`OPTIONAL_LEDGER_KEYS`). Growing the required-key list rejects **every already-committed ledger row** and blocks all reviews for that ticket. The contract has three parts — (1) past rows may omit new keys, (2) new rows **always** serialize the key even when the value is `null`, (3) if present, the value is strictly validated.

In short: **approved changes pass, ambiguous changes stop.**

### What It Does *Not* Enforce

So that you do not miscalculate where your real defenses are:

- **This is not hard enforcement.** No git hook is installed, so running `git commit` directly instead of `req:commit` bypasses doctor, the approval binding, and the evidence trail. Such commits leave no approval evidence, though, so **`npx commitgate verify-range` surfaces them locally as "unproven"** (meant for the pre-merge check — no GitHub auth or network needed). GitHub CI can consume usage quota and cost money, so it is **optional** and never a requirement of CommitGate — only organizations that want stronger enforcement opt into `verify-range --strict` or remote verification in their own pipeline.
- **It does not fully keep your staged content secret.** `req:review-codex` transmits the full `git diff --cached` to Codex (OpenAI), and codex reads the repository root under `--sandbox read-only`. Right before transmission, **high-confidence secret patterns** (PEM private keys, AWS keys, GitHub/Slack tokens, Google/OpenAI keys, JWTs) are blocked by default (`secretScan: "block"` — no budget is consumed; relax with `"warn"`/`"off"`). But **plenty of secrets are outside that list, and there is no masking or scrubbing** — the "inspect the staged diff before review" duty stands. Size is unlimited by default, with a warning above `promptWarnBytes` (256KiB default) and an opt-in `promptMaxBytes` that refuses (never truncates) oversized prompts.
- **It does not guarantee anything after the commit.** Approval binds the staged tree at commit time; merge, tag, and publish are each separate control points.
- 🔴 **Evidence is branch-local.** Approval responses, `approvals.jsonl`, and the ledger are committed on that ticket's **feature branch**. If you never merge that branch, **the evidence never reaches your mainline.** Nothing is destroyed — it is still on the branch — but it is invisible from mainline, and deleting the branch takes it with you.

  Measured (3 consumer repositories, 2,089 review calls, 16 days): **3.1% (65) of responses were absent from mainline**, and **66.2% of those were needs-fix records** (versus 47.9% among the ones that survived). In other words, **a retrospective built only from archived responses systematically undercounts failures.** A young repository with everything merged showed 0% — this skew accumulates over time.

  `req:doctor`'s **D30** reports tickets that were reviewed but whose evidence is not in trunk, together with the review count (WARN — work in progress is normal, so it does not block).
- 🔴 **The "confirm at every phase" backstop for HIGH-risk tickets is gone.** It used to be that a `HIGH` ticket required a human confirmation before every phase commit regardless of configuration; now **`stopGate` alone** decides where that confirmation happens — under the default `req`, intermediate phases of a HIGH ticket auto-commit on Codex approval alone. To review every change yourself, set `stopGate: "phase"`.

## Support scope

| Environment | Status |
|---|---|
| **Runtime (Node.js)** | **Node 20, 22, and 24** — verified by CI on three operating systems every release. 🔴 **Node 18 is not supported** (`engines: >=20` — installs warn, and fail under `--engine-strict`). Node 20 reached EOL on 2026-04-30 but is **deliberately kept** in the supported set because it is still widely deployed |
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
| **Codex** | **Out of product scope** — no companion entrypoint is installed. In CommitGate, Codex is the **Reviewer**; these five are **Builder aids** |

⚠️ **This is based on vendor primary documentation — the CommitGate team did not verify it empirically.**
Checked **2026-07-17** on win32 x64 / Node v20.19.5. If a vendor changes behaviour, this table goes stale.

⚠️ **We do not claim Cursor CLI is either supported or unsupported.** Cursor announced Agent Skills for both
editor and CLI, but discovery via the `.claude/skills` compatibility path is reported to differ by version and
run mode, and we could not verify it. If discovery doesn't happen, **the core workflow is unaffected** — skills
are a quality aid, and `AGENTS.md` is the contract.

We do **not** double-install into `.cursor/skills` to work around this: that path's CLI behaviour is also
uncertain, and the same content in two places invites drift. If the vendor fixes it, it works **with no change
on our side** — same path.
