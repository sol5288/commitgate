#!/usr/bin/env tsx
/**
 * req:doctor — AI REQ 워크플로우 1차 (단계 4B): 일관성 점검(fail-closed).
 *
 * 1차 최소셋(registry 비의존): D2·D3·D5·D6·D9·D10·D11 + D13(design 선행·freshness)·D15(NEEDS_FIX actionable). (D1/D7/D7b·D4a 등 registry/merge 의존은 2차)
 * FAIL 1건 이상 → exit 1, 자동 보정 금지(P9). review-codex 헬퍼 재사용.
 *
 * 사용: req:doctor <REQ-id>  |  req:doctor --ticket <dir>   (저장소 패키지매니저의 실행 형식으로)
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve, join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { parseStatusZ, entryPaths, formatStatusEntry, STATUS_Z_ARGS, type StatusEntry } from './lib/porcelain'
import { isAllowedResponsesScratch, reviewScratchPaths } from './lib/scratch'
// REQ-2026-048 phase-1: confinement 술어는 leaf `lib/evidence.ts`가 정본 — 여기서 재수출(기존 경로 보존).
import { isConfinedArchivePath } from './lib/evidence'
export { isConfinedArchivePath } from './lib/evidence'
import {
  loadState,
  validateVerdict,
  validateResponseStructure,
  findUnstagedOrUntracked,
  captureDesignBinding,
  designDocPaths,
  REVIEW_CALL_LOG_REL,
  type WorkflowState,
  type Verdict,
  type ApprovalEvidence,
} from './review-codex'
import { setupGateVerdict, collectGateFacts, type GateVerdict } from './lib/setup-gate'
// REQ-2026-085 D25: 종결 증거 파일명(trunk 트리에서 이 경로의 존재로 "도달했는가"를 판정한다).
import { CLOSE_PROOF_BASENAME, recoveryGuidance, type CloseProofEvent } from './lib/close-proof'
// REQ-2026-088 DEC-1: 판정은 intake와 같은 술어로. 재구현하면 두 안내가 갈라진다.
// REQ-2026-094 D27: 증인 불일치 판정은 `lib/evidence`가 정본(여기서 재구현 금지).
import { splitUnboundPhases, designHashFromManifest, consumedApprovalsWithoutRow } from './lib/evidence'
import { createEvidencePorts } from './lib/evidence-ports'
// REQ-2026-097 DEC-1: 종결 판정의 술어·입력 획득을 intake와 공유한다(자체 구현 금지).
import { scanTicketIntake } from './lib/intake'
import { loadConfig, packageRoot, stripBom, DEFAULTS, type ResolvedConfig, type PackageManager, type GranularityGate } from './lib/config'
import { createGitAdapter, type GitAdapter } from './lib/adapters'
import { quickstartBackfillTargets, type QuickstartBackfillTarget } from '../../bin/quickstart'

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
export const D_CHECK_IDS = [
  'D2', 'D3', 'D5', 'D6', 'D9', 'D10', 'D11', 'D13', 'D15', 'D16', 'D17', 'D18', 'D19',
  'D20', 'D21', 'D22', 'D23', 'D24', 'D25', 'D26', 'D27',
] as const

/** D-체크 id — `D_CHECK_IDS` 등재분만. 새 id는 등록부에 먼저 추가해야 컴파일된다. */
export type CheckId = (typeof D_CHECK_IDS)[number]

export interface Check {
  id: CheckId
  level: Level
  msg: string
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
export function phaseGranularityWarnings(codeFiles: string[], maxFiles: number, gate: GranularityGate = DEFAULTS.granularityGate): string[] {
  if (codeFiles.length <= maxFiles) return []
  // 🔴 문구는 **실제 설정에 종속**된다(phase-2 r01 P1). `granularityGate:"warn"`인 사용자에게
  //    "막힙니다"라고 하면 도구가 하지 않을 일을 약속하는 것이다 — 안내가 거짓이면 사람은 안내를 믿지 않게 된다.
  const tail =
    gate === 'block'
      ? '다음 phase 리뷰는 이 임계를 넘으면 실행 전에 막힙니다: staging을 줄이거나 state.json의 phases[]에 "max_files"를 선언하세요.'
      : 'granularityGate="warn"이라 리뷰는 그대로 진행됩니다 — 면적을 줄이면 리뷰 라운드가 줄어듭니다(실측: >8파일 평균 2.4R vs ≤8파일 1.4R).'
  return [`phase 코드 변경 ${codeFiles.length}파일 > 권고 ${maxFiles} — 리뷰 면적 큼(granularity 정책). ${tail}`]
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
  const tid = s.codex_thread_id
  if (typeof tid === 'string' && tid.length > 0 && !UUID_RE.test(tid))
    c.push({ id: 'D5', level: 'FAIL', msg: `codex_thread_id 형식 오류: ${tid}` })
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
  } else c.push({ id: 'D6', level: 'OK', msg: 'commit_allowed=false(점검 불요)' })

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
  const dirty = findUnstagedOrUntracked(inp.statusEntries, inp.scratch, inp.ticketRel)
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
  {
    const maxFiles = inp.granularityMaxFiles ?? GRANULARITY_MAX_FILES
    const adv = phaseGranularityWarnings(codeChanges, maxFiles, inp.granularityGate ?? DEFAULTS.granularityGate)
    if (adv.length) c.push({ id: 'D18', level: 'WARN', msg: adv.join(' / ') })
    else c.push({ id: 'D18', level: 'OK', msg: `granularity OK(코드 변경 ${codeChanges.length}파일 ≤ ${maxFiles})` })
  }

