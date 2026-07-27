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

A ticket with `risk_level: HIGH` is never committed or integrated without a human confirmation.
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
