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

/**
 * codex 리뷰어의 추론강도(REQ-2026-013 P1). 실측 확정(R15): codex의 invalid-effort 거부 메시지가
 * `none|minimal|low|medium|high|xhigh`를 지원값으로 명시. `null`은 override 생략(전역 상속) 탈출구.
 */
export type ReviewReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'

/** review 예산(REQ-2026-028 A-2a). config↔review-codex 순환 방지를 위해 여기(config)에 정의. */
export interface ReviewBudget {
  autoBudget: number
  hardCap: number
}

/** 사용자가 `req.config.json`에 줄 수 있는 부분 config(전부 선택). */
export interface RawConfig {
  ticketRoot?: string
  schemaPath?: string
  handoffPath?: string | null
  /** null = 의도적 비활성(persona 블록 생략). 미지정 = DEFAULTS(활성). */
  reviewPersonaPath?: string | null
  branchPrefix?: string
  packageManager?: PackageManager
  granularityMaxFiles?: number
  designDocs?: Partial<DesignDocs>
  /** codex 리뷰 모델(REQ-2026-013 P1). null = `-c model=` 생략(전역 상속). 미지정 = DEFAULTS. */
  reviewModel?: string | null
  /** codex 리뷰 추론강도(REQ-2026-013 P1). null = `-c model_reasoning_effort=` 생략. 미지정 = DEFAULTS. */
  reviewReasoningEffort?: ReviewReasoningEffort | null
  /** REQ-2026-028 A-2a: review 예산. 미지정 = DEFAULTS(5/8). hardCap≤8·autoBudget≤hardCap은 loadConfig 검증. */
  reviewBudget?: ReviewBudget
}

/** 해소된 config(DEFAULTS 병합 + 파생 절대경로). */
export interface ResolvedConfig {
  root: string
  ticketRoot: string
  schemaPath: string
  handoffPath: string | null
  reviewPersonaPath: string | null
  branchPrefix: string
  packageManager: PackageManager
  granularityMaxFiles: number
  designDocs: DesignDocs
  reviewModel: string | null
  reviewReasoningEffort: ReviewReasoningEffort | null
  reviewBudget: ReviewBudget
  // 파생(절대경로)
  workflowDirAbs: string
  schemaPathAbs: string
  handoffPathAbs: string | null
  reviewPersonaPathAbs: string | null
}

/**
 * Codex 리뷰 프롬프트에 주입되는 **리뷰어 페르소나** 문서의 repo-상대 경로(코어 기본값).
 *
 * ⚠️ 이 상수는 두 축의 SSOT다(REQ-2026-010 D3-1).
 *   - **설치 축**: `bin/init.ts`의 `KIT_COPY_RELPATHS`가 이 경로를 대상 repo에 복사한다.
 *   - **설정 축**: `DEFAULTS.reviewPersonaPath`가 이 값으로 해소된다(phase-1b에서 도입).
 *
 * 둘이 갈라지면 신규 설치본은 프롬프트 조립 시 이 파일을 찾지 못하고 **모든 리뷰가 fail-closed로 멈춘다.**
 * `tests/unit/init.test.ts`의 "설치 축 SSOT"가 그 드리프트를 회귀로 잡는다.
 * `package.json`의 `files[]`는 또 **다른 축**(npm tarball 적재분)이므로 함께 갱신해야 한다.
 */
