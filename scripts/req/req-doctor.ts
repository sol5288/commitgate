#!/usr/bin/env tsx
/**
 * req:doctor — AI REQ 워크플로우 1차 (단계 4B): 일관성 점검(fail-closed).
 *
 * 1차 최소셋(registry 비의존): D2·D3·D5·D6·D9·D10·D11 + D13(design 선행·freshness)·D15(NEEDS_FIX actionable). (D1/D7/D7b·D4a 등 registry/merge 의존은 2차)
 * FAIL 1건 이상 → exit 1, 자동 보정 금지(P9). review-codex 헬퍼 재사용.
 *
 * 사용: req:doctor <REQ-id>  |  req:doctor --ticket <dir>   (저장소 패키지매니저의 실행 형식으로)
 */
import { existsSync, readFileSync, readdirSync, appendFileSync, mkdirSync } from 'node:fs'
import { resolve, join, relative, dirname } from 'node:path'
import { createHash } from 'node:crypto'
import { parseStatusZ, entryPaths, formatStatusEntry, STATUS_Z_ARGS, type StatusEntry } from './lib/porcelain'
import { isAllowedResponsesScratch, reviewScratchPaths } from './lib/scratch'
import { effectiveRiskHits, DEFAULT_RISK_PATTERNS, type RiskHit } from './lib/effective-risk'
// REQ-2026-048 phase-1: confinement 술어는 leaf `lib/evidence.ts`가 정본 — 여기서 재수출(기존 경로 보존).
import { isConfinedArchivePath } from './lib/evidence'
import { PLACEHOLDER_APPROVAL_ANGLED, PLACEHOLDER_REASON } from './lib/placeholders'
import { planEvidenceRecovery, buildRecoveryFacts, RECOVERY_GUIDANCE } from './lib/evidence-recovery'
export { isConfinedArchivePath } from './lib/evidence'
import {
  loadState,
  validateVerdict,
  validateResponseStructure,
  findUnstagedOrUntracked,
  captureDesignBinding,
  designDocPaths,
  REVIEW_CALL_LOG_REL,
  STAGED_NAMES_Z_ARGS,
  readPhases,
  // 🔴 REQ-2026-107: granularity 판정의 **정본**을 그대로 쓴다(사본 금지). D18이 리뷰 preflight와
  //    다르게 판정하던 오탐이 정확히 "정책 SSOT가 옮겨갔는데 사본이 남은" 형태였다.
  judgePhaseArea,
  declaredPhaseMaxFiles,
  phaseCodeFiles,
  type WorkflowState,
  type Verdict,
  type ApprovalEvidence,
} from './review-codex'
import { setupGateVerdict, collectGateFacts, type GateVerdict } from './lib/setup-gate'
/**
 * 🔴 REQ-2026-112(D29): **목록(`RETIRED_CLAIMS`)을 import하지 않는다.** 매칭 함수만 가져간다 —
 *    배열을 손에 쥐지 않으면 사본을 둘 자리가 없다(설계 DEC-4 ① 구조 방어).
 *    아래 재수출은 테스트가 **참조 동일성**으로 정본 결속을 확인하는 seam이다.
 */
import { retiredClaimsIn, type RetiredClaim } from './lib/retired-claims'
export { retiredClaimsIn } from './lib/retired-claims'
// 🔴 REQ-2026-110(D28): HIGH 확인 차단 판정의 **정본**을 그대로 쓴다(사본 금지 — REQ-2026-107 교훈).
//    `req:commit`은 doctor를 **spawn**하지 정적 import하지 않으므로 순환은 생기지 않는다(typecheck 확인).
import { userConfirmGate, wouldCompleteReq } from './req-commit'
// REQ-2026-085 D25: 종결 증거 파일명(trunk 트리에서 이 경로의 존재로 "도달했는가"를 판정한다).
import { CLOSE_PROOF_BASENAME, recoveryGuidance, type CloseProofEvent } from './lib/close-proof'
// REQ-2026-088 DEC-1: 판정은 intake와 같은 술어로. 재구현하면 두 안내가 갈라진다.
// REQ-2026-094 D27: 증인 불일치 판정은 `lib/evidence`가 정본(여기서 재구현 금지).
import { splitUnboundPhases, designHashFromManifest, consumedApprovalsWithoutRow } from './lib/evidence'
import { createEvidencePorts } from './lib/evidence-ports'
// REQ-2026-161 DEC-1: 명령 표면 판정·입력 획득·안내 문장의 정본. `check` C6와 같은 것을 쓴다.
import { missingReqScripts, readPackageScripts, commandSurfaceMessage } from './lib/command-surface'
// REQ-2026-097 DEC-1: 종결 판정의 술어·입력 획득을 intake와 공유한다(자체 구현 금지).
import { scanTicketIntake } from './lib/intake'
import { loadConfig, packageRoot, stripBom, DEFAULTS, effectiveStopGate, isStopGate, type ResolvedConfig, type PackageManager, type GranularityGate } from './lib/config'
import { createGitAdapter, type GitAdapter } from './lib/adapters'
import { quickstartBackfillTargets, type QuickstartBackfillTarget } from '../../bin/quickstart'
import { makeRunCli, isEntrypoint } from './lib/cli-boundary'

// 모든 git 호출은 GitAdapter 경유(D-017-3). main()이 loadConfig 후 config.root로 재생성(기본 = packageRoot — config 부재 시 현재 동작 보존).
let gitAdapter: GitAdapter = createGitAdapter(packageRoot())

function git(args: string[]): string {
  return gitAdapter.exec(args)
}

export type Level = 'OK' | 'WARN' | 'FAIL'
/**
 * 🔴 **D-체크 id의 권위 등록부**(REQ-2026-099 DEC-3a). 여기 없는 id는 **타입이 거부한다.**
 *
 * 왜 필요한가: `07-business-rules-and-state-machines.md` §3이 D-체크 정본 표인데, REQ-2026-014
 * (D19 신설) 이후 8개 REQ가 D20~D27을 추가하는 동안 **아무도 그 표로 돌아오지 않아** 문서가
 * "구현된 검사는 13개뿐이다"라고 거짓을 말하고 있었다. 사람의 성실성에 기대는 구조라 반복된다.
 *
 * 왜 **타입**인가: 앞선 두 설계안은 권위를 "관찰"에서 구했다가 각각 반려됐다 — 소스 정규식은
 * `const id = 'D28'`을 못 뽑고, 런타임 관찰은 그 변형에서 발화하지 않는 검사를 못 본다. 관찰은
 * 관찰되지 않은 것을 놓친다. **타입 검사는 코드 경로가 아니라 코드 자체를 본다** — 표기와 발화
 * 조건 모두와 무관하게 등록부 등재를 강제한다.
 *
 * 🔴 등재 후에는 `docs-stale-claims.test.ts`가 **§3 표와의 일치**를 강제한다. 즉 새 검사를 넣으려면
 *    (1) 여기 등재하고 (2) 문서 표에 행을 추가해야 한다. 둘 중 하나만 하면 빌드·테스트가 막는다.
 *
 * ⚠️ 한계: `as CheckId`·`as Check`·`any` 단언은 타입 검사를 의도적으로 우회한다(설계 r03 관찰).
 *    현재 그런 사용은 0건이다. **새 D-체크를 넣으면서 단언으로 이 등록부를 피하지 말 것.**
 */
/**
 * D32 입력(REQ-2026-129, 순수 판정 결과). 네 경우를 **구분**한다 — "다르다"만 알려주면 손상과 legacy가
 * 같은 메시지를 받아 사용자가 무엇을 고쳐야 하는지 알 수 없다.
 */
export type PolicyDrift =
  | { kind: 'aligned'; effective: string }
  | { kind: 'legacy'; config: string }
  | { kind: 'corrupt'; raw: unknown; config: string }
  | { kind: 'drift'; effective: string; config: string }

/**
 * 안내 문구에 실을 티켓 id(순수). 🔴 `<REQ>` 자리표시자를 두지 않는다 — 사용자가 그대로 복사해
 * 실행할 수 있어야 한다(REQ-2026-072 "적용 가능한 안내" 원칙).
 */
export function ticketIdOf(ticketRel: string | undefined): string {
  // 경로를 모르면 자리표시자를 쓴다 — 없는 id를 지어내지 않는다.
  if (!ticketRel) return '<REQ>'
  return ticketRel.split('/').filter(Boolean).pop() ?? ticketRel
}

/** `(state, cfg.stopGate)` → D32 판정(순수). */
export function classifyPolicyDrift(state: { policy_snapshot?: unknown }, configStopGate: string): PolicyDrift {
  const snap = state.policy_snapshot
  if (!snap || typeof snap !== 'object') return { kind: 'legacy', config: configStopGate }
  const raw = (snap as { stop_gate?: unknown }).stop_gate
  if (!isStopGate(raw)) return { kind: 'corrupt', raw, config: configStopGate }
  return raw === configStopGate ? { kind: 'aligned', effective: raw } : { kind: 'drift', effective: raw, config: configStopGate }
}

export const D_CHECK_IDS = [
  'D2', 'D3', 'D5', 'D6', 'D9', 'D10', 'D11', 'D13', 'D15', 'D16', 'D17', 'D18', 'D19',
  'D20', 'D21', 'D22', 'D23', 'D24', 'D25', 'D26', 'D27', 'D28', 'D29', 'D30', 'D31', 'D32', 'D33',
] as const

/** D-체크 id — `D_CHECK_IDS` 등재분만. 새 id는 등록부에 먼저 추가해야 컴파일된다. */
export type CheckId = (typeof D_CHECK_IDS)[number]

