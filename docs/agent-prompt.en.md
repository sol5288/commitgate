# Agent Entrypoints and Delivering Requirements

**You do not paste a long prompt.** Installation lays down agent entrypoints for you.

| File | Read by |
|---|---|
| `AGENTS.md` | Codex CLI, Cursor — **the contract** |
| `.claude/skills/commitgate/SKILL.md` | Claude Code (auto-discovered — the model decides whether to use it) |
| `.claude/commands/req.md` | Claude Code (`/req` explicit call) |
| `.cursor/rules/commitgate.mdc` | Cursor (`alwaysApply`) |
| `CLAUDE.md` | Claude Code (always loaded) — created only if absent |

> **On a fresh install, `CLAUDE.md` and `AGENTS.md` open with a self-sufficient Quick Start** (clarify the four-box requirement → `req:new` → the `req:next` loop). Because these are always-loaded channels, the agent picks the correct first action on the first request without reading the full contract. An existing `CLAUDE.md`/`AGENTS.md` is preserved, so the block is not injected there — **to backfill an existing file, run `npx commitgate quickstart --apply`** (inserts only the managed block, preserves the rest, idempotent).

Just give the agent a requirement.

```text
/req Add a profile edit API

- What: PATCH /profile to change nickname and bio
- Why: users cannot change their profile after signup
- Constraints: reuse the existing auth middleware, no schema change
- Done when: unit tests pass, unauthorized users get 403
```

Outside Claude Code you can skip the slash command and state the requirement directly — `.cursor/rules` and `AGENTS.md` load the rules. If the four fields are missing, the agent asks first.

The agent's first reply should look roughly like this.

```text
REQ-2026-002 created
Branch: feat/req-2026-002-profile-edit-api
Phases:
- phase-1: implement PATCH /profile
- phase-2: tests and regression checks
Control points: before req:commit --run / [B1] before a direct push to main (or [I1] open PR → [I2] merge)
```

## Companion Skills

CommitGate is a **governance layer** — `req:next` computes the next action, and review/approval/evidence gate the commit.
What was missing was **method**: how to sharpen a vague request, how to write the test first, how to corner a bug.
Four skills adapted from Matt Pocock's public skills (MIT) to fit CommitGate's authority boundaries, plus one
CommitGate-original umbrella skill (`commitgate-quality`) that ties those methods into REQ design/plan/build
quality — **five** in total — are bundled in the package.

| Skill | When |
|---|---|
| `commitgate-discovery` | **Before** `req:new` — turn a vague request into a REQ Brief. **User-invoked** |
| `commitgate-tdd` | When `req:next` returns `AGENT` — Red → Green → Refactor → stage |
| `commitgate-diagnosing-bugs` | Bugs, regressions, perf — feedback loop → reproduce/minimise → hypothesise → instrument → fix |
| `commitgate-research` | External technology choices — primary sources, findings with citations and limits |
| `commitgate-quality` | Writing/editing design & plan (`00/01/02`) · AGENT build · bug diagnosis — SSOT references, combination coverage, Test-First, evidence-based verification. **Method, not enforcement** |

**Auto-discovered, model-invoked.** The harness **discovers installed** skills automatically, but **the model decides**
whether to use one — that is probabilistic, so don't expect a skill to always fire. In Claude Code you can also
invoke an installed skill directly with `/commitgate-<name>`. On other harnesses, use whatever invocation that harness offers,
or follow the entry flow in `AGENTS.md`.

**Suggested flow**: `commitgate-discovery` to sharpen the request → `/req` (Claude Code) or the `AGENTS.md` entry
flow → `req:new` → repeat `req:next`.

### Boundaries — read this

- 🔴 **`AGENTS.md` is the contract.** Skills carry **method**, not contract.
  Without the skills installed, the **core workflow behaves identically**.
- 🔴 **Skill output is not approval evidence.** Neither a companion skill's output nor the result of running
  Matt's external skills separately is **approval evidence** for CommitGate or Codex. Running the review, judging
  approval, transitioning state, and committing are **CommitGate's alone**, and `req:next` is the authority on
  what comes next.
- Skills are **cooperative text** — a skill doesn't block a commit; CommitGate's gate does.

### Install, preservation, options

- **`--no-agent-entrypoints`**: skips the whole `.claude/` layer (including the five companion skills).
- **Existing files preserved (seed-once)**: skills are **meant to be edited**. A skill you modified is
  **not overwritten, even with `--force`.** `AGENTS.md`, `CLAUDE.md`, and `workflow/.gitignore` follow the same policy.
- **gitignore warning**: if `.claude/` is gitignored, the skills never reach a teammate's fresh clone.
  Install still proceeds, but CommitGate **warns** and tells you how to track them. **`--strict` stops before installing.**
- **Coexists with third-party skills**: third-party `tdd`, `grill-me`, etc. live at `.claude/skills/<name>/`, companions at
  `.claude/skills/commitgate-<name>/` — **different paths, so neither touches the other.**

### Attribution

Adapted from Matt Pocock's MIT-licensed public skills at baseline SHA `d574778f94cf620fcc8ce741584093bc650a61d3`
and **included as package payload**. CommitGate **does not run or depend on any external skill installer** at
runtime — these are pinned copies inside the package. Each SKILL.md carries the full MIT notice; see
`skills/ATTRIBUTION.md` in the package for details.
