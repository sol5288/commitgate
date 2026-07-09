/**
 * req 워크플로 config 모듈 (portability kit).
 *
 * 목적: 경로·이름·패키지매니저를 `req.config.json`으로 외부화한다. 파일이 없으면 `DEFAULTS`로 해소된다.
 *   ⚠️ `DEFAULTS`는 **모든 프로젝트에 유효한 중립 기본값**만 담는다(REQ-2026-009). 프로젝트 고유 값은 config가 흡수한다.
 *
 * 안전(fail-closed): config가 게이트를 무력화하거나 경로를 탈출하지 못하도록 AJV 스키마 + 해상도 confinement로 강제.
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve, join, dirname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import Ajv from 'ajv'

const __dirname = dirname(fileURLToPath(import.meta.url))

export type PackageManager = 'pnpm' | 'npm' | 'yarn'

export interface DesignDocs {
  requirement: string
  design: string
  plan: string
}

/** 사용자가 `req.config.json`에 줄 수 있는 부분 config(전부 선택). */
export interface RawConfig {
  ticketRoot?: string
  schemaPath?: string
  handoffPath?: string | null
  branchPrefix?: string
  packageManager?: PackageManager
  granularityMaxFiles?: number
  designDocs?: Partial<DesignDocs>
}

/** 해소된 config(DEFAULTS 병합 + 파생 절대경로). */
export interface ResolvedConfig {
  root: string
  ticketRoot: string
  schemaPath: string
  handoffPath: string | null
  branchPrefix: string
  packageManager: PackageManager
  granularityMaxFiles: number
  designDocs: DesignDocs
  // 파생(절대경로)
  workflowDirAbs: string
  schemaPathAbs: string
  handoffPathAbs: string | null
}

/**
 * 코어 기본값. `req.config.json` 부재 시 이 값으로 해소된다.
 *
 * ⚠️ 여기 있는 값은 **모든 대상 프로젝트에 유효한 중립 기본값**이어야 한다.
 *    특정 프로젝트에만 의미 있는 값(경로·문서 위치 등)은 코어가 아니라 `req.config.json`이 흡수한다.
 *    `handoffPath`가 그 예다 — 코어 기본은 **비활성(null)**이고, 쓰려면 config에 명시하거나 `--handoff <path>`로 준다.
 *    (REQ-2026-009: 이전 기본값은 특정 사설 프로젝트의 문서 경로였다.)
 *
 * `handoffPath`의 `as string | null`은 의도적이다. 없으면 TS가 리터럴 `null`로 좁혀
 * `DEFAULTS`를 직접 import하는 소비자의 `string | null` 계약이 깨진다.
 */
export const DEFAULTS = {
  ticketRoot: 'workflow',
  schemaPath: 'workflow/machine.schema.json',
  handoffPath: null as string | null,
  branchPrefix: 'feat/req-',
  packageManager: 'pnpm' as PackageManager,
  granularityMaxFiles: 8,
  designDocs: { requirement: '00-requirement.md', design: '01-design.md', plan: '02-plan.md' } as DesignDocs,
}

const BASENAME_RE = '^[A-Za-z0-9][A-Za-z0-9._-]*$' // basename만(슬래시·백슬래시·선행 `.`(→`..`) 금지)

/** `req.config.json` AJV 스키마(fail-closed). 미지정 키는 DEFAULTS로 병합. */
export const CONFIG_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ticketRoot: { type: 'string', minLength: 1 },
    schemaPath: { type: 'string', minLength: 1 },
    handoffPath: { type: ['string', 'null'] },
    branchPrefix: { type: 'string', minLength: 1 }, // 빈 prefix는 D11 무력화 → 금지
    packageManager: { type: 'string', enum: ['pnpm', 'npm', 'yarn'] },
    granularityMaxFiles: { type: 'integer', minimum: 1 },
    designDocs: {
      type: 'object',
      additionalProperties: false,
      properties: {
        requirement: { type: 'string', pattern: BASENAME_RE },
        design: { type: 'string', pattern: BASENAME_RE },
        plan: { type: 'string', pattern: BASENAME_RE },
      },
    },
  },
} as const

const ajv = new Ajv({ allErrors: true })
const validateConfig = ajv.compile(CONFIG_SCHEMA)

/** kit 패키지 루트(= 현재 APP_ROOT와 동일 디렉터리). config.ts는 scripts/req/lib/ 이므로 3단계 상위. */
export function packageRoot(): string {
  return resolve(__dirname, '..', '..', '..')
}

/**
 * root 해소(순수에 가깝게, IO=existsSync만). 우선순위: ① `--root`(opts.root) → ② cwd 상향탐색으로 `req.config.json` 발견 → ③ package-root fallback.
 */
