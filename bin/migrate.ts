#!/usr/bin/env tsx
/**
 * commitgate migrate — **Stage A(vendored scaffold) → Stage B(런타임 패키지)** 비파괴 전환 (REQ-2026-014 R5).
 *
 * 이 명령이 하는 일은 **하나뿐**이다: 대상 `package.json`의 `req:*` 중 **현재 값이 정확히 Stage A 주입값인 키만**
 * `commitgate <verb>`로 바꾼다. 그 외에는 아무것도 하지 않는다.
 *
 * 비파괴 계약(PM 결정):
 *   - **아무것도 삭제하지 않는다.** `scripts/req/**`·schema·persona·`req.config.json`·진입점·`workflow/REQ-*` 증거를
 *     자동 삭제하지 않는다. 정리는 읽기 전용 `commitgate uninstall` 계획 또는 `git revert` 안내로만.
 *   - **사용자 정의 script를 절대 덮어쓰지 않는다.** 정확한 Stage A 주입값이 아니면 보존하고 수동 조치를 안내한다.
 *   - **커밋하지 않는다.** 사용자가 검토 후 stage/commit 한다.
 *   - 기본은 **dry-run**(쓰기 0건). `--apply`에서만 쓴다.
 *
 * 쓰기 범위는 **`package.json` 한 파일**이다. 그래서 다중 파일 rollback 프레임워크가 필요 없다
 * (REQ-2026-014 D11 제거와 일관 — 기존 init도 rollback이 없고 "쓰기 前 실패"가 계약이다).
 *
 * ⚠️ **동기(sync) 구현이어야 한다.** launcher(`bin/commitgate.mjs`)가 `mod.runCli(rest)`를 **await 없이** 호출하고
 *    기존 7개 runCli가 전부 sync `void`다. async면 promise가 버려져 오류가 unhandledRejection이 되고 exit code가 소실된다.
 *
 * ⚠️ **대상 root는 `--dir`(기본 cwd)로만 해소한다.** `resolveRoot`(scripts/req/lib/config.ts)는 config를 못 찾으면
 *    fallback으로 **패키지 자신의 root**를 반환한다 — package.json을 쓰는 이 명령이 그 fallback을 타면
 *    CommitGate 패키지 자신의 package.json을 재작성한다. init·uninstall과 같은 `--dir` 방식을 쓴다.
 */
import { existsSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { stripBom } from '../scripts/req/lib/config'
import { REQ_SCRIPTS, STAGE_B_REQ_SCRIPTS, KIT_SOURCE_DIR_REL, assertGitWorkTree, commitgateDeclared } from './init'

export interface MigrateOptions {
  dir: string
  /** 기본 false = dry-run(쓰기 0건). true면 package.json 한 파일을 쓴다. */
  apply: boolean
}

/** `req:*` 키 하나의 전환 판정. */
export interface ScriptDecision {
  key: string
  current: string | undefined
  /** 'convert' = 정확한 Stage A 값 → 전환 대상. 'stage-b' = 이미 전환됨. 'custom' = 사용자 값(보존). 'absent' = 키 없음. */
  kind: 'convert' | 'stage-b' | 'custom' | 'absent'
  next: string | undefined
}

export interface MigratePlan {
  targetRoot: string
  decisions: ScriptDecision[]
  /** 실제로 바꿀 키(kind==='convert'). 비어 있으면 쓸 것이 없다. */
  converts: ScriptDecision[]
  /** 보존하는 사용자 정의 키(kind==='custom') — 수동 조치 안내 대상. */
  customs: ScriptDecision[]
  /** vendored `scripts/req/**`가 남아 있는가(삭제하지 않는다 — 안내만). */
  vendoredPresent: boolean
}

/**
 * `req:*` 전환 판정(순수 — REQ-2026-014 D5).
 *
 * **정확한 바이트 일치일 때만 전환**한다. 이 술어는 `bin/uninstall.ts:295-303`의 `cur === injected`와 같은 계약이며
 * `REQ_SCRIPTS`가 그 SSOT다. 사용자 정의 값(`req:new = "node custom.mjs"` 등)은 **절대 덮어쓰지 않는다**.
 */
export function decideScripts(scripts: Record<string, string>): ScriptDecision[] {
  return Object.keys(REQ_SCRIPTS).map((key) => {
    const current = scripts[key]
    const stageA = REQ_SCRIPTS[key]
    const stageB = STAGE_B_REQ_SCRIPTS[key]
    if (current === undefined) return { key, current, kind: 'absent' as const, next: undefined }
    if (current === stageA) return { key, current, kind: 'convert' as const, next: stageB }
    if (current === stageB) return { key, current, kind: 'stage-b' as const, next: undefined }
    return { key, current, kind: 'custom' as const, next: undefined }
  })
}

/** 대상을 읽어 계획을 만든다(**쓰기 0건**). */
export function planMigrate(opts: MigrateOptions): MigratePlan {
  const targetRoot = resolve(opts.dir)
  if (!existsSync(targetRoot) || !statSync(targetRoot).isDirectory())
    throw new Error(`대상 디렉터리가 없음: ${targetRoot}`)
  assertGitWorkTree(targetRoot) // 실제 git probe(fake .git 마커 거부)

  const pkgPath = join(targetRoot, 'package.json')
  if (!existsSync(pkgPath)) throw new Error(`package.json 없음: ${targetRoot}`)
  const pkg = parsePkg(pkgPath)
  const scripts = pkg.scripts ?? {}

  const decisions = decideScripts(scripts)
  return {
    targetRoot,
    decisions,
    converts: decisions.filter((d) => d.kind === 'convert'),
    customs: decisions.filter((d) => d.kind === 'custom'),
    vendoredPresent: existsSync(join(targetRoot, KIT_SOURCE_DIR_REL)),
  }
}

/** package.json 파싱(BOM 허용 — PowerShell `Set-Content -Encoding UTF8`). shape 검증 포함(fail-closed). */
function parsePkg(pkgPath: string): { scripts?: Record<string, string>; devDependencies?: Record<string, string> } {
  let raw: unknown
  try {
    raw = JSON.parse(stripBom(readFileSync(pkgPath, 'utf8')))
  } catch (err) {
    throw new Error(`package.json 파싱 실패(${pkgPath}): ${err instanceof Error ? err.message : String(err)}`)
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`package.json이 JSON 객체가 아님: ${pkgPath}`)
  for (const field of ['scripts', 'devDependencies'] as const) {
    const v = (raw as Record<string, unknown>)[field]
    if (v !== undefined && (typeof v !== 'object' || v === null || Array.isArray(v)))
      throw new Error(`package.json의 ${field} 필드가 객체가 아님(${pkgPath}) — 배열/원시 미지원.`)
  }
  return raw as { scripts?: Record<string, string>; devDependencies?: Record<string, string> }
}

/** 계획을 사람이 읽는 줄 배열로. **shell 연산자(`&&`)를 쓰지 않는다**(Windows PowerShell 5.1·cmd.exe 비호환 — DEC-011-8). */
export function renderPlan(plan: MigratePlan, apply: boolean): string[] {
  const L: string[] = []
  L.push('')
  L.push(`[commitgate migrate] Stage A → Stage B 전환 ${apply ? '(--apply: package.json 을 씁니다)' : '계획 (dry-run — 아무것도 쓰지 않습니다)'}`)
  L.push(`  대상: ${plan.targetRoot}`)
  L.push('')

  if (plan.converts.length > 0) {
    L.push(`  전환 대상 — 현재 값이 정확히 Stage A 주입값인 키 ${plan.converts.length}개:`)
    for (const d of plan.converts) L.push(`    package.json#scripts.${d.key}:  "${d.current}"  →  "${d.next}"`)
  } else {
    L.push('  전환 대상 없음 — 정확한 Stage A 주입값인 req:* 키가 없습니다.')
  }
  L.push('')

  const stageB = plan.decisions.filter((d) => d.kind === 'stage-b')
  if (stageB.length > 0) L.push(`  이미 Stage B: ${stageB.map((d) => d.key).join(', ')}`)

  if (plan.customs.length > 0) {
    L.push('')
    L.push('  ⚠️  사용자 정의 값 — **덮어쓰지 않습니다**. 수동 조치가 필요합니다:')
    for (const d of plan.customs) L.push(`    package.json#scripts.${d.key} = "${d.current}"`)
    L.push('    Stage B 런타임을 쓰려면 그 스크립트가 `commitgate <verb>` 를 호출하도록 직접 고치십시오.')
  }

  if (plan.vendoredPresent) {
    L.push('')
    L.push(`  ℹ️  ${KIT_SOURCE_DIR_REL}/ 가 남아 있습니다 — migrate 는 **아무것도 삭제하지 않습니다**(비파괴).`)
    L.push('     Stage B 에서 실행 코드는 node_modules/commitgate 에서 돕니다. 남은 vendored 파일은 사용하지 않습니다.')
    L.push('     정리하려면 먼저 읽기 전용 계획을 보십시오: npx commitgate uninstall')
  }

  L.push('')
  if (!apply) {
    L.push('  적용하려면: npx commitgate migrate --apply')
    L.push('  (--apply 는 package.json 만 씁니다. 커밋하지 않습니다 — 직접 검토 후 stage/commit 하십시오.)')
  } else if (plan.converts.length > 0) {
    L.push('  다음: git diff package.json 으로 확인한 뒤 커밋하십시오.')
    L.push('    git add -- package.json')
    L.push('    git commit -m "chore: migrate commitgate to Stage B runtime"')
  }
  return L
}

/**
 * 실행. 기본 dry-run(쓰기 0건), `--apply`에서만 `package.json` 한 파일을 쓴다.
 *
 * `--apply` 전 **선행 설치 확인**: Stage B 스크립트(`commitgate <verb>`)를 심으므로 대상에 commitgate가
 * devDependency로 있어야 한다. init의 D14와 **같은 축소 규칙** — **키 존재만** 보고 값 형태는 검증하지 않는다
 * (`npm i -D <tgz>`는 `file:…tgz`를 쓴다).
 */
export function runMigrate(opts: MigrateOptions): MigratePlan {
  const plan = planMigrate(opts)

  if (opts.apply) {
    const pkgPath = join(plan.targetRoot, 'package.json')
    const pkg = parsePkg(pkgPath)
    if (!commitgateDeclared(pkg.devDependencies ?? {}))
      throw new Error(
        `devDependencies.commitgate 선언이 없습니다 — Stage B 는 req:* 를 'commitgate <verb>' 로 심으므로 ` +
          `대상에 commitgate 가 devDependency 로 있어야 합니다. 먼저 'npm install -D commitgate' 를 실행한 뒤 다시 시도하십시오.`,
      )
    if (plan.converts.length > 0) {
      const scripts = pkg.scripts ?? {}
      for (const d of plan.converts) if (d.next !== undefined) scripts[d.key] = d.next
      pkg.scripts = scripts
      writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8')
    }
  }

  for (const line of renderPlan(plan, opts.apply)) console.log(line)
  return plan
}

/** CLI 파싱(fail-closed). 기존 `bin/init.ts`·`bin/uninstall.ts` 관례를 따른다 — `--flag=value` 미지원, 미지 토큰은 throw. */
export function parseArgs(argv: string[]): MigrateOptions {
  let dir = process.cwd()
  let apply = false
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dir') {
      const v = argv[i + 1]
      if (v === undefined) throw new Error('--dir 값 누락')
      dir = v
      i++
    } else if (a === '--apply') {
      apply = true
    } else if (a === '--dry-run') {
      apply = false // 기본값이지만 명시 허용(문서화된 의도 표현)
    } else if (a === '-h' || a === '--help') {
      printHelp()
      process.exit(0)
    } else {
      throw new Error(`알 수 없는 인자: ${a}`)
    }
  }
  return { dir: resolve(dir), apply }
}

