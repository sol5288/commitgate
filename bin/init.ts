#!/usr/bin/env tsx
/**
 * commitgate init — AI REQ workflow(커밋 게이트) kit을 대상 git repo에 설치(Stage A / Model A: vendored 스캐폴딩).
 *
 * 동작(멱등·비파괴):
 *   1. 대상 repo 감사(git repo·package.json 필수 → 없으면 fail-closed throw)
 *   2. `scripts/req/**` + `KIT_COPY_RELPATHS`(스키마 2종 + review-persona.md) 복사(기존 파일은 --force 없으면 스킵)
 *   3. `req.config.json` 시드(부재 시): 감지한 packageManager + handoffPath:null(프로젝트별 값은 코어 DEFAULTS가 아니라 config에서 흡수)
 *   4. 대상 `package.json`에 req:* 스크립트·devDeps(ajv/tsx) 주입(기존 키 미덮어씀)
 *   5. `AGENTS.md` 부재 시 템플릿 생성(있으면 스킵 — Codex 계약 보존)
 *   6. 에이전트 진입점(.claude/skills·.claude/commands·.cursor/rules) 복사 + `CLAUDE.md` 부재 시 생성 (--no-agent-entrypoints로 생략)
 *
 * 코어 승인 바인딩·staged tree 검증은 건드리지 않는다(복사만). 프로젝트 차이는 req.config.json에서만 흡수.
 */
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  statSync,
  copyFileSync,
  realpathSync,
} from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve, join, dirname, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { loadConfig, stripBom, DEFAULT_REVIEW_PERSONA_RELPATH, type PackageManager } from '../scripts/req/lib/config'
import { createGitAdapter, type GitRunner } from '../scripts/req/lib/adapters'
import * as semver from 'semver'

/** 이 패키지 루트(bin/ 기준 1단계 위). 복사 원본. */
export const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** kit 소스 디렉터리(패키지-상대 = 대상-상대). copyInto가 이 레이아웃을 그대로 재현. */
export const KIT_SOURCE_DIR_REL = 'scripts/req'

/**
 * init이 **실제로 복사하는** 스키마 경로(패키지-상대 = 대상-상대). ⚠️ `req.config.json`의 `ticketRoot`/`schemaPath`와 무관하게
 * 언제나 리터럴 `workflow/` 아래다 — `copyInto`가 `relative(PACKAGE_ROOT, src)`로 상대경로를 재현하기 때문.
 * runInit(복사)과 uninstall planner(제거 후보)가 이 상수를 **공유**해야 드리프트가 없다(REQ-2026-007 design R1 P2 / D3b).
 */
export const KIT_SCHEMA_RELPATHS = ['workflow/machine.schema.json', 'workflow/req.config.schema.json'] as const

/**
 * init이 `scripts/req/**` 외에 **실제로 복사하는** 파일 목록(패키지-상대 = 대상-상대). 복사기와 uninstall planner의 SSOT.
 *
 * ⚠️ `KIT_SCHEMA_RELPATHS`와 **의미가 다르다** — 그 상수는 "설정된 `schemaPath`가 init이 깐 스키마인가"를
 * 판정하는 **스키마 축**이고(`bin/uninstall.ts`), 이 상수는 **복사 축**이다. 여기 persona를 넣되 저기엔 넣지 않는다.
 *
 * ⚠️ `package.json`의 `files[]`는 또 다른 축(npm tarball)이다. **셋을 혼동하면**
 * tarball엔 실렸는데 대상 repo엔 안 깔리는 파일이 생기고, phase-1b의 persona fail-closed와 만나
 * 신규 설치본의 모든 리뷰가 멈춘다(REQ-2026-010 design R1 P1).
 */
export const KIT_COPY_RELPATHS = [...KIT_SCHEMA_RELPATHS, DEFAULT_REVIEW_PERSONA_RELPATH] as const

/**
 * 에이전트 진입점 (REQ-2026-010 D7·D8). init 복사기와 uninstall planner가 공유하는 SSOT.
 *
 * ⚠️ `KIT_COPY_RELPATHS`와 달리 **`src !== dest`**다. `copyInto`는 `relative(PACKAGE_ROOT, src)`로 레이아웃을
 * 재현하므로 쓸 수 없고, `uninstall`의 `tool` 분류도 `join(PACKAGE_ROOT, rel)`로 원본을 찾을 수 없다.
 * 두 곳 모두 `src`/`dest`를 분리해 다뤄야 한다.
 *
 * 본문 SSOT는 `AGENTS.md`다. 여기 깔리는 파일은 **얇은 포인터**이며 계약 본문을 복제하지 않는다 — 복제하면 drift 부채가 된다.
 */