export interface Check {
  id: CheckId
  level: Level
  msg: string
  /**
   * REQ-2026-129(0.22, 스키마 v2): 이 실행에서 검사가 **적용 가능**했는가. 미지정 = true.
   * false = "점검 불요/미계산/해당 없음" — 분모(적용 가능 티켓 수) 계산의 입력이다.
   * 🔴 msg 문자열 매칭으로 파생하지 않는다(관찰에서 권위를 구하지 않는다 — REQ-2026-099 교훈).
   */
  applicable?: boolean
  /**
   * REQ-2026-129: 비-OK 발화의 안정적 사유 코드(kebab-case). 미지정 시 로그가 `<id소문자>-<outcome>`
   * 폴백을 쓴다 — 한 검사에 원인이 여럿인 검사(D30 분류 등)만 명시하면 된다.
   */
  reason_code?: string
  /**
   * 발화 **대상의 기계 식별자**(REQ-2026-117 DEC-5) — 실행 로그(`.doctor-runs.jsonl`)에 실린다.
   * 🔴 저위험 식별자만: 티켓 id(`REQ-…`)·계약 파일명(`CONTRACT_FILE_RELS`). 워킹트리 경로·메시지
   *    본문은 넣지 않는다(REQ-2026-111의 프라이버시 결정 계승 — D10 등 경로 주체 검사는 의도적 제외).
   */
  subjects?: string[]
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface DoctorInputs {
  state: WorkflowState
  currentBranch: string
  branchExists: boolean
  // D11 feature-branch 게이트의 prefix(config). main이 cfg.branchPrefix 주입. 빈 prefix는 config 스키마가 금지(D11 무력화 방지).
  branchPrefix: string
  // D18 granularity 임계(config, advisory). 미지정 시 GRANULARITY_MAX_FILES(현재 동작). main이 cfg.granularityMaxFiles 주입.
  granularityMaxFiles?: number
  /**
   * 🔴 REQ-2026-107: 현재 phase의 `phases[].max_files` **선언**(없으면 null). `main()`이
   * `declaredPhaseMaxFiles(state, state.current_phase)`로 채운다.
   *
   * **optional인 이유와 undefined의 의미**(설계 r01 관찰): 기존 호출부(테스트 포함)를 깨지 않기 위해
   * optional이고, **`undefined`와 `null`은 같은 뜻 — "선언 없음" = config 기본 사용**이다. 즉 이 필드를
   * 주지 않는 호출자는 이 REQ 이전과 **동일하게** 판정된다(무회귀). `judgePhaseArea`의 계약이
   * `declared ?? configMax`이므로 `?? null`로 넘기면 그대로 성립한다.
   */
  /**
   * 🔴 REQ-2026-110(D28): HIGH 사람확인 게이트의 **판정 결과**. `main()`이 `userConfirmGate`(정본)를
   * 호출해 그대로 채운다.
   *
   * **왜 `stopGate`·`completesReq`를 각각 받지 않는가**: 그러면 `runChecks`(순수) 안에서 게이트를
   * 재조립해야 하고 그 조립이 곧 사본이다. REQ-2026-107이 고친 결함이 정확히 "정책이 옮겨갔는데
   * 사본이 남아 갈라진 것"이었다. **판정 결과만 받으면 이 함수는 표시만 하므로 갈라질 표면이 없다.**
   *
   * `undefined` = 판정 불요 → D28은 OK. 이 입력을 주지 않는 호출부는 무회귀다.
   */
  highConfirm?: { blocked: boolean; reason?: string }
  /**
   * D29(REQ-2026-112): 소비자 **계약 파일**(`AGENTS.md`·`AGENTS.commitgate.md`)에서 발견된
   * 폐기된 주장. `main()`이 `retiredClaimsIn`으로 계산해 채운다 — `runChecks`는 순수하다.
   *
   * `undefined` = 점검 불요(계약 파일이 없거나 읽지 못함) → D29는 OK. 진단이 사람을 막지 않는다.
   */
  retiredClaimHits?: { file: string; claim: RetiredClaim }[]
  /**
   * D30(REQ-2026-114): **리뷰를 받았는데 증거가 trunk에 없는 티켓**과 그 리뷰 횟수.
   * `main()`이 리뷰 호출 로그와 trunk 트리에서 계산해 채운다 — `runChecks`는 순수하다.
   *
   * `undefined` = 판정 불가(trunk ref 없음·로그 없음·git 실패) → D30은 OK.
   */
  strandedEvidence?: { id: string; reviews: number }[]
  /**
   * D31(REQ-2026-119): staged 경로의 민감 패턴 일치. `main()`이 `effectiveRiskHits`(staged 경로 ×
   * config `riskPaths` 또는 내장 기본)로 계산해 채운다 — `runChecks`는 순수하다.
   *
   * `undefined` = 점검 불요(staged 없음·감지 비활성 `[]`) → D31은 OK. **WARN 상한** — 어떤 경우에도
   * 커밋을 막지 않는다(관측 우선 — 강제는 발화 데이터 후 별도 REQ).
   */
  riskHits?: RiskHit[]
  /**
   * D32(REQ-2026-129): 티켓 정지 정책 스냅샷 ↔ `req.config.json` 대조 결과. `main()`이 채운다.
   * `undefined` = 미계산 → D32는 OK(점검 불요).
   */
  policyDrift?: PolicyDrift
  /**
   * D30 상태 분류(REQ-2026-117): `strandedEvidence`와 같은 티켓들의 분류 결과. `main()`이
   * `collectStrandedContext`+`classifyStranded`로 채운다. undefined면 분류 없는 단순 나열로 렌더링
   * (판정·level은 어느 쪽이든 동일 — 분류는 메시지 내용만 바꾼다).
   */
  strandedClassified?: ClassifiedStranded[]
  /** 원격 추적 ref의 마지막 커밋 시각. null = 원격 축 판정 불가("원격 추적 ref 없음" 표기). */
  remoteTrunkFreshness?: string | null
  declaredMaxFiles?: number | null
  /**
   * 🔴 REQ-2026-107: D18이 셀 **staged 코드 파일**(티켓 문서·scratch 제외). `main()`이
   * `phaseCodeFiles(staged, ticketRel)`(정본)로 채운다.
   *
   * **undefined면 D13의 `codeChanges`로 폴백**한다 — 이 필드를 주지 않는 기존 호출부의 판정을 바꾸지
   * 않기 위해서다. D13은 계속 `codeChanges`를 쓴다(다른 질문 — "설계 승인 없이 코드가 바뀌었나"에는
   * unstaged/untracked도 포함되어야 한다). 두 검사가 지표를 공유하던 것이 오히려 사고였다.
   */
  stagedCodeFiles?: string[]
  /** REQ-2026-086: granularity 강제 수준. D18 문구가 실제 동작과 어긋나지 않게 한다. 미지정 = DEFAULTS. */
  granularityGate?: GranularityGate
  stagedTree: string
  statusEntries: StatusEntry[]
  scratch: string[]
  responseVerdict: Verdict | null
  responseStructureOk: boolean
  // D13(design 선행 + freshness): 유효 승인 = designApproved && designApprovedHash === currentDesignHash.
  designApproved: boolean
  designApprovedHash: string | null
  currentDesignHash: string | null // 현재 00/01/02 index 재계산 해시(미추적 등 계산 불가 시 null → 승인 무효)
  ticketDocs: string[] // 현재 티켓 docs(00/01/02/codex-request)의 exact repo-rel 경로 — D13 코드/문서 분류용
  // A2(D-016-5/6): 승인 증거 아카이브 정본 검증(D16 phase·D17 design)용 입력. main()이 채움(미지정 시 legacy/2-arg 동작).
  ticketRel?: string // responses/ 스크래치 매처(D10)용
  approvalEvidenceRequired?: boolean // state.approval_evidence_required(신규 REQ면 FAIL, legacy면 WARN)
  approvalEvidence?: ApprovalEvidence | null // state.approval_evidence(phase)
  designApprovalEvidence?: ApprovalEvidence | null // state.design_approval_evidence(design)
  approvalArchive?: ArchiveCheck | null // approvalEvidence.response_path 온디스크 검사
  designArchive?: ArchiveCheck | null // designApprovalEvidence.response_path 온디스크 검사
  liveResponseSha256?: string | null // 현재 codex-response.json 바이트 sha — D16(phase) live↔evidence 일치(D-016-5). design 미사용.
  // B3: finalize(복구) 모드. D9 비교 대상을 staged tree → pending_evidence_for.source_commit_sha의 source 커밋 tree로 교체(우회 아님).
  finalize?: boolean
  finalizeSourceTree?: string | null // git rev-parse <pending.source_commit_sha>^{tree}
  /**
   * 🔴 REQ-2026-142 DEC-4: D10 이 통과시킬 **증거 복구 경로 목록**. `planEvidenceRecovery` 가 `Ready` 를
   *    낸 경우에만 채워진다. 그 밖에는 `undefined` 이고, 그때 D10 은 이 REQ 이전과 완전히 동일하다.
   */
  recoveryAllowlist?: readonly string[]
  /**
   * D19(REQ-2026-014): 대상 `package.json`의 `scripts` 맵. main()이 읽어 채운다(runChecks는 순수).
   *   - `undefined` = main()이 조회하지 않음(legacy/2-arg 호출) → OK '점검 불요'
   *   - `null`      = package.json 없음/파손 → OK '점검 불요'(읽기 전용 advisory라 FAIL 아님)
   *   - object      = 파싱된 scripts 맵
   * ⚠️ **optional이어야 한다** — required면 `tests/unit/req-doctor.test.ts`의 `const base: DoctorInputs = {…}`
   *    리터럴이 즉시 tsc 오류가 난다(기존 optional 필드 관례와 동일).
   */
  reqScripts?: Record<string, string> | null
  // D20(REQ-2026-038): vendored 자산 skew content-hash 검사. main()이 계산해 채운다(runChecks는 순수).
  //   - packagedSchemaSha : packageRoot()/workflow/machine.schema.json 의 sha256 (조회 불가 시 null)
  //   - vendoredSchemaSha : cfg.schemaPathAbs(소비 repo 사본)의 sha256 (조회 불가 시 null)
  //   - packageRootDiffers: packageRoot() !== cfg.root (dogfood/dev repo면 false → OK, D19 자기보호와 동일 취지)
  //   - schemaPathIsDefault: cfg.schemaPathAbs === resolve(cfg.root, DEFAULTS.schemaPath) (**정규화 절대경로** 비교 — 동치 상대경로 포함)
  //   - installedVersion  : packageRoot()/package.json 의 version (WARN 메시지용)
  // 미지정(undefined) = 계산 안 함(legacy/2-arg 호출) → OK '점검 불요'. optional이어야 테스트의 base 리터럴이 안 깨진다(reqScripts와 동일).
  packagedSchemaSha?: string | null
  vendoredSchemaSha?: string | null
  packageRootDiffers?: boolean
  schemaPathIsDefault?: boolean
  installedVersion?: string | null
  /**
   * D21: 백필이 필요한 always-loaded 파일과 사유(`bin/quickstart.quickstartBackfillTargets`).
   *
   * 🔴 REQ-2026-101: 이전에는 **부재만**(`quickstartMissing: string[]`) 봤다. 그래서 블록 내용을
   *    개정해도 이미 설치된 소비자는 신호를 못 받았다 — 갱신 기계는 있는데 탐지가 없었다.
   *    이제 `insert`(부재)와 `replace`(드리프트)를 구분해 받는다.
   *
   *   undefined = 미계산(2-arg/legacy)·판정 불가 → OK. [] = 전부 최신/대상없음 → OK. 비어있지 않음 → WARN.
   *   dev/dogfood(packageRootDiffers===false)면 D20처럼 skip. optional이어야 테스트 base 리터럴이 안 깨진다.
   */
  quickstartBackfill?: QuickstartBackfillTarget[]
  // D22(REQ-2026-047): repo-root 런타임 스크래치 경로 중 **ignore도 tracked도 아닌** 것(= 다음 review가 만들면 D10이 막는 것).
  //   런타임이 소비 repo 루트에 만드는 스크래치(현재 `workflow/.review-calls.jsonl`)는 티켓 밖이라 `/REQ-*/` 앵커에
  //   걸리지 않고 `reviewScratchPaths` 허용목록에도 없다 → **gitignore가 유일한 방어**다. 0.9.6 이하 설치본은 배포
  //   템플릿에 그 규칙이 없어, 첫 리뷰 뒤 D10 FAIL로 커밋이 전부 막혔다.
  //   undefined = 미계산(2-arg/legacy) → OK. [] = 전부 보호됨 → OK. 비어있지 않음 → WARN.
  //   dev/dogfood(packageRootDiffers===false)면 D20/D21처럼 skip. optional이어야 테스트 base 리터럴이 안 깨진다.
  repoRootScratchUnprotected?: string[]
  /**
   * D33(REQ-2026-161): 대상 repo `package.json`의 `scripts` 맵. **설치본의 `req:*` 명령 표면** 판정 입력.
   *
   * 🔴 읽기는 `lib/command-surface`의 `readPackageScripts` **하나**가 한다(설계 DEC-1) — `check` C6와
   *    같은 입력 획득이어야 두 표면이 같은 답을 낸다.
   * `undefined` = 미계산(2-arg/legacy) → 점검 불요. `null` = 읽지 못함(판정 불가) → 점검 불요.
   */
  packageScripts?: Record<string, unknown> | null
  /**
   * D24(REQ-2026-062): setup 완료 게이트 판정. `undefined` = 미계산(2-arg 경로).
   * 🔴 이 값이 무엇이든 **WARN 상한**이다 — 차단은 doctor가 아니라 워크플로 verb의 preflight가 한다.
   */
  setupGate?: GateVerdict
  /**
   * 🔴 **현재 티켓의 검증된 종결 이벤트**(REQ-2026-097 DEC-2). 브랜치 동일성 축(D2·D3·D11) 면제 입력.
   *
   *   - `undefined` = 미계산(legacy·2-arg 호출) → 현행 동작
   *   - `null`      = 계산했으나 종결 아님(`developing`·`needs-recovery`·`corrupt`·`legacy`) → 현행 동작
   *   - 이벤트 값    = 종결 → D2·D3·D11 면제 + 그 이벤트를 사유 문구에 쓴다
   *   - `'legacy'`  = **면제하지 않는다**(REQ-2026-102) → FAIL은 그대로 두되 **왜 면제 못 하는지**를 말한다.
   *                  durability marker가 없어 종결 검증이 불가능하고, 그 티켓은 여전히 리뷰·커밋으로
   *                  진행 가능하므로(intake-legacy ≠ review-legacy) 브랜치 축이 지킬 것이 남아 있다.
   *
   * 🔴 **boolean이 아닌 이유**: `runChecks`는 `DoctorInputs`만 보는 순수 함수라, boolean이면
   *    `abandoned`인지 `dev-complete`인지 몰라 면제 사유를 적을 수 없다(설계 r01 P1). 두 필드로 쪼개면
   *    `terminal=true & event=null` 같은 모순 조합이 타입으로 표현 가능해지므로 값 하나가 둘 다 나른다.
   */
  ticketTerminalEvent?: CloseProofEvent | 'legacy' | null
  /**
   * D25(REQ-2026-085): 종결됐지만 trunk에 도달하지 않은 티켓 id들. `undefined` = 판정 불가·미계산 → OK.
   * `[]` = 전부 반영됨 → OK. 비어있지 않음 → WARN(**절대 FAIL 아님**).
   */
  unmergedClosedTickets?: string[]
  /** D25 메시지에 쓰는 trunk 이름(`undefined`면 판정 불가라 메시지에 도달하지 않는다). */
  trunkBranch?: string | null
  /**
   * D26(REQ-2026-088): 낡은 design_ref에 묶인 phase의 **복구 안내 줄**(`recoveryGuidance` 산출 그대로).
   * `undefined` = 미계산 → OK. `[]` = 결속 온전 → OK. 비어있지 않음 → WARN(**절대 FAIL 아님**).
   * 🔴 여기서 판정하지 않는다 — main()이 intake와 같은 술어로 계산해 넣는다(재구현 금지, DEC-1).
   */
  staleBindingLines?: string[]
  /**
   * D27(REQ-2026-094): **소비된 승인인데 매니페스트 행이 없는** phase들. `undefined` = 미계산
   * (HEAD state 없음) → 점검 불요. 🔴 판정은 `lib/evidence`의 `consumedApprovalsWithoutRow`
   * **하나**가 한다 — doctor가 재구현하지 않는다.
   */
  consumedWithoutRow?: string[]
  // D23(REQ-2026-056): frozen-lockfile 위생. 감지된 PM의 lockfile이 없거나 untracked면 재현 가능한 설치
  //   (`<pm> ci`/`--frozen-lockfile`)가 불가하다. undefined = 미계산(2-arg/legacy) → OK.
  //   'no-package-json'/'ok' → OK. 'missing'/'untracked' → **WARN**(FAIL 아님 — D19~D22 근거 동일).
  //   optional이어야 테스트 base 리터럴이 안 깨진다.
  lockfileStatus?: 'ok' | 'missing' | 'untracked' | 'no-package-json'
}

/**
 * D9 검사(순수, 정상/finalize 공용). commit_allowed=true일 때 tree == approved_diff_hash.
 * - 정상(finalize=false): staged tree와 비교.
 * - finalize=true(B3 복구): **pending_evidence_for.source_commit_sha의 source 커밋 tree**와 비교 — source 재커밋 없이 evidence/consume만 복구.
 *   ⚠️ B3-P1: HEAD 커밋 tree가 아니라 **source 커밋 tree**(HEAD는 evidence 커밋일 수 있음). 우회가 아님 — 비교 대상만 교체, fail-closed(source tree 없거나 불일치 시 FAIL).
 */
export function finalizeD9Check(opts: {
  commitAllowed: boolean
  finalize: boolean
  approvedDiffHash: string | null
  stagedTree: string | null
  finalizeSourceTree: string | null
}): { ok: boolean; msg: string } {
  if (!opts.commitAllowed) return { ok: true, msg: 'commit_allowed=false(점검 불요)' }
  if (!opts.approvedDiffHash) return { ok: false, msg: 'commit_allowed=true인데 approved_diff_hash 없음' }
  if (opts.finalize) {
    const ok = opts.finalizeSourceTree !== null && opts.finalizeSourceTree === opts.approvedDiffHash
    return ok
      ? { ok: true, msg: 'finalize: source 커밋 tree == approved(복구 유효)' }
      : { ok: false, msg: `finalize: source 커밋 tree(${String(opts.finalizeSourceTree)}) != approved(${opts.approvedDiffHash}) — pending 마커 없음/불일치(정상 req:commit 사용)` }
  }
  const ok = opts.stagedTree === opts.approvedDiffHash
  return ok
    ? { ok: true, msg: 'staged tree == approved' }
    : { ok: false, msg: `staged tree(${String(opts.stagedTree)}) != approved(${opts.approvedDiffHash}) — stale 승인` }
}

/** Phase C granularity 정책: phase당 코드 변경 권고 상한(초과 시 D18 WARN — 분할 권고). FAIL 아님(advisory). */
export const GRANULARITY_MAX_FILES = 8

/**
 * Phase 분할 권고(순수, advisory). phase 1개의 코드 변경 파일 수가 maxFiles 초과면 WARN 메시지(빈 배열=권고 없음).
 *
 * ⚠️ **절대 FAIL 아님**(REQ-2026-086 DEC-5로 재확인). 차단은 `req:review-codex`의 phase preflight가
 * **리뷰 호출 전에** 한다 — 그 시점의 시정은 staging 재구성이라 싸다. 여기서 FAIL로 올리면 이미 Codex
 * 승인을 받은 phase가 커밋되지 못하고 승인도 소비되지 않는 **교착**이 된다(`req:commit`이 doctor를 하드
 * 게이트로 spawn한다). 그래서 이 자리는 끝까지 진단 표면으로 남는다.
 */
export function phaseGranularityWarnings(
  codeFiles: string[],
  maxFiles: number,
  gate: GranularityGate = DEFAULTS.granularityGate,
  /**
   * 🔴 REQ-2026-107: 이 phase가 선언한 상한(`phases[].max_files`, 없으면 null).
   * 판정은 `judgePhaseArea`(정본)가 하고 여기서는 **문구만** 만든다 — 두 표면(리뷰 preflight·D18)은
   * 사용자가 할 수 있는 조치가 달라 문구를 공유하면 한쪽에 거짓 안내가 된다.
   */
  declaredMaxFiles: number | null = null,
): string[] {
  // 🔴 판정을 여기서 다시 쓰지 않는다(REQ-2026-107). 이 REQ가 고친 결함이 정확히 "정책 SSOT가
  //    review-codex로 옮겨갔는데 여기 사본이 남아 선언을 무시한 것"이다.
  const v = judgePhaseArea(codeFiles.length, declaredMaxFiles, maxFiles)
  if (!v.over) return []
  // 🔴 문구는 **실제 설정에 종속**된다(phase-2 r01 P1). `granularityGate:"warn"`인 사용자에게
  //    "막힙니다"라고 하면 도구가 하지 않을 일을 약속하는 것이다 — 안내가 거짓이면 사람은 안내를 믿지 않게 된다.
  const tail =
    gate === 'block'
      ? '다음 phase 리뷰는 이 임계를 넘으면 실행 전에 막힙니다: staging을 줄이거나 state.json의 phases[]에 "max_files"를 선언하세요.'
      : 'granularityGate="warn"이라 리뷰는 그대로 진행됩니다 — 면적을 줄이면 리뷰 라운드가 줄어듭니다(실측: >8파일 평균 2.4R vs ≤8파일 1.4R).'
  // 🔴 임계의 **출처**를 드러낸다(REQ-2026-107 DEC-4) — 사용자가 자기 선언이 인정됐는지 출력에서
  //    바로 확인할 수 있어야 이런 오탐의 재발을 사람이 알아챈다.
  const limitLabel = v.source === 'declared' ? `선언한 상한 ${v.limit}` : `권고 ${v.limit}`
  return [`phase 코드 변경 ${v.count}파일 > ${limitLabel} — 리뷰 면적 큼(granularity 정책). ${tail}`]
}

/** 설치 모드(REQ-2026-014 D19 진단). `req:*` 스크립트 **값의 형태**로만 판정한다. */
export type InstallMode = 'stage-a' | 'stage-b' | 'mixed' | 'none' | 'custom'

/**
 * 진단 대상 `req:*` 키.
 *
 * 설치 축의 SSOT는 `bin/init.ts`의 `REQ_SCRIPTS`지만 여기서 import하지 않는다(아래 `classifyInstallMode` 주석 — 레이어 역전).
 * 키가 늘면 이 목록도 늘려야 한다. 드리프트가 나도 이 검사는 **advisory(WARN 상한)** 라 게이트를 깨지 않는다.
 */
const REQ_SCRIPT_KEYS = ['req:new', 'req:next', 'req:review-codex', 'req:doctor', 'req:commit'] as const

/** Stage A 형태: `tsx scripts/req/<file>.ts` (과거 vendored scaffold가 주입하던 모양). */
const STAGE_A_SCRIPT_RE = /^tsx\s+scripts\/req\/[A-Za-z0-9._-]+\.ts$/
/** Stage B 형태: `commitgate <verb>` (설치된 패키지 bin dispatch). */
const STAGE_B_SCRIPT_RE = /^commitgate\s+req:[A-Za-z0-9-]+$/

/**
 * 설치 모드 진단(REQ-2026-014 D19 — doctor D19, 순수).
 *
 * **`package.json`의 `req:*` 값 형태만** 본다. manifest·lockfile·node_modules·버전에 의존하지 않는다.
 *
 * ⚠️ **`bin/init.ts`를 import하지 않는다**(레이어 역전 방지). init.ts는 cross-spawn·semver·git spawn을 끌고 오는
 * ~1250줄 설치 CLI이고, 매 커밋 게이트로 도는 이 스크립트가 그것을 로드해선 안 된다. 그래서 바이트 일치(`REQ_SCRIPTS`)가
 * 아니라 **shape**로 판정한다 — 요구(R7)도 "script 형태를 기준으로"다.
 *
 * ⚠️ **migrate와의 비대칭은 의도적이다**: `bin/migrate.ts`의 전환은 **쓰기**라 `REQ_SCRIPTS` 바이트 정확 일치를
 * 요구한다(사용자 값을 덮지 않기 위해). 이 진단은 **읽기 전용 advisory**라 shape로 충분하다. 강도를 바꿔야 하는 쪽은 migrate다.
 *
 * @param scripts `package.json`의 `scripts` 맵. `undefined`/`null`이면 판정 불가 → 호출부가 '점검 불요'.
 */
export function classifyInstallMode(scripts: Record<string, string>): InstallMode {
  const values = REQ_SCRIPT_KEYS.map((k) => scripts[k]).filter((v): v is string => typeof v === 'string')
  if (values.length === 0) return 'none'
  const a = values.filter((v) => STAGE_A_SCRIPT_RE.test(v)).length
  const b = values.filter((v) => STAGE_B_SCRIPT_RE.test(v)).length
  if (a > 0 && b > 0) return 'mixed'
  if (a > 0 && a === values.length) return 'stage-a'
  if (b > 0 && b === values.length) return 'stage-b'
  // Stage A/B 형태가 하나도 없거나(전부 사용자 값), 일부만 kit 형태이고 나머지는 사용자 값.
  return 'custom'
}

/** 승인 증거 아카이브 파일의 온디스크 검사(main이 읽어 채움 — runChecks는 순수). */
export interface ArchiveCheck {
  exists: boolean
  sha256: string | null
  verdict: Verdict | null
  structureOk: boolean
}

// `isConfinedArchivePath`는 REQ-2026-048 phase-1에서 `lib/evidence.ts`로 이동했다 — 매니페스트 검증이
// 같은 술어를 쓰는데 여기 두면 `lib/evidence → req-doctor` 런타임 간선이 생겨 순환이 된다. 아래 re-export로
// 기존 import 경로(`from './req-doctor'`)를 보존한다.

/**
 * 승인 증거(evidence)와 그 아카이브 파일의 정합 문제 목록(순수, A2/D-016-5).
 * evidence 누락 → 단일 문제. 그 외: 경로 confinement·아카이브 존재·SHA·구조(AJV)·validateVerdict·review_kind·승인 status·바인딩 정합.
 * base-sha 검증은 **evidence 자신의 review_base_sha 기준**(design 승인 base는 고정 — 이후 phase의 state.review_base_sha 변동과 무관, 오탐 방지).
 */
function evidenceProblems(
  ev: ApprovalEvidence | null | undefined,
  archive: ArchiveCheck | null | undefined,
  kind: 'phase' | 'design',
  s: WorkflowState,
  ticketRel: string | undefined,
  liveResponseSha256?: string | null,
): string[] {
  const r: string[] = []
  if (!ev) return [`${kind} 승인 증거(evidence) 누락`]
  if (!isConfinedArchivePath(ev.response_path, ticketRel))
    r.push(`response_path가 현재 티켓 responses/ 직계 아카이브가 아님: ${ev.response_path}`)
  if (!archive || !archive.exists) {
    r.push(`아카이브 파일 없음: ${ev.response_path}`)
    return r
  }
  if (archive.sha256 !== ev.response_sha256) r.push(`아카이브 SHA 불일치(기대 ${ev.response_sha256})`)
  if (!archive.structureOk) r.push('아카이브 구조(AJV) 비적합')
  const v = archive.verdict
  if (!v) r.push('아카이브 verdict 파싱 불가')
  else {
    // base-sha 교차검증은 아래 evidence vs 아카이브 비교로 한다(state.review_base_sha 기준 금지 — design 오탐).
    const dom = validateVerdict(v)
    if (!dom.ok) r.push(...dom.errors)
    if (v.review_kind !== kind) r.push(`아카이브 review_kind 불일치(기대 ${kind}, 실제 ${String(v.review_kind)})`)
    if (v.commit_approved !== 'yes') r.push(`아카이브 commit_approved≠yes(${String(v.commit_approved)})`)
    if (v.status !== 'STEP_COMPLETE' && v.status !== 'COMPLETE') r.push(`아카이브 status 비승인(${String(v.status)})`)
    if (ev.review_base_sha !== v.review_base_sha) r.push('evidence review_base_sha != 아카이브 review_base_sha')
  }
  if (ev.review_kind !== kind) r.push(`evidence review_kind 불일치(${String(ev.review_kind)})`)
  if (kind === 'phase') {
    const approvedTree = typeof s.approved_diff_hash === 'string' ? s.approved_diff_hash : null
    if (!approvedTree || ev.approved_tree !== approvedTree) r.push('evidence approved_tree != state.approved_diff_hash')
    // phase evidence만 현재 state.review_base_sha와 일치 요구(design 고정 base는 비교 안 함).
    if (typeof s.review_base_sha === 'string' && ev.review_base_sha !== s.review_base_sha)
      r.push('evidence review_base_sha != state.review_base_sha')
    // D-016-5(A2-R3): live codex-response.json(있으면)은 pinned evidence와 동일 SHA여야 함 — D6가 phase 게이팅에 live 응답을 쓰므로.
    // (design은 미적용 — live 파일은 단일 캐시라 이후 phase 리뷰가 덮으면 phase 응답이 됨, D17은 archive SHA로만 검증.)
    if (typeof liveResponseSha256 === 'string' && liveResponseSha256 !== ev.response_sha256)
      r.push('live codex-response.json SHA != evidence response_sha256 (손편집 의심)')
  } else {
    const dh = typeof s.design_approved_hash === 'string' ? s.design_approved_hash : null
    if (!dh || ev.design_hash !== dh) r.push('evidence design_hash != state.design_approved_hash')
  }
  return r
}

// statusPaths는 lib/porcelain의 entryPaths로 대체(REQ-2026-012). `-z`가 rename의 src·dest를
// 필드로 확실히 주므로 ` -> ` 분할과 인용 해제가 필요 없다.

/**
 * D2·D3·D11 면제 여부(REQ-2026-102 DEC-3). **allow-list이며 exhaustive다.**
 *
 * 🔴 `v !== null && v !== 'legacy'`(deny-list)로 쓰면 **fail-open**이 된다 — 나중에 새 비면제 값
 *    (`'corrupt'` 등)을 타입에 추가하는 순간 그 값이 **조용히 면제 쪽으로 샌다.** 아래 `default`의
 *    `never` 대입이 그것을 **컴파일 시점에** 막는다(REQ-2026-099에서 D_CHECK_IDS로 얻은 교훈:
 *    권위는 관찰이 아니라 타입이 강제해야 한다).
 */
function isExemptTerminal(v: CloseProofEvent | 'legacy' | null): boolean {
  switch (v) {
    case null:
    case 'legacy': // 종결 검증 불가 + 여전히 진행 가능 → 면제하지 않는다
      return false
    case 'series-terminal':
    case 'dev-complete':
    case 'migrated-complete':
    case 'abandoned':
      return true
    default: {
      const exhaustive: never = v
      return Boolean(exhaustive) && false
    }
  }
}

/** 순수: 입력으로부터 1차 최소셋 점검 결과 산출(부수효과 없음 — 테스트 용이). */
export function runChecks(inp: DoctorInputs): Check[] {
  const c: Check[] = []
  const s = inp.state
  const branch = typeof s.branch === 'string' ? s.branch : ''
  const commitAllowed = s.commit_allowed === true

  /**
   * 🔴 브랜치 동일성 축 면제(REQ-2026-097). D2·D3·D11은 **진행 중** 티켓의 작업 위치를 강제하는
   *    규칙이다. 종결된 티켓에는 강제할 작업이 없는데, 병합 후 브랜치를 지우는 **권장 운영**을 하면
   *    셋 다 영구히 FAIL이 되어 `req:doctor`를 건강 점검으로 쓸 수 없었다(소비자 리포트: 종결 118건 전부).
   *    더 나쁜 것은 에이전트가 그 FAIL을 보고 **종결 티켓의 feature 브랜치를 되살리려 한다**는 점이다.
   *
   *    면제 근거는 `verifiedTerminalEvent` 기반의 **검증된** 종결이다(단순 파일 존재가 아니다) —
   *    위조 한 줄로 게이트가 풀리지 않는다. 워킹트리 축(D10·D13)은 종결과 독립이라 건드리지 않는다.
   */
  const terminal = inp.ticketTerminalEvent ?? null
  /**
   * 🔴 면제 축(REQ-2026-102 DEC-3). `'legacy'`는 값이 있지만 **면제하지 않는다** — 사유를 나를 뿐이다.
   *    이 상수가 예전 `terminal`의 자리를 그대로 대체하므로 **분기 구조와 면제 집합이 바뀌지 않는다.**
   */
  const exempt = isExemptTerminal(terminal)
  const terminalMsg = (what: string): string => `종결 티켓(${terminal}) — ${what} 점검 불요`
  /**
   * 🔴 legacy 티켓이 왜 면제되지 않는지(REQ-2026-102 DEC-4). 세 검사가 **같은 문장**을 공유한다
   *    — 세 번 적으면 갈라진다.
   *
   * 🔴 **마지막 문장이 load-bearing이다**: 없는 해결책을 암시하지 않는다(REQ-2026-094 교훈 —
   *    없는 명령을 안내하면 사용자를 막다른 길로 보낸다). 소비자가 정확히 이 지점에서 조치를
   *    찾다가 개선 요청을 썼다. 불친절해 보여도 "해소할 수단이 없다"가 사실이다.
   */
  const legacyNote =
    terminal === 'legacy'
      ? ' (legacy 티켓 — durability marker가 없어 종결을 검증할 수 없습니다.' +
        ' 아직 진행 중이면 자기 feature 브랜치에서 작업하세요.' +
        ' 이미 끝난 티켓이면 현재 이 FAIL을 해소할 수단이 없습니다.)'
      : ''

  // D2: state.branch == 현재 브랜치
  if (exempt) c.push({ id: 'D2', level: 'OK', msg: terminalMsg('브랜치 일치') })
  else if (branch && inp.currentBranch !== branch)
    c.push({ id: 'D2', level: 'FAIL', msg: `state.branch(${branch}) != current(${inp.currentBranch})${legacyNote}` })
  else c.push({ id: 'D2', level: 'OK', msg: 'branch 일치' })

  // D3: state.branch 로컬 존재
  if (exempt) c.push({ id: 'D3', level: 'OK', msg: terminalMsg('브랜치 존재') })
  else if (branch && !inp.branchExists) c.push({ id: 'D3', level: 'FAIL', msg: `state.branch 로컬에 없음: ${branch}${legacyNote}` })
  else c.push({ id: 'D3', level: 'OK', msg: 'branch 존재' })

  // D5: codex_thread_id 형식(설정 시 UUID)
  //
  // 🔴 **WARN 상한이다 — FAIL로 올리지 않는다**(REQ-2026-108). 세 가지가 함께 근거다:
  //
  //   1. **이 필드를 읽는 코드는 이 검사 자신뿐이다.** REQ-2026-013 P4가 재리뷰를 stateless로 고정하며
  //      소비 분기를 상수로 죽였고, REQ-2026-103이 그 죽은 배선을 제거했다. 지금은 기록 전용이다
  //      (승인 증거 스냅샷 `ApprovalEvidence.codex_thread_id`에 남는다 — 그래서 검사 자체는 유지한다).
  //   2. **FAIL은 곧 커밋 차단이다.** `req:commit`이 doctor를 하드 게이트로 spawn한다 — D19~D27이 전부
  //      WARN 상한인 바로 그 이유이며, D5만 그 원칙보다 먼저 만들어져 밖에 남아 있었다.
  //   3. **비대칭 비용.** 값의 출처는 codex CLI가 내는 `thread.started.thread_id`다. codex가 그 형식을
  //      UUID가 아닌 것으로 바꾸는 날 **전 소비자의 커밋이 동시에 막힌다** — 아무것도 읽지 않는 필드
  //      때문에. 같은 비대칭을 `assertReviewerReady`(review-codex)가 이미 반대 방향으로 판단해 두었다
  //      ("false block은 codex가 출력 문자열을 바꾼 날 모든 리뷰를 동시에 멈춘다").
  //
  // 판정 조건과 메시지 문자열은 **그대로**다(REQ-2026-108 DEC-1) — 바뀐 것은 심각도 하나뿐이다.
  const tid = s.codex_thread_id
  if (typeof tid === 'string' && tid.length > 0 && !UUID_RE.test(tid))
    c.push({ id: 'D5', level: 'WARN', msg: `codex_thread_id 형식 오류: ${tid}` })
  else c.push({ id: 'D5', level: 'OK', msg: 'thread_id 형식 OK(또는 미설정)' })

  // D6: commit_allowed=true → 온디스크 응답 재파싱·재검증 + **실제 승인 여부**·state 바인딩 정합(§9.6, DEC-WF-025).
  // 저장 플래그(commit_allowed)를 믿지 않고, 응답이 정말로 승인(commit_approved=yes·승인 status)했는지 + 바인딩 필드가 정합한지 재확인.
  if (commitAllowed) {
    const reasons: string[] = []
    const v = inp.responseVerdict
    if (!v) {
      reasons.push('codex-response.json 없음/파손')
    } else {
      if (!inp.responseStructureOk) reasons.push('구조(AJV) 비적합')
      const dom = validateVerdict(v, {
        reviewBaseSha: typeof s.review_base_sha === 'string' ? s.review_base_sha : undefined,
      })
      if (!dom.ok) reasons.push(...dom.errors)
      if (v.commit_approved !== 'yes') reasons.push(`응답 commit_approved≠yes(${String(v.commit_approved)})`)
      if (v.status !== 'STEP_COMPLETE' && v.status !== 'COMPLETE')
        reasons.push(`응답 status 비승인(${String(v.status)})`)
    }
    const baseSha = typeof s.review_base_sha === 'string' ? s.review_base_sha : ''
    const reviewTree = typeof s.review_diff_hash === 'string' ? s.review_diff_hash : ''
    const approvedTree = typeof s.approved_diff_hash === 'string' ? s.approved_diff_hash : ''
    if (!baseSha) reasons.push('state.review_base_sha 없음')
    if (!reviewTree) reasons.push('state.review_diff_hash 없음')
    if (!approvedTree) reasons.push('state.approved_diff_hash 없음')
    else if (reviewTree && approvedTree !== reviewTree) reasons.push('approved_diff_hash != review_diff_hash')

    if (reasons.length)
      c.push({ id: 'D6', level: 'FAIL', msg: `commit_allowed=true 재검증 실패: ${reasons.join('; ')}` })
    else c.push({ id: 'D6', level: 'OK', msg: '재검증 OK(승인 verdict + 바인딩 정합)' })
  } else c.push({ id: 'D6', level: 'OK', applicable: false, msg: 'commit_allowed=false(점검 불요)' })

  // D9: commit_allowed=true → tree == approved_diff_hash(§8.4). 정상=staged tree, **finalize(B3)=현재 HEAD 커밋 tree**.
  // finalize는 우회가 아니라 비교 **대상만** 교체(여전히 fail-closed) — source 재커밋 없이 evidence/consume만 복구.
  {
    const d9 = finalizeD9Check({
      commitAllowed,
      finalize: inp.finalize === true,
      approvedDiffHash: typeof s.approved_diff_hash === 'string' ? s.approved_diff_hash : null,
      stagedTree: inp.stagedTree,
      finalizeSourceTree: inp.finalizeSourceTree ?? null,
    })
    c.push({ id: 'D9', level: d9.ok ? 'OK' : 'FAIL', msg: d9.msg })
  }

  // D10: unstaged/untracked(비-스크래치) — review용 클린. A2: ticketRel 전달 시 responses/ untracked 아카이브만 스크래치 허용(tracked 변조·approvals.jsonl·타 티켓 flag).
  const dirty = findUnstagedOrUntracked(inp.statusEntries, inp.scratch, inp.ticketRel, inp.recoveryAllowlist)
  if (dirty.length)
    c.push({ id: 'D10', level: 'FAIL', msg: `unstaged/untracked 존재:\n  ${dirty.map(formatStatusEntry).join('\n  ')}` })
  else c.push({ id: 'D10', level: 'OK', msg: '워킹트리 클린(staged + 스크래치)' })

  // D11: main 또는 비-<branchPrefix>* 브랜치면 FAIL(DEC-WF-020). branchPrefix=config(기본 feat/req-).
  //
  // 🔴 REQ-2026-085 DEC-5b: 예전엔 `state.phase !== 'DONE' &&`가 앞에 붙어 있었다. 런타임은 `phase`에
  //    `'DONE'`을 **어디서도 쓰지 않으므로**(전수 확인) 그 조건은 정상 경로에서 늘 참이었다 — 아무 기능이 없었다.
  //    반면 runChecks는 **워킹 state.json**을 읽으므로, 손으로 `"phase": "DONE"`을 써 넣으면 main 위에서도
  //    D11이 통과했다. 즉 죽은 필드로 게이트가 열리는 위조 경로였다. 조건을 없애 그것만 닫는다
  //    (정상 경로 판정은 완전히 동일하다).
  //
  // 🔴 REQ-2026-097: 종결 티켓은 면제한다(위 `terminal` 주석). 이 면제는 커밋 경로를 열지 않는다 —
  //    실제 커밋 게이트는 `commit_allowed`(D6·D9·D16)이고 dev-complete 발행 시점에 소비된다.
  //    그 사실은 `req-doctor.test.ts`가 테스트로 고정한다(주장으로 두지 않는다).
  if (exempt) c.push({ id: 'D11', level: 'OK', msg: terminalMsg('feature 브랜치') })
  else if (inp.currentBranch === 'main' || !branch.startsWith(inp.branchPrefix))
    c.push({
      id: 'D11',
      level: 'FAIL',
      msg: `REQ 작업이 자기 feature 브랜치 밖(current=${inp.currentBranch}, state.branch=${branch || '(없음)'})${legacyNote}`,
    })
  else c.push({ id: 'D11', level: 'OK', msg: 'feature 브랜치 OK' })

  // D13: design 선행 게이트(DEC-WF-027). 유효 design 승인(freshness 포함) 없으면 비-티켓 코드 변경 금지.
  // 유효 승인 = design_approved=true AND design_approved_hash === 현재 00/01/02 index 재계산 해시(불일치=승인 후 설계 변경→무효).
  // 코드 변경 = statusLines(staged/unstaged/untracked)의 경로 중 **티켓 docs/scratch 외**(exact 매칭 — 다른 REQ·.bak·src 모두 코드).
  const validDesign =
    inp.designApproved === true &&
    typeof inp.designApprovedHash === 'string' &&
    inp.designApprovedHash.length > 0 &&
    inp.designApprovedHash === inp.currentDesignHash
  // A2(A2-R2-P2-1): 허용된 untracked 응답 아카이브(D10 scratch)는 D13 코드변경 분류에서도 제외 — D10/D13 scratch 정책 일치.
  // (tracked evidence 변조·approvals.jsonl·타 티켓·collapsed dir은 isAllowedResponsesScratch=false라 제외되지 않음 → D10/D13 모두 FAIL 유지.)
  const responsesScratch = inp.ticketRel
    ? inp.statusEntries.filter((e) => isAllowedResponsesScratch(e, inp.ticketRel as string)).flatMap(entryPaths)
    : []
  const allowD13 = new Set([...inp.ticketDocs, ...inp.scratch, ...responsesScratch].map((p) => p.replace(/\\/g, '/')))
  const codeChanges = [...new Set(inp.statusEntries.flatMap(entryPaths).filter((p) => p !== '' && !allowD13.has(p)))]
  if (!validDesign && codeChanges.length)
    c.push({
      id: 'D13',
      level: 'FAIL',
      msg: `유효 design 승인 없이 비-티켓 코드 변경 존재(설계 선행 위반): ${codeChanges.join(', ')}`,
    })
  else
    c.push({
      id: 'D13',
      level: 'OK',
      msg: validDesign ? 'design 승인 유효(freshness OK) — 코드 변경 허용' : '비-티켓 코드 변경 없음',
    })

  // D18(Phase C, granularity 정책): phase 코드 변경 파일 수가 임계 초과면 분할 권고. **advisory WARN — 절대 FAIL 아님**.
  // 임계 = config(cfg.granularityMaxFiles) 주입, 미지정 시 GRANULARITY_MAX_FILES(현재 동작).
  // 🔴 REQ-2026-107: 임계는 **선언 우선**(phases[].max_files), 대상은 **staged 코드 파일**.
  //    둘 다 리뷰 preflight(review-codex)와 같은 정본을 쓴다 — 이전에는 선언을 무시하고
  //    D13의 codeChanges(unstaged/untracked 포함)를 세어, 선언으로 리뷰를 정당하게 통과한 phase에도
  //    "8파일 초과" WARN을 냈다(소비자 5개 티켓에서 실발화).
  {
    const maxFiles = inp.granularityMaxFiles ?? GRANULARITY_MAX_FILES
    const declared = inp.declaredMaxFiles ?? null
    // undefined면 기존 동작 보존(D13 지표로 폴백) — 이 입력을 주지 않는 호출부는 무회귀.
    const files = inp.stagedCodeFiles ?? codeChanges
    const adv = phaseGranularityWarnings(files, maxFiles, inp.granularityGate ?? DEFAULTS.granularityGate, declared)
    if (adv.length) c.push({ id: 'D18', level: 'WARN', msg: adv.join(' / ') })
    else {
      const limitLabel = declared === null ? `권고 ${maxFiles}` : `선언한 상한 ${declared}`
      c.push({ id: 'D18', level: 'OK', msg: `granularity OK(코드 변경 ${files.length}파일 ≤ ${limitLabel})` })
    }
  }

  /**
   * D15: 온디스크 응답이 `NEEDS_FIX`면 `findings`·`next_action`이 actionable해야 한다.
   *
   * 🔴 **중복이 아니다 — 커밋 직전에 이 조합을 막는 유일한 검사다**(REQ-2026-115에서 정정).
   *
   * | 방어선 | 이 조합을 막는가 | 언제 |
   * |---|---|---|
   * | `machine.schema.json` | ❌ `findings`에 `minItems` 없음 · `next_action`은 `{"type":"string"}`뿐 | — |
   * | `validateVerdict`(review-codex) | ✅ | **리뷰 시점** |
   * | doctor의 `validateResponseStructure` | ❌ **스키마** 검증이라 위 한계를 그대로 물려받는다 | 커밋 직전 |
   * | **D15** | ✅ | **커밋 직전** |
   *
   * 즉 `codex-response.json`이 리뷰 이후 손상되거나 손으로 편집되면 **여기서만 잡힌다.**
   * 이 주장은 `req-doctor.test.ts`가 오라클로 고정한다(스키마 통과 ↔ D15 FAIL 대비) —
   * 스키마에 제약이 추가되는 날 그 테스트가 실패하며 이 표가 낡았다고 알려준다.
   *
   * typeof 가드: 파손된 `next_action`(비-문자열)이 `.trim()`에서 throw하지 않게(fail-closed).
   */
  const rv = inp.responseVerdict
  if (rv && rv.status === 'NEEDS_FIX') {
    const findingsOk = Array.isArray(rv.findings) && rv.findings.length > 0
    const nextOk = typeof rv.next_action === 'string' && rv.next_action.trim().length > 0
    if (!findingsOk || !nextOk)
      c.push({
        id: 'D15',
        level: 'FAIL',
        msg: `NEEDS_FIX 응답인데 actionable 아님(findings ${findingsOk ? 'OK' : '없음'}, next_action ${nextOk ? 'OK' : '공백'})`,
      })
    else c.push({ id: 'D15', level: 'OK', msg: 'NEEDS_FIX 응답 actionable(findings + next_action)' })
  } else c.push({ id: 'D15', level: 'OK', applicable: false, msg: 'NEEDS_FIX 응답 아님(점검 불요)' })

  // D16(A2/D-016-5): phase 승인 증거 아카이브 정본 검증. commit_allowed=true일 때만.
  // 신규 REQ(approval_evidence_required)면 누락/불일치 FAIL, legacy면 (증거 없음=OK / 증거 있는데 불일치=WARN). 기존 D6/D9 대체 아님(추가 게이트).
  if (commitAllowed) {
    const required = inp.approvalEvidenceRequired === true
    if (!required && !inp.approvalEvidence) {
      c.push({ id: 'D16', level: 'OK', applicable: false, msg: 'legacy(증거 미요구) — 점검 불요' })
    } else {
      const problems = evidenceProblems(inp.approvalEvidence, inp.approvalArchive, 'phase', s, inp.ticketRel, inp.liveResponseSha256)
      if (problems.length === 0) c.push({ id: 'D16', level: 'OK', msg: 'phase 승인 증거 아카이브 정합' })
      else if (required) c.push({ id: 'D16', level: 'FAIL', msg: `phase 승인 증거 검증 실패: ${problems.join('; ')}` })
      else c.push({ id: 'D16', level: 'WARN', msg: `phase 승인 증거 미정합(legacy): ${problems.join('; ')}` })
    }
  } else c.push({ id: 'D16', level: 'OK', applicable: false, msg: 'commit_allowed=false(점검 불요)' })

  // D17(A2/D-016-5·6): design 승인 증거 아카이브 정본 검증. design_approved=true일 때만(D13 freshness와 별개의 증거 게이트).
  if (inp.designApproved === true) {
    const required = inp.approvalEvidenceRequired === true
    if (!required && !inp.designApprovalEvidence) {
      c.push({ id: 'D17', level: 'OK', applicable: false, msg: 'legacy(증거 미요구) — 점검 불요' })
    } else {
      const problems = evidenceProblems(inp.designApprovalEvidence, inp.designArchive, 'design', s, inp.ticketRel)
      if (problems.length === 0) c.push({ id: 'D17', level: 'OK', msg: 'design 승인 증거 아카이브 정합' })
      else if (required) c.push({ id: 'D17', level: 'FAIL', msg: `design 승인 증거 검증 실패: ${problems.join('; ')}` })
      else c.push({ id: 'D17', level: 'WARN', msg: `design 승인 증거 미정합(legacy): ${problems.join('; ')}` })
    }
  } else c.push({ id: 'D17', level: 'OK', applicable: false, msg: 'design_approved=false(점검 불요)' })

  // D19(REQ-2026-014): 설치 모드 진단 — `req:*` 값의 **형태**만 본다(manifest·lockfile·node_modules 미사용).
  //
  // 🔴 **level 상한은 WARN — 절대 FAIL이 아니다.** CommitGate 자신의 package.json이 Stage A 형태이고(개발 repo가
  //    자기 스크립트를 직접 실행하므로 정상), `req:commit`이 이 doctor를 exit≠0에 throw하는 하드 게이트로 spawn한다.
  //    FAIL이면 **이 저장소 자신의 커밋과 정당한 Stage A 소비자 전원의 커밋이 영구 차단**된다.
  //    Stage A는 결함이 아니라 지원되는 설치 형태다 → mixed만 WARN한다.
  if (inp.reqScripts === undefined || inp.reqScripts === null) {
    c.push({ id: 'D19', level: 'OK', applicable: false, msg: 'package.json scripts 미조회/없음(점검 불요)' })
  } else {
    const mode = classifyInstallMode(inp.reqScripts)
    if (mode === 'mixed')
      c.push({
        id: 'D19',
        level: 'WARN',
        msg: 'req:* 스크립트에 Stage A(tsx scripts/req/*.ts)와 Stage B(commitgate <verb>) 형태가 섞여 있습니다 — `commitgate migrate` 로 전환하세요(형태 기준 진단)',
      })
    else c.push({ id: 'D19', level: 'OK', msg: `설치 모드: ${INSTALL_MODE_LABEL[mode]}(req:* 스크립트 형태 기준)` })
  }

  // D20(REQ-2026-038): vendored machine.schema.json 자산 skew(content-hash) 진단.
  //
  // 🔴 **level 상한은 WARN — 절대 FAIL이 아니다**(D19 :406-411과 동일 근거). `req:commit`이 이 doctor를 exit≠0에
  //    throw하는 하드 게이트로 spawn하므로, FAIL이면 skew난 소비자의 모든 커밋이 `commitgate sync` 전까지 벽돌이 된다.
  //    확인된 피해는 데이터 손실이 아니라 **조용한 기능 상실**(stale 스키마가 full_review_requested를 제거해 delta 리뷰
  //    full-review 에스컬레이션이 죽음) → WARN이 정확한 강도.
  // 🔴 **content-hash 비교**(버전 비교 아님): machine_schema_version이 minor 간 불변일 수 있어(0.7.0/0.8.1 둘 다 "1.1")
  //    버전으로는 이 skew를 못 잡는다. sha256(shipped) vs sha256(vendored)만 잡는다.
  // 결정표(D19의 undefined→OK 선례): dev repo/dogfood·custom schemaPath·조회 불가·동일 → OK. 상이 → WARN.
  if (inp.packageRootDiffers === false) {
    c.push({ id: 'D20', level: 'OK', applicable: false, msg: '자산 skew 점검 불요(dev repo/dogfood — packageRoot === config root)' })
  } else if (inp.schemaPathIsDefault === false) {
    c.push({ id: 'D20', level: 'OK', applicable: false, msg: 'custom schemaPath(kit 관리 자산 아님 — unmanaged, 점검 불요)' })
  } else if (!inp.packagedSchemaSha || !inp.vendoredSchemaSha) {
    c.push({ id: 'D20', level: 'OK', applicable: false, msg: '자산 skew 점검 불요(shipped/vendored 스키마 조회 불가 — Stage A/미설치/2-arg)' })
  } else if (inp.packagedSchemaSha === inp.vendoredSchemaSha) {
    c.push({ id: 'D20', level: 'OK', msg: 'vendored machine.schema.json 동기화됨(shipped와 동일)' })
  } else {
    const ver = inp.installedVersion ? `commitgate ${inp.installedVersion}` : '설치된 commitgate'
    c.push({
      id: 'D20',
      level: 'WARN',
      msg: `vendored workflow/machine.schema.json 이 ${ver} 사본과 불일치(stale) — \`commitgate sync --apply\` 로 재동기화하세요. stale 스키마는 신규 필드(full_review_requested)를 조용히 제거해 design delta 리뷰의 full-review 에스컬레이션을 비활성화합니다(content-hash 감지).`,
    })
  }

  // D21(REQ-2026-040): 기존 CLAUDE.md/AGENTS.md에 Quick Start 블록 부재 진단. **WARN — 절대 FAIL 아님**
  // (D20과 동일 근거: req:commit이 이 doctor를 하드 게이트로 spawn하므로 FAIL이면 커밋이 벽돌이 된다).
  // seed-once라 REQ-2026-039 이전 설치본/기존 파일엔 신규 블록이 닿지 않는다 — 백필 필요를 알릴 뿐 막지 않는다.
  if (inp.packageRootDiffers === false) {
    c.push({ id: 'D21', level: 'OK', applicable: false, msg: 'Quick Start 백필 점검 불요(dev repo/dogfood — packageRoot === config root)' })
  } else if (inp.quickstartBackfill === undefined) {
    // 판정 불가(shipped 블록 조회 실패·2-arg/미계산) → 조용히 통과(REQ-2026-101 DEC-7).
    // D19 `undefined→OK`·D20 "조회 불가→OK"·D24 "미계산→OK"와 같은 선례다.
    c.push({ id: 'D21', level: 'OK', applicable: false, msg: 'Quick Start 백필 점검 불요(2-arg/미계산·shipped 블록 조회 불가)' })
  } else if (inp.quickstartBackfill.length === 0) {
    c.push({ id: 'D21', level: 'OK', applicable: false, msg: '기존 always-loaded 파일의 commitgate 관리 블록이 설치된 버전과 일치(또는 대상 없음)' })
  } else {
    // 🔴 REQ-2026-101 DEC-2: 부재와 드리프트는 사용자에게 **다른 사건**이다. 한 줄에 뭉치면
    //    무엇을 해야 하는지도, 무엇을 잃는지도 알 수 없다. 드리프트에는 덮어쓰기 경고가 붙는다.
    // 🔴 REQ-2026-136: **블록 단위**로 말한다. 파일만 나열하면 "Quick Start 가 없습니다"라고 단정하는데,
    //    실제로는 Quick Start 가 최신이고 계약 블록만 없을 수 있다 — 사용자가 틀린 작업을 안내받는다.
    const label = (t: { rel: string; blockId: string | null }): string => (t.blockId ? `${t.rel}(${t.blockId})` : t.rel)
    const missing = inp.quickstartBackfill.filter((t) => t.action === 'insert').map(label)
    const stale = inp.quickstartBackfill.filter((t) => t.action === 'replace').map(label)
    /**
     * 🔴 REQ-2026-136 DEC-5: 도구가 **고칠 수 없는** 두 사유를 따로 말한다. `--apply`로 해소되지 않는데
     *    같은 문장에 뭉치면 사용자는 명령을 반복 실행하며 왜 안 되는지 모른다.
     */
    const unsafe = inp.quickstartBackfill.filter((t) => t.action === 'unsafe')
    const unmanaged = inp.quickstartBackfill.filter((t) => t.action === 'unmanaged')
    const parts: string[] = []
    if (missing.length) parts.push(`${missing.join(', ')} 에 commitgate 관리 블록이 없습니다(seed-once라 신규 블록이 기존 파일엔 자동으로 닿지 않습니다 — REQ-2026-040·136).`)
    if (stale.length)
      parts.push(
        `${stale.join(', ')} 의 관리 블록이 설치된 commitgate와 다릅니다(드리프트) — 갱신하면 최신 워크플로·계약 규칙이 반영됩니다. ` +
          `⚠️ 마커(\`<!-- commitgate:<id> -->\`) **안쪽을 직접 수정했다면 그 수정은 덮어써집니다** — 마커 안은 도구 관리 영역입니다.`,
      )
    // 🔴 해소 명령은 "고칠 수 있는" 사유가 있을 때만 붙인다 — 없으면 실행해도 아무 일이 없다.
    if (parts.length) parts.push('`commitgate quickstart --apply` 로 해소하세요.')
    for (const t of unsafe)
      parts.push(`🔴 ${t.rel} 의 관리 마커가 손상돼 도구가 **자동으로 고치지 않습니다**: ${t.reason ?? ''}`)
    for (const t of unmanaged)
      parts.push(`🔴 ${t.rel} 는 CommitGate 계약으로 인식되지 않아 **미접촉**입니다: ${t.reason ?? ''}`)
    c.push({ id: 'D21', level: 'WARN', msg: parts.join(' ') })
  }

  // D22(REQ-2026-047): repo-root 런타임 스크래치가 ignore도 tracked도 아님 → 다음 review 뒤 D10이 커밋을 막는다.
  //
  // 🔴 **level 상한은 WARN — 절대 FAIL이 아니다**(D19:425-428·D20:443-447·D21과 동일 근거). `req:commit`이 이 doctor를
  //    exit≠0에 throw하는 하드 게이트로 spawn하므로, FAIL이면 백필 전까지 소비자의 모든 커밋이 벽돌이 된다.
  //    더구나 이 드리프트는 **이미** D10 FAIL로 발현한다 — 신규 진단이 차단을 만드는 것이 아니라, 불투명한
  //    `D10: unstaged/untracked workflow/.review-calls.jsonl`을 **행동 가능한 안내로 번역**하는 것이 역할이다.
  //
  // tracked인 경우는 여기서 경고하지 않는다(이미 커밋된 상태 = 다른 문제). 그 복구는 `git rm --cached` 절차로
  //    troubleshooting 문서가 다룬다 — ignore 규칙만 넣어서는 tracked 파일이 빠지지 않기 때문이다.
  if (inp.packageRootDiffers === false) {
    c.push({ id: 'D22', level: 'OK', applicable: false, msg: 'repo-root 스크래치 보호 점검 불요(dev repo/dogfood — packageRoot === config root)' })
  } else if (inp.repoRootScratchUnprotected === undefined) {
    c.push({ id: 'D22', level: 'OK', applicable: false, msg: 'repo-root 스크래치 보호 점검 불요(2-arg/미계산)' })
  } else if (inp.repoRootScratchUnprotected.length === 0) {
    c.push({ id: 'D22', level: 'OK', msg: 'repo-root 런타임 스크래치가 모두 ignore(또는 tracked)됨' })
  } else {
    c.push({
      id: 'D22',
      level: 'WARN',
      reason_code: 'unprotected-scratch',
      msg:
        `${inp.repoRootScratchUnprotected.join(', ')} 이(가) gitignore로 무시되지 않습니다 — ` +
        '다음 review가 이 파일을 만들면 **D10이 FAIL하여 커밋이 막힙니다**. ' +
        '`commitgate sync --gitignore --apply` 로 배포 템플릿의 누락 규칙을 보강하세요(기존 행은 변경하지 않습니다, REQ-2026-047).',
    })
  }

  /**
   * D33(REQ-2026-161): **설치본의 `req:*` 명령 표면**이 설치된 패키지의 verb 표면보다 좁은가.
   *
   * 🔴 **D19와 다른 질문이다.** D19는 설치 *모드*(Stage A/B/mixed)를 5개 표본 키의 **값 형태**로 판정하고,
   *    부재 키는 `filter(isString)`에서 조용히 떨어진다 — 그래서 `req:delegate`가 없어도 `OK Stage B`다.
   *    그 판정은 옳다. 한 체크에 두 질문을 섞으면 **한쪽 답이 다른 쪽을 가린다**(지금 그렇게 가려졌다).
   *
   * 🔴 **level 상한은 WARN**(D19~D23과 동일 근거). `req:commit`이 doctor를 하드 게이트로 spawn하므로
   *    FAIL이면 스크립트 하나가 없는 설치본의 **모든 커밋이 벽돌**이 된다.
   *
   * 🔴 실측이 이 검사의 존재 이유다: 0.23.1 설치본에서 `req:next`가 `pnpm req:delegate ...`를 안내했는데
   *    그 스크립트가 없어 실행이 실패했고, `check`·`doctor`·`sync` 어디도 그 사실을 말하지 않았다.
   */
  if (inp.packageRootDiffers === false) {
    c.push({ id: 'D33', level: 'OK', applicable: false, msg: 'req:* 명령 표면 점검 불요(dev repo/dogfood — packageRoot === config root)' })
  } else if (inp.packageScripts === undefined) {
    c.push({ id: 'D33', level: 'OK', applicable: false, msg: 'req:* 명령 표면 점검 불요(2-arg/미계산)' })
  } else if (inp.packageScripts === null) {
    // 🔴 읽지 못한 것을 "부족"으로 읽지 않는다 — C6와 같은 규율.
    c.push({ id: 'D33', level: 'OK', applicable: false, msg: 'req:* 명령 표면 점검 불요(package.json 의 scripts 를 읽지 못함)' })
  } else {
    const missing = missingReqScripts(inp.packageScripts)
    if (missing.length === 0) c.push({ id: 'D33', level: 'OK', msg: commandSurfaceMessage(missing) })
    else c.push({ id: 'D33', level: 'WARN', reason_code: 'command-surface-skew', msg: commandSurfaceMessage(missing) })
  }

  // D23(REQ-2026-056): frozen-lockfile 위생 진단.
  //
  // 🔴 **level 상한은 WARN — 절대 FAIL이 아니다**(D19~D22와 동일 근거). `req:commit`이 doctor를 하드 게이트로
  //    spawn하므로 FAIL이면 lockfile 없는 프로젝트의 모든 커밋이 벽돌이 된다. lockfile ↔ package.json 동기
  //    여부는 검사하지 않는다(PM 실행 없이 신뢰 불가) — 존재·tracked 위생만.
  if (inp.lockfileStatus === undefined || inp.lockfileStatus === 'ok') {
    c.push({ id: 'D23', level: 'OK', applicable: false, msg: inp.lockfileStatus === undefined ? 'lockfile 위생 점검 불요(미계산)' : 'lockfile 존재·git-tracked — 재현 가능한 설치(--frozen-lockfile) 가능' })
  } else if (inp.lockfileStatus === 'no-package-json') {
    c.push({ id: 'D23', level: 'OK', applicable: false, msg: 'lockfile 위생 점검 불요(package.json 없음)' })
  } else {
    c.push({
      id: 'D23',
      level: 'WARN',
      msg:
        inp.lockfileStatus === 'missing'
          ? '감지된 패키지 매니저의 lockfile이 없습니다 — 재현 가능한 설치(`<pm> ci` / `--frozen-lockfile`)가 불가합니다. lockfile을 생성·커밋하세요.'
          : 'lockfile이 git-tracked가 아닙니다(untracked) — 재현 가능한 설치가 불가합니다. lockfile을 커밋하세요.',
    })
  }

  // D24(REQ-2026-062): setup 완료 게이트 진단.
  //
  // 🔴 **level 상한은 WARN — 절대 FAIL이 아니다**(D19~D23과 동일 근거). `req:commit`이 doctor를 하드 게이트로
  //    spawn하므로 FAIL이면 마커 없는 기존 설치본의 **모든 커밋이 벽돌**이 된다. 차단이 필요한 지점은
  //    워크플로 verb의 preflight(`assertSetupComplete`)이고, 여기는 **그 사실을 보이게 하는 역할**만 한다.
  //    실제로 grandfather 통과한 설치본은 막히지 않으므로, 이 WARN은 "언젠가 setup을 하라"는 안내다.
  if (inp.setupGate === undefined) {
    c.push({ id: 'D24', level: 'OK', applicable: false, msg: 'setup 완료 점검 불요(2-arg/미계산)' })
  } else if (inp.setupGate.kind === 'pass' && inp.setupGate.reason === 'marker') {
    c.push({ id: 'D24', level: 'OK', msg: `setup 완료 기록 있음 (${inp.setupGate.evidence.join(' · ')})` })
  } else if (inp.setupGate.kind === 'pass') {
    c.push({
      id: 'D24',
      level: 'WARN',
      msg:
        `setup 완료 기록이 없지만 기존 설치본으로 판정되어 통과했습니다(grandfathered) — ` +
        `${inp.setupGate.evidence.join(' · ')}. 사용자에게 \`npx commitgate setup\` 실행을 요청하면 리뷰 모델·추론강도와 codex 로그인이 확정됩니다(대화형 전용).`,
    })
  } else {
    c.push({
      id: 'D24',
      level: 'WARN',
      msg:
        `setup 완료 기록이 없습니다(${inp.setupGate.evidence.join(' · ')}) — 워크플로 명령(\`req:new\` 등)이 차단됩니다. ` +
        '사용자에게 `npx commitgate setup` 실행을 요청하세요(대화형 전용이라 에이전트는 실행하지 않습니다).',
    })
  }

  // D25(REQ-2026-085): **종결됐지만 trunk에 도달하지 않은 티켓** 누적 경고.
  //
  // 🔴 **level 상한은 WARN — 어떤 입력에서도 FAIL이 아니다**(DEC-4). 병합 시점은 `stopGate`가 정하고
  //    사람이 실행한다. 이 검사는 *알림*이지 게이트가 아니다.
  // 🔴 판정 불가(trunk ref 없음·미계산·비활성)는 **조용히 통과**한다(DEC-2). trunk 이름이 다른 repo에
  //    매번 빨간 줄을 내면 사람이 doctor 출력 전체를 무시하게 되고, 그러면 진짜 FAIL까지 죽는다.
  if (inp.unmergedClosedTickets === undefined) {
    c.push({ id: 'D25', level: 'OK', applicable: false, msg: '미병합 누적 점검 불요(미계산·trunk 없음·비활성)' })
  } else if (inp.unmergedClosedTickets.length === 0) {
    c.push({ id: 'D25', level: 'OK', msg: `종결 티켓이 모두 trunk(${inp.trunkBranch ?? '-'})에 반영됨` })
  } else {
    c.push({
      id: 'D25',
      level: 'WARN',
      msg:
        `종결됐지만 trunk(${inp.trunkBranch ?? '-'})에 없는 티켓 ${inp.unmergedClosedTickets.length}건: ` +
        `${inp.unmergedClosedTickets.join(', ')} — 쌓일수록 브랜치가 서로의 조상이 되어 **순서를 바꿔 병합하거나 되돌릴 수 없게** 됩니다. 통합하거나 정리하세요.`,
      subjects: [...inp.unmergedClosedTickets],
    })
  }

  // D26(REQ-2026-088): 설계 재승인으로 **앞선 phase의 결속이 끊긴** 상태 사전 안내.
  //
  // 🔴 **level 상한은 WARN — 어떤 입력에서도 FAIL이 아니다**(DEC-4). `req:commit`이 doctor를 하드 게이트로
  //    spawn하므로 FAIL이면 **재결속에 필요한 남은 phase를 커밋조차 못 하는 교착**이 된다(재결속하려면
  //    티켓을 끝내야 하는데 끝낼 수가 없다). 진행 중 결속이 끊긴 것 자체는 오류가 아니다 — 마지막에 해소하면 된다.
  if (inp.staleBindingLines === undefined) {
    c.push({ id: 'D26', level: 'OK', applicable: false, msg: 'design 결속 점검 불요(미계산·매니페스트 없음)' })
  } else if (inp.staleBindingLines.length === 0) {
    c.push({ id: 'D26', level: 'OK', msg: '모든 phase 증거가 현재 design 승인에 결속됨' })
  } else {
    c.push({ id: 'D26', level: 'WARN', msg: inp.staleBindingLines.join('\n   ') })
  }

  // D27(REQ-2026-094): 승인 증인 불일치 — "승인이 있었다는 HEAD 증거는 있는데 매니페스트 행이 없다".
  //
  // 🔴 **WARN이 상한이다**(DEC-2). doctor는 `req:commit`이 하드 게이트로 spawn하므로 FAIL이면
  //    이 검사가 오작동할 때 **건강한 저장소를 새로 브릭**한다. 이 상태의 티켓은 이미 막혀 있으므로
  //    FAIL이 얻는 것은 없고 잃을 것만 있다(D20·D24와 같은 태도, REQ-2026-084 block→warn 정정 이력).
  // 🔴 진단은 **다음 행동까지** 말한다 — 그러지 않으면 리포트가 지적한 막다른 길이 그대로 남는다.
  // 🔴 **경고 신호는 "소비됐는데 행이 없다" 하나뿐**이다(DEC-1a). 미소비 승인 핀은 `req:confirm`
  //    체크포인트가 만드는 정상 상태와 구별할 수 없어 신호로 쓰지 않는다.
  //
  // 🔴 **WARN이 상한이다**(DEC-2). doctor는 `req:commit`이 하드 게이트로 spawn하므로 FAIL이면
  //    이 검사가 오작동할 때 **건강한 저장소를 새로 브릭**한다. 이 상태의 티켓은 이미 막혀 있으므로
  //    FAIL이 얻는 것은 없고 잃을 것만 있다(D20·D24와 같은 태도).
  //
  // 🔴 안내는 **정직해야 한다**(DEC-3). 유실된 승인 기록은 **복구할 수 없다** — 승인 핀은 소비와 함께
  //    지워지므로 `approved_at` 등을 되살릴 방법이 없고, 지어내면 그것이 곧 승인 날조다.
  //    그래서 복원 명령을 안내하지 않고 **실제로 가능한 두 경로**만 말한다.
  const cw = inp.consumedWithoutRow ?? []
  if (inp.consumedWithoutRow === undefined || cw.length === 0) {
    c.push({ id: 'D27', level: 'OK', applicable: false, msg: '승인 증인 일치(소비된 승인 중 매니페스트에 빠진 것 없음)' })
  } else {
    const id = String(inp.state.id ?? '<REQ>').replace(/^REQ-/, '')
    c.push({
      id: 'D27',
      level: 'WARN',
      msg: [
        '🔴 소비된 승인인데 매니페스트에 행이 없습니다 — 증거가 유실됐고 이 상태로는 티켓을 종결할 수 없습니다.',
        `해당 phase: ${cw.join(', ')}`,
        '🔴 이 기록은 복구할 수 없습니다 — 승인 핀(approved_at·response_sha256 …)은 소비와 함께 지워지므로',
        '   되살릴 근거가 없습니다. 값을 지어내는 복원은 제공하지 않습니다.',
        '가능한 경로는 둘입니다.',
        '  1) 그 phase를 게이트를 통해 **다시 수행**한다 — 진짜 증거가 새로 생깁니다.',
        `  2) 끝낼 수 없으면 종결한다: npx commitgate req:close ${id} --abandon --reason "${PLACEHOLDER_REASON}" --confirm "${PLACEHOLDER_APPROVAL_ANGLED}" --run (따옴표 안은 자리표시자다 — 실제 값으로 바꿔서 실행한다)`,
      ].join('\n   '),
    })
  }

  /**
   * D28: HIGH 사람확인 게이트가 커밋을 막을 상태인가(REQ-2026-110).
   *
   * **왜 필요했나**: `req:commit`의 차단 게이트 중 **이것 하나만** doctor에 대응이 없었다. HIGH 티켓에서
   * 확인 기록이 없거나 scope가 어긋나면 `req:doctor`는 PASS인데 `req:commit`이 실패했다 — 사용자는
   * 커밋을 실행해봐야 이유를 알았다. 원장 실측상 티켓 시간의 86~91%가 "상태 파악과 조치" 구간이다.
   *
   * 🔴 **WARN 상한 — FAIL 분기를 만들지 않는다.** D19~D27과 같은 근거(커밋이 doctor를 하드 게이트로
   *    spawn한다)에 더해, 여기엔 하나가 더 있다: **이 검사가 FAIL이면 같은 조건을 두 곳에서 막는다.**
   *    doctor의 판정이 커밋 게이트와 조금이라도 어긋나는 순간 커밋이 **doctor 때문에** 막힌다 —
   *    진단이 게이트가 되면 진단의 오차가 곧 차단이 된다. 실제 차단은 계속 `userConfirmGate`가 한다.
   *
   * 🔴 **사유를 재작성하지 않는다.** `userConfirmGate`가 조치 명령까지 담은 문자열을 이미 만든다.
   *    두 표면이 다른 문구를 내면 "어느 쪽이 맞나"를 사람이 판단해야 하고, 그 순간 진단은 시간을
   *    아껴주는 대신 쓴다.
   */
  if (inp.highConfirm?.blocked)
    c.push({
      id: 'D28',
      level: 'WARN',
      msg: `이 상태로는 req:commit이 막힙니다(HIGH 사람확인). ${inp.highConfirm.reason ?? ''}`.trim(),
    })
  else
    c.push({
      id: 'D28',
      level: 'OK', applicable: false,
      msg:
        inp.highConfirm === undefined
          ? 'HIGH 확인 점검 불요(판정 입력 없음)'
          : 'HIGH 확인 충족(또는 해당 없음) — 이 축으로는 커밋이 막히지 않습니다',
    })

  /**
   * D29(REQ-2026-112): 계약 파일에 남은 **폐기된 주장**.
   *
   * 🔴 **WARN 전용이다.** FAIL로 올리면 업그레이드 즉시 기설치 소비자의 커밋이 **서술 문제로** 막힌다.
   * 🔴 **파일을 고치지 않는다.** `AGENTS.md`는 사용자 소유다(`init`도 부재 시에만 만든다) — 알리기만 한다.
   * 🔴 **사유를 재작성하지 않는다**(D28과 같은 원칙). 등재 정본의 `why`를 그대로 쓴다 —
   *    두 표면이 다른 말을 하면 어느 쪽이 맞는지 사람이 판단해야 한다.
   */
  if (inp.retiredClaimHits === undefined)
    c.push({ id: 'D29', level: 'OK', applicable: false, msg: '계약 파일 폐기 서술 점검 불요(대상 파일 없음·미계산)' })
  else if (inp.retiredClaimHits.length === 0)
    c.push({ id: 'D29', level: 'OK', msg: '계약 파일에 폐기된 서술 없음' })
  else
    c.push({
      id: 'D29',
      level: 'WARN',
      msg:
        '계약 파일에 더 이상 사실이 아닌 서술이 있습니다 — ' +
        inp.retiredClaimHits.map((h) => `${h.file}: "${h.claim.text}"(${h.claim.why})`).join(' / ') +
        '. 해당 문장을 지우거나 현재 동작으로 갱신하세요(도구는 이 파일을 고치지 않습니다).',
      subjects: [...new Set(inp.retiredClaimHits.map((h) => h.file))],
    })

  /**
   * D30(REQ-2026-114): 리뷰를 받았는데 그 증거가 trunk에 없는 티켓.
   *
   * 🔴 **WARN 전용이다.** 진행 중 티켓이 **정상적으로** 포함된다 — FAIL이면 평범한 작업이 막힌다.
   * 🔴 **"유실됐다"고 단정하지 않는다.** 사실만 말한다: 리뷰 N회를 받았고 증거가 trunk에 없다.
   *    판단(계속할지·버릴지)은 사람이 한다.
   * 🔴 판정 불가는 **조용히 통과**한다(D25와 같은 근거) — 오탐이 잦으면 사람이 doctor 출력
   *    전체를 무시하게 되고, 그러면 진짜 FAIL까지 죽는다.
   */
  if (inp.strandedEvidence === undefined)
    c.push({ id: 'D30', level: 'OK', applicable: false, msg: '미병합 리뷰 증거 점검 불요(trunk 없음·로그 없음·미계산)' })
  else if (inp.strandedEvidence.length === 0)
    c.push({ id: 'D30', level: 'OK', msg: `리뷰 증거가 모두 trunk(${inp.trunkBranch ?? '-'})에 반영됨` })
  else if (inp.strandedClassified === undefined)
    c.push({
      id: 'D30',
      level: 'WARN',
      msg:
        `리뷰 증거가 trunk(${inp.trunkBranch ?? '-'})에 없는 티켓 ${inp.strandedEvidence.length}건 — ` +
        inp.strandedEvidence.map((s) => `${s.id}(리뷰 ${s.reviews}회)`).join(' · ') +
        '. 진행 중이면 정상입니다. 병합되지 않으면 이 증거는 메인라인에 남지 않습니다(감사 추적은 브랜치-지역적).',
      subjects: inp.strandedEvidence.map((s) => s.id),
    })
  else {
    /**
     * 분류 렌더링(REQ-2026-117 DEC-4): **조치 대상을 앞세운다** — stranded → branch-alive → remote-trunk.
     * level은 WARN 그대로다: 전부 branch-alive여도 강등하지 않는다(실측된 유실 2건이 정확히
     * branch-alive였다 — 침묵 강등은 그 실신호를 지운다).
     */
    const groups = {
      stranded: inp.strandedClassified.filter((t) => t.category === 'stranded'),
      branch: inp.strandedClassified.filter((t) => t.category === 'branch-alive'),
      remote: inp.strandedClassified.filter((t) => t.category === 'remote-trunk'),
    }
    const parts: string[] = []
    if (groups.stranded.length > 0)
      parts.push(`조치 대상 ${groups.stranded.length}건: ${groups.stranded.map(renderStrandedTicket).join(' · ')}`)
    if (groups.branch.length > 0)
      parts.push(
        `미병합 브랜치에 있음(진행 중이면 정상 — 병합하면 해소) ${groups.branch.length}건: ` +
          groups.branch.map(renderStrandedTicket).join(' · '),
      )
    if (groups.remote.length > 0)
      parts.push(
        `로컬 ${inp.trunkBranch ?? '-'}가 원격 추적 ref(마지막 커밋 ${inp.remoteTrunkFreshness ?? '시각 미상'}·fetch 안 함)보다 뒤처짐 — pull로 해소 ${groups.remote.length}건: ` +
          groups.remote.map(renderStrandedTicket).join(' · '),
      )
    const remoteAxisNote =
      inp.remoteTrunkFreshness === null ? ' (원격 추적 ref 없음 — 원격 존재 여부는 판정하지 않음)' : ''
    c.push({
      id: 'D30',
      level: 'WARN',
      msg:
        `리뷰 증거가 trunk(${inp.trunkBranch ?? '-'})에 없는 티켓 ${inp.strandedEvidence.length}건 — ` +
        parts.join(' / ') +
        remoteAxisNote +
        '. 병합되지 않으면 이 증거는 메인라인에 남지 않습니다(감사 추적은 브랜치-지역적).',
      subjects: inp.strandedEvidence.map((s) => s.id),
    })
  }

  /**
   * D31(REQ-2026-119): phase 실효 위험 — staged 경로의 민감 패턴 일치를 **알린다**(WARN 상한).
   *
   * 🔴 티켓 위험도(`state.risk_level`)는 생성 시 입력값이고, phase가 실제로 무엇을 건드리는지는
   *    아무 표면도 보지 않았다 — LOW 티켓의 phase가 결제 웹훅을 수정해도 조용했다. 이 검사는 그
   *    간극을 표시한다. **강제하지 않는다** — 확인 강제는 발화율 데이터가 쌓인 뒤 별도 REQ의
   *    결정이다(0.13.0 block→warn 정정·REQ-2026-066 "조건은 실제 데이터로 측정" 선례).
   * 🔴 subjects를 내지 않는다 — 경로는 실행 로그의 저위험 식별자 허용 목록 밖이다(REQ-2026-117 DEC-5).
   */
  if (inp.riskHits === undefined)
    c.push({ id: 'D31', level: 'OK', applicable: false, msg: '실효 위험 점검 불요(staged 없음·감지 비활성·미계산)' })
  else if (inp.riskHits.length === 0)
    c.push({ id: 'D31', level: 'OK', msg: 'staged 변경에 민감 경로 패턴 일치 없음' })
  else
    c.push({
      id: 'D31',
      level: 'WARN',
      msg:
        `staged 변경이 민감 경로 패턴 ${inp.riskHits.length}종에 일치 — ` +
        inp.riskHits.map((h) => `${h.pattern}(${h.count}건: ${h.samples.join(', ')})`).join(' · ') +
        `. 티켓 위험도(${String((inp.state as { risk_level?: unknown }).risk_level ?? '미상')})와 별개로 이 phase의 실효 위험을 확인하세요 — 민감 변경이면 리뷰·사람 검토를 여기에 집중하십시오.`,
    })

  /**
   * D32(REQ-2026-129 DEC-4): **정지 정책 드리프트**. 티켓에 고정된 스냅샷과 현재 `req.config.json`이 다르면
   * 알린다.
   *
   * 🔴 **FAIL이 아니다.** 정책을 바꾼 것은 정당한 행위이고, 여기서 막으면 진행 중 티켓이 전부 교착한다.
   *    게이트는 이미 스냅샷을 쓰므로 **판정은 일관**하다 — 사용자에게 필요한 것은 차단이 아니라
   *    "이 티켓은 config와 다른 정책으로 돈다"는 **가시성**과 채택 명령이다.
   * 🔴 손상 스냅샷도 여기서 말한다. `effectiveStopGate`가 조용히 config로 폴백하므로, 그 사실을
   *    아무도 말하지 않으면 사용자는 자기가 적은 값이 쓰이는 줄 안다.
   */
  if (inp.policyDrift === undefined) c.push({ id: 'D32', level: 'OK', applicable: false, msg: '정지 정책 드리프트 점검 불요(미계산)' })
  else if (inp.policyDrift.kind === 'aligned')
    c.push({ id: 'D32', level: 'OK', msg: `정지 정책 일치(stopGate="${inp.policyDrift.effective}")` })
  else if (inp.policyDrift.kind === 'legacy')
    c.push({ id: 'D32', level: 'OK', msg: `정지 정책 스냅샷 없음(legacy 티켓) — req.config.json("${inp.policyDrift.config}")을 따릅니다` })
  else if (inp.policyDrift.kind === 'corrupt')
    c.push({
      id: 'D32',
      level: 'WARN',
      msg:
        `정지 정책 스냅샷이 손상됐습니다(policy_snapshot.stop_gate=${JSON.stringify(inp.policyDrift.raw)}) — ` +
        `req.config.json("${inp.policyDrift.config}")을 대신 씁니다. 고정하려면: npx commitgate req:repolicy ${ticketIdOf(inp.ticketRel)} --run`,
    })
  else
    c.push({
      id: 'D32',
      level: 'WARN',
      msg:
        `이 티켓은 정책 "${inp.policyDrift.effective}" 로 고정돼 있고 req.config.json 은 "${inp.policyDrift.config}" 입니다 — ` +
        `게이트는 티켓 값을 씁니다(한 티켓이 두 정책으로 판정되지 않도록). 새 값을 채택하려면: npx commitgate req:repolicy ${ticketIdOf(inp.ticketRel)} --run`,
    })

  return c
}

/**
 * D25 판정(REQ-2026-085 DEC-1·3, 순수).
 *
 * **왜 브랜치가 아니라 커밋된 close proof를 보는가**(R2): 병합 후 브랜치를 지우는 것이 정상 운영이다.
 * 브랜치 존재로 판정하면 정리를 잘한 repo가 계속 경고를 받는다. close proof는 **커밋된 증거**라
 * 병합되면 trunk 트리에 반드시 있다.
 *
 * **왜 대상 티켓을 빼는가**(DEC-3): doctor는 티켓 하나를 대상으로 돈다. 방금 종결된 그 티켓이 아직
 * trunk에 없는 것은 정상이다. 그것까지 세면 모든 REQ의 마지막 doctor가 WARN을 낸다.
 *
 * @param closedTicketIds 워킹트리에 close proof가 있는(= 도구가 "끝났다"고 판정한) 티켓 id
 * @param trunkPaths      trunk 트리의 파일 경로 집합(`git ls-tree -r --name-only <trunk> -- <ticketRoot>`)
 * @param ticketRoot      티켓 루트(repo-상대)
 * @param selfTicketId    지금 doctor가 도는 대상 티켓(제외)
 */
/**
 * 리뷰 호출 로그에서 **티켓별 리뷰 횟수**를 읽는다(REQ-2026-114).
 *
 * 🔴 **fail-open이다.** 파일이 없거나 읽지 못하면 `null`(판정 불가)을 낸다 — D30은 그때 조용히
 *    통과한다. 손상된 줄은 **건너뛴다**(전체를 버리지 않는다): append-only 로그의 마지막 줄이
 *    잘리는 것은 흔한 사고이고, 그 하나 때문에 나머지 관측을 버릴 이유가 없다.
 *    로그 자체가 게이트가 아니므로 여기서 fail-closed로 갈 근거도 없다.
 *
 * 🔴 **그러나 "아무것도 못 읽음"과 "읽었는데 비어 있음"은 구별한다**(phase-1 리뷰 r01 의견).
 *    비어 있지 않은 줄이 하나라도 있는데 **전부 파싱에 실패하면** `null`이다 — 그때 빈 Map을 내면
 *    D30이 "리뷰 증거가 모두 trunk에 반영됨"이라고 **모르는 것을 단언**하게 된다.
 *    빈 파일(줄이 아예 없음)은 정상적인 "아직 리뷰 없음"이므로 빈 Map이 맞다.
 */
export function readReviewCallCounts(absPath: string): Map<string, number> | null {
  const stats = readReviewCallStats(absPath)
  if (stats === null) return null
  return new Map([...stats.entries()].map(([id, s]) => [id, s.count]))
}

/**
 * 티켓별 리뷰 호출 **횟수 + 마지막 시각**(REQ-2026-117 DEC-3). 파싱 규칙은 `readReviewCallCounts`와
 * 동일하며 counts는 이 함수의 파생이다(계약 이원화 방지). 시각 키는 리뷰 호출 로그의 실제 키인
 * **`timestamp`**다(REQ-2026-025가 정의 — `at`이 아니다). 키가 없거나 파싱 불가한 행은 count에만
 * 기여한다 — 그 티켓의 `lastAt`은 다른 유효 시각이 없으면 null로 남는다.
 */
export function readReviewCallStats(absPath: string): Map<string, { count: number; lastAt: string | null }> | null {
  let raw: string
  try {
    raw = readFileSync(absPath, 'utf8')
  } catch {
    return null // 파일 없음·권한 없음 → 판정 불가
  }
  const stats = new Map<string, { count: number; lastAt: string | null }>()
  let seen = 0
  let parsed = 0
  for (const line of raw.split('\n')) {
    const t = line.trim()
    if (t === '') continue
    seen++
    try {
      const row = JSON.parse(t) as { ticket_id?: unknown; timestamp?: unknown }
      parsed++
      const id = row.ticket_id
      if (typeof id !== 'string' || id === '') continue
      const prev = stats.get(id) ?? { count: 0, lastAt: null }
      const at = typeof row.timestamp === 'string' && !Number.isNaN(Date.parse(row.timestamp)) ? row.timestamp : null
      stats.set(id, {
        count: prev.count + 1,
        lastAt: at !== null && (prev.lastAt === null || at > prev.lastAt) ? at : prev.lastAt,
      })
    } catch {
      // 손상된 줄 하나는 건너뛴다 — 나머지 관측은 유효하다.
    }
  }
  if (seen > 0 && parsed === 0) return null // 통째로 손상 → 판정 불가(빈 결과로 단언하지 않는다)
  return stats
}

/**
 * **리뷰를 받았는데 증거가 trunk에 없는 티켓**(REQ-2026-114, 순수).
 *
 * 🔴 **왜 close proof가 아니라 리뷰 로그인가**: D25 계열은 워킹트리의 close proof를 찾는데,
 *    실측된 유실 티켓(`REQ-2026-025`·`009`·`062`)은 **종결된 적이 없어** close proof가 어느
 *    브랜치에도 없다. 찾을 것이 없으므로 그 신호로는 원리적으로 잡을 수 없다.
 *    리뷰 호출 로그는 gitignored·워킹디렉터리 상주라 브랜치와 함께 사라지지 않는다.
 *
 * 🔴 **"유실됐다"고 단정하지 않는다.** 진행 중 티켓이 정상적으로 포함된다 — 그래서 **리뷰 횟수**를
 *    함께 낸다(기간 임계로 거르지 않는다: 근거 없는 임의 임계를 넣지 않는다).
 *    8회 받고 trunk에 없는 것과 오늘 1회 받은 것은 사람이 즉시 구별한다.
 *
 * 자기 티켓은 제외한다(D25 선례) — 작업 중 티켓이 매번 걸리면 안내가 죽는다.
 */
export function strandedReviewedTickets(
  reviewCounts: ReadonlyMap<string, number>,
  trunkPaths: ReadonlySet<string>,
  ticketRoot: string,
  selfTicketId: string,
): { id: string; reviews: number }[] {
  const root = toPosix(ticketRoot).replace(/\/+$/, '')
  const inTrunk = new Set<string>()
  for (const p of trunkPaths) {
    const m = new RegExp(`^${root}/([^/]+)/responses/`).exec(p)
    if (m?.[1]) inTrunk.add(m[1])
  }
  return [...reviewCounts.entries()]
    .filter(([id]) => id !== selfTicketId && !inTrunk.has(id))
    .map(([id, reviews]) => ({ id, reviews }))
    .sort((a, b) => (b.reviews - a.reviews) || a.id.localeCompare(b.id))
}

// ───────────────────────────── D30 상태 분류(REQ-2026-117) — 순수 ──

export type StrandedCategory = 'remote-trunk' | 'branch-alive' | 'stranded'

export interface ClassifiedStranded {
  id: string
  reviews: number
  category: StrandedCategory
  /** 마지막 리뷰 이후 경과일(내림). null = 시각 미기록 — 렌더링이 "마지막 리뷰 시각 미기록"으로 표기(생략 금지 — 설계 r02 P1). */
  ageDays: number | null
}

/**
 * branch-alive 일치(설계 DEC-1·r01 P1): 브랜치명 소문자에 **전체 티켓 id 소문자**가 **비영숫자 경계**로
 * 나타날 때만 참 — 앞 문자가 영숫자가 아니고 뒤 문자가 숫자가 아니어야 한다.
 * 숫자부만 일치(`fix/2026-009-x`)·접두 관계(`req-2026-0091`)는 불일치다 — 관련 없는 브랜치가
 * 실제 조치 대상을 가리는 false-positive를 막는다.
 */
export function ticketIdInBranchNames(ticketId: string, branchNames: readonly string[]): boolean {
  const needle = ticketId.toLowerCase()
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`(^|[^a-z0-9])${escaped}([^0-9]|$)`)
  return branchNames.some((b) => re.test(b.toLowerCase()))
}

