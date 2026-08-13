/**
 * delivery set — 상위 작업 묶음 모델 (REQ-2026-066). **fs·git 를 import 하지 않는다** —
 * git 이 필요한 판정(`readDeliveryGate`)은 읽기 전용 실행자를 **주입**받는다(REQ-2026-128 DEC-4).
 *
 * 목적: 여러 REQ를 하나의 묶음으로 묶어 **묶음이 끝날 때까지 main 병합을 미루고 마지막에 한 번만 멈춘다.**
 *
 * 🔴 **전역 백로그가 아니다.** 도구는 "모든 요구사항이 끝났는지"를 스스로 판정하지 않는다 —
 *    사용자가 묶음을 **명시적으로 만들고 명시적으로 닫는다**(`create`/`seal`). 닫히기 전까지 추가는 자유다.
 *
 * 🔴 **레코드의 읽기 정본은 delivery 브랜치다.** feature 브랜치에도 이 파일이 물리적으로 남지만(git 분기
 *    특성) 그 사본은 분기 시점에 고정되어 stale이다. 그것으로 "모두 종결"을 판정하면 분기 이후 추가된
 *    member를 몰라 **조기 정지**한다. 사본을 지우지도 않는다 — 지우면 integrate가 delete/modify 충돌을 내
 *    무충돌 불변식을 스스로 깬다.
 */

/** 레코드 스키마 버전. 🔴 처음부터 둔다 — 나중에 붙이면 옛 파일에 이 키가 없어 판별이 불가능해진다. */
export const DELIVERY_SCHEMA_VERSION = 1

export type DeliveryState = 'open' | 'sealed' | 'approved'
export type MemberStatus = 'active' | 'integrated' | 'superseded'

/**
 * 교체된 parent의 종결 증거 **사본**(설계 DEC-5).
 *
 * 🔴 **해시 포인터로는 부족하다.** parent feature ref는 미승인 변경을 담은 채 병합되지 않으므로
 *    교체 후 **삭제될 수 있고**, 그러면 SHA가 가리키던 object가 GC되어 검증 원본이 사라진다.
 *    그래서 검증한 close-proof 행의 **정규화 사본**을 여기에 담아 delivery에 커밋한다.
 */
export interface SupersededEvidence {
  /** 검증 당시 parent feature의 ref 이름과 HEAD SHA. */
  feature_ref: string
  feature_head_sha: string
  /** 검증한 `series-terminal` close-proof 행의 정규화 사본(본문). */
  close_proof_row: string
  /** 원본 blob SHA와 행 SHA(대조용 — 원본이 살아 있으면 교차검증 가능). */
  close_proof_blob_sha: string
  close_proof_row_sha: string
  /** 검증 시각(실제 시계) + 종결 사유. */
  verified_at: string
  resolution: string
}

export interface DeliveryMember {
  req_id: string
  /** 등록 순서(1부터). successor 체인의 방향 판정에 쓴다. */
  order: number
  /** `begin` 시점의 delivery HEAD. integrate 전제 검증의 기준. */
  delivery_base_sha: string
  status: MemberStatus
  /** 이 member가 교체한 parent REQ id. 없으면 `null`. */
  successor_of: string | null
  /**
   * `begin`이 만든 feature 브랜치 이름(DEC-7). `integrate`는 **현재 checkout 위치가 아니라** 이 값을 쓴다 —
   * 사용자가 다른 브랜치로 이탈해도 같은 결과가 나와야 한다(phase-2 r05 P1).
   */
  feature_ref: string | null
  integrated_at: string | null
  /** `superseded`일 때만 채워진다(DEC-5). */
  superseded_evidence: SupersededEvidence | null
}

export interface DeliveryEvent {
  event: 'created' | 'sealed' | 'approved' | 'reopened'
  at: string
  /** 사람이 입력한 확인 문구(`created`는 `null`). */
  confirmation: string | null
}

export interface DeliveryRecord {
  schema_version: number
  slug: string
  branch: string
  target_branch: string
  state: DeliveryState
  members: DeliveryMember[]
  events: DeliveryEvent[]
}

