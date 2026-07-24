/**
 * 현재 리뷰의 **semantic identity** 계산 (REQ-2026-052 phase-2).
 *
 * 왜 필요한가: pre-call 원장 커밋(DEC-A)이 매 라운드 HEAD·인덱스를 바꾸므로, approval binding
 * (`reviewBaseSha`/`reviewTree`)은 라운드마다 값이 달라진다. 그런데 두 판정은 **같은 리뷰의 반복**을
 * 감지해야 하므로 audit bookkeeping 변화에 흔들리면 안 된다:
 *   - blocked-review circuit breaker(무한 재리뷰 차단)
 *   - `last_review.compare_hash` · req:next G2(바인딩 신선도)
 *
 * 그래서 approval binding과 **분리된** semantic identity를 둔다: 리뷰 대상(design 문서·phase 코드)은
 * 반영하되, 티켓의 `responses/` audit 산출물(ledger·approvals·아카이브·close-proof·codex-response·
 * preview)의 변화는 **무시**한다.
 *
 * 🔴 **`responses/` 전체를 제외한다**(design-r03-delta P1): 처음엔 `review-ledger.jsonl` 한 줄만
 *    제외했으나, evidence-finalize가 approvals·아카이브를 커밋하면 identity가 바뀌어 방금 승인한 리뷰를
 *    req:next G2가 stale로 오판했다(요구 #4 위반). `responses/`는 **순수 audit**이고 리뷰 대상은 절대
 *    그 안에 없다(design 문서=티켓 루트 `0N-*.md`, phase 코드=`workflow/` 밖). 따라서 `responses/`를
 *    통째로 제외해도 리뷰 대상 손실 없이 pre-call 커밋·evidence-finalize 양쪽에 identity가 불변이다.
 *
 * 🔴 **읽기 전용**: `git ls-files -s`만 쓴다. `git write-tree`는 object DB에 tree를 쓰므로 금지
 *    (`captureIndexHash`와 같은 기법 — req:next가 재계산할 수 있어야 한다).
 *
 * 인터페이스는 이 함수 하나. git 필터링·정렬·hash 규칙을 전부 이 모듈에 숨긴다.
 * 호출자: `review-codex`(생성) · `req:next`(G2 재계산) · 테스트.
 */
import { createHash } from 'node:crypto'

/** `git ...` 실행 경계(review-codex의 `GitFn`과 호환 — 주입 가능·테스트용). */
export type GitFn = (args: string[]) => string

/** `git ls-files -s` 한 줄에서 경로(탭 뒤)를 뽑는다. 형식: `<mode> <oid> <stage>\t<path>`. */
function pathOfLsFilesLine(line: string): string | null {
  const tab = line.indexOf('\t')
  return tab < 0 ? null : line.slice(tab + 1)
}

/**
 * 현재 리뷰의 semantic identity(hex SHA256).
 *
 * = SHA256( 정렬된 `git ls-files -s` 줄들 중, 경로가 `<ticketRel>/responses/` 아래인 줄을 제외 ).
 *
 * 원장·approvals·아카이브가 untracked/modified/committed 어느 상태든 `responses/` 경로라 제외되므로
 * identity가 그 변화에 불변이다. 리뷰 대상(문서·코드)과 `responses/` 밖의 non-audit 변경은 반영된다.
 */
export function computeReviewSemanticIdentity(ticketRel: string, gitFn: GitFn): string {
  const normTicket = ticketRel.replace(/\\/g, '/').replace(/\/+$/, '')
  // 🔴 ticketRel 경계가 애매하면(빈 값) fail-closed — 잘못된 접두사로 무언가를 조용히 제외하지 않는다.
  if (normTicket === '') throw new Error('computeReviewSemanticIdentity: ticketRel이 비어 있음(제외 경계 불명 — fail-closed)')
  const responsesPrefix = `${normTicket}/responses/` // 🔴 정확히 이 티켓의 responses/ 하위만. 다른 workflow 파일·문서·코드 미제외.
  const lines = gitFn(['ls-files', '-s'])
    .split('\n')
    .map((l) => l.replace(/\r$/, ''))
    .filter((l) => l.trim() !== '')
    .filter((l) => {
      const p = pathOfLsFilesLine(l)
      // 🔴 경로를 못 뽑으면(malformed) **보수적으로 포함**한다 — 모호한 경로를 제외하지 않는다(constraint 3).
      //    제외는 명확히 `<ticketRel>/responses/` 하위일 때만.
      return p === null ? true : !p.startsWith(responsesPrefix)
    })
  return createHash('sha256').update([...lines].sort().join('\n')).digest('hex')
}