/**
 * 미도달 티켓 분류(설계 DEC-1, 순수). 우선순위 `remote-trunk` → `branch-alive` → `stranded`:
 * 원격 메인라인 트리의 증거 실재는 **결정적 사실**(pull로 해소)이고, 브랜치명 일치는 휴리스틱이라 뒤다.
 * 임계값 판정은 하지 않는다 — 연령(`ageDays`)은 표시용이고 판단은 사람이 한다(D30 기존 원칙).
 */
export function classifyStranded(input: {
  stranded: readonly { id: string; reviews: number }[]
  /** 원격 추적 ref 트리에 responses/가 있는 티켓 집합. null = 그 축 판정 불가(원격 ref 없음 등). */
  remoteTrunkTickets: ReadonlySet<string> | null
  localBranches: readonly string[]
  lastReviewAt: ReadonlyMap<string, string>
  nowIso: string
}): ClassifiedStranded[] {
  const nowMs = Date.parse(input.nowIso)
  return input.stranded.map(({ id, reviews }) => {
    const lastAt = input.lastReviewAt.get(id)
    const lastMs = lastAt !== undefined ? Date.parse(lastAt) : Number.NaN
    const ageDays =
      Number.isNaN(nowMs) || Number.isNaN(lastMs) ? null : Math.max(0, Math.floor((nowMs - lastMs) / 86_400_000))
    const category: StrandedCategory =
      input.remoteTrunkTickets?.has(id) === true
        ? 'remote-trunk'
        : ticketIdInBranchNames(id, input.localBranches)
          ? 'branch-alive'
          : 'stranded'
    return { id, reviews, category, ageDays }
  })
}