export const KIT_AGENT_ENTRYPOINTS = [
  { src: 'templates/claude-skill.md', dest: '.claude/skills/commitgate/SKILL.md' },
  { src: 'templates/claude-command.md', dest: '.claude/commands/req.md' },
  { src: 'templates/cursor-rule.mdc', dest: '.cursor/rules/commitgate.mdc' },
] as const

/** `CLAUDE.md`는 `AGENTS.md`와 같은 취급 — **부재 시에만** 생성하고, uninstall에서 `ambiguous`(자동 제거 금지). */
export const KIT_CLAUDE_TEMPLATE_REL = 'templates/CLAUDE.template.md'
export const KIT_CLAUDE_DEST_REL = 'CLAUDE.md'

/** `AGENTS.md`가 CommitGate 계약인지 판별하는 마커. 진입점 포인터들이 이 마커로 SSOT를 확인한다. */
export const AGENTS_CONTRACT_MARKER = '<!-- commitgate:contract -->'

/**
 * 기존 `AGENTS.md`에 계약 마커가 없을 때 **대상 repo에 함께 놓는** 계약 템플릿 사본 (phase-3a R1 P2).
 *
 * ⚠️ 이게 없으면 포인터의 복구 지시가 **막다른 길**이 된다. 진입점 파일들은 "마커가 없으면 계약 템플릿을
 * 참조해 병합하라"고 하는데, `AGENTS.template.md`는 **패키지 안에만** 있고 대상 repo에는 복사되지 않는다.
 * `npx commitgate`는 전역/로컬 설치가 아니라 npm 캐시에서 한 번 실행될 뿐이라 `node_modules/commitgate/`도
 * 남지 않는다. 사용자는 참조할 파일을 찾을 수 없다.
 *
 * 그래서 마커가 없을 때만 이 경로로 사본을 놓는다. 마커가 있으면(정상) 이 파일은 만들지 않는다.
 */
export const KIT_AGENTS_CONTRACT_COPY_REL = 'AGENTS.commitgate.md'

/** 대상 package.json에 주입할 req:* 스크립트. */
export const REQ_SCRIPTS: Record<string, string> = {
  'req:new': 'tsx scripts/req/req-new.ts',
  'req:review-codex': 'tsx scripts/req/review-codex.ts',
  'req:doctor': 'tsx scripts/req/req-doctor.ts',
  'req:next': 'tsx scripts/req/req-next.ts',
  'req:commit': 'tsx scripts/req/req-commit.ts',
}

/** cross-spawn 주입 spec(= 보안 하한 SSOT). 진단(#1)과 주입이 이 값을 공유. */
const CROSS_SPAWN_SPEC = '^7.0.6'

/** 대상 package.json에 주입할 devDeps(워크플로 실행 전제). cross-spawn = 복사된 adapters.ts의 안전 spawn(P1) 런타임 의존. */
export const REQ_DEV_DEPS: Record<string, string> = {
  ajv: '^8.20.0',
  'cross-spawn': CROSS_SPAWN_SPEC,
  tsx: '^4.19.1',
}

export interface InitOptions {
  dir: string
  force: boolean
  dryRun: boolean
  strict: boolean // cross-spawn 하한 미만이면 WARN 대신 throw(#1)
  /** `.claude/`·`.cursor/`·`CLAUDE.md`를 건너뛴다. 다른 도구가 그 디렉터리를 쓰는 repo를 위한 opt-out(D7). */
  noAgentEntrypoints?: boolean
}

export interface InitResult {
  targetRoot: string
  copied: string[] // repo-상대 경로(신규 복사)
  skipped: string[] // repo-상대 경로(이미 존재 → 미덮어씀)
  configAction: 'created' | 'merged' | 'unchanged' // req.config.json: 신규 생성 / 누락키 병합 / 변경 없음
  configKeysAdded: string[] // 병합 시 추가된 키(handoffPath·packageManager)
  packageJsonAdded: string[] // 추가된 script/devDep 키
  agentsCreated: boolean
  packageManager: PackageManager
  crossSpawnFloorWarned: boolean // 기존 cross-spawn이 보안 하한 미만이라 경고(#1)
  dryRun: boolean
  claudeMdCreated: boolean // CLAUDE.md를 새로 만들었는가(있으면 미덮어씀)
  agentsMarkerMissing: boolean // 기존 AGENTS.md에 commitgate 계약 마커가 없어 경고했는가
  agentsContractCopyCreated: boolean // 마커 부재 시 AGENTS.commitgate.md(계약 템플릿 사본)를 놓았는가
  agentEntrypointsSkipped: boolean // --no-agent-entrypoints
}