/**
 * 레코드 **필수** 최상위 키. 🔴 선택 키와 분리해 둔다 — REQ-2026-064가 원장에서 겪은 함정
 * (허용 키 == 필수 키 → 키 추가가 **이미 커밋된 모든 파일**을 무효화)을 신규 스키마가 반복하지 않는다.
 */
export const REQUIRED_RECORD_KEYS = [
  'schema_version',
  'slug',
  'branch',
  'target_branch',
  'state',
  'members',
  'events',
] as const

/** 레코드 **선택** 최상위 키(현재 없음 — 자리를 열어 둔다). 있으면 허용되고 없어도 통과한다. */
export const OPTIONAL_RECORD_KEYS: readonly string[] = []

/** member **필수** 키. */
export const REQUIRED_MEMBER_KEYS = ['req_id', 'order', 'delivery_base_sha', 'status'] as const
/** member **선택** 키 — 옛 레코드에 없어도 통과한다. */
export const OPTIONAL_MEMBER_KEYS = ['successor_of', 'feature_ref', 'integrated_at', 'superseded_evidence'] as const

const STATES: readonly string[] = ['open', 'sealed', 'approved']
const MEMBER_STATUSES: readonly string[] = ['active', 'integrated', 'superseded']

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** 레코드 형식 문제 목록(순수). 빈 배열 = 정상. 손상은 **조용히 넘기지 않는다**. */
export function deliveryRecordProblems(raw: unknown): string[] {
  const p: string[] = []
  if (!isPlainObject(raw)) return ['객체가 아님']

  const allowed = new Set<string>([...REQUIRED_RECORD_KEYS, ...OPTIONAL_RECORD_KEYS])
  for (const k of Object.keys(raw)) if (!allowed.has(k)) p.push(`알 수 없는 키: ${k}`)
  for (const k of REQUIRED_RECORD_KEYS) if (!(k in raw)) p.push(`필수 키 누락: ${k}`)
  if (p.length) return p

  if (raw.schema_version !== DELIVERY_SCHEMA_VERSION)
    p.push(`schema_version 부적합: ${String(raw.schema_version)}(기대 ${DELIVERY_SCHEMA_VERSION})`)
  for (const k of ['slug', 'branch', 'target_branch'] as const)
    if (typeof raw[k] !== 'string' || raw[k] === '') p.push(`${k}가 비어 있음`)
  if (typeof raw.state !== 'string' || !STATES.includes(raw.state)) p.push(`state 부적합: ${String(raw.state)}`)
  if (!Array.isArray(raw.members)) p.push('members가 배열이 아님')
  if (!Array.isArray(raw.events)) p.push('events가 배열이 아님')
  if (p.length) return p

  const seenIds = new Set<string>()
  const seenOrders = new Set<number>()
  for (const [i, m] of (raw.members as unknown[]).entries()) {
    if (!isPlainObject(m)) {
      p.push(`members[${i}]가 객체가 아님`)
      continue
    }
    const mAllowed = new Set<string>([...REQUIRED_MEMBER_KEYS, ...OPTIONAL_MEMBER_KEYS])
    for (const k of Object.keys(m)) if (!mAllowed.has(k)) p.push(`members[${i}] 알 수 없는 키: ${k}`)
    for (const k of REQUIRED_MEMBER_KEYS) if (!(k in m)) p.push(`members[${i}] 필수 키 누락: ${k}`)
    if (typeof m.req_id !== 'string' || m.req_id === '') p.push(`members[${i}].req_id가 비어 있음`)
    if (typeof m.order !== 'number' || !Number.isInteger(m.order) || m.order < 1)
      p.push(`members[${i}].order는 1 이상 정수`)
    if (typeof m.delivery_base_sha !== 'string' || m.delivery_base_sha === '')
      p.push(`members[${i}].delivery_base_sha가 비어 있음`)
    if (typeof m.status !== 'string' || !MEMBER_STATUSES.includes(m.status))
      p.push(`members[${i}].status 부적합: ${String(m.status)}`)
    // 선택 키는 **있으면** 검증한다(없으면 통과).
    if ('successor_of' in m && m.successor_of !== null && typeof m.successor_of !== 'string')
      p.push(`members[${i}].successor_of는 null이거나 문자열`)
    if ('feature_ref' in m && m.feature_ref !== null && typeof m.feature_ref !== 'string')
      p.push(`members[${i}].feature_ref는 null이거나 문자열`)
    if ('integrated_at' in m && m.integrated_at !== null && typeof m.integrated_at !== 'string')
      p.push(`members[${i}].integrated_at은 null이거나 문자열`)
    if ('superseded_evidence' in m && m.superseded_evidence !== null && !isPlainObject(m.superseded_evidence))
      p.push(`members[${i}].superseded_evidence는 null이거나 객체`)
    // 🔴 superseded 인데 증거가 없으면 감사 불가 — 손상으로 본다(DEC-5).
    if (m.status === 'superseded' && !isPlainObject(m.superseded_evidence))
      p.push(`members[${i}]는 superseded인데 superseded_evidence가 없음`)

    if (typeof m.req_id === 'string') {
      if (seenIds.has(m.req_id)) p.push(`members에 중복 req_id: ${m.req_id}`)
      seenIds.add(m.req_id)
    }
    if (typeof m.order === 'number') {
      if (seenOrders.has(m.order)) p.push(`members에 중복 order: ${m.order}`)
      seenOrders.add(m.order)
    }
  }
  return p
}

