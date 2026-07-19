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
| `phaseCommit` | `{ "autoApprove": "never" }` | Per-phase auto-commit policy. `never` (default) stops for a human before every phase commit (current behavior). `low-only` auto-commits Codex-approved phases of **LOW-risk** tickets without a human stop and moves the single human confirmation to just before the feature→main merge. HIGH-risk tickets still stop at every phase under any value (`userConfirmGate` backstop). There is no `"all"` value (it would livelock on HIGH) |

Empty `branchPrefix` values and paths that escape the project root are rejected.

**Pinned review model & effort**: `req:review-codex` injects `-c model=` and `-c model_reasoning_effort=` into the codex arguments to **pin the model and reasoning effort**. Without pinning, a review inherits your global `~/.codex/config.toml` (e.g. `model_reasoning_effort="ultra"`), making a single review take minutes and burn tokens. The defaults are `gpt-5.6-terra`/`high`; if your codex doesn't support that model, change it in `req.config.json` or set it to `null` to inherit the global config. Whether the overrides are actually honored can be checked with `npm run verify:overrides` (requires the codex CLI).

**Stateless re-reviews**: each re-review starts a **fresh codex thread** (it does not resume/accumulate the prior conversation — which drove token growth and goalpost drift). Only the previous same-target NEEDS_FIX findings are carried into the prompt as reference data, to confirm closure.
