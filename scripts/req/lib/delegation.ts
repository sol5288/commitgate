/**
 * 사전 위임(pre-delegation) 레코드 — `stopGate: "auto"` 의 권한 근거 (REQ-2026-140 phase-2).
 *
 * 🔴 **권한은 설정이 아니라 이 레코드에서 나온다**(설계 DEC-1). `stopGate` 를 `"auto"` 로 바꾸는 것은
 *    *"위임이 있으면 그것을 따르겠다"* 는 **모드 선언**일 뿐이고, 무엇을 해도 되는지는 여기가 정한다.
 *    설정 편집이나 대화 문장만으로 통합 권한이 생기면 안 된다는 요구의 구조적 답이다.
 *
 * 🔴 **이 모듈은 순수하다** — 파일도 git도 만지지 않는다. 입력은 원장 **텍스트**와 이미 관측된 사실들이고,
 *    출력은 판정 하나다. 그래서 진리표 전수를 배선 없이 테스트할 수 있다.
 *
 * 🔴 **원장은 커밋되는 append-only JSONL** 이다(`workflow/delegations.jsonl`).
 *    `workflow/.integrate-runs.jsonl`(gitignored 관측 로그)와 층이 다르다 — 저건 무슨 일이 있었는지의
 *    기록이고, 이건 **무엇을 해도 되는지의 근거**다. 워킹트리에만 있으면 위조·삭제가 흔적을 남기지 않는다.
 */

/** 커밋되는 위임 원장. 🔴 `.` 로 시작하지 않는다 = gitignore 대상이 아니다(권한 근거는 추적돼야 한다). */

/**
 * 사전 위임 만료(시간). 🔴 `req:delegate` 의 파서·사용법이 **같은 값을 읽는다** — REQ-2026-166 에서
 * 사용법을 `lib/verb-help` 로 옮기며 여기로 내렸다. verb 모듈에 두면 lib 가 verb 를 import 하는
 * 순환이 된다.
 */
export const DEFAULT_TTL_HOURS = 12
export const MAX_TTL_HOURS = 72

export const DELEGATION_LEDGER_REL = 'workflow/delegations.jsonl'

/** 위임 대상. 티켓 하나 또는 delivery 묶음 하나. */
export type DelegationScope = { kind: 'ticket'; req_id: string } | { kind: 'delivery'; slug: string }

/**
 * 허용 작업. 🔴 **세 축은 독립이다** — push 허용이 bypass 허용을 함의하지 않는다.
 *
 * `local_merge` 는 **발급 자체로 참**이다(설계 DEC-5a). 셋 다 opt-in 으로 두면 "아무것도 못 하는 위임"이
 * 기본값이 되어, 문서대로 발급한 사람이 정상 로컬 병합에서 거부당한다(설계 리뷰 r01 P1).
 */
export interface DelegationPermissions {
  local_merge: boolean
  origin_push: boolean
  bypass_protection: boolean
}

/** 발급 1건. 🔴 `at`·`expires_at`·두 SHA 는 **도구가 읽는다** — 손기록을 신뢰하지 않는다(REQ-2026-019). */
export interface DelegationIssued {
  kind: 'issued'
  id: string
  at: string
  scope: DelegationScope
  trunk_branch: string
  trunk_sha: string
  source_branch: string
  base_sha: string
  expires_at: string
  permissions: DelegationPermissions
  /** HIGH 위험 티켓에 필요한 **별도** 위임. 일반 발급으로 HIGH 가 딸려오지 않는다. */
  high_risk_ack: boolean
  /** 사람이 말한 승인 문장 **그대로**. 비어 있으면 발급 자체가 거부된다(권한 근거 없는 권한 금지). */
  approval_sentence: string
}

/** 소비 1건(CAS). `verified_sha` 는 strict 검증을 통과한 SHA(`V`)다 — 설계 DEC-5. */
export interface DelegationConsumed {
  kind: 'consumed'
  id: string
  at: string
  verified_sha: string
  /**
   * 이 소비가 **인가한** 작업. 🔴 `performed`(실제로 한 것)가 **아니다** — 소비 행은 CAS 선점이라
   *    실행 **전에** 쓰이므로, 그 시점에 "했다"고 적으면 push 실패 시 원장이 거짓이 된다
   *    (phase-4c 리뷰 r01 P1). 실제 실행 결과는 `workflow/.integrate-runs.jsonl` 과 최종 보고에 남는다.
   */
  authorized: DelegationPermissions
  outcome: 'merged' | 'aborted'
  detail: string
}