/** 고정 키 순서 직렬화(deterministic) + 끝 개행. */
export function serializeDeliveryRecord(r: DeliveryRecord): string {
  return `${JSON.stringify(r, null, 2)}\n`
}

/** 활성 member(있으면 하나뿐이어야 한다 — 순차 불변식). */
export function activeMember(r: DeliveryRecord): DeliveryMember | null {
  return r.members.find((m) => m.status === 'active') ?? null
}

export interface CanBeginVerdict {
  ok: boolean
  reason?: string
}

/**
 * `begin` 가능 판정(설계 DEC-2c). 🔴 **두 조건을 함께** 본다.
 *
 * 활성 member 유무만 보면 **닫힌 묶음에 REQ가 추가된다**: 빈 묶음을 `seal`하면 활성 member가 없으므로
 * `begin`이 통과하고, 사용자가 명시적으로 닫았다는 사실(R1)과 "닫힌 전체에 대해 정지"(R4)가
 * 동시에 무너진다. `approve` 이후에도 마찬가지다 — 승인된 묶음의 내용이 사후에 바뀐다.
 */
export function canBegin(r: DeliveryRecord): CanBeginVerdict {
  if (r.state !== 'open')
    return {
      ok: false,
      reason: `묶음이 '${r.state}' 상태입니다 — 닫힌 묶음에는 REQ를 추가할 수 없습니다. 다시 열려면 \`commitgate delivery reopen\`을 쓰세요(기존 승인은 무효화됩니다).`,
    }
  const active = activeMember(r)
  if (active)
    return {
      ok: false,
      reason: `활성 REQ(${active.req_id})가 아직 종결되지 않았습니다 — 순차 진행이라 하나씩만 엽니다. \`commitgate delivery integrate\`로 반영하거나 \`--successor-of\`로 교체하세요.`,
    }
  return { ok: true }
}

/**
 * member 종결(terminal) 판정 — **재귀**(설계 DEC-6).
 *
 * ```text
 * terminal ⇔ integrated
 *          또는 superseded 이고,
 *            같은 delivery 안에 direct successor가 **정확히 하나** 있고,
 *            successor의 order가 parent보다 **뒤**이며,
 *            그 successor가 **재귀적으로** terminal이고,
 *            체인의 마지막 leaf가 **integrated**
 * ```
 *
 * 🔴 "유효 successor가 있다"만으로는 **순환**(`R1→R2→R1`)과 **`superseded`만 이어지는 체인**이
 *    전부 terminal로 보인다. 체인은 acyclic이어야 하고 반드시 `integrated`에서 끝나야 한다.
 */
export function isTerminal(r: DeliveryRecord, reqId: string, visiting: ReadonlySet<string> = new Set()): boolean {
  if (visiting.has(reqId)) return false // 순환 — terminal이 아니다.
  const m = r.members.find((x) => x.req_id === reqId)
  if (!m) return false
  if (m.status === 'integrated') return true
  if (m.status !== 'superseded') return false

  const successors = r.members.filter((x) => x.successor_of === reqId)
  if (successors.length !== 1) return false // 0개 = 미완, 2개 이상 = 모호
  const s = successors[0] as DeliveryMember
  if (s.order <= m.order) return false // 순서 역행 = 잘못된 체인
  return isTerminal(r, s.req_id, new Set([...visiting, reqId]))
}

