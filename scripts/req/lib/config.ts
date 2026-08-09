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

/**
 * phase 자동 커밋 정책(REQ-2026-037). **opt-in** — 코어 기본은 `never`(현행: 매 phase `AWAIT_HUMAN` 정지).
 *   - `never`   : Codex 승인 phase마다 사람 확인(`req:commit --run`). 배포 안전도구의 무회귀 기본값.
 *   - `low-only`: `risk_level==='LOW'`(정확 일치)인 phase를 사람 정지 없이 자동 커밋.
 *     HIGH 티켓이 커밋에서 멈추는 **지점은 `stopGate`가 정한다**(`userConfirmGate`) — 이 축이 정하지 않는다.
 *     정책 `"all"`은 **없다** — 자동 커밋이 사람 확인을 요구하는 지점과 만나면 livelock/위조를 부른다
 *     (REQ-2026-019 폐기 사유).
 */
export type PhaseCommitPolicy = 'never' | 'low-only'

/**
 * 사람이 **어디서 멈추는가**(REQ-2026-063 DEC-1). `phaseCommit.autoApprove`가 구현 언어라면
 * 이쪽이 **의미 SSOT**다 — `commitgate setup`이 묻는 것도 이 축이다.
 *
 * - `phase`: 매 phase 커밋 전에 사람 확인(현행 기본).
 * - `req`  : REQ 안의 LOW phase는 자율 커밋하고, 사람 확인을 **통합 직전 한 번**으로 모은다.
 * - `merge`: 여러 REQ를 하나의 delivery set으로 묶고, 묶음 전체가 끝날 때까지 미룬다(REQ-2026-066).
 *
 * 🔴 **HIGH 티켓의 정지 지점도 이 값이 정한다**(REQ-2026-071). `phase`면 매 phase 커밋 전,
 *    `req`면 REQ를 끝내는 커밋 전, `merge`면 커밋에서는 멈추지 않는다(`userConfirmGate`).
 *    `"all"`류 값은 없다 — 사람 확인을 요구하는 지점에서 자동 커밋하면 livelock 또는
 *    타임스탬프 위조가 된다(REQ-2026-019 폐기 사유).
 * 🔴 **통합(main 병합) 승인은 어느 값에서도 필요하다** — 이 축이 없애는 것은 커밋 지점의 정지뿐이다.
 * 🔴 `"merge"`는 `commitgate delivery` **동작과 함께** 착륙했다(REQ-2026-066 p1~p3 동일 릴리스).
 *    스키마에 값만 먼저 넣으면 고를 수는 있는데 동작이 없는 거짓 UI가 된다 — 그래서 미뤘던 값이다.
 */
export type StopGate = 'phase' | 'req' | 'merge'

/**
 * granularity 정책 강제 수준(REQ-2026-086, 기본값은 REQ-2026-087로 `warn`으로 정정).
 *
 * - `warn`(기본): 리뷰 직전에 경고만 내고 진행한다 — **면적 때문에 워크플로가 멈추지 않는다.**
 * - `block`     : 초과하면 리뷰를 실행하지 않는다. 차단은 **리뷰 호출 전**이라 되돌릴 상태가 남지 않는다
 *   (attempt·원장·커밋 무생성). 정당하게 큰 phase는 `phases[].max_files` 선언으로 통과시킨다.
 */
export type GranularityGate = 'block' | 'warn'

/** `stopGate` → 파생 `phaseCommit.autoApprove`. 두 축의 유일한 번역표(SSOT). */
export const AUTO_APPROVE_OF: Record<StopGate, PhaseCommitPolicy> = { phase: 'never', req: 'low-only', merge: 'low-only' }
/**
 * 역방향(legacy config에서 `stopGate` 역파생).
 * 🔴 `merge`는 `req`의 **상위 집합**이라(둘 다 phase는 자율 커밋) autoApprove 만으로는 구별되지 않는다.
 *    그래서 legacy `phaseCommit`만 있는 설정은 **보수적으로 `req`**로 해소한다 — 묶음 정지를 마음대로
 *    켜지 않는다. `merge`를 쓰려면 `stopGate`를 명시해야 한다.
 */
