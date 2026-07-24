# Guarantees and Limits (Safety Contract)

## What Does It Enforce?

CommitGate is designed to block **unreviewed changes from being committed**, not just to wrap commands.

- No Codex approval means no commit.
- If the approved staged tree differs from the current staged tree, the commit is blocked.
- Workflow files such as `state.json` and `responses/` cannot be mixed into the source commit.
- If Codex CLI is missing or fails, the workflow fails instead of silently passing.
- Review exit codes are outcome-based: `0` approved, `1` invalid/fail-closed, `2` blocked (no findings and no approval), `3` needs fix.
- A no-findings/no-approval response is BLOCKED, not NEEDS_FIX, so agents must not loop on it.
- Re-review attempts are counted per open `(review_kind, phase_id)` review series. With the defaults `{ autoBudget: 5, hardCap: 8 }`, rounds 1–5 run automatically, rounds 6–8 each require a human exception record, and once `hardCap` is spent the next attempt (round 9 onward) is blocked even with an exception — this prevents infinite re-review loops. An approval closes the series; if a human terminates an unconverged series with a `human-resolution`, automatic resumption for that key is stopped.
- The reviewer returns every P1 it finds in a single call together in `findings[]` (batching). This avoids the serial one-finding-per-round flow that inflated review rounds — it does not lower the P1 bar; it just stops deferring already-known P1s to a later round.
- During install, existing `cross-spawn` versions below the verified floor warn by default and fail with `--strict`.
- Approval responses and evidence are kept under `workflow/REQ-.../responses/`.
- Review attempts are recorded in a **committed append-only ledger** (`workflow/REQ-.../responses/review-ledger.jsonl`). Each attempt becomes two rows — `attempt-opened` **before** the external call and `attempt-closed` after the verdict — so an attempt with an `attempt-opened` but no `attempt-closed` is exactly a "budget was spent but the call never completed." Whether a human exception was consumed is recorded here too. The ledger is committed automatically on design approval and phase evidence finalization, and it **never stores prompt/response bodies** (hashes only — bodies live in the archives). If the ledger content is corrupt (e.g. a truncated JSONL line), the next review stops fail-closed before it starts.

In short: **approved changes pass, ambiguous changes stop.**

### What It Does *Not* Enforce

So that you do not miscalculate where your real defenses are:

- **This is not hard enforcement.** No git hook is installed, so running `git commit` directly instead of `req:commit` bypasses doctor, the approval binding, and the evidence trail. Your real defense for production is still CI and the deployment pipeline.
- **It does not keep your staged content secret.** `req:review-codex` transmits the full `git diff --cached` to Codex (OpenAI), and codex reads the repository root under `--sandbox read-only`. There is no masking, scrubbing, or size cap. For payment or credential-bearing codebases, write a "inspect the staged diff before review" step into your contract (`AGENTS.md`).
- **It does not guarantee anything after the commit.** Approval binds the staged tree at commit time; merge, tag, and publish are each separate control points.

## Support scope

| Environment | Status |
|---|---|
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