/**
 * **실제 수행 1건**(phase-4c 리뷰 r02 P1). 소비(`consumed`)는 실행 **전에** 쓰이는 인가 기록이라
 * "무엇을 실제로 했는가"를 담을 수 없다. 그래서 결과가 확정된 뒤 이 행을 덧붙인다.
 *
 * 🔴 **종결 행이 아니다** — fold 는 `consumed`·`revoked` 만 종결로 본다. 이 행이 없는 `consumed` 는
 *    "소비했는데 결과를 모른다"는 뜻이고, 그 상태가 보이는 것 자체가 정직한 감사다(중간 중단 흔적).
 * 🔴 **bypass 를 실제로 썼다는 사실이 여기 남는다** — 콘솔과 gitignored 로그에만 두면 영속되지 않는다.
 */
export interface DelegationExecuted {
  kind: 'executed'
  id: string
  at: string
  /** 실제로 만들어진 merge 커밋(없으면 `null` — 병합 실패). */
  merge_sha: string | null
  performed: DelegationPermissions
  detail: string
}

/** 철회 1건. */
export interface DelegationRevoked {
  kind: 'revoked'
  id: string
  at: string
  reason: string
}

export type DelegationRow = DelegationIssued | DelegationConsumed | DelegationExecuted | DelegationRevoked

// ───────────────────────────────── 파싱(fail-closed) ──

export interface ParsedLedger {
  rows: DelegationRow[]
  /** 🔴 하나라도 있으면 판정은 **거부**다. 권한 원장의 손상을 "그 행만 무시"로 넘기면 안 된다. */
  problems: string[]
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0
const isBool = (v: unknown): v is boolean => typeof v === 'boolean'

/** RFC3339 instant. `Z` 또는 `±HH:MM` 오프셋을 요구한다 — 타임존 없는 값은 비교 기준이 없다. */
const INSTANT_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|([+-])(\d{2}):(\d{2}))$/

/**
 * 시각 문자열 → epoch ms. 형식이 아니거나 실재하지 않는 날짜면 `null`.
 *
 * 🔴 **왜 문자열 비교가 아닌가**(phase-2 리뷰 r01 P1): 예전에는 `now >= expires_at` 로 **사전순** 비교를
 *    했다. 그래서 `expires_at` 이 `"not-a-date"` 로 손상되면 `"2026-…Z" >= "not-a-date"` 가 false 라
 *    **만료가 영영 발생하지 않고 위임이 무기한 유효**했다 — fail-closed 계약을 정면으로 우회한다.
 *    오프셋 표기도 틀린다: `2026-08-14T00:00:00+12:00`(= 08-13T12:00Z)은 사전순으로 08-13 보다 뒤라
 *    이미 만료된 위임이 살아 있는 것으로 읽힌다.
 *
 * 🔴 **`Date.parse` 를 쓰지 않는다**(r02 P1). 정규식을 통과해도 `Date.parse` 는 **날짜 오버플로를
 *    정규화**한다 — `2026-02-30T00:00:00Z` 가 3월 2일로 조용히 해석돼, 존재하지 않는 만료일이
 *    "유효한 위임"이 된다. 그래서 컴포넌트를 직접 만들고 **왕복 대조**한다: `Date.UTC` 로 만든 값의
 *    UTC 필드가 원문과 하나라도 다르면 그 문자열은 실재하지 않는 시각이다.
 */
