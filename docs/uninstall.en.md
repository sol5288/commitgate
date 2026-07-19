# Removing CommitGate

CommitGate lives in two places: the **runtime** (`node_modules/commitgate`) and the **governance files installed into your project**.

The package manager removes the runtime:

```sh
npm uninstall -D commitgate      # pnpm remove -D commitgate · yarn remove commitgate
```

For the project files, review the plan below and clean up yourself. First, the important part: **`npx commitgate` is not a global install.** npx downloads the package into the npm cache (`_npx/<hash>/`) and runs it once; it leaves nothing in your global `node_modules` and nothing on your PATH.

Start by previewing the removal plan. This command **deletes nothing** and only prints the plan:

```sh
npx commitgate uninstall
```

It reads your repo and classifies what it finds: (1) CommitGate-owned files that are byte-identical to the package originals, (2) files that differ and need your review, (3) files that must not be removed automatically, and (4) audit evidence. Then it prints the revert commands that match your commit state. You review them and run the deletions yourself.

## Why isn't removal automatic?

`init` **does not record on disk what it created.** At removal time it is therefore impossible to tell apart:

- `AGENTS.md` is created **only when absent**. If you already had one, init leaves it alone — so a file init wrote and a file you wrote look identical on disk.
- `req.config.json` is **merged** (missing keys only) when it already exists. The original is not kept, so the merge cannot be undone.
- `package.json` only gets keys that are **absent**. A pre-existing `req:doctor` or `cross-spawn` is not CommitGate's. And `ajv`, `cross-spawn`, and `tsx` are devDependencies other packages commonly use too.
- Your `ticketRoot` (default `workflow/`) accumulates REQ ticket `state.json` and `approvals.jsonl` — this tool's **audit evidence**.

Deleting all of that without a ledger would destroy user data. CommitGate installs no git hooks and touches no git config — it is a pure in-tree scaffolder, so git is the source of truth for undoing it.

## If you have not committed the scaffold

```sh
git status --porcelain -uall     # see what was added
git diff -- package.json         # see the injected req:* scripts and devDependencies
```

Then revert it yourself. Always restore `package.json` from `HEAD`:

```sh
git checkout HEAD -- package.json
```

> ⚠️ Without `HEAD`, git restores from the **index**, so after a `git add` the injected `req:*` scripts survive.
> ⚠️ This command also discards **any other uncommitted edits** to `package.json`. Check the diff above first.

Delete only the paths `npx commitgate uninstall` listed. Removing `scripts/req/` or `workflow/` as whole directories would also take your own files and your ticket evidence with them.

> git does not track empty directories. After deleting the files, `git status` can report a clean tree while empty `scripts/`, `workflow/`, `.claude/`, and `.cursor/` directories remain on disk.

## If you already committed the scaffold

Revert the commit that introduced the scaffold.

```sh
git log --diff-filter=A --format='%H %s' -- req.config.json
git revert <sha>
```

`npx commitgate uninstall` finds the introducing commit candidate for you. If that commit also contains unrelated work, reverting it undoes that work too — inspect it with `git show <sha>` first. If the scaffold was introduced across several commits, no single revert will undo it.

## Clearing the npx cache (unrelated to your repo)

Check for a global install first:

```sh
npm ls -g commitgate            # empty output means it is not installed globally
npm uninstall -g commitgate     # only if you did install it globally
```

The package npx downloaded stays under `_npx/` in the npm cache.

```powershell
# Windows (PowerShell)
Remove-Item -Recurse -Force "$(npm config get cache)\_npx"
```

```sh
# macOS / Linux
rm -rf "$(npm config get cache)/_npx"
```

> ⚠️ **`npm cache clean --force` is not a CommitGate removal command.** It empties `_cacache` only and leaves `_npx` intact. It has nothing to do with the scaffolding in your repo.
