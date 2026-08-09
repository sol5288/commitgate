/**
 * verify-range 순수 코어 (REQ-2026-116) — **커밋 범위의 로컬 승인 증거 분류·판정**.
 *
 * "base..head의 각 커밋이 CommitGate 절차를 거쳤는가"를 로컬 git과 **head 트리에 커밋된 증거**만으로
 * 분류한다. D25/D30이 티켓 단위 trunk 도달을 보는 것과 축이 다르다 — 여기는 **커밋 단위**다.
 * 실제 소비자 감사에서 "consumed approval SHA·부기 trailer 어느 것으로도 입증 불가"인 커밋 범위가
 * 발견된 것이 이 모듈의 존재 이유다(00-requirement 배경 1).
 *
 * 🔴 순수 모듈 — fs·git·네트워크를 모른다. 커밋 메타와 manifest 본문은 호출부(bin/verify-range.ts)가
 *    포트로 수집한다(`lib/close-proof`·`lib/review-ledger`와 같은 태도). GitHub 인증·gh CLI와 무관하다.
 *
 * 경계(설계 DEC-2): squash/rebase로 재작성된 커밋은 소비 시점 SHA와 달라 `unproven`으로 나온다.
 * 이 모듈은 주어진 범위를 있는 그대로 검증할 뿐, "모든 우회를 잡는다"고 약속하지 않는다.
 */
import { BOOKKEEPING_TRAILER } from './bookkeeping'

/** 분류에 필요한 커밋 메타(호출부가 `git rev-list`/`git log`에서 수집). */
export interface CommitMeta {
  sha: string
  /** 부모 수 — 2 이상이면 merge 커밋. */
  parentCount: number
  /** 요약 줄(보고용 — 판정에는 쓰지 않는다). */
  subject: string
  /** 커밋 메시지 전문(trailer 포함). */
  message: string
}

/** 분류 4범주(설계 DEC-2 — 판정 순서 고정). */
export type CommitCategory = 'merge' | 'bookkeeping' | 'approved' | 'unproven'

/** git OID(SHA-1 40 / SHA-256 64 hex). `evidence.ts`의 검증과 같은 형태 — 여기서는 소비 SHA 추출에 쓴다. */
const OID_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/

export interface ConsumedShas {
  shas: Set<string>
  /** 파싱 실패·스키마 이탈 행 수 — 손상을 숨기지 않되, 손상 하나가 전체 검증을 죽이지 않는다(DEC-2). */
  problems: number
}

/**
 * head 트리의 `workflow/REQ-*⁠/responses/approvals.jsonl` 본문들에서 `consumed_by_commit_sha` 집합을 뽑는다.
 *
 * 🔴 **관대 파싱이다**: JSON 파싱 실패 행·consumed_by_commit_sha가 유효 OID가 아닌 행은 건너뛰고
 *    `problems`로 센다. `parseApprovalsManifest`(evidence.ts)를 쓰지 않는 이유 — 그쪽은 매니페스트
 *    **전체의 무결성**을 fail-closed로 판정하는 게이트 입력이고, 여기는 범위 밖 티켓의 낡은 매니페스트
 *    한 줄 때문에 검증 전체가 죽으면 안 되는 **감사 보고**다(D30의 fail-open 태도).
 */
export function consumedShasFromManifests(contents: readonly string[]): ConsumedShas {
  const shas = new Set<string>()
  let problems = 0
  for (const content of contents) {
    for (const line of content.split('\n')) {
      if (line.trim() === '') continue
      let raw: unknown
      try {
        raw = JSON.parse(line)
      } catch {
        problems++
        continue
      }
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        problems++
        continue
      }
      const sha = (raw as { consumed_by_commit_sha?: unknown }).consumed_by_commit_sha
      if (typeof sha !== 'string' || !OID_RE.test(sha)) {
        problems++
        continue
      }
      shas.add(sha)
    }
  }
  return { shas, problems }
}

/** 메시지에 부기 trailer **줄**이 있는가 — 본문 산문에 섞인 언급은 부기가 아니다(줄 단위 일치). */
function hasBookkeepingTrailer(message: string): boolean {
  return message.split('\n').some((l) => l.trim() === BOOKKEEPING_TRAILER)
}

/**
 * 커밋 1개 분류(설계 DEC-2 — 첫 일치가 범주):
 * merge(부모 2+) → bookkeeping(trailer 줄) → approved(소비 SHA 집합) → unproven.
 */
export function classifyCommit(commit: CommitMeta, consumedShas: ReadonlySet<string>): CommitCategory {
  if (commit.parentCount >= 2) return 'merge'
  if (hasBookkeepingTrailer(commit.message)) return 'bookkeeping'
  if (consumedShas.has(commit.sha)) return 'approved'
  return 'unproven'
}

export interface VerifyRangeInput {
  commits: readonly CommitMeta[]
  /** head 트리에서 읽은 approvals.jsonl 본문들(경로 나열·읽기는 호출부). */
  manifestContents: readonly string[]
}

export interface VerifyRangeReport {
  entries: { sha: string; subject: string; category: CommitCategory }[]
  counts: Record<CommitCategory, number>
  /** 사람 승인자가 볼 목록 — 이 verb의 1차 산출물(DEC-1). */
  unproven: { sha: string; subject: string }[]
  manifestProblems: number
}

/** 범위 전체 분류(순수). 빈 범위도 정상 수행이다 — "검증 생략"과 구별된다(완료 기준 8). */
export function verifyRange(input: VerifyRangeInput): VerifyRangeReport {
  const { shas, problems } = consumedShasFromManifests(input.manifestContents)
  const counts: Record<CommitCategory, number> = { merge: 0, bookkeeping: 0, approved: 0, unproven: 0 }
  const entries = input.commits.map((c) => {
    const category = classifyCommit(c, shas)
    counts[category]++
    return { sha: c.sha, subject: c.subject, category }
  })
  return {
    entries,
    counts,
    unproven: entries.filter((e) => e.category === 'unproven').map((e) => ({ sha: e.sha, subject: e.subject })),
    manifestProblems: problems,
  }
}

/** CI 선택 결과(설계 DEC-5의 감사 로그 어휘와 동일 — phase-2의 CLI가 이 값을 만든다). */
export type CiOutcome = 'skipped-default' | 'skipped-explicit' | 'checked-ok' | 'checked-fail'

/**
 * exit 계약(설계 DEC-1·DEC-7, 순수):
 * - 기본은 0 — 미입증이 있어도 **보고**가 1차 역할이다(fail 기본은 규정된 워크플로 외 커밋에서 즉시 오탐).
 * - `--strict`이고 미입증>0 → 1 (게이트로 쓰고 싶은 저장소의 opt-in).
 * - 명시 요청한 CI 확인 실패(`checked-fail`) → 1 — 요청된 CI 실패를 조용히 무시하지 않는다(정책 12).
 */
export function computeExit(input: { unprovenCount: number; strict: boolean; ci: CiOutcome }): 0 | 1 {
  if (input.ci === 'checked-fail') return 1
  if (input.strict && input.unprovenCount > 0) return 1
  return 0
}
