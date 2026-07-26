# Configuration (req.config.json)

Defaults are enough for most projects. If needed, edit `req.config.json` in the project root.

| Key | Default | Meaning |
|---|---|---|
| `branchPrefix` | `"feat/req-"` | Prefix for new branches |
| `ticketRoot` | `"workflow"` | REQ ticket directory |
| `packageManager` | auto-detected | `npm`, `pnpm`, or `yarn` |
| `designDocs` | `00/01/02` docs | Design document filenames |
| `reviewPersonaPath` | `"workflow/review-persona.md"` | First block of the review prompt. `null` disables it — but delta design reviews still inject the built-in delta contract |
| `reviewModel` | `"gpt-5.6-terra"` | codex review model (pinned via `-c model=`). `null` inherits your global codex config |
| `reviewReasoningEffort` | `"high"` | codex review reasoning effort. One of `none`, `minimal`, `low`, `medium`, `high`, `xhigh`. `null` inherits the global setting |
| `reviewBudget` | `{ "autoBudget": 5, "hardCap": 8 }` | Re-review attempt budget for an open `(review_kind, phase_id)` review series. With the defaults, rounds 1–5 run automatically, rounds 6–8 each require a human exception record bound to that series and round, and once `hardCap` is spent the next attempt (round 9 onward) is blocked even with an exception. `hardCap ≤ 8`, `autoBudget ≤ hardCap` |
| `stopGate` | `"phase"` | **Where a human stops** (preferred axis). `phase` = confirm before every phase commit; `req` = auto-commit LOW phases inside a REQ and gather the confirmation into one stop before integration; `merge` = group several REQs into a delivery set and defer until **the whole set** is done. **HIGH-risk tickets stop at every phase under any value**, and integration (main merge) approval is always required |
| `phaseCommit` *(deprecated alias)* | `{ "autoApprove": "never" }` | Per-phase auto-commit policy. `never` (default) stops for a human before every phase commit (current behavior). `low-only` auto-commits Codex-approved phases of **LOW-risk** tickets without a human stop and moves the single human confirmation to just before the feature→main merge. HIGH-risk tickets still stop at every phase under any value (`userConfirmGate` backstop). There is no `"all"` value (it would livelock on HIGH) |

Empty `branchPrefix` values and paths that escape the project root are rejected.

### `stopGate` vs `phaseCommit`

`stopGate` is the **semantic axis**; `phaseCommit.autoApprove` is its **deprecated alias**. The mapping is 1:1.

| `stopGate` | `phaseCommit.autoApprove` |
|---|---|
| `phase` | `never` |
| `req` | `low-only` |
| `merge` | `low-only` |

- Set **either one** and the other is derived. Configs that only use `phaseCommit` keep working unchanged.
- If both are set and **contradict**, the config is rejected with an error naming both values, the expected
  mapping, and how to fix it.
- Choosing `stopGate` through `commitgate setup` **removes** the legacy `phaseCommit` key automatically
  (a file where the two axes contradict would block every command afterwards).
- 🔴 `merge` and `req` map to the **same** `phaseCommit.autoApprove` (both auto-commit phases). A config that
  only sets the legacy `phaseCommit` therefore resolves conservatively to `req` — set `stopGate` explicitly to use `merge`.
- `merge` only means something with a [delivery set](workflow.en.md#delivery-set--several-reqs-as-one-group).
  With no set, the `req:next` terminal is simply `DONE` and you can open the next REQ.

## Interactive setup — `commitgate setup`

Instead of editing the file by hand, you can set the review model and reasoning effort with a wizard.
It **also handles codex login**.

```sh
npx commitgate setup
```

- Questions with a fixed set of values (reasoning effort, stop gate) are **arrow-key menus**: ↑/↓ to move,
  Enter to confirm, Ctrl+C to cancel. The first entry is **keep the current value** and the cursor starts
  there, so pressing Enter alone changes nothing. Keys that accept an empty value also list
  **clear — inherit global codex config**.
- **The review model is free text** (there is no fixed list). Type the value, or `-` to clear it
  (`none` cannot be used for this: it is a **valid** reasoning-effort value).
- Each question offers the **current value as the default**. Keeping it **writes nothing** —
  only keys you actually change are written, so a value you never chose is never pinned.
- If you are not logged in to codex, the wizard runs `codex login` and **re-checks afterwards**.
  If login cannot be confirmed, **nothing is saved** — `req.config.json` is left untouched.
- The save is **atomic** (temp file in the same directory, then rename). Interrupting it cannot corrupt your
  existing config, and re-running picks up where you left off.
- After saving, the wizard **tells you to commit `req.config.json`**. With a ticket in progress, an
  uncommitted config change trips `req:doctor` checks D10 and D13.

> 🔴 **This command is for a human at a terminal.** It is interactive-only, so in pipes, CI, or agent
> sessions it exits immediately without asking anything. Agents such as Claude or Codex do not run it —
> they **ask you to run it** (see the "human-only commands" section of `AGENTS.md`).

> **No credentials are stored.** `req.config.json` is committed, so it only holds settings such as the model
> and reasoning effort. Authentication stays in codex's own store (`~/.codex/`).

> `req.config.json` is git-tracked, so changing it with setup leaves your working tree dirty.
> `req:new` requires a clean tree — **commit the config change first**.
>
> Until setup completes, **workflow commands are blocked** (see below). Existing installs are exempt.

### setup completion marker

Finishing setup records the fact in `req.config.json`.

```jsonc
"setup": { "completedVersion": "0.9.10", "completedAt": "2026-07-26T02:00:00.000Z" }
```

🔴 **The marker means "this project's configuration is done" — not "I am logged in."**
`req.config.json` is committed and shared by the team, while **login is per-developer**, so the marker
never vouches for a teammate's authentication.

**Without the marker these workflow commands are blocked**: `req:new`, `req:next`, `req:review-codex`,
`req:commit`, `req:close`, `req:reconstruct`, `req:review-exception`.
**Never blocked**: `commitgate check` and `req:doctor` (diagnostics must stay available), plus
`init`/`migrate`/`sync`/`uninstall`/`quickstart`/`setup` (used before setup, or setup itself).

**Existing-install exemption (grandfather).** A project already working with CommitGate is not blocked even
without a marker. It qualifies when there is **at least one valid ticket** (`state.json`'s `id` matches its
directory name) **and at least two install signals** (`req:*` scripts in `package.json`, `req.config.json`,
`workflow/machine.schema.json`, the contract marker in `AGENTS.md`). Creating an empty `REQ-*` directory does
not qualify. `req:doctor`'s **D24** reports the status with its reasoning (WARN — it never blocks a commit).


**Pinned review model & effort**: `req:review-codex` injects `-c model=` and `-c model_reasoning_effort=` into the codex arguments to **pin the model and reasoning effort**. Without pinning, a review inherits your global `~/.codex/config.toml` (e.g. `model_reasoning_effort="ultra"`), making a single review take minutes and burn tokens. The defaults are `gpt-5.6-terra`/`high`; if your codex doesn't support that model, change it in `req.config.json` or set it to `null` to inherit the global config. Whether the overrides are actually honored can be checked with `npm run verify:overrides` (requires the codex CLI).

**Stateless re-reviews**: each re-review starts a **fresh codex thread** (it does not resume/accumulate the prior conversation — which drove token growth and goalpost drift). Only the previous same-target NEEDS_FIX findings are carried into the prompt as reference data, to confirm closure.