/**
 * 대상이 진짜 git work tree인지 실제 git으로 검증(D5, design R1 P2). `.git` 경로 존재만으론 부족(fake 마커 통과).
 * targetRoot가 repo top-level과 일치해야 함(하위 디렉터리에 스캐폴드 방지). git 미설치/비-repo → throw(fail-closed).
 *
 * `run` 주입(REQ-2026-007): uninstall planner가 자신의 감시 runner로 이 검증을 통과시켜
 * **모든 git 호출을 단일 경계에서 관측**할 수 있게 한다. 미지정 시 기존 quiet runner(동작 불변).
 */
export function assertGitWorkTree(targetRoot: string, run?: GitRunner): void {
  // probe 전용 runner: 비-repo일 때 git이 뱉는 `fatal: not a git repository` stderr를 삼킨다.
  // 우리가 더 명확한 조치 메시지로 대체하므로 raw git stderr는 노이즈일 뿐(design 후속 UX).
  // ⚠️ 전역 GitAdapter 기본(stderr 상속)은 그대로 — 다른 git 호출(req:commit 등)의 진단 손실 방지.
  const quietRunner: GitRunner = (file, args, opts) =>
    execFileSync(file, args, { ...opts, stdio: ['ignore', 'pipe', 'ignore'] })
  const git = createGitAdapter(targetRoot, run ?? quietRunner)
  let inside: string
  let topLevel: string
  try {
    inside = git.exec(['rev-parse', '--is-inside-work-tree'])
    topLevel = git.exec(['rev-parse', '--show-toplevel'])
  } catch {
    throw new Error(`대상이 git repo가 아님: ${targetRoot} — 'git init' 후 재시도(워크플로는 git 전제).`)
  }
  if (inside !== 'true') throw new Error(`대상이 git work tree가 아님: ${targetRoot}`)
  // Windows 임시경로(8.3 short name·drive/컴포넌트 case)·symlink 차이 정규화.
  // realpathSync.native = OS API라 컴포넌트 실제 case까지 canonical(WINDOWS/TEMP → Windows/Temp).
  const norm = (p: string): string => resolve(realpathSync.native(p))
  if (norm(topLevel) !== norm(targetRoot))
    throw new Error(`대상이 git repo 최상위가 아님: ${targetRoot} (top-level=${topLevel}) — repo 루트에서 실행.`)
}

/** lockfile로 대상 패키지매니저 감지(없으면 npm — 가장 보편적 기본). */
export function detectPackageManager(root: string): PackageManager {
  if (existsSync(join(root, 'pnpm-lock.yaml'))) return 'pnpm'
  if (existsSync(join(root, 'yarn.lock'))) return 'yarn'
  if (existsSync(join(root, 'package-lock.json'))) return 'npm'
  return 'npm'
}

/**
 * 대상 pm에 맞는 package.json script 실행 커맨드 문자열.
 * npm은 임의 스크립트를 `npm run <script>`로만 실행하고 인자 전달에 `--` 구분자가 필요하다
 * (`npm req:new …`은 "Unknown command"로 실패). pnpm/yarn은 bare script + 인자 직접 전달을 지원.
 * → 안내 문구가 실제로 복붙 가능한 유효 커맨드가 되도록 pm별로 분기(README 수동 명령과 동일 형태).
 */
export function runScriptCmd(pm: PackageManager, script: string, args: string): string {
  return pm === 'npm' ? `npm run ${script} -- ${args}` : `${pm} ${script} ${args}`
}

/** dir 하위 모든 파일의 절대경로(재귀). */
function walkFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry)
    if (statSync(abs).isDirectory()) out.push(...walkFiles(abs))
    else out.push(abs)
  }
  return out
}

/**
 * srcAbs 파일들을 targetRoot 하위 동일 상대경로로 복사. 기존 파일은 force 없으면 스킵.
 * srcBase는 상대경로 계산 기준(= PACKAGE_ROOT)이라 대상에서도 같은 레이아웃 유지.
 */
function copyInto(
  srcFiles: string[],
  srcBase: string,
  targetRoot: string,
  opts: InitOptions,
  copied: string[],
  skipped: string[],
): void {
  for (const srcAbs of srcFiles) {
    const rel = relative(srcBase, srcAbs).replace(/\\/g, '/')
    const destAbs = join(targetRoot, rel)
    if (existsSync(destAbs) && !opts.force) {
      skipped.push(rel)
      continue
    }
    copied.push(rel)
    if (opts.dryRun) continue
    mkdirSync(dirname(destAbs), { recursive: true })
    copyFileSync(srcAbs, destAbs)
  }
}

