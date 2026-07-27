# Development & Current Scope

The current release is a **runtime package model**. Executable code and runtime dependencies live only in `node_modules/commitgate`; your project keeps governance/audit data and the `req:* = commitgate <verb>` scripts. (Older vendored installs move over with [`migrate`](./upgrade.en.md#migrating-from-an-older-install-migrate).)

Current verification:

- GitHub Actions runs a `ubuntu-latest`, `macos-latest`, `windows-latest` × Node 18/20/22 matrix.
- `npm run smoke` installs the packed tarball into a throwaway project and asserts that the target has **no** `scripts/req/`, that `tsx`/`ajv`/`cross-spawn` are **not** injected, that all five `req:*` scripts point at the package bin, and that `npm run req:doctor` actually dispatches into the module inside the package. It verifies `migrate`'s non-destructiveness the same way.
- A Windows `.cmd` wrapper injection regression test protects package-manager and Codex wrapper paths.
- `npm test` runs the **whole suite**, and that is what the gate judges (we do not run only-changed tests —
  impact analysis lets through the regressions it failed to predict).

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
