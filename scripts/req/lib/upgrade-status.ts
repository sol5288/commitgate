/**
 * 업그레이드 축의 **현재 상태** 판정 (REQ-2026-165 phase-2).
 *
 * 🔴 **왜 필요한가**: REQ-2026-164 가 축 등록부와 정본 표를 만들었지만 **소비자 프로젝트 안에서는
 *    그 어느 것에도 도달할 수 없다** — `docs/` 는 npm 패키지에 없고, 설치된 `AGENTS.md`·`CLAUDE.md` 는
 *    업그레이드를 한 마디도 하지 않는다. 티켓 없이 돌릴 수 있는 유일한 명령(`check`)은 8축 중 2축만 봤고,
 *    나머지를 보는 `req:doctor` 는 REQ id 를 요구한다 — 업그레이드 **직후**엔 티켓이 없을 수 있다.
 *
 * 🔴 **술어를 재구현하지 않는다.** 각 축의 판정은 이미 있는 함수를 그대로 부른다. `check` 가 자기
 *    판정을 새로 쓰면 `doctor` 와 갈라져 *"doctor 는 괜찮다는데 check 가 막는"* 상태가 생긴다
 *    (REQ-2026-094 가 같은 결론에 도달했다).
 *
 * 🔴 **축 목록을 다시 적지 않는다.** `UPGRADE_AXES` 를 순회하므로 축을 늘리면 출력이 자동으로 따라온다.
 *    판정기를 빠뜨리면 `unknown`(판정기 미등록)으로 **드러난다** — 조용히 빠지지 않는다.
 */
import { UPGRADE_AXES, type UpgradeAxis } from './upgrade-axes'
import { missingReqScripts } from './command-surface'
import { classifyInstallMode, unprotectedRepoRootScratch } from './install-shape'

/** 축 하나의 상태. */
export type AxisState =
  /** 어긋난 것이 없다. */
  | { kind: 'ok'; detail: string }
  /** 조치가 필요하다 — 호출부가 축의 `remedy` 를 함께 낸다. */
  | { kind: 'action'; detail: string }
  /** 🔴 **판정하지 못했다.** "부족"이 아니다 — 모르는 것을 결함으로 말하지 않는다. */
  | { kind: 'unknown'; detail: string }
  /** 도구가 판정할 수 없는 축(caret 범위) — 사람이 확인한다. */
  | { kind: 'manual'; detail: string }

export interface AxisReport {
  axis: UpgradeAxis
  state: AxisState
}

/**
 * 판정 입력. **전부 호출부가 수집한다** — 이 모듈은 파일·git 을 만지지 않는다(순수).
 *
 * 🔴 `undefined` = **미수집**(2-arg/legacy 호출) → 그 축은 `unknown`. `null` 이 있는 필드는
 *    "읽으려 했으나 읽지 못함"이라 역시 `unknown` 이다. 둘 다 `action` 이 아니다.
 */
export interface UpgradeStatusInput {
  /**
   * 패키지 루트와 대상 루트가 **다른가**(= 실제 소비 설치본인가).
   * 🔴 `false`(dogfood)면 설치 자산 축은 점검 불요다 — `doctor` D20/D21/D22 와 **같은 기준**.
   */
  packageRootDiffers?: boolean
  /**
   * 이 디렉터리가 **CommitGate 설치본이라는 신호**(`setup-gate.collectInstallSignals` 산출).
   *
   * 🔴 **왜 필요한가**(REQ-2026-166 DEC-1): 설치가 아닌 디렉터리에서 `review-persona` 가 조치를 냈다 —
   *    `planSync` 는 persona 부재를 설치본이든 아니든 "복원 대상"으로 보고하기 때문이다. 나머지 자산 축이
   *    안전했던 것은 입력이 비어 자연히 `unknown` 이 된 **우연**이지 설계가 아니었다. 전제를 명시한다.
   *
   * 🔴 문턱은 **1 이상**이다. `setup-gate.MIN_INSTALL_SIGNALS`(=2)를 쓰지 않는다 — 그것은 "setup 이
   *    끝났는가"라는 더 강한 질문이고, 여기 질문은 "여기가 CommitGate 프로젝트이긴 한가"다. 2를 쓰면
   *    신호가 하나뿐인 부분 설치 프로젝트의 **진짜 조치가 unknown 뒤로 숨는다**.
   */
  installSignals?: readonly string[] | null
  /** `package.json` 의 `scripts`(`readPackageScripts` 산출). */
  packageScripts?: Record<string, unknown> | null
  /** 설치된 패키지의 스키마 sha256. */
  packagedSchemaSha?: string | null
  /** 소비 repo vendored 사본의 sha256. */
  vendoredSchemaSha?: string | null
  /** `schemaPath` 가 기본값인가(custom 이면 kit 관리 자산이 아니다 — unmanaged). */
  schemaPathIsDefault?: boolean
  /** ignore 도 tracked 도 아닌 repo-root 스크래치 경로(`unprotectedRepoRootScratch` 산출). */
  unprotectedScratch?: string[]
  /** 백필이 필요한 always-loaded 파일(`quickstartBackfillTargets` 산출). */
  quickstartBackfill?: readonly { rel: string }[]
  /** persona 축 상태 — `sync` 의 자산 판정에서 온다. */
  personaState?: 'in-sync' | 'missing' | 'differs' | 'unmanaged' | null
  /** 폐기 서술이 남은 계약 파일(`retiredClaimsIn` 산출). */
  contractClaimFiles?: readonly string[]
}

