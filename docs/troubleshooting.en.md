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