/** 모든 member가 종결됐는가. member가 0건이면 **참**(빈 묶음은 종결로 본다 — seal 판단은 사용자 몫). */
export function allMembersTerminal(r: DeliveryRecord): boolean {
  return r.members.every((m) => isTerminal(r, m.req_id))
}

export type DeliveryGateKind = 'continue' | 'await-human'

export interface DeliveryGateVerdict {
  kind: DeliveryGateKind
  detail: string
}

/**
 * 최종 게이트 판정(설계 DEC-8a) — **단일 SSOT**.
 *
 * 🔴 `req:next`만 이 판정을 하면 게이트가 **영영 나오지 않는다**: 마지막 member를 integrate하면 그 REQ의
 *    `req:next`는 이미 끝나 있고, 그 뒤 `seal`을 해도 `req:next`를 다시 부를 이유가 없다.
 *    그래서 `integrate`·`seal`·`status`·`req:next` **네 곳이 이 함수 하나를 공유**한다 — 각자 판정하면 갈라진다.
 */
export function deliveryGateVerdict(r: DeliveryRecord): DeliveryGateVerdict {
  if (r.state === 'open')
    return { kind: 'continue', detail: '묶음이 열려 있습니다 — 다음 REQ를 시작하거나 `delivery seal`로 닫으세요.' }
  if (!allMembersTerminal(r)) {
    const pending = r.members.filter((m) => !isTerminal(r, m.req_id)).map((m) => m.req_id)
    return { kind: 'continue', detail: `아직 종결되지 않은 member: ${pending.join(', ')}` }
  }
  if (r.state === 'approved')
    return { kind: 'continue', detail: '이미 통합 승인이 기록됐습니다 — 사람이 I1/I2/B1 절차로 병합합니다.' }
  return {
    kind: 'await-human',
    detail:
      `묶음 '${r.slug}'이 닫혔고 모든 REQ가 종결됐습니다 — ${r.branch} → ${r.target_branch} 통합은 사람 승인이 필요합니다. ` +
      '`commitgate delivery approve`로 승인을 기록한 뒤, 경로(PR 또는 direct push)와 승인 문장은 AGENTS.md 통제점표(I1/I2/B1)를 따르세요.',
  }
}

// ──────────────────────────────────────── 소속·게이트 조회(주입된 read-only git) ──

/**
 * 레코드가 이 REQ 를 member 로 **언급**하는가(손상 레코드에도 쓰이므로 방어적으로 읽는다).
 * 스키마 검증을 통과하지 못한 값에서도 소속을 식별할 수 있어야 fail-closed 판정이 가능하다.
 */
export function mentionsMember(record: unknown, reqId: string): boolean {
  if (!record || typeof record !== 'object') return false
  const ms = (record as { members?: unknown }).members
  if (!Array.isArray(ms)) return false
  return ms.some((m) => !!m && typeof m === 'object' && (m as { req_id?: unknown }).req_id === reqId)
}

/** `readDeliveryGate` 의 반환. `null` 은 **이 REQ 가 어떤 묶음에도 속하지 않음**(또는 refs 를 못 읽음)이다. */
export type DeliveryGateLookup = { slug: string; kind: 'continue' | 'await-human' | 'corrupt'; detail: string } | null

/**
 * 이 REQ 가 속한 delivery 묶음의 게이트 판정(REQ-2026-066 DEC-10).
 *
 * 🔴 **delivery ref에서** 읽는다 — feature 사본은 분기 시점에 고정되어 stale 이므로 그것으로 판정하면
 *    앞선 member 만 반영된 상태를 보고 **조기 정지**한다(DEC-3).
 * 🔴 판정은 `deliveryGateVerdict` **하나**를 쓴다 — `integrate`·`seal`·`status`와 갈라지면 안 된다.
 *
 * 묶음을 찾는 방법: `refs/heads/delivery/*` 를 훑어 각 레코드에서 이 REQ 를 member 로 가진 것을 찾는다.
 * 레코드가 손상됐거나 읽을 수 없으면 `null`(= 묶음 정지 대상 아님) — 여기서 fail-closed 하면
 * delivery 를 쓰지 않는 사용자의 정상 종단까지 막힌다.
 *
 * ⚠️ **한계**(REQ-2026-128 DEC-7): 반환 `null` 은 "묶음 없음"과 "refs 를 못 읽음"을 **구분하지 않는다**.
 *    소속 판정을 이 값으로 대신하는 소비자는 그 사실을 알고 써야 한다 — 묶음 보증의 강제 지점은
 *    `delivery integrate` 자격검사이지 이 조회가 아니다.
 */