type Evaluator = (i: UpgradeStatusInput) => AxisState

const unknown = (detail: string): AxisState => ({ kind: 'unknown', detail })
const ok = (detail: string): AxisState => ({ kind: 'ok', detail })
const action = (detail: string): AxisState => ({ kind: 'action', detail })

/**
 * 설치 자산 축의 공통 전제.
 *
 * 🔴 **설치 신호가 하나도 없으면 판정 대상이 아니다**(REQ-2026-166 DEC-1). "여기는 정상"도 아니고
 *    "조치가 필요하다"도 아니다 — **모른다**. 엉뚱한 디렉터리에서 `check` 를 돌린 사람에게
 *    CommitGate 프로젝트가 아닌 곳에 파일을 만들라고 말하지 않는다.
 *
 * 🔴 새 필드의 `undefined` 를 **하위호환 통과로 읽지 않는다**. 이 모듈이 스스로 선언한 법
 *    (`undefined` = 미수집 → `unknown`)을 새 필드에서만 어길 이유가 없다 — REQ-2026-165 phase-2
 *    r01 P1 이 `schemaPathIsDefault` 에서 정확히 그 자리에 있었다.
 */
function assetPrelude(i: UpgradeStatusInput): AxisState | null {
  if (i.packageRootDiffers === undefined) return unknown('미수집')
  if (i.installSignals === undefined) return unknown('미수집')
  if (i.installSignals === null) return unknown('설치 신호를 읽지 못함')
  if (i.installSignals.length === 0) return unknown('CommitGate 설치 신호 없음 — 판정 대상이 아니다')
  if (i.packageRootDiffers === false) return ok('점검 불요(dev repo/dogfood)')
  return null
}

/**
 * 축 id → 판정기.
 *
 * 🔴 **등록부에 축을 더하고 여기를 빠뜨리면** 그 축이 `unknown`(판정기 미등록)으로 **드러난다**.
 *    조용히 빠지지 않는 것이 요점이다 — 전수 테스트가 그 상태를 red 로 만든다.
 */