/** `REQ-x(리뷰 n회·마지막 리뷰 N일 전)` — 세 범주 공통 표기(설계 r01 P1: 연령은 범주와 무관). */
export function renderStrandedTicket(t: ClassifiedStranded): string {
  const age = t.ageDays === null ? '마지막 리뷰 시각 미기록' : `마지막 리뷰 ${t.ageDays}일 전`
  return `${t.id}(리뷰 ${t.reviews}회·${age})`
}

export interface StrandedContext {
  /** 원격 추적 ref 트리의 responses/ 보유 티켓. null = 축 판정 불가. */
  remoteTrunkTickets: Set<string> | null
  /** 원격 추적 ref의 마지막 커밋 시각(%cI). 축 판정 불가면 null. */
  remoteFreshness: string | null
  localBranches: string[]
}

/**
 * D30 분류 입력 수집(설계 DEC-2). 🔴 **fetch·네트워크 호출을 하지 않는다** — 이미 존재하는
 * remote-tracking ref만 읽는다(git 호출 최대 4회: rev-parse·ls-tree·log·branch). upstream 미설정·
 * ref 부재는 그 축의 판정 불가(null)로 남고 나머지 분류는 계속된다.
 */
export function collectStrandedContext(
  gitExec: (args: string[]) => string,
  trunkBranch: string,
  ticketRoot: string,
): StrandedContext {
  let remoteTrunkTickets: Set<string> | null = null
  let remoteFreshness: string | null = null
  try {
    const upstream = gitExec(['rev-parse', '--abbrev-ref', `${trunkBranch}@{upstream}`]).trim()
    const root = toPosix(ticketRoot).replace(/\/+$/, '')
    const re = new RegExp(`^${root}/([^/]+)/responses/`)
    const set = new Set<string>()
    for (const p of gitExec(['ls-tree', '-r', '--name-only', upstream, '--', ticketRoot]).split('\n')) {
      const m = re.exec(p.trim())
      if (m?.[1]) set.add(m[1])
    }
    remoteTrunkTickets = set
    remoteFreshness = gitExec(['log', '-1', '--format=%cI', upstream]).trim() || null
  } catch {
    remoteTrunkTickets = null // upstream 미설정·ref 없음 — 모르는 것을 단언하지 않는다.
    remoteFreshness = null
  }
  let localBranches: string[] = []
  try {
    localBranches = gitExec(['branch', '--list', '--format=%(refname:short)'])
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
  } catch {
    localBranches = [] // 브랜치 목록 실패 → branch-alive 축만 침묵(stranded로 보수적 분류).
  }
  return { remoteTrunkTickets, remoteFreshness, localBranches }
}