/**
 * 진입점 dest 경로들이 **실제로 만들어질 수 있는지** preflight에서 확인한다 (D8).
 *
 * `mkdirSync(recursive)`는 경로 중간 컴포넌트가 **파일**이면 ENOTDIR로 죽는다. apply 단계에서 그러면
 * 앞의 파일들은 이미 복사된 뒤라 **부분 설치**가 된다. 쓰기 전에 걸러서 preflight→apply 계약을 지킨다.
 */
function assertEntrypointPathsUsable(targetRoot: string): void {
  const dests = [...KIT_AGENT_ENTRYPOINTS.map((e) => e.dest), KIT_CLAUDE_DEST_REL, KIT_AGENTS_CONTRACT_COPY_REL]
  for (const dest of dests) {
    const parts = dest.split('/')
    // 마지막(파일명) 제외한 각 디렉터리 컴포넌트가 파일로 존재하면 mkdir 불가.
    for (let i = 0; i < parts.length - 1; i++) {
      const sub = join(targetRoot, ...parts.slice(0, i + 1))
      if (existsSync(sub) && !statSync(sub).isDirectory())
        throw new Error(
          `진입점 설치 불가: ${parts.slice(0, i + 1).join('/')} 가 디렉터리가 아니라 파일입니다(${dest} 를 만들 수 없음).\n` +
            `  → 해당 파일을 옮기거나, --no-agent-entrypoints 로 이 계층을 건너뛰세요.`,
        )
    }
    const abs = join(targetRoot, dest)
    if (existsSync(abs) && statSync(abs).isDirectory())
      throw new Error(`진입점 설치 불가: ${dest} 가 디렉터리로 존재합니다(파일이어야 함).`)
  }
}

/**
 * `src → dest`(경로가 다름) 복사. 기존 파일은 `--force` 없으면 스킵. 중첩 디렉터리를 만든다.
 * `copyInto`(레이아웃 재현)와 달리 매핑이 명시적이다.
 */
function copyEntrypoints(
  targetRoot: string,
  opts: InitOptions,
  copied: string[],
  skipped: string[],
): void {
  for (const { src, dest } of KIT_AGENT_ENTRYPOINTS) {
    const destAbs = join(targetRoot, dest)
    if (existsSync(destAbs) && !opts.force) {
      skipped.push(dest)
      continue
    }
    copied.push(dest)
    if (opts.dryRun) continue
    mkdirSync(dirname(destAbs), { recursive: true })
    copyFileSync(join(PACKAGE_ROOT, src), destAbs)
  }
}

/** JSON 파일을 객체로 파싱(fail-closed). 파싱 실패·비-객체(배열/원시)면 throw. */
function parseJsonObject(path: string, label: string): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = JSON.parse(stripBom(readFileSync(path, 'utf8')))
  } catch (e) {
    throw new Error(`${label} 파싱 실패(${path}): ${(e as Error).message}`)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
    throw new Error(`${label}이 JSON 객체가 아님(${path})`)
  return parsed as Record<string, unknown>
}

// ─────────────────────────────── cross-spawn 버전 하한 진단 (#1) ──

/** 보안 하한 = 주입 spec의 최소버전(SSOT — 하드코딩 이중화 금지). '^7.0.6' → 7.0.6. */
const CROSS_SPAWN_FLOOR = semver.minVersion(CROSS_SPAWN_SPEC)

/** obj가 plain object일 때 obj[key](문자열). 아니면 undefined. */
function stringField(obj: unknown, key: string): string | undefined {
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    const v = (obj as Record<string, unknown>)[key]
    if (typeof v === 'string') return v
  }
  return undefined
}

/** 대상의 기존 cross-spawn spec(devDeps 우선, 없으면 deps). 없으면 null. */
function existingCrossSpawnSpec(pkg: Record<string, unknown>): string | null {
  return stringField(pkg.devDependencies, 'cross-spawn') ?? stringField(pkg.dependencies, 'cross-spawn') ?? null
}

/** node_modules에 실제 설치된 cross-spawn 버전(valid semver). 없으면 null. */
function installedCrossSpawnVersion(targetRoot: string): string | null {
  const p = join(targetRoot, 'node_modules', 'cross-spawn', 'package.json')
  if (!existsSync(p)) return null
  try {
    const v = (JSON.parse(stripBom(readFileSync(p, 'utf8'))) as { version?: unknown }).version
    return typeof v === 'string' && semver.valid(v) ? v : null
  } catch {
    return null
  }
}

