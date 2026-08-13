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
| `reviewReasoningEffort` | `"medium"` | codex review reasoning effort. One of `none`, `minimal`, `low`, `medium`, `high`, `xhigh`. `null` inherits the global setting |
| `reviewBudget` | `{ "autoBudget": 5, "hardCap": 8, "onSoftLimit": "ask" }` | Re-review attempt budget for an open `(review_kind, phase_id)` review series. With the defaults, rounds 1–5 run automatically. Rounds 6–8 are governed by `onSoftLimit`: `"ask"` (default) requires a human exception record bound to that series and round; `"auto"` runs them without human approval and records the policy grounds in the ledger. Once `hardCap` is spent the next attempt (round 9 onward) is blocked **under both values**. `hardCap ≤ 8`, `autoBudget ≤ hardCap`. See [Review budget](#review-budget--reviewbudget) |
| `stopGate` | `"req"` | **Decides on its own where a human stops** (preferred axis). `phase` = confirm before every phase commit; `req` = auto-commit phases inside a REQ and gather the confirmation at **the commit that completes the REQ**; `merge` = group several REQs into a delivery set and defer until **the whole set** is done. The per-value confirmation points, including how `HIGH` risk is treated, are defined in [Workflow — Human confirmation for HIGH-risk tickets](workflow.en.md#human-confirmation-for-high-risk-tickets). Integration (main merge) approval is required under every value |
| `githubCi` | not configured (`null`) | GitHub Actions workflow that `integrate` may run only after an explicit user request. When absent, CommitGate neither asks about a CI run nor guesses a workflow |
| `phaseCommit` *(deprecated alias)* | `{ "autoApprove": "low-only" }` | Per-phase auto-commit policy. **`low-only` is the default**: it auto-commits Codex-approved phases without a human stop and defers the human confirmation. Set `never` **explicitly** to stop for a human before every phase commit. There is no `"all"` value — `stopGate` is the semantic axis, and adding values to the alias would split the two axes again |

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
- With a [delivery set](workflow.en.md#delivery-set--several-reqs-as-one-group), `merge` defers **the stops of
  several REQs into that one group**. With no set it behaves like `req`: the `req:next` terminal is
  `AWAIT_HUMAN` (integration feature→main).
- Under any value the phase commits do not stop (except `phase`) and the stops collect at the terminal. How many
  control points the terminal has depends on risk: `LOW` is **one** (the integration approval), `HIGH` is **two** —
  `req:confirm` first, then the integration approval. (`req` behaves the same; only the confirmation point moves
  from the commit to the terminal.)

### Review budget — `reviewBudget`

```jsonc
"reviewBudget": { "autoBudget": 5, "hardCap": 8, "onSoftLimit": "ask" }
```

- `autoBudget` (default 5): reviews repeat this many times with no human involvement.
- `hardCap` (default 8): the **absolute call ceiling**. A 9th attempt never runs, by any route.
- `onSoftLimit` (default `ask`): what happens once `autoBudget` is exceeded.
  - `ask`: attempts 6–8 each need a human approval via `req:review-exception` (current behaviour).
  - `auto`: they proceed without human approval up to `hardCap`, and the ledger records that they passed
    **by policy**.

🔴 **This stop is cost control, not a safety gate.** Switching to `auto` changes nothing about review
approval, evidence, the integration control points, or `hardCap`. All it removes is the budget question,
"may we spend one more round?"

- Under `auto`, `req:review-exception` **refuses to grant** an exception — it would only create an approval
  record that can never be consumed. Keep `ask` if you want the human approval.
- A config that sets only the two original keys (`{"autoBudget":3,"hardCap":6}`) stays valid and gets
  `onSoftLimit: "ask"`.

### Policy snapshot — a ticket keeps the `stopGate` it was created with

`req:new` pins the resolved `stopGate` into the ticket's `state.json` (`policy_snapshot.stop_gate`), and the
gates (`req:next`, `req:commit`, `req:confirm`, `req:doctor`, `delivery integrate`) read that value.

If the gates re-read `req.config.json` on every command, **one ticket runs under several policies**: confirm
phases 1–2 under `phase`, switch the setting to `merge` midway, and the rest auto-commit with no confirmation —
the meaning of a confirmation you already gave changes after the fact.

- Changing the setting **does not affect tickets already in flight.** New tickets start on the new policy.
- A mismatch is reported by `req:doctor` as **D32 WARN** (not FAIL — it never blocks progress).
- To apply the new policy to a ticket in flight:

  ```sh
  npx commitgate req:repolicy <REQ> --reason "<why>" --run
  ```

  🔴 This is not a gate bypass. Only "where you stop" changes; **confirmations already recorded are not
  erased** — if the new policy requires a different `scope`, it is asked for again at that point.
- Tickets with no snapshot (created before this feature) follow `req.config.json` as before.

### Optional GitHub CI runs — `githubCi`

The default is **not configured**, so the user controls GitHub Actions quota and cost. Only projects that want
the option of a run should name the workflow file explicitly.

```json
{
  "githubCi": {
    "workflow": "ci.yml",
    "timeoutMinutes": 30
  }
}
```

- `workflow` is one filename under `.github/workflows/`, such as `ci.yml` — not a path or URL.
- `timeoutMinutes` is the single deadline from dispatch to completion. It accepts 1–120 minutes and defaults
  to 30.
- Adding the setting does not start CI. Answer `y` during interactive `integrate --run`, or explicitly use
  `integrate --run --run-github-ci` in a non-interactive run.
- The prompt is `[y/N]`, so No is the default. Enter, an empty answer, and `n` all skip the run.
- With no configuration the question is omitted. If `--run-github-ci` is requested without configuration,
  CommitGate fails instead of guessing a workflow.
- Skipping GitHub CI is not an integration failure. The local `verify-range --strict` inside `integrate` still
  always runs.
- This setting only selects what CommitGate may dispatch through `workflow_dispatch`. Inspect the actual
  triggers in `.github/workflows/*.yml` to learn whether repository-owned workflows react automatically to
  `push`, `pull_request`, or a tag.

To **query only** existing results, use `verify-range --check-github-ci`. A query does not start a workflow or
create new GitHub Actions usage. See [Workflow — integration seam](workflow.en.md#integration-seam--commitgate-integrate-022)
for the full execution order.

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
- **The review model is a menu too** (`gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`). 🔴 That list is a
  **suggestion, not an enum** — the last entry, **"직접 입력…" (type it yourself)**, accepts any model, and the
  schema stays free text. Clear the value by typing `-` there.
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