export function parseInstantMs(v: unknown): number | null {
  if (typeof v !== 'string') return null
  const m = INSTANT_RE.exec(v)
  if (m === null) return null
  const [, y, mo, d, hh, mi, se, frac, tz, sign, oh, om] = m as unknown as (string | undefined)[]
  const year = Number(y)
  const month = Number(mo)
  const day = Number(d)
  const hour = Number(hh)
  const minute = Number(mi)
  const second = Number(se)
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return null
  // 소수 이하는 ms 정밀도까지만 쓴다(잘라내되 값의 유효성에는 영향이 없다).
  const ms = frac === undefined ? 0 : Number(frac.slice(0, 3).padEnd(3, '0'))

  const utc = Date.UTC(year, month - 1, day, hour, minute, second, ms)
  if (!Number.isFinite(utc)) return null
  const back = new Date(utc)
  // 🔴 **왕복 대조** — 2/30 같은 오버플로는 여기서 걸린다(정규화된 값은 원문과 달라진다).
  if (
    back.getUTCFullYear() !== year ||
    back.getUTCMonth() !== month - 1 ||
    back.getUTCDate() !== day ||
    back.getUTCHours() !== hour ||
    back.getUTCMinutes() !== minute ||
    back.getUTCSeconds() !== second
  )
    return null

  if (tz === 'Z') return utc
  const offHour = Number(oh)
  const offMin = Number(om)
  if (offHour > 23 || offMin > 59) return null
  const offset = (offHour * 60 + offMin) * 60_000
  return sign === '-' ? utc + offset : utc - offset
}

/** 🔴 타입 술어여야 한다 — `parseInstantMs(x) === null` 만으로는 `x` 가 string 으로 좁혀지지 않는다. */
const isInstant = (v: unknown): v is string => parseInstantMs(v) !== null

function parsePermissions(v: unknown): DelegationPermissions | null {
  if (!isObj(v)) return null
  const { local_merge, origin_push, bypass_protection } = v
  if (!isBool(local_merge) || !isBool(origin_push) || !isBool(bypass_protection)) return null
  return { local_merge, origin_push, bypass_protection }
}

function parseScope(v: unknown): DelegationScope | null {
  if (!isObj(v)) return null
  if (v.kind === 'ticket' && isStr(v.req_id)) return { kind: 'ticket', req_id: v.req_id }
  if (v.kind === 'delivery' && isStr(v.slug)) return { kind: 'delivery', slug: v.slug }
  return null
}

function parseRow(o: Record<string, unknown>): DelegationRow | null {
  if (o.kind === 'issued') {
    const scope = parseScope(o.scope)
    const permissions = parsePermissions(o.permissions)
    if (
      scope === null ||
      permissions === null ||
      !isStr(o.id) ||
      !isInstant(o.at) ||
      !isStr(o.trunk_branch) ||
      !isStr(o.trunk_sha) ||
      !isStr(o.source_branch) ||
      !isStr(o.base_sha) ||
      !isInstant(o.expires_at) ||
      !isBool(o.high_risk_ack) ||
      !isStr(o.approval_sentence)
    )
      return null
    return {
      kind: 'issued',
      id: o.id,
      at: o.at,
      scope,
      trunk_branch: o.trunk_branch,
      trunk_sha: o.trunk_sha,
      source_branch: o.source_branch,
      base_sha: o.base_sha,
      expires_at: o.expires_at,
      permissions,
      high_risk_ack: o.high_risk_ack,
      approval_sentence: o.approval_sentence,
    }
  }
  if (o.kind === 'consumed') {
    /**
     * 🔴 **옛 키 `performed` 도 받는다**(phase-4c 리뷰 r03 P1). 이 필드는 같은 REQ 안에서
     *    `performed` → `authorized` 로 이름이 바뀌었다. 이름만 바꾸고 옛 행을 못 읽게 두면,
     *    그 사이 빌드로 쓰인 원장이 **손상으로 판정되어 이후 모든 자율 통합이 막힌다** —
     *    스키마 변경이 영속 원장을 망가뜨리는 전형적인 함정이다(REQ-2026-064 가 겪은 것과 같은 계열).
     */
    const authorized = parsePermissions(o.authorized ?? o.performed)
    if (
      authorized === null ||
      !isStr(o.id) ||
      !isInstant(o.at) ||
      !isStr(o.verified_sha) ||
      (o.outcome !== 'merged' && o.outcome !== 'aborted') ||
      typeof o.detail !== 'string'
    )
      return null
    return { kind: 'consumed', id: o.id, at: o.at, verified_sha: o.verified_sha, authorized, outcome: o.outcome, detail: o.detail }
  }
  if (o.kind === 'executed') {
    const performed = parsePermissions(o.performed)
    if (
      performed === null ||
      !isStr(o.id) ||
      !isInstant(o.at) ||
      !(o.merge_sha === null || isStr(o.merge_sha)) ||
      typeof o.detail !== 'string'
    )
      return null
    return { kind: 'executed', id: o.id, at: o.at, merge_sha: o.merge_sha as string | null, performed, detail: o.detail }
  }
  if (o.kind === 'revoked') {
    if (!isStr(o.id) || !isInstant(o.at) || typeof o.reason !== 'string') return null
    return { kind: 'revoked', id: o.id, at: o.at, reason: o.reason }
  }
  return null
}

