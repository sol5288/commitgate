# Development & Current Scope

The current release is a **runtime package model**. Executable code and runtime dependencies live only in `node_modules/commitgate`; your project keeps governance/audit data and the `req:* = commitgate <verb>` scripts. (Older vendored installs move over with [`migrate`](./upgrade.en.md#migrating-from-an-older-install-migrate).)

Current verification:

- GitHub Actions runs a `ubuntu-latest`, `macos-latest`, `windows-latest` × Node 18/20/22 matrix.
- `npm run smoke` installs the packed tarball into a throwaway project and asserts that the target has **no** `scripts/req/`, that `tsx`/`ajv`/`cross-spawn` are **not** injected, that all five `req:*` scripts point at the package bin, and that `npm run req:doctor` actually dispatches into the module inside the package. It verifies `migrate`'s non-destructiveness the same way.
- A Windows `.cmd` wrapper injection regression test protects package-manager and Codex wrapper paths.

Future scope:

- Yarn PnP support; independent installs in workspace sub-packages
- Asset↔runtime version drift detection
- Non-git VCS support
- More design document templates
