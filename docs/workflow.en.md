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

> **Where a human stops is decided by `stopGate` alone.** Under the default `req`, phases inside a REQ commit
> without a human stop (`req:next` issues `req:commit --run` as a RUN), and the human confirmation is gathered at
> **the commit that completes the REQ** and **before integration** (the terminal becomes `AWAIT_HUMAN` (integration)
> instead of `DONE`). To stop at every phase, use `stopGate: "phase"`.
> The per-value confirmation points and how `HIGH` risk is treated are defined in
> [Human confirmation for HIGH-risk tickets](#human-confirmation-for-high-risk-tickets) below — that section is the
> single source. The Codex review gate is unchanged under every value — `stopGate` only moves the *human stop*.

## The reviewer persona is injected by the tool

`req:review-codex` puts `workflow/review-persona.md` in as the **first block** of the prompt. It is identical whether a human, Cursor, or Claude runs the command — it does not live where an agent can forget it. If the file is missing or empty, the review stops fail-closed.

Edit it for your project, or point `reviewPersonaPath` in `req.config.json` at a different file. Set it to `null` to disable — but **delta design reviews still inject the built-in delta contract** (the contract that tells the reviewer to re-check only what changed since the approved baseline, so it is attached regardless of the configured persona).

## Design re-reviews narrow to a delta

Once a design is approved, CommitGate remembers that snapshot of the design docs (default `00/01/02`, configurable via `designDocs`) as a baseline. When you then edit the design and re-review, the prompt is built so the reviewer assesses **only the changed documents and their direct impact**. Changed docs are tagged `[변경됨 — 심사 대상]` (changed — under review), unchanged docs `[승인 baseline — 변경 없음, 참조]` (approved baseline — unchanged, for reference), with a contract not to re-litigate the approved areas. Unchanged docs carry only an omission marker instead of their body, to save tokens. This reduces the failure mode where a small post-approval edit triggered a full re-review and the approval got reverted.

If a change is too fundamental to judge as a delta, the reviewer requests a full re-review with `full_review_requested: "yes"` (which must come with `commit_approved: "no"`). The baseline is then cleared so the next design review returns to full mode; once that design is approved again, a new baseline is captured and delta review resumes.

Both integration paths are valid: **through a PR (optional)** and **direct push**. A PR is not mandatory. But a direct push to a protected branch **bypasses the required status checks**, so it needs a separate "branch protection bypass를 사용한 direct push 승인" — holding bypass permission is not approval. In that case CI runs **after** the push, so its green is post-hoc verification, and the agent must not omit that from its report. tag, npm publish, and GitHub release are control points of their own, requested after CI is green and never bundled with the integration approval. See [AGENTS.template.md](../AGENTS.template.md) and [docs/RELEASING.md](../docs/RELEASING.md) for the full contract.

## Observability summary — commitgate report

Summarizes the three local observation logs the tool accumulates (`.doctor-runs` · `.review-calls` ·
`.verify-runs`) in one read-only command (writes nothing, no network):

```sh
npx commitgate report          # doctor firings, review convergence, evidence, CI choices
npx commitgate report --json   # machine-readable
```

It shows per-check fired/FAIL counts and warning fatigue (WARN-only ratio), calls-per-target
distribution with prompt-size/duration percentiles, an approval-evidence summary against trunk
(verify-range), and the GitHub CI opt-in/skip distribution. Missing sources render as "no data" —
nothing is estimated.

## Pre-merge local verification — GitHub CI is optional

**GitHub CI is not a requirement of CommitGate.** GitHub Actions can consume usage quota and cost money, so CommitGate neither requires nor auto-triggers it. Before an integration approval you can verify the range's approval evidence locally:

```sh
npx commitgate verify-range            # classify merge-base(trunk)..HEAD
npx commitgate verify-range --strict   # exit 1 when unproven commits exist (gate mode)
```

Each commit in the range is classified as **approved** (a consumption record in the committed `approvals.jsonl`), **tool bookkeeping** (trailer), **merge**, or **unproven**. It works without GitHub auth, `gh`, or network access. "Unproven" is not an accusation of bypass — it means "not provable from evidence" (legitimate out-of-workflow commits such as install scaffolding or release commits appear here too). History rewritten by squash/rebase no longer matches the consumption-time SHAs and shows up as unproven — this check reports the given range as-is.

An interactive run ends by asking **"기존 GitHub CI 결과를 조회하시겠습니까? 워크플로를 실행하지 않습니다(GitHub API 조회 1회). [y/N]"** (check existing GitHub CI results? — does not run workflows; one GitHub API query). The default is No; Enter or `n` continues without the query (skipping is a normal state). Only on `y` or `--check-github-ci` does it **query** the head SHA's check-runs once (it never dispatches workflows, so no new Actions usage is incurred), and an explicitly requested query that fails stops with exit 1 instead of being silently ignored. Non-interactive runs skip unless a flag is given. The choice applies to that run only and is never stored. The old `--github-ci`/`--no-github-ci` flags remain as deprecated aliases with identical (query-only) behavior.

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

🔴 **Never pass a multi-line commit message with `-m`.** Package managers and `npx` re-serialize
arguments into a shell command string, which **drops everything after the newline** (npm, npx) or turns it
into a **literal two-character `\n`** (pnpm). The message is already corrupted by the time CommitGate sees it, so it
cannot be recovered. Pass it as a file instead.

```sh
npm run req:commit -- 2026-001 --run --message-file commit-message.txt
npm run req:commit -- 2026-001 --run -F commit-message.txt   # same thing (the git commit -F convention)
```

Single-line messages remain safe with `-m`. The measured breakdown is in
[Troubleshooting](./troubleshooting.en.md).

## delivery set — several REQs as one group

Sometimes a requirement is too large for one REQ, or several design documents are implemented in sequence.
`stopGate: "merge"` plus `commitgate delivery` groups those REQs together and defers the main-merge stop
until **the whole group** is finished.

```sh
npx commitgate delivery create payment-improvement --run       # delivery/payment-improvement branch + record
npx commitgate delivery begin payment-api --slug payment-improvement --run   # create the REQ and register it
# … design, review, phases, req:commit as usual …
npx commitgate delivery integrate --slug payment-improvement --run           # single merge commit
npx commitgate delivery begin payment-ui --slug payment-improvement --run    # next REQ
# …
npx commitgate delivery seal    --slug payment-improvement --confirm "seal payment-improvement"    --run
npx commitgate delivery approve --slug payment-improvement --confirm "approve payment-improvement" --run
```

- **One active REQ at a time.** The next `begin` is refused until the previous member is terminal — that
  sequential invariant is what removes merge conflicts structurally.
- `integrate` only takes **approved, completed** REQs. It checks the committed `dev-complete` proof, the
  approval manifest, response-file integrity and approved-tree provenance on the feature ref, and **refuses
  when code was committed after the approval**. There is no `--force` escape hatch.
- After `seal` you cannot `begin`. Use `reopen` to undo it — the fact that an approval existed stays in the log.
- 🔴 **The tool never merges `delivery` into `main`.** `approve` records the approval; the merge itself is
  performed by a human at the existing control points (I1/I2/B1).
- It does not depend on your current branch — the tool moves where it needs to and **returns you where you were**.

With `stopGate: "merge"`, the `req:next` terminal also looks at the group: still open → `DONE` (you may open
the next REQ); sealed with every member terminal → `AWAIT_HUMAN`. `integrate` and `seal` emit the same verdict
right after the transition they cause — someone who seals after the last `integrate` has no reason to call
`req:next` again.

## You fill in the phase breakdown yourself

`req:new` leaves `phases[]` in `state.json` as an **empty array**. Break the work into phases in
`02-plan.md`, then list those ids in `phases[]` before running a phase review.

```jsonc
"phases": [
  { "id": "phase-1-model", "approved": false },
  { "id": "phase-2-verb",  "approved": false }
]
```

🔴 **A `--kind phase` review is refused until you do.** An approval produced in that state cannot be
committed — the commit path uses `phases[]` as the list of valid ids, so with an empty list no phase
approval passes. This used to surface only at `req:commit`, **after a paid review call was spent.**

> Older tickets (from before `phases[]` tracking) still work. Passing `--phase` to one is **rejected rather
> than silently ignored** — being ignored would leave you believing the approval was bound to the phase you named.

## When the design was re-approved — `req:rebind`

When a review raises a P1 you usually edit the design documents, which triggers a **design re-approval**.
Each one changes `design_hash`, and **phases approved earlier stay bound to the old hash**. The completion
proof (`dev-complete`) is only issued when every phase is bound to the current design, so in that state
**the ticket never closes and you cannot open the next REQ.**

**You are told before you hit the wall.** As soon as a phase becomes unbound, `req:next` appends the exact
command to its diagnostics, and `req:doctor` reports the same thing as **D26**.

```
[req:next] AGENT  REQ-2026-086
  Implement phase `phase-4` …
  - ⚠️ 설계 재승인으로 앞선 phase의 결속이 끊겼습니다 — 지금 재결속하지 않으면 마지막 phase를 마쳐도 티켓이 닫히지 않습니다.
  - npx commitgate req:rebind REQ-2026-086 --phase phase-1-x --confirm "rebind REQ-2026-086 phase-1-x" --run
```

This notice **blocks nothing.** Being unbound mid-flight is not itself an error — you resolve it at the end.
It only makes sure the end is not the *first* time you hear about it. Tickets whose bindings are intact get
**no extra lines at all.**

```sh
# see the plan only — which phase is bound to an old hash
npx commitgate req:rebind 2026-069 --phase phase-1-x
# rebind (confirmation sentence required)
npx commitgate req:rebind 2026-069 --phase phase-1-x --confirm "rebind REQ-2026-069 phase-1-x" --run
```

🔴 **This command does not make the judgement for you.** Whether a design change invalidates that phase's
review is something the tool cannot know — a human answers with the confirmation sentence, and that fact is
**appended** to `approvals.jsonl` for the audit trail (who, when, from which hash to which). The original
approval rows are never rewritten, so "which design this phase was reviewed against" is still recorded.

If the rebind fills in the **last** missing binding, `dev-complete` is issued right there and the ticket
closes. If phases are still unapproved it just records the rebind and moves on — mid-run rebinds are normal.

**If it was interrupted, just run it again.** A rebind is two commits (the rebind record, then
`dev-complete`). When the second one fails, re-running treats "already rebound" as a **no-op rather than a
failure** and re-runs the completion check. If the ticket scratch (`state.json`) is gone, the committed HEAD
copy is used instead — and if that one has no phase plan, the command says it **could not judge completion**
rather than claiming the ticket is unfinished.

## The ticket is finished but `req:new` is still blocked

If you add one more phase after `dev-complete` was already issued — and re-approve the design to do it —
that completion proof **goes stale carrying the old `design_ref`**. The tool reads that ticket as unfinished
and `req:new` blocks on it.

The blocking message now prints the command that **actually applies** to that ticket.

```text
🔴 미종결 durable 티켓이 있어 새 REQ를 만들 수 없습니다(HEAD 커밋 증거 기준):
  - REQ-2026-088: developing — 미종결 durable 티켓(developing) …
      설계 재승인으로 앞선 phase의 결속이 끊겼습니다(2개) — 재결속하면 종결됩니다.
      npx commitgate req:rebind REQ-2026-088 --phase phase-0 --confirm "rebind REQ-2026-088 phase-0" --run
```

- If **every** broken binding can be rebound, you get `req:rebind` as above. In that case `req:close
  --migrate` **refuses and prints the same guidance** — routing around a live human-confirmed path with an
  after-the-fact stamp would make "attested later" indistinguishable from "proved itself" in the audit trail.
- If any of them has no `phase_design_ref` (approved before that field existed), rebinding cannot close the
  ticket, so the guidance points at `req:close --migrate` — and that path does close it.

> This state used to reject **all three** supported recovery commands (`--migrate` saw the stale completion
> row and reported "already closed" while doing nothing). The cause was two different predicates for
> "already closed"; they now share one function.

**This is not `req:close --migrate`.** That one is an escape hatch for **legacy tickets** that cannot prove
themselves, closed by an operator after the fact and recorded with `reconstructed: true`. Using it routinely
would make every normal completion look like an after-the-fact attestation.

> **Measured**: REQ-2026-066 and 067 each re-approved the design 4 times and could not close; REQ-2026-068,
> with zero re-approvals, closed itself with `dev-complete`. The only difference was the re-approval count.

## Human confirmation for HIGH-risk tickets

A ticket with `risk_level: HIGH` **cannot pass the point `stopGate` designates without a human confirmation.** That does **not** mean every commit is confirmed — only the point in the table below is.
**Where that confirmation happens is decided by `stopGate`.**

| `stopGate` | Confirmation point | Confirmation `scope` |
|---|---|---|
| `phase` | before every phase commit | `phase` |
| `req` | **the commit that completes the REQ** | `req` |
| `merge` | `delivery integrate` | `delivery` |

```sh
npx commitgate req:confirm 2026-071 --scope req --method "<what you based the approval on>" --run
```

🔴 **`req` and `delivery` scopes pre-approve changes that do not exist yet.** `--scope req` means
"every remaining phase of this REQ"; `--scope delivery` means "every remaining REQ in this set".
If you want to see each change before approving it, use `stopGate: "phase"`.

🔴 **Scope is a statement, not a size ordering.** Each point accepts only a confirmation whose `scope`
**matches exactly** — a wider confirmation cannot satisfy a narrower point. Otherwise a single
confirmation would erase the "fresh confirmation per phase" that `phase` exists to guarantee.

🔴 Under `req` and `merge`, HIGH tickets also **auto-commit intermediate phases** — `stopGate` alone decides
where you stop. If `risk_level` is neither `LOW` nor `HIGH` (missing, typo, `MEDIUM`), nothing auto-commits
under any value.

A confirmation is **consumed when its scope closes**: `phase` at every commit, `req` when `dev-complete`
is issued, `delivery` at `delivery approve`. Once consumed, the next scope needs a new confirmation.

> The timestamp is read from the **real clock**. Before this command you had to hand-edit `state.json`,
> and that let the timestamp be fabricated.

## An oversized phase is flagged right before the review

When one phase changes more code files than the threshold (8 by default), `req:review-codex` warns
**right before it would run the review.**

```
phase 검수 면적 초과: 코드 변경 14파일 > 8(granularityMaxFiles)
리뷰 라운드는 면적에 비례해 늘어납니다(실측: >8파일 평균 2.4R vs ≤8파일 1.4R).
```

**By default this only warns and the review proceeds** — the workflow is never stopped by phase size.
Set `"granularityGate": "block"` in `req.config.json` to have it enforced (then the review is not run at
all, and no attempt, ledger row, or commit is created — nothing is consumed).

**Why before the review and not before the commit**: what we are saving is review rounds (a paid call,
the wait, and the bookkeeping commits). And at this point the fix is **restaging, not rewriting code**.
Even as a warning, this timing is far more actionable than the old D18 (at commit time, "split from next time").

| Choice | How |
|---|---|
| **A. Split it now** (recommended) | `git restore --staged <files to drop>` — not a single line of code changes. Move the dropped files to the next phase by adding an entry to `phases[]` in `state.json` |
| **B. Declare it is meant to be large** | Add `"max_files": 14` to that entry in `phases[]`. For mechanical sweeps where splitting would hurt the review |

`max_files` lives in `state.json`, and that file gets committed — so **the declaration is on the record**.
It must be an integer ≥ 1; anything else is rejected (so a typo cannot silently disable the gate).

The threshold itself is `granularityMaxFiles` (default 8). Design reviews are unaffected.

| `granularityGate` | Behavior |
|---|---|
| `"warn"` (**default**) | Warns and proceeds with the review — the workflow never stops |
| `"block"` | Does not run the review. Resolve with A or B above, then re-run |

> 0.13.0 shipped with `"block"` as the default. 0.13.1 **corrected it to `"warn"`** — it was never a dead
> end (nothing consumed, three ways out), but it was a stop that does not clear itself, which breaks an
> autonomous workflow. The value of this policy is its **timing**, not its severity, and the timing is unchanged.

**D18 in `req:doctor` stays a WARN.** Blocking (`block`) happens before the review; a phase that already has
Codex approval is never blocked from committing — that would deadlock, with the approval neither consumed nor committed.

## Seeing only code commits in the history

CommitGate writes the ledger, the evidence, and the state as **separate commits** for every review and
every phase. That is what keeps the record of "a call was attempted" even when the call fails. The price
is history density — in one measured stretch, **79 of 108 commits (73%) were bookkeeping** and only 23
were actual code.

Squashing them would break that durability, so instead every tool-made commit carries a trailer.

```
chore(REQ-2026-085): state checkpoint — design 승인

CommitGate-Bookkeeping: true
```

To see only code commits:

```bash
git log --oneline --invert-grep --grep=^CommitGate-Bookkeeping:\ true
```

- The marker is on **tool-made commits only**. A `chore(REQ-…)` commit you wrote by hand still shows up
  (that is why this is a trailer and not a subject convention).
- Your own source commits from `req:commit -m "…"` **do not carry it** — those are code commits.
- ⚠️ The marker exists only on commits made **from 0.13.0 onward**. Older history is not filtered by this.

## When finished tickets have not been merged — D25

`req:doctor` counts tickets that are **closed (`dev-complete`) but have not reached the trunk**.

```
[req:doctor] WARN D25: 종결됐지만 trunk(main)에 없는 티켓 3건: REQ-2026-070, REQ-2026-071, REQ-2026-072 — …
```

As these pile up, each branch becomes an ancestor of the next, and you can no longer **merge them out of
order or revert just one**. That is why seeing it early matters.

- The verdict is based on whether the **committed close proof** (`responses/ticket-close.jsonl`) is in the
  trunk tree. It stays correct even after you delete the merged branch.
- The ticket currently being checked is not counted (a just-finished ticket being absent from trunk is normal).
- It is **a WARN and blocks nothing.** When to merge is decided by `stopGate` and executed by a human.
- The trunk name is `trunkBranch` in `req.config.json` (default `"main"`). Set it to `null` to turn D25 off.
  If the ref does not exist locally the check passes silently — a noisy false positive would train you to
  ignore the whole doctor output.

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
| `npm run req:rebind -- <id> --phase <p> --confirm "<sentence>" --run` | Rebind an earlier phase to the current design after a re-approval (see above) |
| `npm run req:confirm -- <id> --scope <s> --method "<sentence>" --run` | Record the human confirmation for a HIGH-risk ticket (see above) |

`req:*` are **`package.json` scripts**, not executables on your PATH. npm needs the `--` separator to pass arguments.

```sh
npm  run req:next -- 2026-002    # npm
pnpm req:next 2026-002           # pnpm
yarn req:next 2026-002           # yarn
```

**Replacement REQ (`--successor-of`)**: only when a human has judged a review series unconverged and terminated it with a `human-resolution` **replace** decision can you create a replacement REQ that preserves the parent's lineage (total attempts and the termination record) via `req:new --successor-of <REQ-id>`. If the parent has no valid replace resolution, ticket creation fails closed — this does not block ordinary new-REQ creation itself.
