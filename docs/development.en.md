# Development & Current Scope

The current release is a **runtime package model**. Executable code and runtime dependencies live only in `node_modules/commitgate`; your project keeps governance/audit data and the `req:* = commitgate <verb>` scripts. (Older vendored installs move over with [`migrate`](./upgrade.en.md#migrating-from-an-older-install-migrate).)

Current verification:

- GitHub Actions runs a `ubuntu-latest`, `macos-latest`, `windows-latest` × Node 20/22/24 matrix.
- `npm run smoke` installs the packed tarball into a throwaway project and asserts that the target has **no** `scripts/req/`, that `tsx`/`ajv`/`cross-spawn` are **not** injected, that all five `req:*` scripts point at the package bin, and that `npm run req:doctor` actually dispatches into the module inside the package. It verifies `migrate`'s non-destructiveness the same way.
- A Windows `.cmd` wrapper injection regression test protects package-manager and Codex wrapper paths.
- `npm test` runs the **whole suite**, and that is what the gate judges (we do not run only-changed tests —
  impact analysis lets through the regressions it failed to predict).

### CI jobs have a 20-minute cap

`timeout-minutes: 20` in `.github/workflows/ci.yml` cuts off a hung job (GitHub's default is **360 minutes**).

🔴 **Why 20**: the measured longest job is windows at **7.0 minutes**. We set roughly 3× that — tightening it
further means runner slowness or an npm registry hiccup **kills a healthy run and produces a false red**.
A false red is worse than a hang, because people start ignoring red.

🔴 **The second purpose is logs**: GitHub **will not give you the logs of a job that is still running**
(`gh run view --job <id> --log` → "still in progress"). When `macos-latest · node 18` hung on 2026-07-27, seeing
the cause required **killing the job** — diagnosing meant destroying the evidence. A timed-out job leaves its
logs behind. Keep that in mind before raising the value.

### Tests run with bounded parallelism

`maxWorkers: 2` in `vitest.config.ts` caps how many test files run at once.

🔴 **Why a cap is needed**: the `init`/`uninstall`/`migrate` tests spawn `commitgate` processes in throwaway
repositories. With file parallelism at its default (≈ CPU core count) those spawns pile up and `npm test`
**hangs** on resource-constrained runners — a deadlock, not an assertion failure (REQ-2026-044).

🔴 **Why 2 specifically**: the hang condition is `concurrent workers × spawns per worker`, and GitHub runners
have **4 vCPUs**. Once the worker count reaches the core count you are back in that condition, so we stop at
**half**. Measured (local 12-core, 47 files, 2237 tests): fully serial **507s** → `maxWorkers: 2` **310s**
(1.64×), both passing.

To revert, drop `maxWorkers` and restore `fileParallelism: false` — that reproduces the previous behaviour exactly.

Future scope:

- Yarn PnP support; independent installs in workspace sub-packages
- Asset↔runtime version drift detection
- Non-git VCS support
- More design document templates