/**
 * 원장 텍스트를 행으로 만든다. **빈 줄은 무시하되 그 밖의 이상은 전부 problem 이다.**
 *
 * 🔴 미지의 `kind` 를 조용히 건너뛰지 않는다. 나중 버전이 새 행 종류를 추가했는데 옛 도구가 그것을
 *    무시하면, **철회 행을 못 읽고 권한을 내주는** 상황이 된다. 모르면 멈춘다.
 */
export function parseDelegationLedger(text: string | null): ParsedLedger {
  const rows: DelegationRow[] = []
  const problems: string[] = []
  if (text === null) return { rows, problems }
  text.split('\n').forEach((raw, i) => {
    const line = raw.trim()
    if (line === '') return
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      problems.push(`${i + 1}행: JSON 파싱 실패`)
      return
    }
    if (!isObj(parsed)) {
      problems.push(`${i + 1}행: 객체가 아님`)
      return
    }
    const row = parseRow(parsed)
    if (row === null) {
      problems.push(`${i + 1}행: 알 수 없거나 불완전한 레코드(kind=${String(parsed.kind)})`)
      return
    }
    rows.push(row)
  })
  return { rows, problems }
}

// ───────────────────────────────── fold ──

export interface FoldedDelegations {
  /** 종결되지 않은 발급. 만료 여부는 여기서 보지 않는다(시각 판정은 verdict 의 몫). */
  active: DelegationIssued[]
  /** 종결된 발급과 그 사유. 사용자에게 "왜 없는지"를 말하기 위해 남긴다. */
  terminated: { row: DelegationIssued; by: 'consumed' | 'revoked'; at: string }[]
}

const sameScope = (a: DelegationScope, b: DelegationScope): boolean =>
  a.kind === 'ticket' && b.kind === 'ticket'
    ? a.req_id === b.req_id
    : a.kind === 'delivery' && b.kind === 'delivery'
      ? a.slug === b.slug
      : false

/** 특정 scope 의 발급들을 종결 상태별로 접는다. */
export function foldDelegations(rows: readonly DelegationRow[], scope: DelegationScope): FoldedDelegations {
  const issued = rows.filter((r): r is DelegationIssued => r.kind === 'issued' && sameScope(r.scope, scope))
  const active: DelegationIssued[] = []
  const terminated: FoldedDelegations['terminated'] = []
  for (const row of issued) {
    const end = rows.find((r) => (r.kind === 'consumed' || r.kind === 'revoked') && r.id === row.id)
    if (end === undefined) active.push(row)
    else terminated.push({ row, by: end.kind as 'consumed' | 'revoked', at: end.at })
  }
  return { active, terminated }
}

// ───────────────────────────────── 판정 ──

/**
 * 병합 소스 브랜치 → 위임을 찾을 **scope**. 판정할 수 없으면 `null`.
 *
 * 🔴 **브랜치에서 유도한다**(REQ-2026-140 phase-4b). "원장을 뒤져 이 브랜치를 가리키는 위임을 찾는"
 *    방향으로 하면 도구가 **어느 위임을 쓸지 고르게** 되고, 그 선택이 곧 권한 확대다.
 *    대상을 먼저 확정하고 그 대상의 위임만 본다.
 *
 * 🔴 판정할 수 없으면 `null` — 호출부는 이것을 **거부**로 다룬다(차단 지점 fail-closed).
 */
export function scopeOfBranch(branch: string, branchPrefix: string): DelegationScope | null {
  if (branch.startsWith('delivery/')) {
    const slug = branch.slice('delivery/'.length)
    return slug === '' ? null : { kind: 'delivery', slug }
  }
  if (branchPrefix !== '' && branch.startsWith(branchPrefix)) {
    const m = /^(\d{4}-\d{3,})/.exec(branch.slice(branchPrefix.length))
    if (m !== null) return { kind: 'ticket', req_id: `REQ-${m[1] as string}` }
  }
  return null
}