export const STOP_GATE_OF: Record<PhaseCommitPolicy, StopGate> = { never: 'phase', 'low-only': 'req' }

export interface PhaseCommit {
  autoApprove: PhaseCommitPolicy
}

/**
 * setup 완료 마커(REQ-2026-062 DEC-1). **커밋되는 파일에 들어가므로 "팀 공유 설정 완료 사실"**이지
 * "내가 로그인돼 있다"가 아니다 — 로그인은 개발자별이라 이 마커가 팀원의 인증을 보증하지 않는다(DEC-2).
 *
 * 🔴 `completedAt`은 **실제 시계**에서 읽는다. 지어내면 REQ-2026-019 폐기 사유(타임스탬프 날조)의 재발이다.
 */
export interface SetupMarker {
  /** setup을 실행한 commitgate 버전(진단·마이그레이션 근거). */
  completedVersion: string
  /** ISO instant. */
  completedAt: string
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
  /** REQ-2026-037: phase 자동 커밋 정책. 미지정 = DEFAULTS(never = 현행 매 phase 정지). */
  phaseCommit?: PhaseCommit
  /** REQ-2026-056: true면 리뷰 프롬프트에 lockfile diff 전문을 담는다. 미지정/false = 요약(기본). */
  lockfilePromptFull?: boolean
  /** REQ-2026-120: 전송 전 secret scan 정책. 미지정 = 기본 'block'(고신뢰 패턴·비가역 유출 방지). */
  secretScan?: 'block' | 'warn' | 'off'
  /**
   * REQ-2026-119: 실효 위험 감지(D31)의 민감 경로 패턴(소문자 부분 문자열).
   * 미지정/null = 내장 기본 목록 · 지정 = **대체**(합집합 아님 — 기본 목록의 오탐 항목을 제거할 수
   * 있어야 한다) · `[]` = 감지 비활성(그것도 유효한 선택).
   */
  riskPaths?: string[] | null
  /** REQ-2026-062: setup 완료 마커. 부재 = 아직 setup을 하지 않음. */
  setup?: SetupMarker
  /** REQ-2026-063: 멈춤 위치(의미 SSOT). 미지정 = `phaseCommit`에서 역파생하거나 DEFAULTS. */
  stopGate?: StopGate
  /** REQ-2026-085: D25(미병합 누적 경고) 판정용 통합 브랜치. `null` = D25 비활성. 미지정 = DEFAULTS(`main`). */
  trunkBranch?: string | null
  /** REQ-2026-086: granularity 강제 수준. 미지정 = DEFAULTS(`block`). */
  granularityGate?: GranularityGate
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
  phaseCommit: PhaseCommit
  lockfilePromptFull: boolean
  /** REQ-2026-120: 전송 전 secret scan 정책(기본 'block'). */
  secretScan: 'block' | 'warn' | 'off'
  /** REQ-2026-119: D31 민감 경로 패턴. `null` = 내장 기본 목록 사용 · `[]` = 감지 비활성. */
  riskPaths: string[] | null
  /** REQ-2026-062: setup 완료 마커. `null` = 미완료(게이트 판정 입력). */
  setup: SetupMarker | null
  /** REQ-2026-063: 멈춤 위치. `phaseCommit`과 **항상 정합**(둘 중 하나가 다른 하나에서 파생된다). */
  stopGate: StopGate
  /** REQ-2026-085: D25 판정용 통합 브랜치. `null` = D25 비활성. */
  trunkBranch: string | null
  /** REQ-2026-086: granularity 강제 수준. `block` = 리뷰 전 차단(기본). */
  granularityGate: GranularityGate
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
  // 🔴 기본 추론강도 = medium(REQ-2026-067 phase-4, 사용자 지시). 이전 기본은 high 였다.
  //    **핀하지 않은 소비자의 리뷰 깊이·비용이 함께 내려간다** — 높게 유지하려면 `reviewReasoningEffort`를 명시한다.
  reviewReasoningEffort: 'medium' as ReviewReasoningEffort | null,
  // REQ-2026-028 A-2a: review 예산. autoBudget=자동 허용 회차, hardCap=절대 상한(9번째 차단 → 8).
  reviewBudget: { autoBudget: 5, hardCap: 8 } as ReviewBudget,
  // REQ-2026-037: phase 자동 커밋은 opt-in. 코어 기본 never = 현행(매 phase 정지) — 업그레이드로 완화되지 않는다.
  // 🔴 `stopGate`와 **한 쌍**이다(AUTO_APPROVE_OF). 한쪽만 바꾸면 두 키가 다 없는 정상 설정이
  //    자기모순으로 해소된다 — 파생을 하드코딩하지 않고 표에서 가져온다(REQ-2026-067 DEC-18).
  phaseCommit: { autoApprove: AUTO_APPROVE_OF['req'] } as PhaseCommit,
  // REQ-2026-056: lockfile 프롬프트 기본 요약(false). 전문이 필요하면 config에 true 명시(opt-in).
  lockfilePromptFull: false,
  // REQ-2026-120: 기본 차단 — 고신뢰 패턴뿐이라 오탐 근접 0이고 유출은 비가역이다(0.13.1 warn-first
  // 선례는 수렴 마찰 맥락 — 적용 경계 밖). 오탐 시 탈출구는 'warn'/'off'.
  secretScan: 'block' as 'block' | 'warn' | 'off',
  // REQ-2026-119: null = 내장 기본 목록(lib/effective-risk의 DEFAULT_RISK_PATTERNS). `as`는 trunkBranch와 같은 이유.
  riskPaths: null as string[] | null,
  // REQ-2026-062: setup 미완료가 기본. `as` 는 handoffPath와 같은 이유(직접 import 소비자의 `| null` 계약 보존).
  setup: null as SetupMarker | null,
  // REQ-2026-063: 현행 기본(매 phase 정지) = phaseCommit.never 와 같은 값.
  // 🔴 기본 멈춤 지점 = req(REQ-2026-067 DEC-18, 사용자 지시). 이전 기본은 phase(매 phase 정지)였다.
  //    **안전 기본값을 완화하는 변경**이다 — 값을 핀하지 않은 소비자는 LOW phase가 사람 정지 없이
  //    자동 커밋된다. HIGH 티켓도 이 값에서는 REQ를 끝내는 커밋에서만 멈춘다(`userConfirmGate`).
  //    통합(main 병합) 승인은 그대로 필요하다.
  stopGate: 'req' as StopGate,
  /**
   * REQ-2026-085: D25(미병합 누적 경고)가 "도달했는가"를 판정하는 통합 브랜치.
   * `null` = D25 비활성. 로컬에 이 ref가 없으면 **조용히 통과**한다 — D25는 알림이지 게이트가 아니라서,
   * trunk 이름이 다른 repo에 매번 오탐을 내면 사람이 doctor 출력 전체를 무시하게 된다.
   * `as ... | null`은 handoffPath와 같은 이유(직접 import 소비자의 `| null` 계약 보존).
   */
  trunkBranch: 'main' as string | null,
  /**
   * REQ-2026-086: granularity 정책의 **강제 수준**.
   * - `warn`(기본): 리뷰 직전에 경고만 내고 **그대로 진행한다.**
   * - `block`     : 초과하면 리뷰를 실행하지 않는다(opt-in).
   *
   * 🔴 **기본은 `warn`이다**(REQ-2026-087로 정정). 0.13.0은 `block`으로 냈는데, 그 기본은
   *    **자동으로 넘어가지 않는 정지**라 자율 루프를 끊는다. 막다른 길은 아니었지만(소모 0 · 탈출구 3개)
   *    "진행을 막지 않는다"가 우선한다는 것이 사용자 결정이다.
   *
   * 🔴 정책의 실제 가치는 **강도가 아니라 시점**이다. 판정은 여전히 **리뷰 호출 직전**에 일어난다 —
   *    그 시점의 시정은 `git restore --staged`(staging 재구성)라 싸고, 예전 D18처럼 커밋 직전에
   *    "다음부터 분할 권고"라는 행동 불가능한 조언을 내지 않는다. `warn`이어도 그 가치는 유지된다.
   *    차단이 필요한 팀은 `"granularityGate": "block"`으로 켠다.
   */
  granularityGate: 'warn' as GranularityGate,
}

