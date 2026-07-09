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
 * verb dispatch(REQ-2026-007): `uninstall`만 별도 모듈로 보낸다. verb 없는 호출은 **현행 그대로 init**(하위호환).
 *    dispatch를 여기(단일 bin 진입점)에 두면 uninstall.ts → init.ts 단방향 import가 되어 순환이 생기지 않는다.
 */
import { register } from 'tsx/esm/api'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

register()

const binDir = dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)
const entry = argv[0] === 'uninstall' ? 'uninstall.ts' : 'init.ts'
const rest = argv[0] === 'uninstall' ? argv.slice(1) : argv

const mod = await import(pathToFileURL(join(binDir, entry)).href)
// runCli = 예외를 친절한 한 줄 메시지 + exit 1로 변환하는 CLI 경계(스택트레이스 노출 방지).
mod.runCli(rest)