  // D15: 온디스크 응답이 NEEDS_FIX면 findings·next_action이 actionable해야 함(스키마/validateVerdict와 중복이라도 명시 점검).
  // typeof 가드: 파손된 next_action(비-문자열)이 .trim()에서 throw하지 않게(fail-closed).
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
  } else c.push({ id: 'D15', level: 'OK', msg: 'NEEDS_FIX 응답 아님(점검 불요)' })

  // D16(A2/D-016-5): phase 승인 증거 아카이브 정본 검증. commit_allowed=true일 때만.
  // 신규 REQ(approval_evidence_required)면 누락/불일치 FAIL, legacy면 (증거 없음=OK / 증거 있는데 불일치=WARN). 기존 D6/D9 대체 아님(추가 게이트).
  if (commitAllowed) {
    const required = inp.approvalEvidenceRequired === true
    if (!required && !inp.approvalEvidence) {
      c.push({ id: 'D16', level: 'OK', msg: 'legacy(증거 미요구) — 점검 불요' })
    } else {
      const problems = evidenceProblems(inp.approvalEvidence, inp.approvalArchive, 'phase', s, inp.ticketRel, inp.liveResponseSha256)
      if (problems.length === 0) c.push({ id: 'D16', level: 'OK', msg: 'phase 승인 증거 아카이브 정합' })
      else if (required) c.push({ id: 'D16', level: 'FAIL', msg: `phase 승인 증거 검증 실패: ${problems.join('; ')}` })
      else c.push({ id: 'D16', level: 'WARN', msg: `phase 승인 증거 미정합(legacy): ${problems.join('; ')}` })
    }
  } else c.push({ id: 'D16', level: 'OK', msg: 'commit_allowed=false(점검 불요)' })

  // D17(A2/D-016-5·6): design 승인 증거 아카이브 정본 검증. design_approved=true일 때만(D13 freshness와 별개의 증거 게이트).
  if (inp.designApproved === true) {
    const required = inp.approvalEvidenceRequired === true
    if (!required && !inp.designApprovalEvidence) {
      c.push({ id: 'D17', level: 'OK', msg: 'legacy(증거 미요구) — 점검 불요' })
    } else {
      const problems = evidenceProblems(inp.designApprovalEvidence, inp.designArchive, 'design', s, inp.ticketRel)
      if (problems.length === 0) c.push({ id: 'D17', level: 'OK', msg: 'design 승인 증거 아카이브 정합' })
      else if (required) c.push({ id: 'D17', level: 'FAIL', msg: `design 승인 증거 검증 실패: ${problems.join('; ')}` })
      else c.push({ id: 'D17', level: 'WARN', msg: `design 승인 증거 미정합(legacy): ${problems.join('; ')}` })
    }
  } else c.push({ id: 'D17', level: 'OK', msg: 'design_approved=false(점검 불요)' })

  // D19(REQ-2026-014): 설치 모드 진단 — `req:*` 값의 **형태**만 본다(manifest·lockfile·node_modules 미사용).
  //
  // 🔴 **level 상한은 WARN — 절대 FAIL이 아니다.** CommitGate 자신의 package.json이 Stage A 형태이고(개발 repo가
  //    자기 스크립트를 직접 실행하므로 정상), `req:commit`이 이 doctor를 exit≠0에 throw하는 하드 게이트로 spawn한다.
  //    FAIL이면 **이 저장소 자신의 커밋과 정당한 Stage A 소비자 전원의 커밋이 영구 차단**된다.
  //    Stage A는 결함이 아니라 지원되는 설치 형태다 → mixed만 WARN한다.
  if (inp.reqScripts === undefined || inp.reqScripts === null) {
    c.push({ id: 'D19', level: 'OK', msg: 'package.json scripts 미조회/없음(점검 불요)' })
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
    c.push({ id: 'D20', level: 'OK', msg: '자산 skew 점검 불요(dev repo/dogfood — packageRoot === config root)' })
  } else if (inp.schemaPathIsDefault === false) {
    c.push({ id: 'D20', level: 'OK', msg: 'custom schemaPath(kit 관리 자산 아님 — unmanaged, 점검 불요)' })
  } else if (!inp.packagedSchemaSha || !inp.vendoredSchemaSha) {
    c.push({ id: 'D20', level: 'OK', msg: '자산 skew 점검 불요(shipped/vendored 스키마 조회 불가 — Stage A/미설치/2-arg)' })
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
    c.push({ id: 'D21', level: 'OK', msg: 'Quick Start 백필 점검 불요(dev repo/dogfood — packageRoot === config root)' })
  } else if (inp.quickstartBackfill === undefined) {
    // 판정 불가(shipped 블록 조회 실패·2-arg/미계산) → 조용히 통과(REQ-2026-101 DEC-7).
    // D19 `undefined→OK`·D20 "조회 불가→OK"·D24 "미계산→OK"와 같은 선례다.
    c.push({ id: 'D21', level: 'OK', msg: 'Quick Start 백필 점검 불요(2-arg/미계산·shipped 블록 조회 불가)' })
  } else if (inp.quickstartBackfill.length === 0) {
    c.push({ id: 'D21', level: 'OK', msg: '기존 always-loaded 파일의 Quick Start 블록이 설치된 버전과 일치(또는 대상 없음)' })
  } else {
    // 🔴 REQ-2026-101 DEC-2: 부재와 드리프트는 사용자에게 **다른 사건**이다. 한 줄에 뭉치면
    //    무엇을 해야 하는지도, 무엇을 잃는지도 알 수 없다. 드리프트에는 덮어쓰기 경고가 붙는다.
    const missing = inp.quickstartBackfill.filter((t) => t.action === 'insert').map((t) => t.rel)
    const stale = inp.quickstartBackfill.filter((t) => t.action === 'replace').map((t) => t.rel)
    const parts: string[] = []
    if (missing.length) parts.push(`${missing.join(', ')} 에 Quick Start 블록이 없습니다(seed-once라 신규 블록이 기존 파일엔 자동으로 닿지 않습니다 — REQ-2026-040).`)
    if (stale.length)
      parts.push(
        `${stale.join(', ')} 의 Quick Start 블록이 설치된 commitgate와 다릅니다(드리프트) — 갱신하면 최신 워크플로 규칙이 반영됩니다. ` +
          `⚠️ 마커(\`<!-- commitgate:quickstart -->\`) **안쪽을 직접 수정했다면 그 수정은 덮어써집니다** — 마커 안은 도구 관리 영역입니다.`,
      )
    c.push({
      id: 'D21',
      level: 'WARN',
      msg: `${parts.join(' ')} \`commitgate quickstart --apply\` 로 해소하세요.`,
    })
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
    c.push({ id: 'D22', level: 'OK', msg: 'repo-root 스크래치 보호 점검 불요(dev repo/dogfood — packageRoot === config root)' })
  } else if (inp.repoRootScratchUnprotected === undefined) {
    c.push({ id: 'D22', level: 'OK', msg: 'repo-root 스크래치 보호 점검 불요(2-arg/미계산)' })
  } else if (inp.repoRootScratchUnprotected.length === 0) {
    c.push({ id: 'D22', level: 'OK', msg: 'repo-root 런타임 스크래치가 모두 ignore(또는 tracked)됨' })
  } else {
    c.push({
      id: 'D22',
      level: 'WARN',
      msg:
        `${inp.repoRootScratchUnprotected.join(', ')} 이(가) gitignore로 무시되지 않습니다 — ` +
        '다음 review가 이 파일을 만들면 **D10이 FAIL하여 커밋이 막힙니다**. ' +
        '`commitgate sync --gitignore --apply` 로 배포 템플릿의 누락 규칙을 보강하세요(기존 행은 변경하지 않습니다, REQ-2026-047).',
    })
  }

  // D23(REQ-2026-056): frozen-lockfile 위생 진단.
  //
  // 🔴 **level 상한은 WARN — 절대 FAIL이 아니다**(D19~D22와 동일 근거). `req:commit`이 doctor를 하드 게이트로
  //    spawn하므로 FAIL이면 lockfile 없는 프로젝트의 모든 커밋이 벽돌이 된다. lockfile ↔ package.json 동기
  //    여부는 검사하지 않는다(PM 실행 없이 신뢰 불가) — 존재·tracked 위생만.
  if (inp.lockfileStatus === undefined || inp.lockfileStatus === 'ok') {
    c.push({ id: 'D23', level: 'OK', msg: inp.lockfileStatus === undefined ? 'lockfile 위생 점검 불요(미계산)' : 'lockfile 존재·git-tracked — 재현 가능한 설치(--frozen-lockfile) 가능' })
  } else if (inp.lockfileStatus === 'no-package-json') {
    c.push({ id: 'D23', level: 'OK', msg: 'lockfile 위생 점검 불요(package.json 없음)' })
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
    c.push({ id: 'D24', level: 'OK', msg: 'setup 완료 점검 불요(2-arg/미계산)' })
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
    c.push({ id: 'D25', level: 'OK', msg: '미병합 누적 점검 불요(미계산·trunk 없음·비활성)' })
  } else if (inp.unmergedClosedTickets.length === 0) {
    c.push({ id: 'D25', level: 'OK', msg: `종결 티켓이 모두 trunk(${inp.trunkBranch ?? '-'})에 반영됨` })
  } else {
    c.push({
      id: 'D25',
      level: 'WARN',
      msg:
        `종결됐지만 trunk(${inp.trunkBranch ?? '-'})에 없는 티켓 ${inp.unmergedClosedTickets.length}건: ` +
        `${inp.unmergedClosedTickets.join(', ')} — 쌓일수록 브랜치가 서로의 조상이 되어 **순서를 바꿔 병합하거나 되돌릴 수 없게** 됩니다. 통합하거나 정리하세요.`,
    })
  }

  // D26(REQ-2026-088): 설계 재승인으로 **앞선 phase의 결속이 끊긴** 상태 사전 안내.
  //
  // 🔴 **level 상한은 WARN — 어떤 입력에서도 FAIL이 아니다**(DEC-4). `req:commit`이 doctor를 하드 게이트로
  //    spawn하므로 FAIL이면 **재결속에 필요한 남은 phase를 커밋조차 못 하는 교착**이 된다(재결속하려면
  //    티켓을 끝내야 하는데 끝낼 수가 없다). 진행 중 결속이 끊긴 것 자체는 오류가 아니다 — 마지막에 해소하면 된다.
  if (inp.staleBindingLines === undefined) {
    c.push({ id: 'D26', level: 'OK', msg: 'design 결속 점검 불요(미계산·매니페스트 없음)' })
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
    c.push({ id: 'D27', level: 'OK', msg: '승인 증인 일치(소비된 승인 중 매니페스트에 빠진 것 없음)' })
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
        `  2) 끝낼 수 없으면 종결한다: npx commitgate req:close ${id} --abandon --reason "<사유>" --confirm "<승인 문장>" --run`,
      ].join('\n   '),
    })
  }

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
    } catch {
      unmerged = undefined // trunk ref 없음 등 — 알림을 낼 근거가 없다.
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
    trunkBranch: cfg.trunkBranch,
    stagedTree: git(['write-tree']),
    // `-z`: 경로 인용 없음(설계 D11) → core.quotePath 불필요. --untracked-files=all: `?? responses/` collapse 방지.
    statusEntries: parseStatusZ(git([...STATUS_Z_ARGS])),
    scratch: reviewScratchPaths(ticketRel),
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
    repoRootScratchUnprotected: unprotectedRepoRootScratch([REVIEW_CALL_LOG_REL], git),
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
  for (const c of checks) console.log(`[req:doctor] ${c.level} ${c.id}: ${c.msg}`)
  const fails = checks.filter((c) => c.level === 'FAIL')
  console.log(`[req:doctor] ${fails.length ? `FAIL ${fails.length}건` : 'PASS'} (REQ=${state.id})`)
  if (fails.length) process.exit(1)
}

/** bin dispatch 진입점(친절한 1줄 오류 + exit 1 경계). 직접 `tsx` 실행은 아래 `if (isMain) main()`이 그대로 담당(하위호환). */
export function runCli(argv: string[]): void {
  try {
    main(argv)
  } catch (err) {
    console.error(`commitgate: ${err instanceof Error ? err.message : String(err)}`)
    process.exitCode = 1
  }
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href
if (isMain) main()