export function unmergedClosedTickets(
  closedTicketIds: readonly string[],
  trunkPaths: ReadonlySet<string>,
  ticketRoot: string,
  selfTicketId: string,
): string[] {
  const root = toPosix(ticketRoot).replace(/\/+$/, '')
  return closedTicketIds
    .filter((id) => id !== selfTicketId)
    .filter((id) => !trunkPaths.has(`${root}/${id}/responses/${CLOSE_PROOF_BASENAME}`))
    .sort()
}

/** Windows 경로 구분자를 POSIX로. `setup-gate`는 repo-상대 경로를 `/` 기준으로 받는다. */
function toPosix(p: string): string {
  return p.split('\\').join('/')
}

/** D19 메시지용 라벨. */
const INSTALL_MODE_LABEL: Record<InstallMode, string> = {
  'stage-a': 'Stage A(vendored — scripts/req/** 를 직접 실행)',
  'stage-b': 'Stage B(런타임 패키지 — commitgate <verb> dispatch)',
  mixed: 'mixed',
  none: 'req:* 스크립트 없음',
  custom: '사용자 정의 req:* 값(kit 형태 아님)',
}

// ──────────────────────────────────────────────────────────────── CLI ──

export interface DoctorArgs {
  ticket: string | null
  reqId: string | null
  finalize: boolean
  root: string | null
}

