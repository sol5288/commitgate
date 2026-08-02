import { describe, it, expect } from 'vitest'
import { assembleReviewPrompt } from '../../scripts/req/review-codex'

/**
 * REQ-2026-106 phase-1 — **프롬프트 바이트 골든**.
 *
 * 왜 필요한가: 프롬프트는 리뷰어에게 **그대로 전달되는 입력 계약**이다. 그런데 기존 테스트
 * (`req-review-codex.test.ts:134-`)는 `toContain`·`indexOf` 순서 비교라 **바이트를 고정하지 않는다** —
 * 구분자·공백·줄바꿈이 바뀌어도 통과한다. 리뷰 결과가 조용히 달라질 수 있는 축이 핀 없이 열려 있었다.
 *
 * 🔴 **expected는 이 파일에 박은 literal이다**(REQ-2026-031 교훈). SUT가 export하는 상수
 *    (`DELTA_CHANGED_TAG` 등)로 expected를 조립하면 SUT가 바뀔 때 expected도 같이 바뀌어
 *    **동어반복**이 된다 — 그런 테스트는 아무것도 지키지 않는다. 태그 문자열도 여기에 직접 적는다.
 *
 * 🔴 **`norm`은 CRLF→LF만 정규화한다**(REQ-2026-042 교훈: autocrlf 환경에서 Write는 LF, Edit는 CRLF를
 *    남겨 같은 내용이 갈린다). **그 외 공백은 정규화하지 않는다 — 공백이 계약의 일부다.**
 *
 * 케이스는 **계약이 갈리는 축**만 덮는다(조합 폭발을 노리지 않는다):
 *   phase(기본) · design(full) · design(delta) · previousFindingsToClose 유무.
 */
const norm = (s: string): string => s.replace(/\r\n/g, '\n')