export function readDeliveryGate(ticketRoot: string, reqId: string, roGit: (args: string[]) => string): DeliveryGateLookup {
  let branches: string[]
  try {
    branches = roGit(['for-each-ref', '--format=%(refname:short)', 'refs/heads/delivery/'])
      .split('\n')
      .map((x) => x.trim())
      .filter(Boolean)
  } catch {
    return null
  }
  for (const branch of branches) {
    const slug = branch.slice('delivery/'.length)
    if (!slug) continue
    let record: unknown
    try {
      record = JSON.parse(roGit(['show', `${branch}:${ticketRoot}/delivery/${slug}.json`]))
    } catch {
      continue
    }
    // 🔴 손상 레코드를 그냥 건너뛰면 "묶음 없음"과 구분되지 않아 종단이 DONE 이 된다 —
    //    묶음 정지 게이트가 조용히 사라진다(phase-3 r02 P1). 이 REQ 를 member 로 **식별할 수 있으면**
    //    손상이라도 fail-closed 로 전파한다. 식별조차 안 되는 레코드만 건너뛴다.
    const problems = deliveryRecordProblems(record)
    if (!mentionsMember(record, reqId)) continue
    if (problems.length)
      return { slug, kind: 'corrupt', detail: `delivery 레코드 손상(${branch}): ${problems.slice(0, 3).join('; ')}` }
    const v = deliveryGateVerdict(record as DeliveryRecord)
    return { slug, kind: v.kind, detail: v.detail }
  }
  return null
}

/** `approve` 가능 판정 — `sealed` && 모든 member terminal 일 때만(설계 DEC-8). */
export function canApprove(r: DeliveryRecord): CanBeginVerdict {
  if (r.state === 'approved') return { ok: false, reason: '이미 승인됐습니다.' }
  if (r.state !== 'sealed') return { ok: false, reason: '묶음이 아직 열려 있습니다 — `delivery seal`로 먼저 닫으세요.' }
  if (!allMembersTerminal(r)) {
    const pending = r.members.filter((m) => !isTerminal(r, m.req_id)).map((m) => m.req_id)
    return { ok: false, reason: `아직 종결되지 않은 member가 있습니다: ${pending.join(', ')}` }
  }
  return { ok: true }
}

