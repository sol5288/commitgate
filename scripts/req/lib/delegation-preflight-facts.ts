/**
 * 발급 시점 preflight 가 쓰는 **사실 수집** (REQ-2026-172 phase-2).
 *
 * 🔴 `bin/integrate.ts` 의 `delegationGate` 가 모으는 것과 **같은 집합·같은 함수**다.
 *    다른 입력으로 같은 술어를 돌리면 판정이 갈라진다 — REQ-2026-094 의 교훈은
 *    *"술어뿐 아니라 입력 획득까지 맞춰야 한다"* 였다.
 *
 * 🔴 **모르면 막지 않는다.** 여기서 못 읽은 것이 있으면 `unavailable` 을 돌려주고 호출부는 **발급을
 *    허용하되 그 사실을 말한다**. 발급은 조기 경보이고 **진짜 게이트는 `integrate` 에 그대로 있다** —
 *    모른다고 발급을 막으면 정상 흐름이 죽는다. (통합 지점의 "모르면 멈춘다"와 층이 다르다.)
 */
import { verifyRangeDeep, collectDeepInput, type ReadBlobsPort } from './verify-range'
import { attributeRange, type AttributionDetail } from './range-attribution'
import { readTicketFacts } from './integration-facts'
import type { GitAdapter } from './adapters'
import type { DelegationScope } from './delegation'

export interface PreflightFactPorts {
  git: GitAdapter
  readBlobs: ReadBlobsPort
  ticketRoot: string
  reviewHardCap: number
}

export interface PreflightFacts {
  riskLevel: string | null
  budgetHardCapReached: boolean
  reviewInconclusive: boolean
  evidenceOk: boolean
  rangeAttribution: AttributionDetail
  deliveryMembers: string[] | null
  compositionChanged: boolean
}

export type PreflightFactsResult =
  | { kind: 'facts'; facts: PreflightFacts }
  /** 판정에 필요한 것을 읽지 못했다 — 호출부는 **막지 않고** 이 사유를 말한다. */
  | { kind: 'unavailable'; reason: string }

/** delivery 레코드의 멤버 목록(발급 시점 ref 기준). 읽지 못하면 `null`. */
function readDeliveryMembers(
  ports: PreflightFactPorts,
  slug: string,
  ref: string,
): string[] | null {
  const rel = `${ports.ticketRoot}/delivery/${slug}.json`
  try {
    const buf = ports.readBlobs(ref, [rel]).get(rel)
    if (buf === null || buf === undefined) return null
    const rec = JSON.parse(buf.toString('utf8')) as { members?: unknown }
    if (!Array.isArray(rec.members)) return null
    return rec.members.filter((m): m is string => typeof m === 'string')
  } catch {
    return null
  }
}

/**
 * 범위(`trunkSha..sourceSha`)와 티켓 state 에서 판정 사실을 모은다.
 *
 * 🔴 `evidenceOk` 는 `verify-range --strict` 와 **같은 기준**이다: 미입증·손상 증거가 0 이어야 한다.
 *    (`attested` 는 여기서 보지 않는다 — 그것은 scope 축이 `attested_ack` 와 함께 판정한다.)
 */
export function collectPreflightFacts(
  ports: PreflightFactPorts,
  scope: DelegationScope,
  trunkSha: string,
  sourceSha: string,
): PreflightFactsResult {
  let deepInput: ReturnType<typeof collectDeepInput>
  try {
    deepInput = collectDeepInput(ports.git, ports.readBlobs, trunkSha, sourceSha, ports.ticketRoot)
  } catch (err) {
    return { kind: 'unavailable', reason: `범위를 읽지 못했습니다: ${err instanceof Error ? err.message : String(err)}` }
  }
  const report = verifyRangeDeep(deepInput)
  const rangeAttribution = attributeRange({
    commits: deepInput.commits,
    entries: report.entries,
    manifests: deepInput.manifests,
    ticketRoot: ports.ticketRoot,
  })

  const members =
    scope.kind === 'delivery' ? readDeliveryMembers(ports, scope.slug, sourceSha) : null
  if (scope.kind === 'delivery' && members === null)
    return { kind: 'unavailable', reason: `delivery 레코드(${scope.slug})의 멤버 목록을 읽지 못했습니다` }

  const ticketIds = scope.kind === 'ticket' ? [scope.req_id] : members ?? []
  const each = ticketIds.map((id) =>
    readTicketFacts(ports.readBlobs, sourceSha, ports.ticketRoot, id, ports.reviewHardCap),
  )

  return {
    kind: 'facts',
    facts: {
      // 🔴 `integrate` 와 같은 합치기: 하나라도 HIGH 면 HIGH, 하나라도 막히면 막힌다.
      riskLevel: each.some((f) => f.riskLevel === 'HIGH') ? 'HIGH' : 'LOW',
      budgetHardCapReached: each.some((f) => f.budgetHardCapReached),
      reviewInconclusive: each.some((f) => f.reviewInconclusive),
      evidenceOk: report.counts.unproven === 0 && report.counts['invalid-evidence'] === 0,
      rangeAttribution,
      deliveryMembers: members,
      /**
       * 🔴 발급 시점에는 **비교 대상이 없다** — 구성 변경은 "발급 이후" 개념이다.
       *    그래서 언제나 `false` 이고, 이것은 추측이 아니라 정의상 참이다.
       */
      compositionChanged: false,
    },
  }
}
