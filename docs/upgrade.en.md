# Upgrading (0.x)

Bumping the runtime to a new version takes **two** steps — `npm update` alone is not enough.

**① The caret range blocks 0.x minors.** `npm install -D commitgate` writes a `^0.y.z` range. In npm semver,
`^0.7.0` means `>=0.7.0 <0.8.0`, so `npm update`/`pnpm update` **will not cross a 0.x minor** (it stays within 0.7.x).
To cross a minor, raise the range explicitly:

```sh
npm install -D commitgate@latest     # or a specific version: commitgate@^0.8.0
```

**② Vendored assets update separately from the runtime.** The command above refreshes the runtime
(`node_modules/commitgate`), but the contract assets in your project's `workflow/`
(`machine.schema.json`, `req.config.schema.json`) **stay as they were**. If you bump the runtime but leave the
assets, the new runtime **reads the old contract**, and newer features (e.g. the full-review escalation of design
delta reviews) can be silently disabled. `commitgate sync` restores those assets from the installed package copy:

```sh
npx commitgate sync                    # plan only (dry-run — see what would change)
npx commitgate sync --apply            # re-sync the schema axis
npx commitgate sync --apply --persona  # persona too (restore if missing; if it differs, show a diff and preserve)
npx commitgate sync --apply --persona --persona-apply  # after reviewing that diff, replace it (keeps a .bak)
```

- `sync` restores the **schema axis only** (contracts, always kept current). It does not touch companion skills,
  `workflow/.gitignore`, `package.json`, or `req:*`.
- The **persona (`review-persona.md`) is handled only with `--persona`**. It is restored when missing, and when it
  differs the tool **prints the real content diff before doing anything and preserves the file by default** (you see
  the diff in dry-run too).
- **To pick up review-policy updates**, review that diff and pass `--persona-apply` **together with** `--persona`.
  A backup is written to `workflow/review-persona.md.bak` first (last generation only), and **if the backup or the
  diff cannot be produced, nothing is replaced** (fail-closed). Personas installed by 0.9.8 and earlier carry no kit
  marker, so they get a louder "you may have written this yourself" warning — but the replace path is the same.
  Decide from the diff.
- To keep managing the persona yourself, point `reviewPersonaPath` in `req.config.json` at a separate file
  (`sync` then leaves it completely untouched).
- `req:doctor`'s **D20** WARNs when the vendored schema drifts from the installed copy (it never blocks the commit).

**③ If you are on an older (vendored) install**, follow up with the `migrate` step below to move to the Stage B runtime.

**④ The Quick Start block also does not reach existing files automatically (0.9.2+).** A fresh install puts the
onboarding Quick Start at the top of `CLAUDE.md`/`AGENTS.md`, but `init` is seed-once, so it is **not applied to
files that already existed**. After upgrading, backfill existing files with `commitgate quickstart`:

```sh
npx commitgate quickstart              # plan only (dry-run — see what would change)
npx commitgate quickstart --apply      # inject only the managed block (preserves the rest, idempotent)
```

- `AGENTS.md` is targeted only when it carries the CommitGate contract marker. Absent files are left untouched.
- `req:doctor`'s **D21** WARNs when an existing file is missing the Quick Start block (it never blocks the commit).

> In short: install `commitgate@latest` → `commitgate sync --apply` → `commitgate quickstart --apply` → (if needed) `commitgate migrate`.

## Migrating from an older install (`migrate`)

If `scripts/req/` is copied into your project and `req:*` points at `tsx scripts/req/*.ts`, you have an **older (vendored) install**. When `init` detects this state, it **stops** rather than creating a silent mix, and points you here.

```sh
npm install -D commitgate      # first, if it is not a devDependency yet
npx commitgate migrate         # plan only — writes nothing
npx commitgate migrate --apply # rewrites only the req:* scripts in package.json
```

`migrate` does exactly **one** thing: it rewrites the `req:*` keys **whose current value is byte-for-byte the old injected value** to `commitgate <verb>`.

- **It deletes nothing.** `scripts/req/`, schemas, persona, config, entrypoints, and `workflow/REQ-*` evidence are all left in place. The leftover `scripts/req/` is no longer executed; run `npx commitgate uninstall` to see a cleanup plan first.
- **It never overwrites scripts you edited.** Any value that differs — even by one character — is treated as yours, preserved, and reported for manual action.
- **It does not commit.** It writes `package.json` only; reviewing is up to you.

`req:doctor` also reports the install mode (old / current / mixed).
