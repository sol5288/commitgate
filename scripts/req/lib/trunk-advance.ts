/**
 * **인가된 trunk 이동** 판정 (REQ-2026-173).
 *
 * ## 무엇을 푸는가
 * 사전 위임은 `trunk_sha` 를 **순수 비교**해, REQ 를 차례로 통합하면 앞 REQ 병합이 뒤 REQ 들의 위임을
 * 전부 무효화했다. 소비자 실측에서 초과 발급 29건 중 **9건(31%)** 이 이 연쇄였고, 철회 사유가
 * *"같은 승인으로 재발급"* 이라고 적고 있었다.
 *
 * ## 논지
 * 🔴 **사람이 승인한 것은 "무엇을 병합해도 되는가"이지 "main 이 어느 SHA 에 있는가"가 아니다.**
 *    기준선 재고정은 **부기**이고, 범위·권한의 확대는 **결정**이다. 그 둘을 같은 값으로 취급한 것이 결함이었다.
 *
 * ## 통과 조건 — 넷 **전부** (DEC-2)
 * | # | 조건 | 막는 것 |
 * |---|---|---|
 * | 1 | 범위의 머지 커밋이 전부 이 원장의 `executed.merge_sha` 에 있다 | 인가 없이 들어온 병합 |
 * | 2 | `unproven`·`invalid-evidence` 가 0 | 손으로 민 커밋·깨진 증거 |
 * | 3 | `attested` 가 0 | 그 커밋의 승인 ≠ 이 위임을 계속 두는 승인 |
 * | 4 | 수집·분류가 성공했다 | 판정 불가(= 모름)는 거부 |
 *
 * 🔴 **조건 1이 핵심이다.** 2·3만 보면 *"증거는 멀쩡한데 다른 경로로 들어온 병합"* 이 통과한다.
 *    `merge_sha` 대조가 **"이 원장이 인가했다"** 를 못 박는다.
 *
 * 🔴 **판정 불가는 통과가 아니다.** 여기는 차단 지점이므로 모르면 막는다.
 */
import { verifyRangeDeep, type ReadBlobsPort, type ReadBlobsByOidPort } from './verify-range'
import { collectDeepInput } from './verify-range'
import type { GitAdapter } from './adapters'
import type { DelegationRow, TrunkAdvanceVerdict } from './delegation'

export interface TrunkAdvancePorts {
  git: GitAdapter
  readBlobs: ReadBlobsPort
  /** 🔴 REQ-2026-176: OID 요청 경로. */
  readBlobsByOid: ReadBlobsByOidPort
  ticketRoot: string
}

/**
 * **이 trunk 에 대해** 인가된 머지 SHA 집합.
 *
 * 🔴 **`executed` 행을 그 `issued` 행에 결속한다**(phase-1 r03 P1). `merge_sha` 를 무조건 인가로 세면
 *    **다른 trunk 를 대상으로 발급된 위임의 병합**이 이 trunk 의 이동을 인가해 버린다:
 *
 *    ```
 *    T0 에서 main 대상 위임 D 발급
 *    release 대상 위임 R 로 정상 integrate → M(머지) + B(수행 기록)
 *    main 에서 `git merge --ff-only release`  ← main 이 B 까지 움직인다
 *    ```
 *    범위에는 M·B 와 정상 증거뿐이고 M 은 원장에 `executed.merge_sha` 로 있으므로, 결속 없이는
 *    **통과한다**. 그러나 R 의 `trunk_branch` 는 `release` 였고 main 의 이동은 아무도 인가하지 않았다.
 *    **권한 범위 우회**다.
 *
 * 🔴 그래서 `issued.trunk_branch === trunkBranch` 인 위임의 `executed` 만 센다.
 */
export function authorizedMergeShas(rows: readonly DelegationRow[], trunkBranch: string): Set<string> {
  const idsForThisTrunk = new Set(
    rows.filter((r): r is Extract<DelegationRow, { kind: 'issued' }> => r.kind === 'issued' && r.trunk_branch === trunkBranch).map((r) => r.id),
  )
  const out = new Set<string>()
  for (const r of rows)
    if (r.kind === 'executed' && idsForThisTrunk.has(r.id) && typeof r.merge_sha === 'string' && r.merge_sha !== '')
      out.add(r.merge_sha)
  return out
}

