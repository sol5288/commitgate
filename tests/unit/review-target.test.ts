import { describe, it, expect } from 'vitest'
import { computeReviewSemanticIdentity } from '../../scripts/req/lib/review-target'

/**
 * review-target semantic identity (REQ-2026-052 phase-2) — 순수 함수. git은 stub으로 주입.
 * ⚠️ 실제 git 통합은 near-e2e(req-review-codex.test.ts)가 검증. 여기선 필터/정렬/hash 규칙만.
 */

/** `git ls-files -s` 출력을 흉내내는 stub. lines를 개행으로 join해 반환. */
const gitStub = (lines: string[]) => (args: string[]): string => {
  expect(args).toEqual(['ls-files', '-s']) // 🔴 read-only ls-files만 부른다(write-tree 금지).
  return lines.join('\n')
}

const line = (oid: string, path: string): string => `100644 ${oid} 0\t${path}`
const T = 'workflow/REQ-2026-001'

describe('[review-target] responses/ 제외 — 정확한 티켓 경계', () => {
  it('티켓 responses/ 하위는 제외, 그 밖은 포함', () => {
    const withLedger = [
      line('a'.repeat(40), 'app/src/x.ts'),
      line('b'.repeat(40), `${T}/01-design.md`),
      line('c'.repeat(40), `${T}/responses/review-ledger.jsonl`),
      line('d'.repeat(40), `${T}/responses/approvals.jsonl`),
    ]
    const withoutResponses = [
      line('a'.repeat(40), 'app/src/x.ts'),
      line('b'.repeat(40), `${T}/01-design.md`),
    ]
    // responses/ 내용이 달라져도(원장·approvals 유무) identity가 같다.
    expect(computeReviewSemanticIdentity(T, gitStub(withLedger))).toBe(computeReviewSemanticIdentity(T, gitStub(withoutResponses)))
  })

  it('responses/ 안의 아무 파일 변화도 identity를 바꾸지 않는다(ledger·approvals·archive·close-proof)', () => {
    const a = [line('1'.repeat(40), `${T}/responses/review-ledger.jsonl`), line('x'.repeat(40), `${T}/00-requirement.md`)]
    const b = [
      line('2'.repeat(40), `${T}/responses/review-ledger.jsonl`), // 원장 변화
      line('9'.repeat(40), `${T}/responses/design-r01-approved.json`), // 아카이브 추가
      line('7'.repeat(40), `${T}/responses/ticket-close.jsonl`), // close proof 추가
      line('x'.repeat(40), `${T}/00-requirement.md`),
    ]
    expect(computeReviewSemanticIdentity(T, gitStub(a))).toBe(computeReviewSemanticIdentity(T, gitStub(b)))
  })

  it('리뷰 대상(design 문서) 변화는 identity를 바꾼다', () => {
    const a = [line('1'.repeat(40), `${T}/01-design.md`)]
    const b = [line('2'.repeat(40), `${T}/01-design.md`)]
    expect(computeReviewSemanticIdentity(T, gitStub(a))).not.toBe(computeReviewSemanticIdentity(T, gitStub(b)))
  })

  it('phase 코드(workflow/ 밖) 변화는 identity를 바꾼다', () => {
    const a = [line('1'.repeat(40), 'app/src/x.ts')]
    const b = [line('2'.repeat(40), 'app/src/x.ts')]
    expect(computeReviewSemanticIdentity(T, gitStub(a))).not.toBe(computeReviewSemanticIdentity(T, gitStub(b)))
  })

  it('다른 티켓의 responses/ 는 제외하지 않는다(정확히 이 티켓 경계)', () => {
    const other = 'workflow/REQ-2026-002'
    const a = [line('1'.repeat(40), `${other}/responses/review-ledger.jsonl`)]
    const b = [line('2'.repeat(40), `${other}/responses/review-ledger.jsonl`)]
    // 다른 티켓의 responses/ 변화는 이 티켓 identity를 바꾼다(광범위 제외 안 함).
    expect(computeReviewSemanticIdentity(T, gitStub(a))).not.toBe(computeReviewSemanticIdentity(T, gitStub(b)))
  })

  it('`responsesX`처럼 접두사만 같은 경로는 제외 안 함(trailing slash 엄격)', () => {
    const a = [line('1'.repeat(40), `${T}/responsesX.md`)]
    const b = [line('2'.repeat(40), `${T}/responsesX.md`)]
    expect(computeReviewSemanticIdentity(T, gitStub(a))).not.toBe(computeReviewSemanticIdentity(T, gitStub(b)))
  })
})

describe('[review-target] 보수적 포함 · fail-closed', () => {
  it('경로를 못 뽑는 malformed 행은 보수적으로 포함한다(모호한 경로 미제외)', () => {
    const a = [line('1'.repeat(40), 'app/x.ts'), 'garbage-no-tab-line']
    const b = [line('1'.repeat(40), 'app/x.ts')]
    expect(computeReviewSemanticIdentity(T, gitStub(a))).not.toBe(computeReviewSemanticIdentity(T, gitStub(b)))
  })

  it('ticketRel이 비면 fail-closed(제외 경계 불명)', () => {
    expect(() => computeReviewSemanticIdentity('', gitStub([]))).toThrow(/비어 있음/)
  })

  it('정렬은 결정적이다(입력 순서 무관)', () => {
    const a = [line('1'.repeat(40), 'a.ts'), line('2'.repeat(40), 'b.ts')]
    const b = [line('2'.repeat(40), 'b.ts'), line('1'.repeat(40), 'a.ts')]
    expect(computeReviewSemanticIdentity(T, gitStub(a))).toBe(computeReviewSemanticIdentity(T, gitStub(b)))
  })

  it('CRLF 종단을 무시한다', () => {
    const a = (args: string[]): string => {
      expect(args).toEqual(['ls-files', '-s'])
      return `${line('1'.repeat(40), 'a.ts')}\r`
    }
    const b = gitStub([line('1'.repeat(40), 'a.ts')])
    expect(computeReviewSemanticIdentity(T, a)).toBe(computeReviewSemanticIdentity(T, b))
  })
})
