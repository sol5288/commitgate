# Troubleshooting (FAQ)

**What happens if Codex CLI is missing?**
The review command fails. It is not treated as approval.

**Can I edit code after approval and still commit?**
No. If the staged tree changes after approval, CommitGate treats the approval as stale and requires review again.

**Why should I not stage `state.json` or `responses/`?**
They are workflow state and evidence files. Mixing them into the source commit weakens the approval binding, so `req:commit` blocks it.

**What should I do if I see a cross-spawn version warning?**
It means the target project may already have a `cross-spawn` version below CommitGate's verified floor. Upgrade it with `npm i -D cross-spawn@^7.0.6`. In CI or security-sensitive installs, use `npx commitgate --strict` to treat the warning as a failure.

**Does running install twice overwrite files?**
No. Existing files are skipped. `--force` only force-refreshes the **copied assets** the kit manages (schemas, the `.claude`/`.cursor` entrypoint pointers). **Skills you modified, `AGENTS.md`, `CLAUDE.md`, and `workflow/.gitignore` are not overwritten even with `--force`** (user files are preserved — see [Guarantees and limits](./guarantees.en.md) and [Agent entrypoints](./agent-prompt.en.md)).

**`req:doctor` fails D10 because of `workflow/.review-calls.jsonl`, and every commit is blocked.**
This happens in repositories installed with 0.9.6 or earlier. The review measurement log (`workflow/.review-calls.jsonl`) is scratch that `req:review-codex` writes at the repository root, but the shipped template of those versions is missing its ignore rule, so it shows up as `??` and D10 treats it as an unclean tree. Backfill the missing rule into `workflow/.gitignore`:

```
npx commitgate sync --gitignore --apply
```

It **only appends rules that are absent**, never modifying or reordering your existing lines (and does nothing if the rule is already there). From 0.9.7 on, `req:doctor` warns about this situation up front as **D22 WARN** (a warning only — it never blocks commits).

**I already committed `workflow/.review-calls.jsonl`.**
Adding the ignore rule alone will not drop it — git does not exclude files that are **already tracked**. Untrack it (the local file stays) and keep the rule:

```
npx commitgate sync --gitignore --apply
git rm --cached workflow/.review-calls.jsonl
git commit -m "chore: stop tracking review-call measurement log"
```

The log is measurement-only and is not a commit artifact. The approval ledger (`responses/approvals.jsonl`) and approval archives are unaffected and remain committed.

## Runtime-generated file inventory

Files CommitGate creates in the consuming repository while it runs, and how each is handled.

| File | Created in | Ignore policy | Shipped by init | sync owner | Persisted in Git |
|---|---|---|---|---|---|
| `workflow/.review-calls.jsonl` | `workflow/` at repo root | `/.review-calls.jsonl` in `workflow/.gitignore` | Yes (`templates/workflow.gitignore`) | `sync --gitignore` | No (measurement only) |
| `workflow/REQ-*/codex-response.json` | Ticket root | `/REQ-*/codex-response.json` | Yes (same) | `sync --gitignore` | No (scratch) |
| `workflow/REQ-*/.review-preview.txt` | Ticket root | `/REQ-*/.review-preview.txt` | Yes (same) | `sync --gitignore` | No (scratch) |
| `workflow/REQ-*/.codex-*.tmp` | Ticket root | `/REQ-*/.codex-*.tmp` | Yes (same) | `sync --gitignore` | No (temporary) |
| `workflow/REQ-*/state.json` | Ticket root | None (tracked) | No (created by `req:new`) | None | Yes (scaffold only) — runtime changes are working state and are not committed |
| `workflow/REQ-*/responses/*-rNN-*.json` | Ticket `responses/` | None (tracked) | No | None | **Yes (approval evidence)** |
| `workflow/REQ-*/responses/approvals.jsonl` | Ticket `responses/` | None (tracked) | No | None | **Yes (approval ledger)** |

> **Maintenance rule**: when adding a new runtime scratch file at the repository root, (1) add a row to this table, (2) add an **anchored** rule to `templates/workflow.gitignore`, and (3) add a `git check-ignore` assertion for that path to `scripts/smoke.mjs`. The smoke assertions are per-path and do not cover new files automatically.
>
> Rules in a nested `.gitignore` (`workflow/.gitignore`) are relative to **that directory**. Copying the root-`.gitignore` form `workflow/…` makes git look for `workflow/workflow/…`, which never matches.