/** ISO instant(UTC). `close-proof`의 `isValidIsoInstant`와 같은 형태를 스키마 수준에서 강제한다. */
const ISO_INSTANT_RE = '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d+)?Z$'

const BASENAME_RE = '^[A-Za-z0-9][A-Za-z0-9._-]*$' // basename만(슬래시·백슬래시·선행 `.`(→`..`) 금지)

/** `req.config.json` AJV 스키마(fail-closed). 미지정 키는 DEFAULTS로 병합. */
export const CONFIG_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ticketRoot: { type: 'string', minLength: 1 },
    // REQ-2026-085: null = D25 비활성. 문자열이면 minLength 1(빈 문자열은 "비활성"의 애매한 표현 → null을 쓰게 한다).
    trunkBranch: { type: ['string', 'null'], minLength: 1 },
    schemaPath: { type: 'string', minLength: 1 },
    handoffPath: { type: ['string', 'null'] },
    // null = 의도적 비활성. 문자열이면 minLength 1(빈 문자열은 "비활성"의 애매한 표현 → 거부, null을 쓰게 한다).
    reviewPersonaPath: { type: ['string', 'null'], minLength: 1 },
    branchPrefix: { type: 'string', minLength: 1 }, // 빈 prefix는 D11 무력화 → 금지
    // REQ-2026-119: 항목은 비지 않은 문자열(빈 패턴은 전 경로 일치 — 의미 없는 전량 오탐 금지).
    riskPaths: { type: ['array', 'null'], items: { type: 'string', minLength: 1 } },
    packageManager: { type: 'string', enum: ['pnpm', 'npm', 'yarn'] },
    granularityMaxFiles: { type: 'integer', minimum: 1 },
    // REQ-2026-086: 강제 수준. enum이 정책을 고정한다 — 임의 문자열로 게이트를 무력화할 수 없다.
    granularityGate: { type: 'string', enum: ['block', 'warn'] },
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
    // REQ-2026-037: phase 자동 커밋 정책. autoApprove enum이 정책을 고정 — `"all"`은 없다(HIGH livelock 방지).
    phaseCommit: {
      type: 'object',
      additionalProperties: false,
      required: ['autoApprove'],
      properties: {
        autoApprove: { type: 'string', enum: ['never', 'low-only'] },
      },
    },
    // REQ-2026-056: lockfile 프롬프트 전문 opt-in.
    lockfilePromptFull: { type: 'boolean' },
    secretScan: { type: 'string', enum: ['block', 'warn', 'off'] },
    // REQ-2026-063: 멈춤 위치. 🔴 enum은 **2값만** — `merge`는 delivery set 없이는 동작이 없어 거짓 UI가 된다.
    //    `null`을 넣지 않으므로 "비움" 입력은 기존 검증 경로가 자동으로 거부한다(전역 상속 개념이 없는 축).
    stopGate: { type: 'string', enum: ['phase', 'req', 'merge'] },
    // REQ-2026-062: setup 완료 마커. 🔴 `workflow/req.config.schema.json` 과 **동시에** 확장해야 한다 —
    // 한쪽만 고치면 소비자의 vendored 스키마가 신규 키를 additionalProperties:false 로 거부해 모든 명령이 죽는다.
    setup: {
      type: 'object',
      additionalProperties: false,
      required: ['completedVersion', 'completedAt'],
      properties: {
        completedVersion: { type: 'string', minLength: 1 },
        // ISO instant. 형식을 고정해 두면 날조·수기 편집이 티가 난다.
        completedAt: { type: 'string', pattern: ISO_INSTANT_RE },
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

/**
 * `stopGate`·`phaseCommit` 두 축 해소(REQ-2026-063 DEC-2·DEC-3).
 *
 * 🔴 **충돌 검사는 raw key 명시 여부 기준**이다. `phaseCommit`은 부재해도 DEFAULTS로 채워지므로,
 *    해소값을 비교하면 `stopGate`만 쓴 정상 설정이 "never와 모순"으로 거부된다 — 새 축을 아무도 못 쓰게 된다.
 * 🔴 오류는 **무엇이 모순인지** 말한다(DEC-2b): 두 키의 실제 값 · 기대 매핑 · 해결 방법.
 *    "거부만 하고 안내는 없는" 구현은 사용자가 무엇을 고쳐야 할지 알 수 없게 만든다.
 */
export function resolveStopAxes(raw: RawConfig): { stopGate: StopGate; phaseCommit: PhaseCommit } {
  const hasStopGate = Object.prototype.hasOwnProperty.call(raw, 'stopGate') && raw.stopGate !== undefined
  const hasPhaseCommit = Object.prototype.hasOwnProperty.call(raw, 'phaseCommit') && raw.phaseCommit !== undefined

  if (hasStopGate && hasPhaseCommit) {
    const sg = raw.stopGate as StopGate
    const pc = raw.phaseCommit as PhaseCommit
    const expected = AUTO_APPROVE_OF[sg]
    if (expected !== pc.autoApprove)
      throw new Error(
        `req.config: stopGate 와 phaseCommit.autoApprove 가 모순입니다 — ` +
          `stopGate: "${sg}" 인데 phaseCommit.autoApprove: "${pc.autoApprove}" 입니다. ` +
          `기대 매핑은 stopGate "phase" ⇄ "never" · "req" ⇄ "low-only" 이므로 stopGate "${sg}" 는 "${expected}" 여야 합니다. ` +
          `해결: 둘 중 하나를 지우거나 값을 맞추세요 — stopGate 가 새 축이고 phaseCommit 은 deprecated alias 입니다.`,
      )
    return { stopGate: sg, phaseCommit: pc }
  }
  if (hasStopGate) {
    const sg = raw.stopGate as StopGate
    return { stopGate: sg, phaseCommit: { autoApprove: AUTO_APPROVE_OF[sg] } }
  }
  if (hasPhaseCommit) {
    const pc = raw.phaseCommit as PhaseCommit
    return { stopGate: STOP_GATE_OF[pc.autoApprove], phaseCommit: pc }
  }
  return { stopGate: DEFAULTS.stopGate, phaseCommit: DEFAULTS.phaseCommit }
}

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
    trunkBranch: raw.trunkBranch === undefined ? DEFAULTS.trunkBranch : raw.trunkBranch,
    granularityGate: raw.granularityGate ?? DEFAULTS.granularityGate,
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
    // REQ-2026-063: 두 축 해소. 🔴 **raw key 명시 여부**로 판정한다 — 해소값을 비교하면 `phaseCommit`이
    //    부재해도 `never`로 채워지므로 `stopGate:"req"`만 쓴 **정상 설정**이 오탐되어 거부된다(새 축을 아무도 못 쓴다).
    ...resolveStopAxes(raw),
    // REQ-2026-062: 부재 = 미완료(null). 게이트가 이 값을 본다.
    setup: raw.setup ?? DEFAULTS.setup,
    // REQ-2026-056: 미지정 → DEFAULTS(false = 요약).
    lockfilePromptFull: raw.lockfilePromptFull ?? DEFAULTS.lockfilePromptFull,
    // REQ-2026-120: 미지정 → 기본 차단.
    secretScan: raw.secretScan ?? DEFAULTS.secretScan,
    // REQ-2026-119: null = 명시적 "기본 목록 사용"·[] = 비활성 — undefined만 DEFAULTS로 채운다.
    riskPaths: raw.riskPaths !== undefined ? raw.riskPaths : DEFAULTS.riskPaths,
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
