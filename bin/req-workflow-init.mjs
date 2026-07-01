#!/usr/bin/env node
/**
 * req-workflow-init bin 런처(Stage A).
 * npm bin은 TS를 직접 실행 못 하므로, node 서브프로세스로 tsx 로더를 얹어 init.ts를 실행한다.
 * (Stage B에서 init.ts를 JS로 빌드해 이 런처를 제거할 수 있다.)
 */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const initTs = join(dirname(fileURLToPath(import.meta.url)), 'init.ts')
const res = spawnSync(process.execPath, ['--import', 'tsx', initTs, ...process.argv.slice(2)], {
  stdio: 'inherit',
})
process.exit(res.status ?? 1)