/** lockfile 해소 cross-spawn 버전(package-lock v2/v3 JSON 우선, pnpm/yarn best-effort). 없으면 null. */
function lockedCrossSpawnVersion(targetRoot: string): string | null {
  const pl = join(targetRoot, 'package-lock.json')
  if (existsSync(pl)) {
    try {
      const j = JSON.parse(stripBom(readFileSync(pl, 'utf8'))) as {
        packages?: Record<string, { version?: unknown }>
        dependencies?: Record<string, { version?: unknown }>
      }
      const v = j.packages?.['node_modules/cross-spawn']?.version ?? j.dependencies?.['cross-spawn']?.version
      if (typeof v === 'string' && semver.valid(v)) return v
    } catch {
      /* best-effort */
    }
  }
  for (const [file, re] of [
    ['pnpm-lock.yaml', /cross-spawn@(\d+\.\d+\.\d+)/],
    ['yarn.lock', /(?:^|\n)"?cross-spawn@[^\n]*:[\s\S]*?\n\s+version:?\s+"?(\d+\.\d+\.\d+)"?/],
  ] as const) {
    const fp = join(targetRoot, file)
    if (!existsSync(fp)) continue
    try {
      const m = readFileSync(fp, 'utf8').match(re)
      if (m?.[1] && semver.valid(m[1])) return m[1]
    } catch {
      /* best-effort */
    }
  }
  return null
}

/**
 * 기존 cross-spawn이 보안 하한 미만인지 판정(#1). 우선순위: **설치버전 → lockfile 해소버전 → range**.
 * range fallback은 `>=floor`로 절대 해소 불가한 spec만 below로 본다(‘^7.0.0’·‘~7.0.1’ 오탐 방지 — R1 P2).
 * 기존 cross-spawn 없으면 null(우리가 `^7.0.6` 주입 → 진단 불필요).
 */
export function crossSpawnBelowFloor(
  targetRoot: string,
  pkg: Record<string, unknown>,
): { below: boolean; detail: string } | null {
  if (!CROSS_SPAWN_FLOOR) return null // 이론상 도달 불가(REQ_DEV_DEPS 고정값)
  const floor = CROSS_SPAWN_FLOOR.version
  const spec = existingCrossSpawnSpec(pkg)
  if (!spec) return null

  const installed = installedCrossSpawnVersion(targetRoot)
  if (installed) return { below: semver.lt(installed, floor), detail: `설치버전 ${installed}` }

  const locked = lockedCrossSpawnVersion(targetRoot)
  if (locked) return { below: semver.lt(locked, floor), detail: `lockfile ${locked}` }

  if (semver.validRange(spec)) return { below: !semver.intersects(spec, `>=${floor}`), detail: `범위 ${spec}` }
  return { below: false, detail: `범위 ${spec}(파싱 불가 — 무경고)` }
}

/**
 * 설치 코어. IO는 여기서만(테스트가 임시 repo로 직접 호출).
 * **Preflight(전 검증·파싱) → Apply(쓰기) 2단계** — malformed 입력에 대해 어떤 파일도 복사·수정하기 전에 실패한다(부분 설치 방지, design R2 P2).
 */
export function runInit(opts: InitOptions): InitResult {
  const targetRoot = resolve(opts.dir)

  // ══ Preflight: 모든 검증·파싱을 어떤 쓰기보다 먼저 ═══════════════════
  if (!existsSync(targetRoot) || !statSync(targetRoot).isDirectory())
    throw new Error(`대상 디렉터리가 없음: ${targetRoot}`)
  assertGitWorkTree(targetRoot) // 실제 git probe(fake .git 마커 거부)

  const pkgPath = join(targetRoot, 'package.json')
  if (!existsSync(pkgPath))
    throw new Error(`package.json 없음: ${targetRoot} — 'npm init' 등으로 먼저 생성(req:* 스크립트 주입 대상).`)
  const pkg = parseJsonObject(pkgPath, 'package.json') as {
    scripts?: Record<string, string>
    devDependencies?: Record<string, string>
  }
  // scripts·devDependencies·dependencies가 존재하면 반드시 plain object — 배열/원시면 patch 유실(scripts/devDeps, phase R1 P2)
  // 또는 cross-spawn 진단(dependencies, design R1 P3) 오동작. 읽기 전에 shape 검증(fail-closed).
  for (const field of ['scripts', 'devDependencies', 'dependencies'] as const) {
    const v = (pkg as Record<string, unknown>)[field]
    if (v !== undefined && (typeof v !== 'object' || v === null || Array.isArray(v)))
      throw new Error(`package.json의 ${field} 필드가 객체가 아님(${pkgPath}) — 배열/원시 미지원.`)
  }

  // cross-spawn 보안 하한 진단(#1): 기존 cross-spawn이 하한 미만이면 WARN(기본)/throw(--strict). preflight라 strict throw 시 부분 설치 없음.
  let crossSpawnFloorWarned = false
  const floorCheck = crossSpawnBelowFloor(targetRoot, pkg as Record<string, unknown>)
  if (floorCheck?.below) {
    const spec = CROSS_SPAWN_SPEC
    const msg = `기존 cross-spawn(${floorCheck.detail})이 보안 하한 >=${CROSS_SPAWN_FLOOR?.version} 미만 — CommitGate 안전 경계(safeSpawnSync)는 ${spec} 검증분입니다. 'npm i -D cross-spawn@${spec}' 권장.`
    if (opts.strict) throw new Error(`[--strict] ${msg}`)
    console.warn(`⚠️  ${msg} (설치는 계속 — 강제 중단하려면 --strict)`)
    crossSpawnFloorWarned = true
  }

  const cfgPath = join(targetRoot, 'req.config.json')
  const existingCfg = existsSync(cfgPath) ? parseJsonObject(cfgPath, 'req.config.json') : null
  // 기존 config는 워크플로 CONFIG_SCHEMA(additionalProperties·enum·type) + 경로 confinement까지 preflight 검증(phase R2 P2).
  // kit의 loadConfig를 재사용 — schema-invalid(unknown key·bad enum·escaping ticketRoot 등)면 복사 전 throw(첫 req:* 지연 실패 방지).
  // 병합은 유효 키만 추가(handoffPath:null·packageManager)라 "기존 유효 ⇒ 병합 유효".
  loadConfig({ root: targetRoot })
  const packageManager = detectPackageManager(targetRoot)

  // req.config.json 계획(쓰기 없음). handoffPath:null·packageManager를 항상 보장 —
  // handoffPath는 프로젝트별 값이라 코어 기본이 비활성(null)이다 — 그 비활성을 config에 **명시 기록**한다(암묵 < 명시). 기존 키 보존.
  let configAction: 'created' | 'merged' | 'unchanged' = 'unchanged'
  const configKeysAdded: string[] = []
  let configToWrite: Record<string, unknown> | null = null
  if (existingCfg === null) {
    configAction = 'created'
    configKeysAdded.push('packageManager', 'handoffPath')
    configToWrite = { packageManager, handoffPath: null }
  } else {
    const patch: Record<string, unknown> = {}
    if (!('handoffPath' in existingCfg)) {
      patch.handoffPath = null
      configKeysAdded.push('handoffPath')
    }
    if (!('packageManager' in existingCfg)) {
      patch.packageManager = packageManager
      configKeysAdded.push('packageManager')
    }
    if (configKeysAdded.length > 0) {
      configAction = 'merged'
      configToWrite = { ...existingCfg, ...patch }
    }
  }

  // package.json 패치 계획(쓰기 없음, 기존 키 미덮어씀)
  const packageJsonAdded: string[] = []
  const scripts = pkg.scripts ?? {}
  const devDeps = pkg.devDependencies ?? {}
  for (const [k, v] of Object.entries(REQ_SCRIPTS)) {
    if (!(k in scripts)) {
      scripts[k] = v
      packageJsonAdded.push(`scripts.${k}`)
    }
  }
  for (const [k, v] of Object.entries(REQ_DEV_DEPS)) {
    if (!(k in devDeps)) {
      devDeps[k] = v
      packageJsonAdded.push(`devDependencies.${k}`)
    }
  }

  const agentsPath = join(targetRoot, 'AGENTS.md')
  const agentsCreated = !existsSync(agentsPath)

  const agentEntrypointsSkipped = opts.noAgentEntrypoints === true
  if (!agentEntrypointsSkipped) assertEntrypointPathsUsable(targetRoot)

  // 기존 AGENTS.md에 계약 마커가 없으면 진입점 포인터가 **엉뚱한 SSOT**를 가리키게 된다(design R1 observation).
  // 설치는 계속한다(비파괴 원칙) — 사용자가 병합하도록 알릴 뿐.
  const agentsMarkerMissing =
    !agentEntrypointsSkipped && !agentsCreated && !readFileSync(agentsPath, 'utf8').includes(AGENTS_CONTRACT_MARKER)

  const claudeMdPath = join(targetRoot, KIT_CLAUDE_DEST_REL)
  const claudeMdCreated = !agentEntrypointsSkipped && !existsSync(claudeMdPath)

  // 마커가 없으면 포인터가 참조할 계약 템플릿을 **대상 repo에** 놓는다 — 그러지 않으면 복구 지시가 막다른 길이다.
  const contractCopyPath = join(targetRoot, KIT_AGENTS_CONTRACT_COPY_REL)
  const agentsContractCopyCreated = agentsMarkerMissing && (!existsSync(contractCopyPath) || opts.force)

  // ══ Apply: 여기부터 쓰기(preflight 전부 통과 후에만) ═════════════════
  const copied: string[] = []
  const skipped: string[] = []
  copyInto(walkFiles(join(PACKAGE_ROOT, KIT_SOURCE_DIR_REL)), PACKAGE_ROOT, targetRoot, opts, copied, skipped)
  // ⚠️ KIT_COPY_RELPATHS는 패키지-상대 = 대상-상대(리터럴 `workflow/`). ticketRoot/schemaPath 설정과 무관 — uninstall planner와 공유하는 SSOT.
  const kitFiles = KIT_COPY_RELPATHS.map((rel) => join(PACKAGE_ROOT, rel))
  copyInto(kitFiles, PACKAGE_ROOT, targetRoot, opts, copied, skipped)
  if (!agentEntrypointsSkipped) copyEntrypoints(targetRoot, opts, copied, skipped)

  if (!opts.dryRun) {
    if (configToWrite) writeFileSync(cfgPath, JSON.stringify(configToWrite, null, 2) + '\n', 'utf8')
    if (packageJsonAdded.length > 0) {
      pkg.scripts = scripts
      pkg.devDependencies = devDeps
      writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8')
    }
    if (agentsCreated) copyFileSync(join(PACKAGE_ROOT, 'AGENTS.template.md'), agentsPath)
    // CLAUDE.md는 AGENTS.md와 동일 정책: **부재 시에만** 생성(--force로도 덮어쓰지 않는다 — 사용자 파일일 수 있다).
    if (claudeMdCreated) copyFileSync(join(PACKAGE_ROOT, KIT_CLAUDE_TEMPLATE_REL), claudeMdPath)
    if (agentsContractCopyCreated) copyFileSync(join(PACKAGE_ROOT, 'AGENTS.template.md'), contractCopyPath)
  }

  if (agentsMarkerMissing) {
    // phase-3a R1 observation: 사본을 **새로 놓았을 때**와 **기존 것을 보존했을 때**의 문구가 달라야 한다.
    // "설치했습니다"가 두 경우 모두에 나오면, 편집된 사본을 그대로 둔 사용자가 새 템플릿을 받았다고 오해한다.
    const copyNote = opts.dryRun
      ? `계약 템플릿을 ${KIT_AGENTS_CONTRACT_COPY_REL} 로 설치할 예정입니다.`
      : agentsContractCopyCreated
        ? `계약 템플릿을 ${KIT_AGENTS_CONTRACT_COPY_REL} 로 함께 설치했습니다.`
        : `${KIT_AGENTS_CONTRACT_COPY_REL} 가 이미 있어 보존했습니다(덮어쓰려면 --force).`
    console.warn(
      `⚠️  기존 AGENTS.md에 ${AGENTS_CONTRACT_MARKER} 마커가 없습니다 — .claude/·.cursor/ 진입점이 가리킬 CommitGate 계약이 그 파일에 없습니다.\n` +
        `   ${copyNote} 그 내용을 AGENTS.md에 병합한 뒤 ${KIT_AGENTS_CONTRACT_COPY_REL} 를 지우세요(설치는 계속됩니다).`,
    )
  }

  return {
    targetRoot,
    copied,
    skipped,
    configAction,
    configKeysAdded,
    packageJsonAdded,
    agentsCreated,
    packageManager,
    crossSpawnFloorWarned,
    dryRun: opts.dryRun,
    claudeMdCreated,
    agentsMarkerMissing,
    agentsContractCopyCreated,
    agentEntrypointsSkipped,
  }
}

export function parseArgs(argv: string[]): InitOptions {
  let dir = process.cwd()
  let force = false
  let dryRun = false
  let strict = false
  let noAgentEntrypoints = false
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dir') {
      const v = argv[i + 1]
      if (v === undefined) throw new Error('--dir 값 누락')
      dir = v
      i++
    } else if (a === '--force') {
      force = true
    } else if (a === '--dry-run') {
      dryRun = true
    } else if (a === '--strict') {
      strict = true
    } else if (a === '--no-agent-entrypoints') {
      noAgentEntrypoints = true
    } else if (a === '-h' || a === '--help') {
      printHelp()
      process.exit(0)
    } else {
      throw new Error(`알 수 없는 인자: ${a}`)
    }
  }
  return { dir: resolve(dir), force, dryRun, strict, noAgentEntrypoints }
}

