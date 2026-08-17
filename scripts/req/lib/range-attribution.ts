/**
 * 병합 범위의 **티켓 귀속** — `stopGate: "auto"` 의 scope 결속 (REQ-2026-140 phase-4a · 설계 DEC-4a).
 *
 * 🔴 **왜 필요한가**: 위임은 "티켓 A 를 통합해도 된다"인데, strict 검증은 **브랜치 전체**를 본다.
 *    한 feature 브랜치에 A 와 B 의 승인된 커밋이 함께 있으면(이 저장소의 체인이 정확히 그 모양이다)
 *    A 로 받은 위임이 **B 까지 통합**한다. 식별자를 적게 해 놓고 강제하지 않으면 그 칸은 장식이다.
 *
 * 🔴 **판정 불가는 거부다.** 여기는 조회·진단이 아니라 **차단 지점**이라, "모르겠음"을 통과로 읽으면
 *    그것이 곧 구멍이다. (`req:doctor` 의 "모르면 판단 안 함" 과 반대 방향이고, 그 차이는 의도적이다.)
 *
 * 🔴 **분류는 새로 만들지 않는다.** `verifyRangeDeep` 이 이미 6범주로 나눈 결과와, 그것이 쓰는
 *    소비 행 매핑(`collectConsumedRows`)을 **그대로 재사용**한다 — 분류기를 두 벌 두면 갈라진다.
 */
import { DELEGATION_LEDGER_REL, type RangeAttribution } from './delegation'
import { collectConsumedRows, type DeepCategory, type DeepCommitMeta, type ManifestFile } from './verify-range'

/**
 * repo 수준 부기로 **허용되는 정확한 경로 집합**.
 *
 * 🔴 **집합이지 접두가 아니다**(phase-4a 리뷰 r01 P1). 예전에는 "`<ticketRoot>/` 아래인데 티켓
 *    디렉터리가 아니면 repo 수준"으로 뭉뚱그렸다. 그러면 `workflow/delivery/S.json` 같은 **다른 도구
 *    상태**까지 티켓 위임에 편승해 통합된다 — scope 제한을 정면으로 우회한다.
 *    여기에는 **CAS 소비 커밋이 반드시 바꾸는 위임 원장**만 둔다.
 */
export const REPO_LEVEL_BOOKKEEPING_PATHS: readonly string[] = [DELEGATION_LEDGER_REL]

/** 커밋 제목의 `chore(REQ-XXXX):` 에서 티켓을 읽는다(DEC-4a 의 도구 부기 귀속 규칙). */
export function ticketOfSubject(subject: string): string | null {
  const m = /^[a-z]+\((REQ-\d{4}-\d{3,})\)/.exec(subject.trim())
  return m === null ? null : (m[1] as string)
}

/**
 * `<ticketRoot>/delivery/<slug>.json` → `<slug>`. delivery 레코드가 아니면 `null`.
 *
 * 🔴 **정상 경로를 막지 않기 위해 필요하다**(phase-4a 리뷰 r03 P1). `commitgate delivery create/begin`
 *    은 이 파일만 바꾸고 제목이 `chore(delivery): …` 라 REQ 를 담지 않는다. 그것을 판정 불가로 두면
 *    **지원되는 delivery scope 의 정상 자율 통합이 통째로 막힌다.** 대신 슬러그로 귀속시켜
 *    "그 묶음의 위임에서만 정상"이라는 판정을 가능하게 한다.
 */
export function deliveryOfPath(path: string, ticketRoot: string): string | null {
  const prefix = `${ticketRoot}/delivery/`
  if (!path.startsWith(prefix) || !path.endsWith('.json')) return null
  const slug = path.slice(prefix.length, -'.json'.length)
  return slug === '' || slug.includes('/') ? null : slug
}

export interface AttributionInput {
  /** 범위의 커밋(변경 경로 포함) — `verifyRangeDeep` 에 넘긴 것과 **같은 배열**. */
  commits: readonly DeepCommitMeta[]
  /** `verifyRangeDeep` 의 판정. sha → 범주. */
  entries: readonly { sha: string; category: DeepCategory }[]
  manifests: readonly ManifestFile[]
  /** repo-상대 ticketRoot(예: `workflow`). */
  ticketRoot: string
}

/**
 * 귀속을 판정하지 못한 커밋 하나.
 *
 * 🔴 `category` 는 `verify-range` 의 분류를 **그대로 옮긴 것**이다(재해석하지 않는다). 분류 결과에
 *    없는 커밋이면 `null` — "모른다"를 어떤 범주로도 읽지 않는다.
 *
 * 🔴 **`why`(산문)를 파싱해 사유를 추정하지 않는다**(REQ-2026-168 DEC-1). 산문은 다듬을 수 있고,
 *    다듬는 순간 판정이 바뀐다. 호출부가 *"전부 attested 인가"* 를 물으려면 기계가 읽는 축이 필요하다.
 */
export interface UnattributableCommit {
  sha: string
  subject: string
  why: string
  category: string | null
}

/** 상세 결과 — 왜 판정 불가인지 사람에게 말하기 위해 남긴다. */
export interface AttributionDetail extends RangeAttribution {
  /** 귀속을 판정하지 못한 커밋(요약). */
  unattributableCommits: UnattributableCommit[]
  /** 티켓에 속하지 않지만 정상인 **repo 수준 부기**(예: 위임 원장). */
  repoLevelBookkeeping: number
}