describe('[REQ-2026-106] assembleReviewPrompt — 바이트 골든', () => {
  it('kind=phase(기본): persona·handoff·Context·SHA·KIND·request·staged diff 순서와 바이트', () => {
    const actual = assembleReviewPrompt({
      persona: 'PERSONA BODY',
      handoff: 'HANDOFF BODY',
      reviewContext: {
        branch: 'feat/req-2026-106-x',
        reviewBaseSha: 'abc123',
        reviewTree: 'TREE9',
        phase: 'REVIEW_REQUEST',
        previousFindingsToClose: null,
      },
      reviewBaseSha: 'abc123',
      requestBody: 'REQUEST BODY',
      stagedDiff: 'diff --git a/x b/x',
    })
    const expected = [
      'PERSONA BODY',
      'HANDOFF BODY',
      '# Review Context',
      '- branch: feat/req-2026-106-x',
      '- review_base_sha: abc123',
      '- review_tree: TREE9',
      '- phase: REVIEW_REQUEST',
      '---',
      'REVIEW_BASE_SHA: abc123',
      '---',
      'REVIEW_KIND: phase (응답 review_kind가 동일해야 함)',
      '---',
      'REQUEST BODY',
      '---',
      '# 권위 아티팩트 = staged diff (리뷰 대상 = 바인딩 대상)',
      'diff --git a/x b/x',
    ].join('\n')
    expect(norm(actual)).toBe(expected)
  })

  it('previousFindingsToClose가 있으면 Review Context **직후** 별도 블록으로 들어간다', () => {
    const actual = assembleReviewPrompt({
      reviewContext: {
        branch: 'b',
        reviewBaseSha: 's',
        reviewTree: 't',
        phase: 'p',
        previousFindingsToClose: '# 직전 findings\n- P1 무언가',
      },
      reviewBaseSha: 's',
      requestBody: 'R',
      stagedDiff: 'D',
    })
    const expected = [
      '# Review Context',
      '- branch: b',
      '- review_base_sha: s',
      '- review_tree: t',
      '- phase: p',
      '# 직전 findings',
      '- P1 무언가',
      '---',
      'REVIEW_BASE_SHA: s',
      '---',
      'REVIEW_KIND: phase (응답 review_kind가 동일해야 함)',
      '---',
      'R',
      '---',
      '# 권위 아티팩트 = staged diff (리뷰 대상 = 바인딩 대상)',
      'D',
    ].join('\n')
    expect(norm(actual)).toBe(expected)
  })

  it('kind=design(full): 설계 문서 00/01/02가 권위 아티팩트로 전문 포함', () => {
    const actual = assembleReviewPrompt({
      reviewKind: 'design',
      reviewBaseSha: 'sha1',
      requestBody: 'REQ BODY',
      stagedDiff: '',
      designDocs: { requirement: 'REQUIREMENT', design: 'DESIGN', plan: 'PLAN' },
    })
    const expected = [
      '---',
      'REVIEW_BASE_SHA: sha1',
      '---',
      'REVIEW_KIND: design (응답 review_kind가 동일해야 함)',
      '---',
      'REQ BODY',
      '---',
      '# 권위 아티팩트 = 설계 문서 00/01/02 (리뷰 대상 = 바인딩 대상)',
      '## 00-requirement.md',
      'REQUIREMENT',
      '## 01-design.md',
      'DESIGN',
      '## 02-plan.md',
      'PLAN',
    ].join('\n')
    expect(norm(actual)).toBe(expected)
  })

  it('kind=design(delta): 변경 문서는 전문 + [변경됨] 태그, baseline은 본문 생략', () => {
    const actual = assembleReviewPrompt({
      reviewKind: 'design',
      reviewBaseSha: 'sha2',
      requestBody: 'REQ BODY',
      stagedDiff: '',
      designDocs: { requirement: 'REQUIREMENT', design: 'DESIGN', plan: 'PLAN' },
      designDelta: { changed: ['design'], unchanged: ['requirement', 'plan'] },
    })
    // 🔴 태그·생략 문구를 SUT에서 import하지 않고 여기에 직접 적는다(동어반복 방지).
    const OMITTED =
      '(본문 생략 — 승인 baseline·변경 없음. 전체가 필요하면 `full_review_requested: "yes"`로 full review를 요청하라.)'
    const expected = [
      '---',
      'REVIEW_BASE_SHA: sha2',
      '---',
      'REVIEW_KIND: design (응답 review_kind가 동일해야 함)',
      '---',
      'REQ BODY',
      '---',
      '# 권위 아티팩트 = 설계 문서 00/01/02 (delta review — 변경분 심사)',
      '## 00-requirement.md [승인 baseline — 변경 없음, 참조]',
      OMITTED,
      '## 01-design.md [변경됨 — 심사 대상]',
      'DESIGN',
      '## 02-plan.md [승인 baseline — 변경 없음, 참조]',
      OMITTED,
    ].join('\n')
    expect(norm(actual)).toBe(expected)
  })

  it('kind=design + 이미 커밋된 phase가 있으면 권위 아티팩트 **뒤**에 참고 블록', () => {
    const actual = assembleReviewPrompt({
      reviewKind: 'design',
      reviewBaseSha: 'sha3',
      requestBody: 'R',
      stagedDiff: '',
      designDocs: { requirement: 'RQ', design: 'DS', plan: 'PL' },
      shippedPhaseIds: ['phase-1-a', 'phase-2-b'],
    })
    const expected = [
      '---',
      'REVIEW_BASE_SHA: sha3',
      '---',
      'REVIEW_KIND: design (응답 review_kind가 동일해야 함)',
      '---',
      'R',
      '---',
      '# 권위 아티팩트 = 설계 문서 00/01/02 (리뷰 대상 = 바인딩 대상)',
      '## 00-requirement.md',
      'RQ',
      '## 01-design.md',
      'DS',
      '## 02-plan.md',
      'PL',
      '---',
      '# 이미 승인·커밋된 phase (참고 사실)',
      '- phase-1-a',
      '- phase-2-b',
      '',
      '이 phase들의 코드는 **이미 커밋됐다** — 설계 문서를 수정해도 그 코드는 바뀌지 않는다.',
      '따라서 이 phase의 결함을 **실제로 고치는 경로는 후속 REQ**다.',
      '이 사실을 severity 판단에 반영하라. **판단은 당신의 것이다** — 이 블록은 무엇이 findings인지 정하지 않는다.',
    ].join('\n')
    expect(norm(actual)).toBe(expected)
  })
})