const EVALUATORS: Record<string, Evaluator> = {
  // 🔴 진단 수단이 없다. `^0.x` 는 소비자 package.json 에서 PM 이 강제하므로 도구가 볼 수 없다.
  'caret-range': () => ({ kind: 'manual', detail: '진단 없음 — 설치 범위를 사람이 확인' }),

  'req-scripts': (i) => {
    const pre = assetPrelude(i)
    if (pre) return pre
    if (i.packageScripts === undefined || i.packageScripts === null) return unknown('package.json 의 scripts 를 읽지 못함')
    const missing = missingReqScripts(i.packageScripts)
    return missing.length === 0 ? ok('명령 표면 일치') : action(`없는 verb ${missing.length}개: ${missing.join(' · ')}`)
  },

  'vendored-schema': (i) => {
    const pre = assetPrelude(i)
    if (pre) return pre
    // 🔴 **미수집을 기본값으로 읽지 않는다**(phase-2 r01 P1). `undefined` 를 "기본 경로"로 가정하면
    //    custom schemaPath 프로젝트에 **없는 조치**를 안내한다 — 이 모듈이 스스로 정한 계약
    //    (`undefined` = 미수집 → `unknown`)을 그 축에서만 어겼던 자리다.
    if (i.schemaPathIsDefault === undefined) return unknown('미수집')
    if (i.schemaPathIsDefault === false) return ok('custom schemaPath(kit 관리 자산 아님)')
    if (i.packagedSchemaSha === undefined || i.vendoredSchemaSha === undefined) return unknown('미수집')
    if (i.packagedSchemaSha === null || i.vendoredSchemaSha === null) return unknown('스키마 사본을 읽지 못함')
    return i.packagedSchemaSha === i.vendoredSchemaSha ? ok('vendored 스키마 동기화됨') : action('vendored 스키마가 설치본과 다름')
  },

  'workflow-gitignore': (i) => {
    const pre = assetPrelude(i)
    if (pre) return pre
    if (i.unprotectedScratch === undefined) return unknown('미수집')
    return i.unprotectedScratch.length === 0
      ? ok('런타임 스크래치가 모두 보호됨')
      : action(`보호되지 않는 경로: ${i.unprotectedScratch.join(' · ')}`)
  },

  'managed-blocks': (i) => {
    const pre = assetPrelude(i)
    if (pre) return pre
    if (i.quickstartBackfill === undefined) return unknown('미수집')
    return i.quickstartBackfill.length === 0
      ? ok('관리 블록이 설치본과 일치')
      : action(`드리프트/부재 ${i.quickstartBackfill.length}건: ${i.quickstartBackfill.map((t) => t.rel).join(' · ')}`)
  },

  'review-persona': (i) => {
    const pre = assetPrelude(i)
    if (pre) return pre
    if (i.personaState === undefined || i.personaState === null) return unknown('persona 상태를 판정하지 못함')
    if (i.personaState === 'unmanaged') return ok('custom/비활성 persona(unmanaged)')
    if (i.personaState === 'in-sync') return ok('persona 가 배포본과 일치')
    return action(i.personaState === 'missing' ? 'persona 부재 — 리뷰가 fail-closed 로 멈춘다' : 'persona 가 배포본과 다름')
  },

  'mixed-install': (i) => {
    if (i.packageScripts === undefined || i.packageScripts === null) return unknown('package.json 의 scripts 를 읽지 못함')
    // 🔴 값이 문자열인 것만 형태 판정에 넣는다 — `classifyInstallMode` 의 계약이 그렇다.
    const scripts: Record<string, string> = {}
    for (const [k, v] of Object.entries(i.packageScripts)) if (typeof v === 'string') scripts[k] = v
    const mode = classifyInstallMode(scripts)
    // 🔴 순수 Stage A 는 **지원되는 형태**다. 섞였을 때만 조치가 필요하다.
    return mode === 'mixed' ? action('Stage A 와 Stage B 형태가 섞여 있음') : ok(`설치 모드: ${mode}`)
  },

  'contract-claims': (i) => {
    if (i.contractClaimFiles === undefined) return unknown('미수집')
    return i.contractClaimFiles.length === 0
      ? ok('계약 문서에 폐기된 서술 없음')
      : action(`폐기 서술이 남은 파일: ${i.contractClaimFiles.join(' · ')}`)
  },
}

/**
 * 축 전부를 판정한다(**순수**). 등록부 순서를 그대로 따른다.
 *
 * 🔴 판정기가 없는 축은 **빠뜨리지 않고** `unknown` 으로 낸다 — 축을 늘리고 판정기를 안 만들면
 *    출력에 그 사실이 보인다.
 */
export function evaluateUpgradeAxes(input: UpgradeStatusInput): AxisReport[] {
  return UPGRADE_AXES.map((axis) => {
    const ev = EVALUATORS[axis.id]
    return { axis, state: ev ? ev(input) : unknown('판정기 미등록 — 이 축은 아직 자동 확인되지 않는다') }
  })
}

/** 조치가 필요한 축만. 호출부가 요약을 만들 때 쓴다. */
export function axesNeedingAction(reports: readonly AxisReport[]): AxisReport[] {
  return reports.filter((r) => r.state.kind === 'action')
}

/** 상태별 개수(요약 한 줄용). */
export function countByKind(reports: readonly AxisReport[]): Record<AxisState['kind'], number> {
  const out: Record<AxisState['kind'], number> = { ok: 0, action: 0, unknown: 0, manual: 0 }
  for (const r of reports) out[r.state.kind] += 1
  return out
}

/** `unprotectedRepoRootScratch` 를 호출부가 그대로 쓸 수 있게 다시 내보낸다(재구현 방지). */
export { unprotectedRepoRootScratch }