/** CLI 파싱(fail-closed). `--ticket`·`--finalize`(B3)·`--root <dir>`(config 탐색 루트). 알 수 없는 옵션·`--root` 값 누락은 throw. */
export function parseArgs(argv: string[]): DoctorArgs {
  let ticket: string | null = null
  let reqId: string | null = null
  let finalize = false
  let root: string | null = null
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === undefined) continue
    // bare `--`는 POSIX end-of-options 마커(DEC-011-3). pnpm/yarn은 이를 스크립트에 그대로 넘긴다.
    if (a === '--') continue
    else if (a === '--ticket') ticket = argv[++i] ?? null
    else if (a === '--finalize') finalize = true // B3: D9를 finalize(source tree) 모드로
    else if (a === '--root') {
      const v = argv[++i]
      if (v === undefined) throw new Error('--root 값 필요')
      root = v
    } else if (a.startsWith('-')) throw new Error(`알 수 없는 옵션: ${a}`)
    else reqId = a
  }
  return { ticket, reqId, finalize, root }
}

/**
 * D19(REQ-2026-014): 대상 `package.json`의 `scripts` 맵을 읽는다. 없거나 파손이면 `null`(→ D19는 '점검 불요' OK).
 *
 * **읽기 전용 advisory이므로 throw하지 않는다** — package.json이 깨졌다는 사실은 다른 게이트(init·migrate)가
 * fail-closed로 알린다. 여기서 throw하면 무관한 이유로 `req:commit`의 doctor 게이트가 죽는다.
 *
 * `stripBom` 필수: PowerShell `Set-Content -Encoding UTF8`이 만든 BOM'd package.json은 이 플랫폼에서 실제로
 * 발생하는 실패다. 없으면 정상 파일을 '파손'으로 오분류한다.
 */
