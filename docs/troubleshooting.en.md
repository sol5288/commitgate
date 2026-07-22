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

**`req:next` returns `BLOCKED` saying the committed design approval evidence is incomplete.**
All phases are done, but the **design approval evidence never reached the commit history**. Integrating in this state leaves a fresh clone with no proof the design was ever reviewed and approved. Run the recovery command it prints:

```
npm run req:commit -- <REQ-id> --finalize-design --run
```

It is idempotent — if the evidence is already committed it does nothing, and if only the commit failed right after approval it **re-commits without duplicating the record**. From 0.9.8 the normal path commits design evidence automatically on approval (`req:review-codex --kind design --run`), so you only need this command when that commit failed.

The gate reads **only Git blobs at `HEAD`**, so **fixing the working tree does not clear it** — the evidence must be committed. The BLOCKED reason tells you exactly what is wrong:

| Reason | Meaning |
|---|---|
| `state.json 없음` / parse failure / `phases` not an array | The committed ticket state cannot be interpreted |
| `approvals.jsonl 없음` / `무결성 실패` | The manifest is missing, or its schema/path/filename/SHA format is wrong |
| `design 승인 행이 없음` | The design approval was never recorded in the manifest |
| `승인 아카이브 SHA 불일치(HEAD ≠ manifest)` | The recorded SHA differs from the committed file content |
| `archive_inventory가 비어 있음` | No round evidence was recorded at all |
| `HEAD의 design 아카이브가 archive_inventory에 빠져 있음` | Some rounds (e.g. needs-fix) are missing from the list |
| `archive_inventory에 HEAD에 없는 항목이 있음` | The list contains a path that is not committed |

> This check runs **only in `req:next`'s completion decision**. Neither `req:doctor` nor a normal `req:commit` fails because of it — a deliberate boundary so existing repositories are never blocked from committing. Tickets created before 0.9.8 are not subject to the check (existing behavior preserved).

**If a design review went through several needs-fix rounds, are those responses kept?**
Yes. On approval the manifest row records an `archive_inventory` (path and SHA-256 of each archive), and **every archive in that list is committed together**. Before 0.9.8 only the single approved archive was committed, so needs-fix rounds never reached the commit history.

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