/**
 * 🔴 **trunk 자신의 사슬에 올라온 것이 인가된 병합과 그 부기뿐인가**(순수 · phase-1 r01 P1).
 *
 * ## 왜 범위 전체만으로는 부족한가
 * 범위 분류(`unproven`·`attested` 0 + 머지 sha 대조)만 보면 **trunk 에 직접 올라온 `approved` 커밋**이
 * 통과한다. 예: `main` 에서 다른 REQ 의 `req:commit` 을 돌리면 승인 증거가 있는 source 커밋 C 와
 * 부기 B 가 trunk 에 얹힌다. C 는 어느 인가된 병합이 가져온 것도 아니고 **이 위임이 인가한 것도 아니다**.
 *
 * ## 판정
 * `rev-list --first-parent from..to` 의 각 커밋은 다음 중 하나여야 한다:
 *   - 이 원장이 인가한 머지(`executed.merge_sha`)
 *   - `bookkeeping` 으로 분류된 커밋 — `integrate` 가 병합 뒤 남기는 수행 기록이 이것이다
 *
 * 🔴 **side-parent 쪽(병합이 데려온 이력)은 검사 대상이 아니다** — 그것은 그 병합이 인가된 것으로
 *    이미 설명된다. 사슬 위에 있다는 것 자체가 *"trunk 에 직접 올렸다"* 는 뜻이다.
 */
export function firstParentAuthorizationProblem(
  chain: readonly ChainCommit[],
  authorizedMerges: ReadonlySet<string>,
  categoryOf: (sha: string) => string | null,
): string | null {
  for (const c of chain) {
    if (authorizedMerges.has(c.sha)) continue
    /**
     * 🔴 **부기라고 다 허용하지 않는다**(phase-1 r02 P1). `bookkeeping` 분류만 보면, trunk 에서
     *    무관한 `req:delegate` 를 돌려 만든 원장 커밋도 통과한다 — **위임 행 추가는 권한 부여**이므로
     *    그것이 "인가된 병합의 부기"로 통과하면 안 된다.
     *    허용 조건을 **그 병합의 수행 기록**으로 좁힌다: 부기이면서 **첫 부모가 인가된 병합**이어야 한다.
     *    (`integrate` 는 병합 직후 `executed` 행 부기를 정확히 하나 얹는다 — 그 모양만 통과한다.)
     */
    if (categoryOf(c.sha) === 'bookkeeping' && c.firstParent !== null && authorizedMerges.has(c.firstParent)) continue
    return (
      `trunk 사슬에 인가된 병합도 그 수행 기록도 아닌 커밋이 있다: ${c.sha.slice(0, 8)}` +
      `(분류=${categoryOf(c.sha) ?? '미상'}) — 이 위임이 인가한 변경이 아니다`
    )
  }
  return null
}

/** trunk first-parent 사슬 한 항목. 🔴 `firstParent` 를 알아야 "그 병합의 부기"를 가릴 수 있다. */
export interface ChainCommit {
  sha: string
  firstParent: string | null
}

/** `rev-list --first-parent --parents` 출력 파싱(순수). 각 줄 = `<sha> <parent1> [<parent2>…]`. */
export function parseFirstParentChain(out: string): ChainCommit[] {
  const chain: ChainCommit[] = []
  for (const line of out.split('\n').map((l) => l.trim()).filter(Boolean)) {
    const parts = line.split(/\s+/)
    const sha = parts[0]
    if (sha === undefined) continue
    chain.push({ sha, firstParent: parts[1] ?? null })
  }
  return chain
}

/**
 * `from..to` 사이의 trunk 이동이 **이 원장이 인가한 병합만으로** 이루어졌는가.
 *
 * @param rows 원장 행 전체(파싱 완료). 🔴 손상 원장은 호출부가 이미 거부한다.
 */