export function resolveRoot(opts: { root?: string | null; cwd?: string } = {}): string {
  if (opts.root) return resolve(opts.root)
  let dir = resolve(opts.cwd ?? process.cwd())
  for (;;) {
    if (existsSync(join(dir, 'req.config.json'))) return dir
    const parent = dirname(dir)
    if (parent === dir) break // 파일시스템 루트
    dir = parent
  }
  return packageRoot()
}

/** 절대경로(POSIX `/`·Windows `C:\`·드라이브상대·UNC `\\`)면 throw — repo-내부 자원은 상대경로만(portable). */
function assertRelative(rel: string, name: string): void {
  if (/^([/\\]|[A-Za-z]:)/.test(rel)) throw new Error(`req.config: ${name}는 절대경로 불가(repo-상대만): ${rel}`)
}

/** abs가 rootAbs 하위인지(자기 자신 포함). 탈출 시 throw. */
function assertUnderRoot(rootAbs: string, rel: string, name: string): void {
  const abs = resolve(rootAbs, rel)
  if (abs !== rootAbs && !abs.startsWith(rootAbs + sep)) throw new Error(`req.config: ${name}가 root 밖으로 탈출: ${rel}`)
}

/** UTF-8 BOM(U+FEFF) 제거 — PowerShell 5 `Set-Content -Encoding UTF8` 등이 BOM을 붙여 JSON.parse가 실패하는 것 방지(P3). */
export function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s
}

/**
 * config 로드(fail-closed). root 결정 → `<root>/req.config.json` 있으면 파싱+AJV 검증+confinement → DEFAULTS 병합 → 파생경로.
 * 파일 부재 시 DEFAULTS만(현재 동작). 위반은 명확한 throw(자동 보정·기본값 강등 금지).
 */
export function loadConfig(opts: { root?: string | null; cwd?: string } = {}): ResolvedConfig {
  const rootAbs = resolveRoot(opts)
  const cfgPath = join(rootAbs, 'req.config.json')
  let raw: RawConfig = {}
  if (existsSync(cfgPath)) {
    let parsed: unknown
    try {
      parsed = JSON.parse(stripBom(readFileSync(cfgPath, 'utf8')))
    } catch (e) {
      throw new Error(`req.config.json 파싱 실패(${cfgPath}): ${(e as Error).message}`)
    }
    if (!validateConfig(parsed)) throw new Error(`req.config.json 스키마 위반: ${ajv.errorsText(validateConfig.errors)}`)
    raw = parsed as RawConfig
  }

  const merged = {
    ticketRoot: raw.ticketRoot ?? DEFAULTS.ticketRoot,
    schemaPath: raw.schemaPath ?? DEFAULTS.schemaPath,
    handoffPath: raw.handoffPath !== undefined ? raw.handoffPath : DEFAULTS.handoffPath, // null = 명시적 비활성
    branchPrefix: raw.branchPrefix ?? DEFAULTS.branchPrefix,
    packageManager: raw.packageManager ?? DEFAULTS.packageManager,
    granularityMaxFiles: raw.granularityMaxFiles ?? DEFAULTS.granularityMaxFiles,
    designDocs: { ...DEFAULTS.designDocs, ...(raw.designDocs ?? {}) },
  }

  // repo-내부 자원(ticketRoot·schemaPath)은 **상대경로 + root 하위**만(절대경로·탈출 금지 → portable). handoffPath는 읽기 전용 참조라 면제.
  assertRelative(merged.ticketRoot, 'ticketRoot')
  assertRelative(merged.schemaPath, 'schemaPath')
  assertUnderRoot(rootAbs, merged.ticketRoot, 'ticketRoot')
  assertUnderRoot(rootAbs, merged.schemaPath, 'schemaPath')

  return {
    root: rootAbs,
    ...merged,
    workflowDirAbs: resolve(rootAbs, merged.ticketRoot),
    schemaPathAbs: resolve(rootAbs, merged.schemaPath),
    handoffPathAbs: merged.handoffPath ? resolve(rootAbs, merged.handoffPath) : null,
  }
}

/**
 * 패키지매니저별 스크립트 호출 argv 빌더(순수). 문자열 치환만으론 npm 불가.
 * pnpm/yarn → `[pm, script, ...args]`, npm → `[npm, run, script, --, ...args]`.
 */
export function buildScriptInvocation(pm: PackageManager, scriptName: string, args: string[]): string[] {
  if (pm === 'npm') return ['npm', 'run', scriptName, '--', ...args]
  return [pm, scriptName, ...args]
}