/** integrate **위상** 전제(순수 — git 사실은 입력으로 받는다). 자격 검증은 별도(DEC-2b, phase-2). */
export interface IntegrateTopologyFacts {
  /** 레코드가 기억하는 base(감사 정보 + 이력 선상 확인용). */
  memberBaseSha: string
  /** 현재 delivery HEAD. */
  deliveryHeadSha: string
  /**
   * 🔴 `merge-base(delivery, feature) .. delivery HEAD` 의 변경 경로가 **delivery 레코드 파일뿐**인가 —
   * **무충돌의 실제 보장**이다(design r03).
   *
   * 내가 분기한 뒤 delivery에서 움직인 것이 레코드 파일밖에 없다면, 그 변경은 feature 쪽 코드와 겹칠 수
   * 없으므로 병합이 코드 충돌을 낼 수 없다.
   *
   * 🔴 **왜 ancestry가 아닌가**: "delivery HEAD가 feature의 조상"은 이 성질의 **충분조건일 뿐**(변경이 아예
   *    없는 경우)이고, **membership을 delivery에 기록하는 것과 양립 불가**했다 — member 레코드 커밋이
   *    delivery HEAD를 feature 분기점 너머로 밀기 때문이다. 순서를 바꿔도 같고, 커밋이 분기점보다 앞서려면
   *    REQ 번호를 `req:new` 이전에 알아야 하는데 채번은 `req:new`가 한다. 그래서 조건을 **정밀한 쪽**으로 바꿨다.
   */
  deliveryDivergedOnlyByRecord: boolean
  /** 위 판정에 쓰인, 레코드 외 변경 경로(진단 메시지용). */
  deliveryNonRecordPaths: readonly string[]
  /**
   * 기록된 base가 현재 delivery HEAD의 **조상(또는 동일)** 인가 — 같은 이력 선상인지 보는 정합성 검사.
   * 🔴 **동일성을 요구하지 않는다**(design r02): `begin`이 member 레코드를 커밋하므로 delivery HEAD는
   *    기록된 base보다 항상 앞선다. 이 검사는 손으로 고친 엉뚱한 base를 잡기 위한 것이다.
   */
  baseIsAncestorOfDeliveryHead: boolean
  /**
   * 🔴 `merge-base(delivery, feature) .. feature` 가 건드린 **delivery 레코드 경로**(design r07 P1).
   *
   * delivery 쪽만 보면 무충돌이 성립하지 않는다 — delivery는 member 등록으로 레코드를 바꾸고,
   * feature가 분기 시점 사본을 편집하면 **정확히 그 파일에서** 병합 충돌이 난다.
   * 사본은 판정 입력도 편집 대상도 아니므로(DEC-3), 편집됐다면 거부한다.
   */
  featureChangedRecordPaths: readonly string[]
  /** 워킹트리가 clean 한가. */
  worktreeClean: boolean
  /** 진행 중 merge/rebase가 없는가. */
  noMergeInProgress: boolean
}

/**
 * integrate 위상 전제 판정(설계 DEC-2). 어긋나면 **merge·레코드 write 0건**이어야 한다.
 *
 * 🔴 여기서 통과해도 **내용이 검수됐다는 뜻은 아니다** — 통합 자격(DEC-2b)은 별도이고 **더 앞**이다.
 *    위상만 보고 병합하면 "feature에 미승인 변경 커밋 → integrate"가 리뷰 게이트를 통째로 우회한다.
 */
export function integrateTopologyProblems(f: IntegrateTopologyFacts): string[] {
  const p: string[] = []
  if (!f.worktreeClean) p.push('워킹트리가 clean 하지 않습니다')
  if (!f.noMergeInProgress) p.push('진행 중인 merge/rebase가 있습니다')
  if (!f.baseIsAncestorOfDeliveryHead)
    p.push(
      `기록된 base(${f.memberBaseSha.slice(0, 8)})가 현재 delivery HEAD(${f.deliveryHeadSha.slice(0, 8)})의 이력 선상에 없습니다 — 레코드가 다른 이력을 가리킵니다`,
    )
  if (f.featureChangedRecordPaths.length)
    p.push(
      `feature 가 delivery 레코드를 수정했습니다(${f.featureChangedRecordPaths.join(', ')}) — ` +
        '레코드의 정본은 delivery ref 입니다(feature 사본은 판정 입력이 아닙니다). ' +
        '해당 경로를 분기 시점 상태로 되돌린 뒤 다시 시도하세요(삭제하지 마세요 — delete/modify 충돌이 납니다)',
    )
  if (!f.deliveryDivergedOnlyByRecord)
    p.push(
      `분기 이후 delivery에서 레코드 외 변경이 있었습니다(${f.deliveryNonRecordPaths.join(', ') || '경로 미상'}) — ` +
        '자동 rebase·충돌 해결은 하지 않습니다(재검수 없는 코드 유입 방지)',
    )
  return p
}

/** 새 묶음 레코드(순수 팩토리). */
export function newDeliveryRecord(args: {
  slug: string
  branch: string
  targetBranch: string
  at: string
}): DeliveryRecord {
  return {
    schema_version: DELIVERY_SCHEMA_VERSION,
    slug: args.slug,
    branch: args.branch,
    target_branch: args.targetBranch,
    state: 'open',
    members: [],
    events: [{ event: 'created', at: args.at, confirmation: null }],
  }
}

/** 다음 member order(1부터, 최대값+1). */
export function nextOrder(r: DeliveryRecord): number {
  return r.members.reduce((mx, m) => Math.max(mx, m.order), 0) + 1
}