export function authorizeTrunkAdvance(
  ports: TrunkAdvancePorts,
  rows: readonly DelegationRow[],
  fromSha: string,
  toSha: string,
  /** 🔴 **어느 trunk 의 이동인가**. 인가 집합을 이 branch 로 발급된 위임에 한정한다(phase-1 r03 P1). */
  trunkBranch: string,
): TrunkAdvanceVerdict {
  if (fromSha === toSha) return { authorized: true, mergeShas: [], addedCommits: 0 }

  // ── 조건 4: 수집·분류가 성공해야 한다 ──
  let deepInput: ReturnType<typeof collectDeepInput>
  try {
    deepInput = collectDeepInput(ports.git, ports.readBlobs, fromSha, toSha, ports.ticketRoot, ports.readBlobsByOid)
  } catch (err) {
    return { authorized: false, reason: `trunk 이동 범위를 읽지 못했다: ${err instanceof Error ? err.message : String(err)}` }
  }
  const report = verifyRangeDeep(deepInput)

  // ── 조건 2·3: 증거가 온전하고 예외 승인 커밋이 없다 ──
  const bad: string[] = []
  if (report.counts.unproven > 0) bad.push(`미입증 ${report.counts.unproven}건`)
  if (report.counts['invalid-evidence'] > 0) bad.push(`손상 증거 ${report.counts['invalid-evidence']}건`)
  /**
   * 🔴 `attested` 는 사람이 **그 커밋**을 예외 승인한 것이지, **이 위임을 계속 유효하게 두는 것**을
   *    승인한 것이 아니다. 보수적으로 막고 사람이 다시 발급하게 한다 —
   *    이 자리는 과잉 허용보다 과잉 차단이 안전하다.
   */
  if (report.counts.attested > 0) bad.push(`attested ${report.counts.attested}건(예외 승인 커밋 — 재발급 필요)`)
  if (bad.length > 0)
    return { authorized: false, reason: `trunk 이동 범위에 인가할 수 없는 것이 있다: ${bad.join(' · ')}` }

  // ── 조건 1: 범위의 머지 커밋이 전부 이 원장이 인가한 것이다 ──
  const authorized = authorizedMergeShas(rows, trunkBranch)
  const merges = deepInput.commits.filter((c) => c.parentCount >= 2).map((c) => c.sha)
  const foreign = merges.filter((sha) => !authorized.has(sha))
  if (foreign.length > 0)
    return {
      authorized: false,
      reason: `이 원장이 인가하지 않은 병합이 trunk 에 있다: ${foreign.map((s) => s.slice(0, 8)).join(', ')}`,
    }

  // ── 조건 1′: trunk **자신의 사슬**에 올라온 것이 인가된 병합과 그 부기뿐이다 ──
  let chain: ChainCommit[]
  try {
    // 🔴 `--parents` 가 필요하다 — 첫 부모를 알아야 "그 병합의 수행 기록"인지 가릴 수 있다.
    chain = parseFirstParentChain(ports.git.exec(['rev-list', '--first-parent', '--parents', `${fromSha}..${toSha}`]))
  } catch (err) {
    return { authorized: false, reason: `trunk first-parent 사슬을 읽지 못했다: ${err instanceof Error ? err.message : String(err)}` }
  }
  const categoryOf = new Map(report.entries.map((e) => [e.sha, e.category]))
  const chainProblem = firstParentAuthorizationProblem(chain, authorized, (sha) => categoryOf.get(sha) ?? null)
  if (chainProblem !== null) return { authorized: false, reason: chainProblem }

  /**
   * 🔴 **머지가 하나도 없는 이동은 인가된 것이 아니다.** 부기만으로 trunk 가 움직였다면 그것은
   *    통합 경로가 아닌 무언가가 trunk 를 건드린 것이다 — `bookkeeping` 분류를 통과했더라도
   *    "인가된 병합만으로 움직였다"는 주장은 거짓이 된다.
   */
  if (merges.length === 0)
    return { authorized: false, reason: 'trunk 가 움직였는데 인가된 병합이 하나도 없다(부기만으로 이동)' }

  return { authorized: true, mergeShas: merges, addedCommits: deepInput.commits.length }
}