function readReqScripts(root: string): Record<string, string> | null {
  const p = join(root, 'package.json')
  if (!existsSync(p)) return null
  try {
    const raw: unknown = JSON.parse(stripBom(readFileSync(p, 'utf8')))
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
    const s = (raw as { scripts?: unknown }).scripts
    if (!s || typeof s !== 'object' || Array.isArray(s)) return null
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(s as Record<string, unknown>)) if (typeof v === 'string') out[k] = v
    return out
  } catch {
    return null
  }
}

function resolveTicketDir(opts: DoctorArgs, cfg: ResolvedConfig): string {
  if (opts.ticket) return resolve(opts.ticket)
  if (opts.reqId) return join(cfg.workflowDirAbs, `REQ-${opts.reqId.replace(/^REQ-/, '')}`)
  throw new Error('REQ id 또는 --ticket <dir> 필요')
}

function branchExistsLocal(branch: string): boolean {
  if (!branch) return false
  try {
    git(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`])
    return true
  } catch {
    return false
  }
}

/**
 * 파일 sha256(hex). 부재·오류 시 null — D20 fail-safe(조회 불가는 OK로 처리, 게이트를 막지 않는다).
 *
 * ⚠️ `createHash`는 이 파일 상단(`import { createHash } from 'node:crypto'`, :13)에 **이미** import돼 있다
 *    — D16 live-sha·evidence archive sha가 공유하는 기존 import다. D20용으로 추가 import는 필요 없다(중복이면 오류).
 * `export`인 이유: 테스트가 **실제 createHash 경로**를 직접 구동해(합성 sha 문자열이 아니라) req-doctor의 sha 계산이
 *    실제로 동작함을 증명하기 위함이다(REQ-2026-038 phase-2 리뷰 대응).
 */
export function safeSha256(abs: string): string | null {
  try {
    return createHash('sha256').update(readFileSync(abs)).digest('hex')
  } catch {
    return null
  }
}

/**
 * D22(REQ-2026-047): repo-root 런타임 스크래치 중 **ignore도 tracked도 아닌** 경로.
 *
 * 판정은 **로컬 git 상태 그대로**다(전역 excludes 포함) — D10이 보는 `git status`와 같은 기준이어야
 * "다음 review 뒤 D10이 막는다"는 예측이 맞는다. 파일이 아직 없어도 `check-ignore`는 패턴 매칭이라
 * 동작한다(그래서 **첫 리뷰 전에 미리** 경고할 수 있다 — 이 검사의 존재 이유).
 *
 * 읽기 전용 advisory라 어떤 오류도 삼킨다(조회 실패 = 보호됨으로 간주 → WARN 안 냄. fail-safe: 게이트를 막지 않는다).
 */
export function unprotectedRepoRootScratch(paths: readonly string[], gitFn: (a: string[]) => string): string[] {
  const out: string[] = []
  for (const p of paths) {
    let ignored = false
    let tracked = false
    try {
      gitFn(['check-ignore', '-q', '--', p])
      ignored = true
    } catch {
      ignored = false
    }
    if (!ignored) {
      try {
        tracked = gitFn(['ls-files', '--', p]).trim() !== ''
      } catch {
        tracked = true // 조회 불가 → 보호됨으로 간주(경고하지 않음)
      }
    }
    if (!ignored && !tracked) out.push(p)
  }
  return out
}

/** package.json의 version 문자열. 부재·파손 시 null(D20 WARN 메시지용 — 없어도 무해). */
function safeReadVersion(pkgAbs: string): string | null {
  try {
    const raw = JSON.parse(stripBom(readFileSync(pkgAbs, 'utf8'))) as { version?: unknown }
    return typeof raw.version === 'string' ? raw.version : null
  } catch {
    return null
  }
}

/** PM별 기대 lockfile 후보(npm은 둘 다 유효). */
const LOCKFILES_FOR_PM: Record<PackageManager, string[]> = {
  npm: ['package-lock.json', 'npm-shrinkwrap.json'],
  pnpm: ['pnpm-lock.yaml'],
  yarn: ['yarn.lock'],
}

/**
 * frozen-lockfile 위생 판정(D23·REQ-2026-056). package.json 없으면 점검 불요. PM 기대 lockfile이 하나라도
 * 존재+tracked면 ok, 존재하나 전부 untracked면 untracked, 하나도 없으면 missing.
 * 🔴 lockfile↔package.json **동기 검사는 안 한다**(PM 실행 없이 신뢰 불가) — 존재·tracked 위생만.
 */
export function lockfileHygiene(
  root: string,
  pm: PackageManager,
  isTracked: (rel: string) => boolean,
): 'ok' | 'missing' | 'untracked' | 'no-package-json' {
  if (!existsSync(join(root, 'package.json'))) return 'no-package-json'
  const present = LOCKFILES_FOR_PM[pm].filter((f) => existsSync(join(root, f)))
  if (present.length === 0) return 'missing'
  return present.some((f) => isTracked(f)) ? 'ok' : 'untracked'
}

// ─────────────────────────────────────── 실행 관측 로그(REQ-2026-111) ──

/**
 * doctor 실행 관측 로그의 경로(repo root 기준). **커밋 대상이 아니다** — `workflow/.review-calls.jsonl`과
 * 같은 성격·같은 자리다(설계 DEC-1).
 *
 * 🔴 커밋하지 않는 이유: (a) doctor는 phase마다 여러 번 돌아 커밋 소음이 된다 (b) 커밋된 증거는
 *    **병합되지 않은 브랜치와 함께 사라진다**(소비자 3곳 실측: 리뷰 아카이브의 3.1% 유실, 그중 다수가
 *    실패 기록) (c) 티켓 내부 커밋 자산은 D10/D13 스테이징 규칙과 얽힌다.
 */
export const DOCTOR_RUN_LOG_REL = 'workflow/.doctor-runs.jsonl'

/**
 * D29(REQ-2026-112)가 읽는 **계약 파일**. `init`이 만드는 두 형태를 모두 본다 —
 * 기존 `AGENTS.md`에 계약 마커가 없으면 `AGENTS.commitgate.md`를 사본으로 함께 깐다(`bin/init.ts`).
 */
export const CONTRACT_FILE_RELS = ['AGENTS.md', 'AGENTS.commitgate.md'] as const

/** 실행 1회 = 1행(설계 DEC-2). `msg`는 담지 않는다 — 경로·파일명이 섞이고 질문에 답하는 데 불필요하다. */
export interface DoctorRunRow {
  ticket_id: string
  at: string
  /** `main()`의 출력 요약과 **같은 기준** — FAIL 1건 이상이면 FAIL. */
  verdict: 'PASS' | 'FAIL'
  /**
   * 이번 실행에서 반환된 체크 개수(`checks.length`).
   *
   * 🔴 **id별 "평가됨"은 기록하지 않는다**(설계 DEC-3). `runChecks`가 매 호출에서 등록부 전부를
   *    push한다고 가정하지 않기 때문이다. 이 로그로 답할 수 있는 것은 "D-x가 발화한 적 있는가"와
   *    "몇 번 FAIL했는가"까지다. 필드 추가로 확장 가능하다(append-only JSONL).
   */
  evaluated: number
  /**
   * level !== 'OK' 인 것만, `runChecks` 반환 순서 유지.
   * `subjects`(REQ-2026-117): 발화 대상 기계 식별자 — **선택 키**다. 기존 행(키 부재)은 계속 유효하고,
   * 검사가 subjects를 내지 않으면 직렬화에서도 키가 빠진다(append-only JSONL 하위호환).
   */
  nonok: { id: CheckId; level: Level; subjects?: string[] }[]
  /** REQ-2026-129(v2): 스키마 표식. v1 행(키 부재)은 계속 유효하다. */
  schema_version?: 2
  /** REQ-2026-129(v2): OK 포함 전 평가 — 검사별 적용 가능 분모·발화율·차단·reason 분포의 원천. */
  evaluations?: DoctorEvaluation[]
}

/** REQ-2026-129(0.22): 스키마 v2의 평가 1건. v1의 nonok과 달리 **OK 포함 전 평가**를 담는다. */
export interface DoctorEvaluation {
  id: CheckId
  /** 이 실행에서 적용 가능했는가 — 검사별 분모의 입력. */
  applicable: boolean
  outcome: 'pass' | 'warn' | 'fail' | 'not-applicable'
  /** doctor는 커밋의 하드 게이트다 — fail = 이 실행이 커밋을 실제로 막았다. */
  blocked: boolean
  /** 비-OK만. 검사 명시값 또는 `<id소문자>-<outcome>` 폴백(안정 슬러그). */
  reason_code?: string
  subjects?: string[]
}

/** 순수 — 관측 행 조립(스키마 v2 — REQ-2026-129). 부작용이 없어 단독 테스트된다.
 *
 * 하위호환: v1 필드(`verdict`·`evaluated`·`nonok`)를 **그대로 유지**하고 `schema_version: 2`와
 * `evaluations`(OK 포함 전 평가·applicable·reason_code)를 additive로 싣는다 — v1만 아는 소비자
 * (구버전 report·수기 스크립트)는 계속 동작하고, v2 소비자는 분모를 계산할 수 있다.
 */
export function buildDoctorRunRow(checks: readonly Check[], meta: { ticketId: string; at: string }): DoctorRunRow {
  const nonok = checks
    .filter((c) => c.level !== 'OK')
    .map((c) =>
      c.subjects !== undefined && c.subjects.length > 0
        ? { id: c.id, level: c.level, subjects: [...c.subjects] }
        : { id: c.id, level: c.level },
    )
  const evaluations: DoctorEvaluation[] = checks.map((c) => {
    const applicable = c.applicable !== false
    const outcome: DoctorEvaluation['outcome'] =
      c.level === 'FAIL' ? 'fail' : c.level === 'WARN' ? 'warn' : applicable ? 'pass' : 'not-applicable'
    const ev: DoctorEvaluation = { id: c.id, applicable, outcome, blocked: outcome === 'fail' }
    if (outcome === 'warn' || outcome === 'fail') ev.reason_code = c.reason_code ?? `${c.id.toLowerCase()}-${outcome}`
    if (c.subjects !== undefined && c.subjects.length > 0) ev.subjects = [...c.subjects]
    return ev
  })
  return {
    schema_version: 2,
    ticket_id: meta.ticketId,
    at: meta.at,
    verdict: checks.some((c) => c.level === 'FAIL') ? 'FAIL' : 'PASS',
    evaluated: checks.length,
    nonok,
    evaluations,
  }
}

/**
 * 관측 행 append. **모든 예외를 삼킨다.**
 *
 * 🔴 관측은 게이트가 아니다(요구 제약 1). 로그가 없어도, 쓰기가 실패해도 doctor의 출력·FAIL 개수·
 *    exit code는 **동일해야 한다**. `review-codex.ts`의 review-call 로그와 같은 형태·같은 이유다.
 */
export function appendDoctorRun(rootAbs: string, row: DoctorRunRow): void {
  try {
    const abs = join(rootAbs, ...DOCTOR_RUN_LOG_REL.split('/'))
    mkdirSync(dirname(abs), { recursive: true })
    appendFileSync(abs, `${JSON.stringify(row)}\n`, 'utf8')
  } catch {
    // 의도적으로 비어 있다 — 관측 실패가 판정을 바꾸면 안 된다.
  }
}

export function main(argv: string[] = process.argv.slice(2)): void {
  const opts = parseArgs(argv)
  const cfg = loadConfig({ root: opts.root })
  gitAdapter = createGitAdapter(cfg.root) // 모든 git 호출 cwd = config.root
  const ticketDir = resolveTicketDir(opts, cfg)
  const finalize = opts.finalize // B3: D9를 source tree 모드로
  const state = loadState(ticketDir)

  const respPath = join(ticketDir, 'codex-response.json')
  let responseVerdict: Verdict | null = null
  let responseStructureOk = false
  let liveResponseSha256: string | null = null
  if (existsSync(respPath)) {
    const bytes = readFileSync(respPath)
    liveResponseSha256 = createHash('sha256').update(bytes).digest('hex') // D16 live↔evidence SHA(D-016-5)
    try {
      responseVerdict = JSON.parse(bytes.toString('utf8')) as Verdict
      responseStructureOk = validateResponseStructure(responseVerdict, cfg.schemaPathAbs).ok
    } catch {
      responseVerdict = null
    }
  }

  const repoRel = (abs: string) => relative(cfg.root, abs).replace(/\\/g, '/')
  const ticketRel = repoRel(ticketDir)

  // D13 freshness: 현재 설계문서 index 해시 재계산. 문서 미추적 등으로 계산 불가면 null(→ 유효 승인 불가, fail-closed).
  let currentDesignHash: string | null = null
  try {
    currentDesignHash = captureDesignBinding(ticketRel, git, cfg.designDocs).designHash
  } catch {
    currentDesignHash = null
  }

  // A2: 승인 증거 아카이브 온디스크 검사(D16/D17). evidence.response_path 파일을 읽어 sha/verdict/구조를 채움.
  const readArchive = (ev: ApprovalEvidence | null): ArchiveCheck | null => {
    if (!ev || typeof ev.response_path !== 'string' || !ev.response_path) return null
    // confinement: 현재 티켓 responses/ 직계 아카이브만 읽음(범위 밖 경로는 미존재 처리 → evidenceProblems가 FAIL).
    if (!isConfinedArchivePath(ev.response_path, ticketRel)) return { exists: false, sha256: null, verdict: null, structureOk: false }
    const abs = resolve(cfg.root, ev.response_path)
    if (!existsSync(abs)) return { exists: false, sha256: null, verdict: null, structureOk: false }
    try {
      const bytes = readFileSync(abs)
      let v: Verdict | null = null
      let sOk = false
      try {
        v = JSON.parse(bytes.toString('utf8')) as Verdict
        sOk = validateResponseStructure(v, cfg.schemaPathAbs).ok
      } catch {
        v = null
      }
      return { exists: true, sha256: createHash('sha256').update(bytes).digest('hex'), verdict: v, structureOk: sOk }
    } catch {
      return { exists: false, sha256: null, verdict: null, structureOk: false }
    }
  }
  const approvalEvidence = (state.approval_evidence as ApprovalEvidence | undefined) ?? null
  const designApprovalEvidence = (state.design_approval_evidence as ApprovalEvidence | undefined) ?? null

  // B3 finalize: pending_evidence_for.source_commit_sha의 source 커밋 tree(없거나 계산 불가 → null → D9 FAIL).
  let finalizeSourceTree: string | null = null
  if (finalize) {
    const pending = state.pending_evidence_for as { source_commit_sha?: unknown } | undefined
    const sha = pending && typeof pending.source_commit_sha === 'string' && pending.source_commit_sha ? pending.source_commit_sha : null
    if (sha) {
      try {
        finalizeSourceTree = git(['rev-parse', `${sha}^{tree}`])
      } catch {
        finalizeSourceTree = null
      }
    }
  }

  // D25(REQ-2026-085): trunk 도달 여부. `ls-tree` **1회**로 끝낸다 — 티켓마다 `git log`를 돌리면 80회다.
  //   판정 불가(비활성·ref 없음·git 실패)는 undefined로 남겨 조용히 통과시킨다(DEC-2).
  let unmerged: string[] | undefined
  /**
   * D30(REQ-2026-114): 리뷰를 받았는데 증거가 trunk에 없는 티켓.
   * D25와 **같은 `ls-tree` 결과를 쓴다** — git 호출을 늘리지 않는다.
   */
  let stranded: { id: string; reviews: number }[] | undefined
  let strandedClassified: ClassifiedStranded[] | undefined
  let remoteTrunkFreshness: string | null | undefined
  if (cfg.trunkBranch !== null) {
    try {
      git(['rev-parse', '--verify', '--quiet', `${cfg.trunkBranch}^{commit}`])
      const trunkPaths = new Set(
        git(['ls-tree', '-r', '--name-only', cfg.trunkBranch, '--', cfg.ticketRoot]).split('\n').map((l) => l.trim()).filter(Boolean),
      )
      const closed = existsSync(cfg.workflowDirAbs)
        ? readdirSync(cfg.workflowDirAbs, { withFileTypes: true })
            .filter((d) => d.isDirectory() && /^REQ-\d{4}-\d+$/.test(d.name))
            .filter((d) => existsSync(join(cfg.workflowDirAbs, d.name, 'responses', CLOSE_PROOF_BASENAME)))
            .map((d) => d.name)
        : []
      unmerged = unmergedClosedTickets(closed, trunkPaths, cfg.ticketRoot, String(state.id ?? ''))
      // 🔴 로그가 없거나 손상돼도 **조용히 통과**한다(요구 제약 2) — 진단이 사람을 막지 않는다.
      const stats = readReviewCallStats(join(cfg.root, ...REVIEW_CALL_LOG_REL.split('/')))
      const counts = stats === null ? null : new Map([...stats.entries()].map(([id, s]) => [id, s.count]))
      stranded =
        counts === null ? undefined : strandedReviewedTickets(counts, trunkPaths, cfg.ticketRoot, String(state.id ?? ''))
      // D30 상태 분류(REQ-2026-117): 미도달이 있을 때만 수집한다 — fetch 없이 로컬 ref만(+git 4회).
      if (stats !== null && stranded !== undefined && stranded.length > 0) {
        const ctx = collectStrandedContext(git, cfg.trunkBranch, cfg.ticketRoot)
        const lastReviewAt = new Map<string, string>()
        for (const [id, s] of stats.entries()) if (s.lastAt !== null) lastReviewAt.set(id, s.lastAt)
        strandedClassified = classifyStranded({
          stranded,
          remoteTrunkTickets: ctx.remoteTrunkTickets,
          localBranches: ctx.localBranches,
          lastReviewAt,
          nowIso: new Date().toISOString(),
        })
        remoteTrunkFreshness = ctx.remoteFreshness
      }
    } catch {
      unmerged = undefined // trunk ref 없음 등 — 알림을 낼 근거가 없다.
      stranded = undefined
      strandedClassified = undefined
      remoteTrunkFreshness = undefined
    }
  }

  /**
   * REQ-2026-097 DEC-1: **현재 티켓**의 검증된 종결 이벤트(D2·D3·D11 면제 입력).
   *
   * 🔴 `scanTicketIntake`를 그대로 쓴다 — 술어(`verifiedTerminalEvent`)뿐 아니라 **입력 획득까지**
   *    intake·`req:close`·`req:commit`와 같아야 한다(REQ-2026-094 교훈: 같은 술어를 쓰고도 입력이
   *    달라 판독이 갈렸다). HEAD blob만 읽으므로 워킹트리 dirty 여부가 이 판정을 흔들지 않는다.
   *
   * 🔴 위 D25 수집부는 여전히 `existsSync(close proof)`다 — 목적·비용이 다르다. 저것은 티켓 N개에 대한
   *    WARN 전용 집계라 `ls-tree` 1회로 끝내고, 이것은 게이트를 **푸는** 입력이라 검증된 술어를 쓴다.
   *    두 술어가 남아 있는 것은 의도다(설계 r02 관찰).
   *
   * 실패는 조용히 `null`(= 종결 아님) — fail-closed. 판정 못 하면 현행 동작이 기본값이다.
   */
  const ticketTerminalEvent: CloseProofEvent | 'legacy' | null = (() => {
    try {
      const base = scanTicketIntake(cfg.root, ticketRel, String(state.id ?? '')).baseState
      if (base === 'series-terminal' || base === 'dev-complete' || base === 'migrated-complete' || base === 'abandoned') return base
      // 🔴 REQ-2026-102: `legacy`만 따로 나른다 — 면제하지는 않지만 사유를 말할 수 있어야 한다.
      //    나머지(`developing`·`needs-recovery`·`corrupt`)는 사유가 자명하거나 다른 검사가 다룬다.
      return base === 'legacy' ? 'legacy' : null
    } catch {
      return null
    }
  })()

  // 상태는 한 번만 읽는다 — statusEntries와 D31 입력이 같은 스냅샷을 본다(이중 조회 = 판독 갈림 위험).
  const statusEntries = parseStatusZ(git([...STATUS_Z_ARGS]))
  // ── REQ-2026-142: 증거 복구 예외(DEC-4) ──
  // 🔴 **`finalize` 일 때만** plan 을 계산한다. 정상 경로에서는 이 블록 자체가 실행되지 않아
  //    `recoveryAllowlist` 가 `undefined` 로 남고, D10 은 이 REQ 이전과 한 글자도 다르지 않다.
  //
  // 🔴 **왜 `req:commit` 이 아니라 여기인가**: D10 이 평가되는 곳이 여기다. 목록을 `req:commit` 에서
  //    만들어 CLI 인자로 넘기면 경로 목록을 문자열로 실어 나르는 더 나쁜 결합이 되고, 그 인자를 아는
  //    다른 호출부가 생기면 예외가 넓어진다. `--finalize` 게이트 하나 안에 가두는 편이 좁다.
  //    `req:doctor --finalize` 를 사람이 직접 불러도 이 경로는 **읽기 전용 보고**만 바꾼다.
  let recoveryAllowlist: readonly string[] | undefined
  if (finalize) {
    const plan = planEvidenceRecovery(
      buildRecoveryFacts({
        ticketRel,
        state,
        headText: (rel) => createEvidencePorts(cfg.root, `${ticketRel}/responses`).headText(rel),
        // 🔴 REQ-2026-150 판별자 A: `HEAD^` 를 함께 읽는다. 두 호출부가 같은 조립 함수를 쓰므로
        //    한쪽만 주면 doctor 통과·commit 거부 교착이 생긴다.
        parentText: (rel) => {
          try {
            return git(['show', `HEAD^:${rel}`])
          } catch {
            return null
          }
        },
        dirtyPaths: () => statusEntries.flatMap((e) => (e.origPath === undefined ? [e.path] : [e.origPath, e.path])),
        revParse: (rev) => {
          try {
            return git(['rev-parse', rev])
          } catch {
            return null
          }
        },
        fileSha: (rel) => {
          try {
            return createHash('sha256').update(readFileSync(join(cfg.root, rel))).digest('hex')
          } catch {
            return null
          }
        },
        hashUtf8: (str) => createHash('sha256').update(str, 'utf8').digest('hex'),
      }),
    )
    if (plan.kind === 'ready') {
      recoveryAllowlist = plan.allowlist
      console.log(`[req:doctor] ℹ️ 증거 복구 적용 가능(${plan.resumeFrom}) — ${plan.detail}`)
    } else {
      console.log(`[req:doctor] ℹ️ 증거 복구 미적용(${plan.reason}) — ${RECOVERY_GUIDANCE[plan.reason]}`)
    }
  }


  const inp: DoctorInputs = {
    state,
    currentBranch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
    branchExists: branchExistsLocal(typeof state.branch === 'string' ? state.branch : ''),
    branchPrefix: cfg.branchPrefix,
    granularityMaxFiles: cfg.granularityMaxFiles,
    granularityGate: cfg.granularityGate,
    // 🔴 REQ-2026-088 DEC-1·3: intake와 **같은 술어·같은 원천(HEAD blob)**. 여기서 판정을 재구현하지 않는다.
    staleBindingLines: (() => {
      const text = createEvidencePorts(cfg.root, `${ticketRel}/responses`).headText(`${ticketRel}/responses/approvals.jsonl`)
      if (!text) return undefined
      try {
        const split = splitUnboundPhases(text, designHashFromManifest(text))
        if (split.unbound.length === 0) return []
        return recoveryGuidance({ ticketId: String(state.id ?? ''), unboundPhaseIds: split.unbound, rebindablePhaseIds: split.rebindable }).lines
      } catch {
        return undefined // 손상 매니페스트의 fail-closed 처리는 intake·D17의 몫이다.
      }
    })(),
    // 🔴 REQ-2026-094 D27: intake·복원과 **같은 원천(HEAD blob)**. 워킹트리 state를 보지 않는다 —
    //    승인 직후 dirty state는 정상이고, 그것을 신호로 읽으면 진행 중 티켓이 전부 오탐이 된다.
    consumedWithoutRow: (() => {
      const ports = createEvidencePorts(cfg.root, `${ticketRel}/responses`)
      const stateText = ports.headText(`${ticketRel}/state.json`)
      if (!stateText) return undefined
      try {
        return consumedApprovalsWithoutRow(stateText, ports.headText(`${ticketRel}/responses/approvals.jsonl`))
      } catch {
        return undefined // 손상 매니페스트의 fail-closed는 intake·D17 소관.
      }
    })(),
    ticketTerminalEvent,
    unmergedClosedTickets: unmerged,
    // D30(REQ-2026-114): 같은 `ls-tree` 결과에서 파생 — git 호출 증가 0.
    strandedEvidence: stranded,
    // D30 상태 분류(REQ-2026-117): 미도달 존재 시에만 계산됨(fetch 없음).
    strandedClassified,
    remoteTrunkFreshness,
    trunkBranch: cfg.trunkBranch,
    stagedTree: git(['write-tree']),
    // `-z`: 경로 인용 없음(설계 D11) → core.quotePath 불필요. --untracked-files=all: `?? responses/` collapse 방지.
    statusEntries,
    // D31(REQ-2026-119): staged 경로 × 민감 패턴(config riskPaths 대체 의미 — null=내장 기본·[]=비활성).
    riskHits: (() => {
      const patterns = cfg.riskPaths ?? DEFAULT_RISK_PATTERNS
      if (patterns.length === 0) return undefined // 비활성 — 점검 불요
      const stagedPaths = statusEntries.filter((e) => e.index !== ' ' && e.index !== '?').flatMap(entryPaths)
      if (stagedPaths.length === 0) return undefined // staged 없음 — 점검 불요
      return effectiveRiskHits(stagedPaths, patterns)
    })(),
    scratch: reviewScratchPaths(ticketRel),
    // 🔴 REQ-2026-107: D18은 리뷰 preflight와 **같은 정본**으로 판정한다.
    //    임계 = 현재 phase의 `max_files` 선언(없으면 config), 대상 = staged 코드 파일.
    //    `current_phase`가 없으면 선언도 없음(null) → config 기본, 즉 기존 동작.
    // 🔴 REQ-2026-110(D28): 판정은 정본이 하고 runChecks는 표시만 한다.
    //    매니페스트는 아래 D27 입력이 읽는 것과 같은 경로다(같은 커밋 상태를 본다).
    highConfirm: (() => {
      try {
        const manifest =
          createEvidencePorts(cfg.root, `${ticketRel}/responses`).headText(`${ticketRel}/responses/approvals.jsonl`) ?? ''
        const completes = wouldCompleteReq({
          phaseIds: readPhases(state).map((p) => p.id),
          manifestContent: manifest,
        }).complete
        // 🔴 REQ-2026-129: `req:commit` 게이트와 **같은 정지 정책**을 봐야 한다. 여기만 config 를 보면
        //    같은 티켓을 두 정책으로 판정해, D28 이 통과라고 표시한 커밋을 게이트가 막는다(또는 반대).
        return userConfirmGate(state, effectiveStopGate(state, cfg), completes)
      } catch {
        return undefined // 판정 불가는 조용히 '점검 불요' — 진단이 doctor를 깨뜨리지 않는다.
      }
    })(),
    // D32(REQ-2026-129): 티켓 정책 스냅샷 ↔ config 대조. 게이트가 쓰는 값과 같은 기준(`isStopGate`)이다.
    policyDrift: classifyPolicyDrift(state, cfg.stopGate),
    declaredMaxFiles: declaredPhaseMaxFiles(state, typeof state.current_phase === 'string' ? state.current_phase : null),
    stagedCodeFiles: phaseCodeFiles(git([...STAGED_NAMES_Z_ARGS]).split('\0'), ticketRel),
    responseVerdict,
    responseStructureOk,
    designApproved: state.design_approved === true,
    designApprovedHash: typeof state.design_approved_hash === 'string' ? state.design_approved_hash : null,
    currentDesignHash,
    ticketDocs: [...designDocPaths(ticketRel, cfg.designDocs), `${ticketRel}/codex-request.md`],
    ticketRel,
    approvalEvidenceRequired: state.approval_evidence_required === true,
    approvalEvidence,
    designApprovalEvidence,
    approvalArchive: readArchive(approvalEvidence),
    designArchive: readArchive(designApprovalEvidence),
    liveResponseSha256,
    finalize,
    finalizeSourceTree,
    recoveryAllowlist,
    reqScripts: readReqScripts(cfg.root),
    // D20(REQ-2026-038): 자산 skew content-hash 입력. shipped=packageRoot 사본, vendored=cfg.schemaPathAbs(소비 repo 사본).
    packagedSchemaSha: safeSha256(join(packageRoot(), 'workflow', 'machine.schema.json')),
    vendoredSchemaSha: safeSha256(cfg.schemaPathAbs),
    packageRootDiffers: packageRoot() !== cfg.root,
    schemaPathIsDefault: cfg.schemaPathAbs === resolve(cfg.root, DEFAULTS.schemaPath), // 정규화 절대경로 비교(동치 상대경로 포함)
    installedVersion: safeReadVersion(join(packageRoot(), 'package.json')),
    quickstartBackfill: quickstartBackfillTargets(cfg.root),
    // D22(REQ-2026-047): 현재 repo-root 런타임 스크래치 축은 review-call 측정 로그 1건.
    // 새 축이 생기면 이 배열에 추가하고 packed-consumer smoke 단언도 함께 늘린다(docs 인벤토리 표의 유지 규칙).
    // REQ-2026-111: 새 관측 로그도 같은 보호 대상이다 — 루트 `.gitignore`·`templates/workflow.gitignore`
    //   양쪽이 배포되지 않은 설치본을 D22가 알리게 한다(자산 skew 전례: REQ-2026-025·038).
    repoRootScratchUnprotected: unprotectedRepoRootScratch([REVIEW_CALL_LOG_REL, DOCTOR_RUN_LOG_REL], git),
    // D33(REQ-2026-161): 명령 표면 skew. 읽기는 command-surface 하나가 한다(check C6와 같은 입력).
    packageScripts: readPackageScripts(cfg.root),
    // D29(REQ-2026-112): 계약 파일을 **읽기만** 한다. 파일이 하나도 없으면 `undefined`(점검 불요).
    retiredClaimHits: ((): { file: string; claim: RetiredClaim }[] | undefined => {
      const rels = CONTRACT_FILE_RELS.filter((r) => existsSync(join(cfg.root, r)))
      if (rels.length === 0) return undefined
      const hits: { file: string; claim: RetiredClaim }[] = []
      for (const rel of rels) {
        try {
          for (const claim of retiredClaimsIn(readFileSync(join(cfg.root, rel), 'utf8'))) hits.push({ file: rel, claim })
        } catch {
          // 읽기 실패는 조용히 건너뛴다 — 진단이 사람을 막지 않는다.
        }
      }
      return hits
    })(),
    // D23(REQ-2026-056): frozen-lockfile 위생(존재·tracked). tracked 판정은 read-only `git ls-files`.
    lockfileStatus: lockfileHygiene(cfg.root, cfg.packageManager, (rel) => {
      try {
        git(['ls-files', '--error-unmatch', '--', rel])
        return true
      } catch {
        return false
      }
    }),
    // D24(REQ-2026-062): setup 완료 게이트. 게이트 전용 root 해소를 쓴다(config.root는 이미 확정돼 있으므로 명시 전달).
    setupGate: setupGateVerdict(collectGateFacts(cfg.root, toPosix(relative(cfg.root, cfg.workflowDirAbs)))),
  }

  const checks = runChecks(inp)
  // REQ-2026-111: 관측 로그. 판정·출력·exit는 아래 그대로이며 이 호출은 그것들에 영향을 주지 않는다.
  appendDoctorRun(cfg.root, buildDoctorRunRow(checks, { ticketId: String(state.id ?? ''), at: new Date().toISOString() }))
  for (const c of checks) console.log(`[req:doctor] ${c.level} ${c.id}: ${c.msg}`)
  const fails = checks.filter((c) => c.level === 'FAIL')
  console.log(`[req:doctor] ${fails.length ? `FAIL ${fails.length}건` : 'PASS'} (REQ=${state.id})`)
  if (fails.length) process.exit(1)
}

/** bin dispatch 진입점(친절한 1줄 오류 + exit 1 경계). 직접 `tsx` 실행은 아래 `if (isMain) main()`이 그대로 담당(하위호환). */
export const runCli = makeRunCli(main)

const isMain = isEntrypoint(import.meta.url)
if (isMain) main()