/**
 * 거부 사유 **등록부**. 🔴 union 을 이 배열에서 파생시킨다 — 두 벌로 두면 한쪽만 갱신될 때
 *    전수 테스트가 **조용히 그 사유를 건너뛴다**(이 저장소가 `D_CHECK_IDS` 로 같은 결론에 도달했다:
 *    권위는 관찰이 아니라 등록부이고, 등재는 타입이 강제해야 사각지대가 없다).
 */
export const DELEGATION_DENY_REASONS = [
  'ledger-corrupt',
  'absent',
  'ambiguous-active',
  'revoked',
  'consumed',
  'expired',
  'trunk-branch-mismatch',
  'trunk-moved',
  'source-mismatch',
  'scope-out-of-range',
  'composition-changed',
  'evidence-mismatch',
  'high-risk-unacked',
  'budget-hardcap',
  'review-inconclusive',
  'permission-denied',
] as const

/** 🔴 안내 매핑이 `Record` 라, 사유를 늘리면서 안내를 빠뜨리면 **컴파일이 깨진다.** */
export type DelegationDenyReason = (typeof DELEGATION_DENY_REASONS)[number]

/** 병합 범위의 티켓 귀속(설계 DEC-4a). `unattributable` 은 **귀속을 판정하지 못한** 커밋 수다. */
export interface RangeAttribution {
  tickets: string[]
  unattributable: number
  /**
   * 범위가 건드린 **delivery 레코드의 슬러그**(`<ticketRoot>/delivery/<slug>.json`).
   *
   * 🔴 티켓 위임으로 delivery 상태를 옮기면 안 되므로 별도 축으로 둔다(phase-4a 리뷰 r03).
   *    부재(`undefined`)는 "없음"이지 "모름"이 아니다 — `attributeRange` 는 항상 채운다.
   */
  deliveries?: string[]
}

export interface DelegationCheckInput {
  /** 원장 파일 내용. `null` = 파일 없음(= 위임 없음). */
  ledgerText: string | null
  scope: DelegationScope
  /** 🔴 **주입된 현재 시각**. 테스트가 시계를 고정할 수 있어야 만료 경계를 검증할 수 있다. */
  now: string
  /** 실제 통합 대상 브랜치 **이름**. */
  trunkBranch: string
  /** 실제 통합 대상 브랜치의 현재 tip. */
  trunkSha: string
  /** 실제 병합 소스 브랜치 이름. */
  sourceBranch: string
  /** 이번에 하려는 작업. 위임이 허용한 것의 부분집합이어야 한다. */
  requested: DelegationPermissions
  /** 티켓 위험도(`'HIGH'` 면 별도 위임 필요). */
  riskLevel: string | null
  budgetHardCapReached: boolean
  /** BLOCKED·미판정 리뷰가 남아 있는가. */
  reviewInconclusive: boolean
  /** strict 승인 증거 검증이 결속 SHA 에서 통과했는가. */
  evidenceOk: boolean
  /** 병합 범위의 귀속(DEC-4a). */
  rangeAttribution: RangeAttribution
  /** delivery scope 일 때 그 묶음의 멤버 티켓. ticket scope 면 `null`. */
  deliveryMembers: string[] | null
  /** delivery 구성이 발급 시점과 달라졌는가. */
  compositionChanged: boolean
}

export type DelegationVerdict =
  | { ok: true; row: DelegationIssued }
  | { ok: false; reason: DelegationDenyReason; detail: string }

/**
 * 🔴 **모든 항이 통과했을 때만 `ok`** 다. 순서는 "사용자에게 가장 설명적인 사유"를 앞에 둔다 —
 *    원장이 손상됐는데 `absent` 라고 말하면 사람이 엉뚱한 곳을 고친다.
 */