export const DEFAULT_REVIEW_PERSONA_RELPATH = 'workflow/review-persona.md'

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
  // ⚠️ handoffPath와 달리 코어 기본이 **활성**이다. init이 이 경로에 파일을 깔기 때문(KIT_COPY_RELPATHS).
  //    비활성이 필요하면 config에 `null`을 명시한다. `as string | null`은 handoffPath와 같은 이유(직접 import 소비자 계약).
  reviewPersonaPath: DEFAULT_REVIEW_PERSONA_RELPATH as string | null,
  branchPrefix: 'feat/req-',
  packageManager: 'pnpm' as PackageManager,
  granularityMaxFiles: 8,
  designDocs: { requirement: '00-requirement.md', design: '01-design.md', plan: '02-plan.md' } as DesignDocs,
  // REQ-2026-013 P1: 리뷰어 모델·추론강도 고정. 코어 기본은 DEFAULTS 중립성의 의도적 예외(D3) —
  // 리뷰어 모델은 게이트 무결성 핵심이라 미고정 시 전역 ultra 상속이 곧 결함. 미지원 CLI는 config override/null.
  // `as ... | null`은 handoffPath와 같은 이유(직접 import 소비자의 `| null` 계약 보존).
  reviewModel: 'gpt-5.6-terra' as string | null,
  reviewReasoningEffort: 'high' as ReviewReasoningEffort | null,
  // REQ-2026-028 A-2a: review 예산. autoBudget=자동 허용 회차, hardCap=절대 상한(9번째 차단 → 8).
  reviewBudget: { autoBudget: 5, hardCap: 8 } as ReviewBudget,
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
    // null = 의도적 비활성. 문자열이면 minLength 1(빈 문자열은 "비활성"의 애매한 표현 → 거부, null을 쓰게 한다).
    reviewPersonaPath: { type: ['string', 'null'], minLength: 1 },
    branchPrefix: { type: 'string', minLength: 1 }, // 빈 prefix는 D11 무력화 → 금지
    packageManager: { type: 'string', enum: ['pnpm', 'npm', 'yarn'] },
    granularityMaxFiles: { type: 'integer', minimum: 1 },
    // REQ-2026-013 P1. null=override 생략(전역 상속). model은 slug 패턴(따옴표·개행 거부 → TOML `model="…"` 주입 안전; null은 pattern에 vacuously 통과).
    reviewModel: { type: ['string', 'null'], pattern: BASENAME_RE },
    // effort는 실측 확정 enum(R15) + null. null을 enum에 포함해야 `{effort:null}`이 통과(JSON Schema enum은 타입 무관 전체 적용).
    reviewReasoningEffort: { type: ['string', 'null'], enum: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', null] },
    // REQ-2026-028 A-2a: 예산. 스키마는 타입·상한(hardCap≤8·최소 1)까지. 교차검증(autoBudget≤hardCap)은 loadConfig.
    reviewBudget: {
      type: 'object',
      additionalProperties: false,
      required: ['autoBudget', 'hardCap'],
      properties: {
        autoBudget: { type: 'integer', minimum: 1 },
        hardCap: { type: 'integer', minimum: 1, maximum: 8 },
      },
    },
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
    reviewPersonaPath:
      raw.reviewPersonaPath !== undefined ? raw.reviewPersonaPath : DEFAULTS.reviewPersonaPath, // null = 명시적 비활성
    branchPrefix: raw.branchPrefix ?? DEFAULTS.branchPrefix,
    packageManager: raw.packageManager ?? DEFAULTS.packageManager,
    granularityMaxFiles: raw.granularityMaxFiles ?? DEFAULTS.granularityMaxFiles,
    designDocs: { ...DEFAULTS.designDocs, ...(raw.designDocs ?? {}) },
    // REQ-2026-013 P1: nullable — 명시적 null 보존을 위해 `!== undefined`(`??` 금지: null이 기본값으로 복귀해 탈출구가 깨짐).
    reviewModel: raw.reviewModel !== undefined ? raw.reviewModel : DEFAULTS.reviewModel,
    reviewReasoningEffort:
      raw.reviewReasoningEffort !== undefined ? raw.reviewReasoningEffort : DEFAULTS.reviewReasoningEffort,
    reviewBudget: raw.reviewBudget ?? DEFAULTS.reviewBudget,
  }

  // REQ-2026-028 R7: 교차검증(스키마가 표현 못 함). AJV가 이미 hardCap∈[1,8]·autoBudget≥1을 잡았고,
  // 여기서 autoBudget ≤ hardCap을 강제(fail-closed). R4("9번째는 어떤 경로로도 차단")는 설정을 넘는 코드
  // 상수 경계다 — hardCap>8은 스키마가 거부하므로 config 한 줄로 뚫을 수 없다.
  if (merged.reviewBudget.autoBudget > merged.reviewBudget.hardCap)
    throw new Error(
      `req.config: reviewBudget.autoBudget(${merged.reviewBudget.autoBudget}) > hardCap(${merged.reviewBudget.hardCap}) — autoBudget는 hardCap 이하여야 한다`,
    )

  // repo-내부 자원(ticketRoot·schemaPath·reviewPersonaPath)은 **상대경로 + root 하위**만(절대경로·탈출 금지 → portable).
  // handoffPath만 면제 — 형제 repo의 SSOT 문서를 읽는 **외부 참조**이기 때문.
  // reviewPersonaPath는 패키지가 배포하고 init이 repo 안에 까는 자원이라 schemaPath와 같은 축이다(REQ-2026-010 D2).
  assertRelative(merged.ticketRoot, 'ticketRoot')
  assertRelative(merged.schemaPath, 'schemaPath')
  assertUnderRoot(rootAbs, merged.ticketRoot, 'ticketRoot')
  assertUnderRoot(rootAbs, merged.schemaPath, 'schemaPath')
  if (merged.reviewPersonaPath !== null) {
    assertRelative(merged.reviewPersonaPath, 'reviewPersonaPath')
    assertUnderRoot(rootAbs, merged.reviewPersonaPath, 'reviewPersonaPath')
  }

  return {
    root: rootAbs,
    ...merged,
    workflowDirAbs: resolve(rootAbs, merged.ticketRoot),
    schemaPathAbs: resolve(rootAbs, merged.schemaPath),
    handoffPathAbs: merged.handoffPath ? resolve(rootAbs, merged.handoffPath) : null,
    reviewPersonaPathAbs: merged.reviewPersonaPath ? resolve(rootAbs, merged.reviewPersonaPath) : null,
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