/** `workflow/REQ-2026-140/...` → `REQ-2026-140`. 티켓 디렉터리가 아니면 `null`. */
export function ticketOfPath(path: string, ticketRoot: string): string | null {
  const prefix = `${ticketRoot}/`
  if (!path.startsWith(prefix)) return null
  const seg = path.slice(prefix.length).split('/')[0]
  return seg !== undefined && /^REQ-\d{4}-\d{3,}$/.test(seg) ? seg : null
}

/**
 * 범위의 귀속을 계산한다.
 *
 * | 범주 | 귀속 |
 * |---|---|
 * | `merge` | 없음 — 부모로 흡수된다 |
 * | `bookkeeping` | 변경 경로의 티켓. 티켓 디렉터리가 아니면(예: 위임 원장) **repo 수준**이라 정상 |
 * | `approved` | 승인 증거 매니페스트의 티켓 |
 * | `attested` | 🔴 **판정 불가** — 리뷰 없이 예외 승인된 커밋을 자율 통합에 태우지 않는다 |
 * | `unproven`·`invalid-evidence` | 🔴 판정 불가 — strict 가 먼저 막지만 여기서도 통과시키지 않는다 |
 */
export function attributeRange(input: AttributionInput): AttributionDetail {
  const { rows: consumed } = collectConsumedRows(input.manifests)
  const byCategory = new Map(input.entries.map((e) => [e.sha, e.category]))
  const tickets = new Set<string>()
  const deliveries = new Set<string>()
  const unattributableCommits: AttributionDetail['unattributableCommits'] = []
  let repoLevelBookkeeping = 0

  for (const c of input.commits) {
    const category = byCategory.get(c.sha)
    if (category === undefined) {
      unattributableCommits.push({ sha: c.sha, subject: c.subject, why: '분류 결과에 없는 커밋', category: null })
      continue
    }
    if (category === 'merge') continue

    if (category === 'approved') {
      const rows = consumed.get(c.sha) ?? []
      const rels = new Set(rows.map((r) => r.ticketRel))
      if (rels.size === 0) {
        unattributableCommits.push({ sha: c.sha, subject: c.subject, why: '승인 커밋인데 소비 행을 찾지 못함', category })
        continue
      }
      // 🔴 한 커밋을 여러 티켓이 소비했다면 그 **전부**를 귀속으로 본다(더 좁게 읽지 않는다).
      for (const rel of rels) {
        const id = rel.split('/')[1]
        if (id === undefined)
          unattributableCommits.push({ sha: c.sha, subject: c.subject, why: `매니페스트 경로 해석 실패: ${rel}`, category })
        else tickets.add(id)
      }
      continue
    }

    if (category === 'bookkeeping') {
      /**
       * 🔴 **모든 경로를 분류한다**(r02 P1). 예전에는 티켓 디렉터리 경로가 하나라도 있으면 거기서
       *    끝내고 같은 커밋의 나머지 경로를 보지 않았다 — `workflow/REQ-2026-140/…` 와
       *    `workflow/delivery/S.json` 을 함께 바꾼 부기가 **140 위임만으로** 통합됐다.
       *    한 경로라도 설명되지 않으면 이 커밋은 판정되지 않은 것이다.
       */
      if (c.changedPaths.length === 0) {
        unattributableCommits.push({ sha: c.sha, subject: c.subject, why: '변경 경로가 없는 부기 커밋', category })
        continue
      }
      const owners = new Set<string>()
      const unclassified: string[] = []
      for (const p of c.changedPaths) {
        const t = ticketOfPath(p, input.ticketRoot)
        if (t !== null) {
          owners.add(t)
          continue
        }
        const slug = deliveryOfPath(p, input.ticketRoot)
        if (slug !== null) {
          deliveries.add(slug)
          continue
        }
        if (!REPO_LEVEL_BOOKKEEPING_PATHS.includes(p)) unclassified.push(p)
      }
      if (unclassified.length > 0) {
        // 경로로 설명되지 않는 변경은 **제목의 `chore(REQ-XXXX):`** 가 책임진다(DEC-4a).
        const fromSubject = ticketOfSubject(c.subject)
        if (fromSubject === null) {
          unattributableCommits.push({
            sha: c.sha,
            subject: c.subject,
            why: `도구 부기인데 티켓을 판정할 수 없는 경로가 있다(제목에 chore(REQ-…) 없음): ${unclassified.slice(0, 2).join(', ')}`,
            category,
          })
          continue
        }
        owners.add(fromSubject)
      }
      if (owners.size === 0) {
        // 전부 허용된 repo 수준 경로 또는 delivery 레코드 — 티켓 귀속은 없다.
        // (delivery 레코드는 `deliveries` 축이 따로 판정한다.)
        repoLevelBookkeeping++
        continue
      }
      for (const o of owners) tickets.add(o)
      continue
    }

    unattributableCommits.push({
      sha: c.sha,
      subject: c.subject,
      why:
        category === 'attested'
          ? 'attested(정식 리뷰 없이 예외 승인된 커밋) — 자율 통합 대상이 아니다'
          : `${category} — 승인 증거로 귀속을 판정할 수 없다`,
      category,
    })
  }

  return {
    tickets: [...tickets].sort(),
    deliveries: [...deliveries].sort(),
    unattributable: unattributableCommits.length,
    // 🔴 REQ-2026-168: `--allow-attested` 가 **전부 attested 인가**를 물을 수 있게 함께 센다.
    //    여기서 세는 이유는 호출부가 `why`(산문)를 파싱하지 않게 하기 위해서다.
    unattributableAttested: unattributableCommits.filter((c) => c.category === 'attested').length,
    unattributableCommits,
    repoLevelBookkeeping,
  }
}