export function delegationVerdict(input: DelegationCheckInput): DelegationVerdict {
  const deny = (reason: DelegationDenyReason, detail: string): DelegationVerdict => ({ ok: false, reason, detail })

  const { rows, problems } = parseDelegationLedger(input.ledgerText)
  if (problems.length > 0) return deny('ledger-corrupt', `위임 원장 손상 ${problems.length}건 — ${problems[0]}`)

  const folded = foldDelegations(rows, input.scope)
  if (folded.active.length === 0) {
    const last = folded.terminated[folded.terminated.length - 1]
    if (last === undefined) return deny('absent', '이 대상에 발급된 위임이 없다')
    return last.by === 'revoked'
      ? deny('revoked', `위임이 철회됐다(${last.at})`)
      : deny('consumed', `위임이 이미 소비됐다(${last.at}) — 권한은 정확히 한 번만 쓰인다`)
  }
  /**
   * 🔴 여러 개가 살아 있으면 **고르지 않는다.** 어느 것을 쓸지 도구가 정하면 그 선택이 곧 권한 확대다.
   */
  if (folded.active.length > 1)
    return deny('ambiguous-active', `유효한 위임이 ${folded.active.length}건이다 — 하나만 남기고 나머지를 철회하라`)

  const row = folded.active[0] as DelegationIssued

  /**
   * 🔴 **수치 비교다**(r01 P1). `now` 가 ISO instant 가 아니면 정책 판정이 아니라 **호출 계약 위반**이므로
   *    throw 한다 — 판정으로 흡수하면 "시계를 못 읽었는데 통과"가 가능해진다.
   */
  const nowMs = parseInstantMs(input.now)
  if (nowMs === null) throw new Error(`현재 시각이 ISO instant 가 아니다: ${String(input.now)}`)
  const expiresMs = parseInstantMs(row.expires_at)
  if (expiresMs === null || nowMs >= expiresMs)
    return deny('expired', `위임이 만료됐다(만료 ${row.expires_at} · 현재 ${input.now})`)

  /**
   * 🔴 이름과 SHA 는 **다른 것을 막는다**(설계 리뷰 r02 P1). SHA 만 비교하면 `main` 과 `release` 가 같은
   *    커밋을 가리키는 순간 이름 검사가 사라지고, config 의 trunk 를 바꾸면 엉뚱한 브랜치에 병합된다.
   */
  if (row.trunk_branch !== input.trunkBranch)
    return deny('trunk-branch-mismatch', `위임 대상은 '${row.trunk_branch}' 인데 통합 대상은 '${input.trunkBranch}' 다`)
  if (row.trunk_sha !== input.trunkSha)
    return deny('trunk-moved', `위임 발급 이후 ${row.trunk_branch} 가 움직였다(${row.trunk_sha.slice(0, 8)} → ${input.trunkSha.slice(0, 8)})`)
  if (row.source_branch !== input.sourceBranch)
    return deny('source-mismatch', `위임된 소스는 '${row.source_branch}' 인데 병합 소스는 '${input.sourceBranch}' 다`)

  const scopeProblem = scopeRangeProblem(input.scope, input.rangeAttribution, input.deliveryMembers)
  if (scopeProblem !== null) return deny('scope-out-of-range', scopeProblem)

  if (input.compositionChanged) return deny('composition-changed', '위임 발급 이후 delivery 구성이 바뀌었다')
  if (input.riskLevel === 'HIGH' && !row.high_risk_ack)
    return deny('high-risk-unacked', 'HIGH 위험 티켓은 별도 위임(--high-risk)이 필요하다')
  if (input.budgetHardCapReached)
    return deny('budget-hardcap', '리뷰 hardCap 에 도달했다 — 이 정지는 위임으로도, 설정으로도 열리지 않는다')
  if (input.reviewInconclusive) return deny('review-inconclusive', 'BLOCKED 또는 미판정 리뷰가 남아 있다')
  if (!input.evidenceOk) return deny('evidence-mismatch', 'strict 승인 증거 검증이 결속 SHA 에서 통과하지 못했다')

  const missing = missingPermissions(row.permissions, input.requested)
  if (missing.length > 0) return deny('permission-denied', `위임에 없는 작업: ${missing.join(', ')}`)

  return { ok: true, row }
}

/**
 * DEC-4a — scope 가 **병합 범위를 실제로 제한**하는가.
 *
 * 🔴 **판정 불가가 하나라도 있으면 거부**다. 자율 통합의 권한 판정에서 "모르겠음"을 통과로 읽으면
 *    그게 곧 구멍이다. (진단·조회 지점의 "모르면 판단 안 함" 과 다르다 — 여기는 **차단 지점**이다.)
 */
