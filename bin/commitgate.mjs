#!/usr/bin/env node
/**
 * commitgate bin 런처(Stage A).
 * npm bin은 TS를 직접 실행 못 하므로 tsx ESM 로더를 얹어 init.ts/uninstall.ts를 실행한다.
 *
 * ⚠️ tsx는 반드시 **이 런처(=패키지) 기준**으로 해소해야 한다(호출 cwd 아님).
 *    npx로 실행하면 cwd=대상 repo인데 그곳엔 아직 tsx가 없을 수 있어,
 *    bare `--import tsx`/cwd-상대 해소는 init 전에 ERR_MODULE_NOT_FOUND로 실패한다(REQ-2026-001 design R1 P1).
 *    `import ... from 'tsx/esm/api'`는 이 .mjs(패키지 node_modules) 기준으로 정적 해소되므로 cwd 무관.
 *    (node:module의 register('tsx/esm')는 tsx v4가 deprecated --loader로 간주해 거부 → tsx 자체 API 사용.)
 * (Stage B에서 init.ts를 JS로 빌드하면 이 런처는 제거 가능.)
 *
 * verb dispatch(REQ-2026-014 Stage B, 설계 D3): 로컬 패키지 bin이 `req:*`를 dispatch한다.
 *    - 알려진 verb(`req:new`/`req:next`/`req:review-codex`/`req:doctor`/`req:commit`/`uninstall`/`init`) → 해당 모듈(verb 토큰 소비).
 *    - argv 없음 **또는 첫 인자가 `-` 옵션**(`--dry-run`·`--dir`·`--strict`·`--force`·`--no-agent-entrypoints`·`-h`) → **init에 argv 전체 전달**(하위호환).
 *    - 그 외 비-옵션 미지 토큰 → fail-closed(오타를 조용히 init으로 보내지 않는다). `migrate`는 Phase 3에서 등록.
 *    각 대상 모듈은 `runCli(argv)`(예외→친절한 1줄+exit1 경계)를 export한다. import되면 대상의 `if (isMain)` 가드는 발화하지 않으므로 중복 실행 없음.
 */
import { register } from 'tsx/esm/api'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { resolveDispatch } from './dispatch.mjs'

register()

const binDir = dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)

const decision = resolveDispatch(argv)
if ('unknown' in decision) {
  // 비-옵션 미지 토큰: fail-closed(스택트레이스 없이 한 줄).
  console.error(`commitgate: 알 수 없는 명령: ${decision.unknown}`)
  process.exit(1)
}

const mod = await import(pathToFileURL(join(binDir, decision.entry)).href)
// runCli = 예외를 친절한 한 줄 메시지 + exit 1로 변환하는 CLI 경계(스택트레이스 노출 방지).
mod.runCli(decision.rest)