function printHelp(): void {
  console.log(`commitgate migrate — Stage A(vendored) → Stage B(런타임 패키지) 비파괴 전환

사용법:
  npx commitgate migrate [--dir <대상repo>]            계획만 출력(기본 — 아무것도 쓰지 않음)
  npx commitgate migrate --apply [--dir <대상repo>]    package.json 의 req:* 전환

하는 일:
  package.json 의 req:* 중 **현재 값이 정확히 Stage A 주입값인 키만** "commitgate <verb>" 로 바꿉니다.

하지 않는 일:
  - 아무것도 삭제하지 않습니다(scripts/req/**·schema·persona·config·진입점·workflow 증거 전부 보존).
  - 사용자 정의 script 를 덮어쓰지 않습니다(보존 + 수동 조치 안내).
  - 커밋하지 않습니다.

--apply 전제:
  대상 package.json 에 devDependencies.commitgate 선언이 있어야 합니다(먼저 'npm install -D commitgate').
`)
}

export function runCli(argv: string[]): void {
  try {
    runMigrate(parseArgs(argv))
  } catch (err) {
    console.error(`commitgate migrate: ${err instanceof Error ? err.message : String(err)}`)
    process.exitCode = 1
  }
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href
if (isMain) runCli(process.argv.slice(2))