function printHelp(): void {
  console.log(`commitgate — AI REQ workflow(커밋 게이트) kit 설치

사용법:
  npx commitgate [--dir <대상repo>] [--force] [--dry-run] [--strict]
  npx commitgate uninstall [--dir <대상repo>]   # 제거 계획만 출력(아무것도 지우지 않음)

옵션:
  --dir <path>   대상 repo 루트(기본: 현재 디렉터리)
  --force        기존 kit 파일 덮어쓰기(기본: 스킵)
  --dry-run      변경 없이 수행 예정 목록만 출력
  --strict       기존 cross-spawn이 보안 하한(>=7.0.6) 미만이면 경고 대신 중단(fail-closed)
  --no-agent-entrypoints
                 .claude/·.cursor/·CLAUDE.md 진입점 설치를 건너뛴다
  -h, --help     도움말

설치 후:
  1. <대상repo>에서 의존성 설치(감지된 패키지매니저)
  2. codex CLI 설치 확인(리뷰 실호출용)
  3. req.config.json 조정(branchPrefix/ticketRoot 등)
  4. 첫 티켓 생성:
       npm  → npm run req:new -- <slug> --run
       pnpm → pnpm req:new <slug> --run
       yarn → yarn req:new <slug> --run`)
}

export function main(argv: string[]): void {
  const opts = parseArgs(argv)
  const r = runInit(opts)
  const tag = r.dryRun ? '[dry-run] ' : ''
  console.log(`${tag}commitgate 설치: ${r.targetRoot}`)
  console.log(`${tag}  packageManager 감지: ${r.packageManager}`)
  console.log(`${tag}  복사 ${r.copied.length}개 / 스킵(기존) ${r.skipped.length}개`)
  for (const f of r.copied) console.log(`${tag}    + ${f}`)
  for (const f of r.skipped) console.log(`${tag}    = ${f} (이미 존재)`)
  const cfgMsg =
    r.configAction === 'created'
      ? `생성(${r.configKeysAdded.join(', ')})`
      : r.configAction === 'merged'
        ? `누락키 병합(${r.configKeysAdded.join(', ')})`
        : '변경 없음(기존 유지)'
  console.log(`${tag}  req.config.json: ${cfgMsg}`)
  console.log(
    `${tag}  package.json: ${r.packageJsonAdded.length > 0 ? '추가 ' + r.packageJsonAdded.join(', ') : '변경 없음'}`,
  )
  console.log(`${tag}  AGENTS.md: ${r.agentsCreated ? '템플릿 생성' : '이미 존재(유지)'}`)
  if (r.agentEntrypointsSkipped) console.log(`${tag}  에이전트 진입점: 건너뜀(--no-agent-entrypoints)`)
  else {
    console.log(`${tag}  CLAUDE.md: ${r.claudeMdCreated ? '템플릿 생성' : '이미 존재(유지)'}`)
    if (r.agentsContractCopyCreated) console.log(`${tag}  ${KIT_AGENTS_CONTRACT_COPY_REL}: 계약 템플릿 사본 생성(AGENTS.md에 병합 후 삭제)`)
  }
  if (r.crossSpawnFloorWarned) console.log(`${tag}  ⚠️ cross-spawn 버전 하한 경고(위 참조) — 강제 중단은 --strict`)
  if (!r.dryRun) {
    console.log(`\n다음:`)
    console.log(`  1. cd ${r.targetRoot} && ${r.packageManager} install`)
    console.log(`  2. codex --version   # 리뷰 실호출 전제(미설치면 review-codex --run이 fail-closed)`)
    console.log(`  3. req.config.json 확인(branchPrefix 등)`)
    console.log(`  4. ${runScriptCmd(r.packageManager, 'req:new', '<slug> --run')}`)
  }
}

/**
 * CLI 경계: main을 실행하되 사전조건 미충족 등 예상된 실패(throw)는
 * raw 스택트레이스가 아니라 친절한 한 줄 메시지 + 종료코드 1로 표면화한다.
 * (에러 문구 자체가 이미 조치 안내를 담고 있어 스택트레이스는 노이즈일 뿐 — REQ 후속 UX 개선.)
 * bin/commitgate.mjs 런처와 직접 실행(`tsx bin/init.ts`)이 공유하는 단일 경계.
 */
export function runCli(argv: string[]): void {
  try {
    main(argv)
  } catch (err) {
    console.error(`commitgate: ${err instanceof Error ? err.message : String(err)}`)
    process.exitCode = 1
  }
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href
if (isMain) runCli(process.argv.slice(2))
