# CommitGate 🚦

🌐 [한국어](./README.md) · **English**

**A "commit gate" that lets AI-written code be committed only after a *different* AI reviews and approves it.**

> In one line: pair a **Builder AI** with a **Reviewer AI** so that **nothing gets committed without review, approval, and evidence.**

[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

---

## 🤔 What is this? (an analogy)

Think of an airport security checkpoint. No matter how much of a hurry you're in, you **can't reach the gate without passing through security.**

CommitGate works the same way. No matter how much code you produce, **`git commit` is blocked until it passes the "review → approval" gate.**

- 🛠️ **Builder (the maker)** — you, or your AI coding tool (e.g. Claude Code). Designs the requirement and writes the code.
- 🔎 **Reviewer (the checker)** — the **Codex CLI**. **Independently re-reviews** what the Builder made and rules pass / needs-fix.
- 🚦 **CommitGate** — stands between them and lets **only Reviewer-approved code** be committed.

In short, instead of "build alone, commit alone," it enforces **cross-verification between the AI that built it and the AI that checked it.**

## 🎯 What problem does it solve?

AI produces code **fast**, but committing it without verification is risky. CommitGate:

- ✅ Forces **every change through review.**
- ✅ Binds approval to **"the exact code that was reviewed."** (You can't swap in changes after approval — it's compared like a fingerprint.)
- ✅ **Blocks by default (fail-closed)** whenever something is ambiguous or missing. "Pass only when certain" is the default, so it's safe.
- ✅ Leaves **evidence on disk** of who approved what and when.

## 🔄 The flow at a glance

```
① create ticket   →  ② write design →  ③ design review(Codex) →  ④ implement code
      req:new                            req:review-codex

   →  ⑤ gate check   →  ⑥ code review(Codex)  →  ⑦ commit once approved
        req:doctor        req:review-codex           req:commit
```

At each step, **if it doesn't pass, you can't move to the next.**

---

## 📦 Prerequisites

You need these 4 things before starting. Check each in your terminal.

| What | Check command | If missing |
|---|---|---|
| **Git** (required) | `git --version` | install from [git-scm.com](https://git-scm.com) |
| **Node.js 18.17+** (required) | `node --version` | install from [nodejs.org](https://nodejs.org) |
| **Codex CLI** (for review) | `codex --version` | install OpenAI Codex CLI (without it only review is unavailable; the rest works) |
| **Package manager** | `npm --version` | `npm` ships with Node (or use `pnpm`/`yarn`) |

> 💡 **Reviewer = Codex CLI.** To actually run reviews, the Codex CLI must be installed. Without it, review commands **fail safely (fail-closed)** — they never silently pass.

### 🔧 Install & log in to the Codex CLI (Reviewer setup)

Reviews in CommitGate are handled by the **OpenAI Codex CLI**. Three steps:

**① Install**

```sh
# npm (all OSes)
npm install -g @openai/codex

# or macOS Homebrew
brew install codex
```

Verify:

```sh
codex --version      # e.g. codex-cli 0.4x.x
```

**② Log in** — pick whichever is easier

- **Option A. With a ChatGPT account (recommended, browser)**
  ```sh
  codex login
  ```
  A browser opens → sign in with your ChatGPT account → return to the terminal when done.

- **Option B. With an OpenAI API key**
  ```sh
  # via environment variable (simplest)
  export OPENAI_API_KEY=sk-...        # Windows PowerShell: $env:OPENAI_API_KEY="sk-..."

  # or store the key in Codex
  printenv OPENAI_API_KEY | codex login --with-api-key
  ```
  Create an API key at [platform.openai.com](https://platform.openai.com/api-keys).

**③ Verify login**

```sh
codex login status     # shows login status
codex doctor           # full diagnosis of install, auth, and environment (explains any issue)
```

> ✅ If `codex --version` and `codex login status` look good, the Reviewer is ready. Move on to `npx commitgate`.
> ⚠️ If Windows can't find the `codex` command, open a **new terminal** so PATH is reloaded (a common issue right after a global install).

---

## 🚀 Install (one line)

**In your project folder** (= a git repo that has a `package.json`):

```sh
npx commitgate
```

What this does automatically (it **never overwrites** existing files):

1. Copies the workflow scripts (`scripts/req/`) and schemas.
2. Creates a `req.config.json` (settings file).
3. Adds the `req:*` commands and required devDependencies (`tsx`, `ajv`, `cross-spawn`) to your `package.json`.
4. Creates an `AGENTS.md` template (the rules file the Reviewer reads) if you don't have one.

After installing, fetch the newly added dependencies:

```sh
npm install
```

> Add `--dry-run` to preview what it would do **without changing anything**: `npx commitgate --dry-run`

---

## 🤖 How to use it — hand it to an AI agent via a prompt (recommended)

Honestly, **nobody types `req:new → review → implement → review → commit` by hand, one at a time.** It's tedious.

The real way to use CommitGate is this: **give your AI coding agent a prompt with your "requirements" plus "use this workflow," and the agent drives the whole thing.** You only approve at **control points (commit, merge, push, etc.).**

### What this mode assumes
- **An AI coding agent that can run shell commands** — Claude Code, Cursor (agent), Codex CLI, etc. (it must be able to run terminal commands in your repo)
- **Codex CLI installed** — the Reviewer role. Without it, the review step stops (fail-closed).
- **A filled-in `AGENTS.md`** — write your project's rules (coding conventions, test commands, etc.) into the template that `npx commitgate` created; it improves review quality.

### Three steps and you're done
1. Copy the **prompt template** below and fill the `[Requirements]` block at the bottom with your request.
2. Paste the whole thing **into your AI agent's chat.**
3. The agent's **first reply reports only the REQ number, branch, phase plan, and control points.** After that it asks you **only at control points** — everything else (implementation, tests, Codex review, applying NEEDS_FIX, re-review) is automatic.

### 📋 Copy-paste prompt template

````text
Do NOT handle this as a normal implementation task. You MUST use the CommitGate (AI REQ workflow) installed in this project.

Issue a new REQ ticket for the [Requirements] below and drive it all the way through:
  req:new → write design docs (00/01/02) → req:review-codex (design review)
  → implement phase + tests → req:doctor (gate) → req:review-codex (phase review) → req:commit

[Do automatically]
- Within the approved phase scope, do implementation, tests, keeping codex-request consistent, applying NEEDS_FIX, and re-review (resume) automatically. Do not ask me every time.
- If Codex returns NEEDS_FIX, apply the feedback and re-run the review until approved (max 3 rounds per phase).
- Only what is `git add`ed is reviewed. NEVER `git add` state.json or responses/ (the tool manages those).

[Control points — stop and ask me ONLY here]
- Right before `req:commit --run` (the actual commit / HIGH impact)
- Right before merging to main or `git push`
- Destructive operations such as reset, clean, force push
- When a design-scope change or a feature not in [Requirements] is needed
- When Codex review exceeds 3 rounds without approval, or the judgment is unclear
- When a prerequisite is missing (not a git repo, no Codex CLI / Node / package manager) and you must fail-closed

[First reply] Report only the REQ number, branch, phase plan, and control points. After that, stop only at control points.

[Requirements]
- What: (e.g.) Add a user-profile edit API
- Why:  (e.g.) Only the name is editable today — email and bio should be editable too
- Constraints: (e.g.) Reuse the existing auth middleware, validate email format, no new external libraries
- Done when: (e.g.) PATCH /profile works + unit tests pass + existing tests unbroken
````

> The `[Requirements]` example above is **just a sample.** Just replace the 4 lines (What / Why / Constraints / Done when) with your own. If the request is large, it's split into multiple phases, each going through its own review and gate.

### Example of the agent's first reply

```
Issued REQ-2026-002 · branch feat/req-2026-002-profile-edit-api
Phase plan:
  - phase-1: PATCH /profile handler + validation
  - phase-2: unit tests + regression
Control points: proceed per phase after design approval / confirm before req:commit --run / push needs separate approval
→ Starting with the design docs. Once the design review passes, I'll move to implementation.
```

Now you just **wait** until a control-point notification arrives. When it asks "commit as-is?" right before committing, you confirm.

---

## 🔧 Appendix: what the workflow actually runs under the hood (manual steps)

> With the prompt approach above, you **don't need to type the commands below** — the agent runs them for you.
> These are the actual commands the workflow runs internally. Refer to them only when you need to **understand the behavior, debug, or run steps manually.**

Let's walk the whole flow with one small feature as an example. (Commands use `npm`; arguments after `npm run` go after `--`. With `pnpm` you can drop the `--`, e.g. `pnpm req:new my-feature --run`.)

### Step 1 — create a work ticket

```sh
npm run req:new -- my-feature --run
```

- A new branch (`feat/req-...`) is created, and three design docs appear under `workflow/REQ-2026-001/`.
- The output shows a **ticket number** (e.g. `REQ-2026-001`). Later commands use just the number → `2026-001`

### Step 2 — write the design docs

Fill in the three files under `workflow/REQ-2026-001/`:

- `00-requirement.md` — **what** to build and why
- `01-design.md` — **how** to build it
- `02-plan.md` — in what **order/phases** to proceed

### Step 3 — get a design review (Codex)

Stage your design (i.e. `git add`):

```sh
git add workflow/REQ-2026-001/00-requirement.md workflow/REQ-2026-001/01-design.md workflow/REQ-2026-001/02-plan.md
npm run req:review-codex -- 2026-001 --kind design --run
```

- Codex reads the design and returns **approval** or **NEEDS_FIX**.
- If NEEDS_FIX, apply the feedback, then **`git add` again → re-run the command.** Repeat until approved.

### Step 4 — implement code + tests

Once the design is approved, write the actual code and tests.

### Step 5 — gate check

Stage your changes and preview the gate status:

```sh
git add <files-you-changed>
npm run req:doctor -- 2026-001
```

- It checks several things (is the design approval valid, does the staged code match the approved code, is the working tree clean, etc.) and shows **PASS/FAIL.**

> ⚠️ **Important:** `git add` **only your own code/docs.** Do **not** stage workflow-internal files like `state.json` or `responses/` (the tool manages them; staging them by mistake gets blocked at the commit step).

### Step 6 — get a code review (Codex)

```sh
npm run req:review-codex -- 2026-001 --kind phase --run
```

- Codex reviews the **implementation code.** Again, apply feedback → re-run until approved.
- Once approved, `commit_allowed=true` and the commit opens.

### Step 7 — commit

```sh
npm run req:commit -- 2026-001 --run -m "feat: implement my-feature"
```

- After passing the gate (doctor) one final time, it makes a **code commit + an evidence commit.**
- If it isn't approved, or the code changed after approval, it **stops here.** (That's the heart of CommitGate.)

🎉 Done! Your code is now committed safely with review, approval, and evidence all recorded.

---

## 📋 Command cheat sheet

| Command | What it does |
|---|---|
| `npx commitgate` | Install (scaffold) CommitGate into your project |
| `req:new <name> --run` | Create a new ticket + branch + design docs |
| `req:review-codex <num> --kind design --run` | **Design** review (Codex) |
| `req:review-codex <num> --kind phase --run` | **Implementation** review (Codex) |
| `req:doctor <num>` | Gate check (shows pass/fail) |
| `req:commit <num> --run -m "message"` | Commit approved code (+ evidence) |

> Instead of `-m "message"`, multi-line messages can be read from a file with `--message-file message.txt`.

---

## ⚙️ Configuration (`req.config.json`, optional)

You can tweak behavior via `req.config.json` at the project root. **Without the file it works on sensible defaults**, so you can ignore it at first.

| Key | Default | Meaning |
|---|---|---|
| `branchPrefix` | `"feat/req-"` | Prefix for newly created branch names |
| `ticketRoot` | `"workflow"` | Where ticket folders live |
| `packageManager` | auto-detected | `npm` / `pnpm` / `yarn` |
| `designDocs` | `00-/01-/02-*.md` | Filenames of the three design docs |

Invalid values (e.g. an empty `branchPrefix`, a path that escapes the folder) are **rejected safely.**

---

## ❓ FAQ / troubleshooting

**Q. It says the `codex` command is not found.**
A. The Reviewer (Codex CLI) must be installed for reviews to run. Before it's installed, review commands don't "silently pass" — they **fail clearly** (that's the intended fail-closed behavior).

**Q. I get an error like "staged tree != approved" at the commit step.**
A. It means **the approved code and the code you currently staged (`git add`) differ.** If you changed code after approval, redo Step 6 (implementation review) to re-approve. (This safeguard prevents approval swapping.)

**Q. I get a "non-code staged not allowed (state/responses)" error.**
A. You `git add`ed `state.json` or `responses/`. **Don't stage those** (the tool manages them); stage only your own code/docs.

**Q. Does running `npx commitgate` twice overwrite things?**
A. No. **Existing files are skipped** (idempotent). To force overwrite, add `--force`.

**Q. On Windows my commit message newlines look wrong.**
A. For multi-line messages, use `--message-file file.txt` instead of `-m`.

---

## 🔒 How is "safety" guaranteed? (fail-closed)

CommitGate's principle is **"pass only when definitely approved; block on the slightest doubt."**

- Design docs missing or malformed → treated as not approved
- Codex not installed / review failed → not a pass, fails clearly
- The approved code fingerprint differs from the current code → commit rejected
- The working tree is dirty (unreviewed changes mixed in) → review/commit rejected

In other words, **blocking is the default and passing is the exception**, minimizing the chance of unverified code slipping through.

---

## 📄 License

[MIT](./LICENSE) © 2026 sol5288

> This workflow was extracted as a standalone package from the REQ-2026-017 portability kit of `palm-kiosk-app`, and was validated by **reviewing and approving itself through this very workflow (dogfood).**