export function scopeRangeProblem(
  scope: DelegationScope,
  attribution: RangeAttribution,
  deliveryMembers: string[] | null,
): string | null {
  if (attribution.unattributable > 0)
    return `병합 범위에 귀속을 판정할 수 없는 커밋 ${attribution.unattributable}건이 있다`
  const allowed = scope.kind === 'ticket' ? [scope.req_id] : (deliveryMembers ?? [])
  if (scope.kind === 'delivery' && deliveryMembers === null) return 'delivery 멤버 목록을 읽지 못했다'
  const outside = attribution.tickets.filter((t) => !allowed.includes(t))
  if (outside.length > 0)
    return `병합 범위에 위임 대상 밖 티켓이 있다: ${outside.join(', ')} (허용: ${allowed.join(', ') || '(없음)'})`
  /**
   * 🔴 delivery 레코드 변경은 **그 묶음의 위임에서만** 정상이다(phase-4a 리뷰 r03 P1).
   *    티켓 위임으로 묶음 상태를 옮기면 위임 대상 밖을 바꾸는 것이고, 다른 묶음의 레코드도 마찬가지다.
   */
  const touched = attribution.deliveries ?? []
  const allowedSlug = scope.kind === 'delivery' ? scope.slug : null
  const foreignDeliveries = touched.filter((s) => s !== allowedSlug)
  if (foreignDeliveries.length > 0)
    return `병합 범위가 위임 대상 밖 delivery 레코드를 바꾼다: ${foreignDeliveries.join(', ')}`
  return null
}

/** 요청한 작업 중 위임이 허용하지 않은 것. */
export function missingPermissions(granted: DelegationPermissions, requested: DelegationPermissions): string[] {
  const out: string[] = []
  if (requested.local_merge && !granted.local_merge) out.push('local_merge')
  if (requested.origin_push && !granted.origin_push) out.push('origin_push (--allow-push)')
  if (requested.bypass_protection && !granted.bypass_protection) out.push('bypass_protection (--allow-bypass)')
  return out
}

/**
 * 거부 사유별 **해소 안내**. 🔴 `Record` 라서 사유를 늘리면 여기도 채워야 컴파일된다.
 */
export const DENY_GUIDANCE: Record<DelegationDenyReason, string> = {
  'ledger-corrupt': `${DELEGATION_LEDGER_REL} 이 손상됐다 — 손으로 고치지 말고 무엇이 append 됐는지 git 이력에서 확인하라`,
  absent: '사람이 `npx commitgate req:delegate ... --run` 으로 위임을 발급해야 한다',
  'ambiguous-active': '유효한 위임을 하나만 남기고 나머지를 `--revoke <id>` 로 철회하라',
  revoked: '철회된 위임은 되살릴 수 없다 — 다시 발급해야 한다',
  consumed: '권한은 한 번만 쓰인다 — 다시 진행하려면 사람이 다시 발급해야 한다',
  expired: '만료된 위임은 자동 연장되지 않는다 — 다시 발급하라',
  'trunk-branch-mismatch': '위임이 지정한 trunk 와 실제 통합 대상이 다르다 — 대상을 맞추거나 그 대상으로 다시 발급하라',
  'trunk-moved': 'trunk 가 움직였다 — 사람이 새 기준선을 보고 다시 발급해야 한다',
  'source-mismatch': '위임된 소스 브랜치에서만 통합할 수 있다',
  'scope-out-of-range': '위임 대상 밖의 변경이 범위에 있다 — 범위를 좁히거나 그 대상까지 포함해 다시 발급하라',
  'composition-changed': 'delivery 구성이 바뀌었다 — 바뀐 구성으로 다시 발급해야 한다',
  'evidence-mismatch': '`npx commitgate verify-range --strict` 로 무엇이 미입증인지 먼저 확인하라',
  'high-risk-unacked': 'HIGH 위험은 `--high-risk` 로 명시 위임해야 한다',
  'budget-hardcap': 'hardCap 은 설정으로도 위임으로도 열리지 않는다 — 리뷰가 왜 수렴하지 않는지 봐야 한다',
  'review-inconclusive': 'BLOCKED·미판정 리뷰를 먼저 해소하라',
  'permission-denied': '필요한 권한을 명시해 다시 발급하라(`--allow-push` · `--allow-bypass`)',
}
