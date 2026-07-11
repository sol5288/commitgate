import { describe, it, expect } from 'vitest'
import type { StatusEntry } from '../../scripts/req/lib/porcelain'
import {
  TOOL_OUTPUT_BASENAMES,
  reviewScratchPaths,
  isToolOutputScratch,
  isAllowedResponsesScratch,
  isArchiveFileName,
} from '../../scripts/req/lib/scratch'

/** StatusEntry 조립. */
const se = (index: string, worktree: string, path: string, origPath?: string): StatusEntry =>
  origPath === undefined ? { index, worktree, path } : { index, worktree, path, origPath }
/** untracked 엔트리(X=Y=`?`). */
const u = (path: string): StatusEntry => se('?', '?', path)

describe('reviewScratchPaths — review/doctor의 3경로', () => {
  it('codex-response.json · .review-preview.txt · state.json', () => {
    expect(reviewScratchPaths('workflow/REQ-2026-001')).toEqual([
      'workflow/REQ-2026-001/codex-response.json',
      'workflow/REQ-2026-001/.review-preview.txt',
      'workflow/REQ-2026-001/state.json',
    ])
  })
  it('후행 슬래시·역슬래시를 정규화한다', () => {
    expect(reviewScratchPaths('workflow\\REQ-2026-001\\')).toEqual([
      'workflow/REQ-2026-001/codex-response.json',
      'workflow/REQ-2026-001/.review-preview.txt',
      'workflow/REQ-2026-001/state.json',
    ])
  })
  it('TOOL_OUTPUT_BASENAMES는 state.json을 포함하지 않는다(D8 — req:new 예외에서 제외돼야)', () => {
    expect(TOOL_OUTPUT_BASENAMES).toEqual(['codex-response.json', '.review-preview.txt'])
    expect(TOOL_OUTPUT_BASENAMES as readonly string[]).not.toContain('state.json')
  })
})

/**
 * isToolOutputScratch — `req:new`의 좁은 예외(설계 D7). 승인을 부여하지 않는(D9) 방어선.
 * **오직** untracked 도구 산출물(codex-response.json·.review-preview.txt)이 티켓 직계에 있을 때만 true.
 */
describe('isToolOutputScratch — req:new 예외 술어 (설계 D7)', () => {
  const ROOT = 'workflow'

  it('untracked codex-response.json(티켓 직계) → true', () => {
    expect(isToolOutputScratch(u('workflow/REQ-2026-011/codex-response.json'), ROOT)).toBe(true)
  })
  it('untracked .review-preview.txt(티켓 직계) → true', () => {
    expect(isToolOutputScratch(u('workflow/REQ-2026-001/.review-preview.txt'), ROOT)).toBe(true)
  })

  it('state.json → false (tracked 메타데이터, D8)', () => {
    expect(isToolOutputScratch(u('workflow/REQ-2026-011/state.json'), ROOT)).toBe(false)
  })
  it('responses/ 하위 → false (증거 변조 구멍 차단, D8)', () => {
    expect(isToolOutputScratch(u('workflow/REQ-2026-011/responses/design-r01-approved.json'), ROOT)).toBe(false)
  })

  it('tracked·staged·수정은 무시하지 않는다(untracked만)', () => {
    for (const e of [
      se(' ', 'M', 'workflow/REQ-2026-011/codex-response.json'), // unstaged 수정(tracked)
      se('M', ' ', 'workflow/REQ-2026-011/codex-response.json'), // staged
      se('A', ' ', 'workflow/REQ-2026-011/codex-response.json'), // staged add
    ])
      expect(isToolOutputScratch(e, ROOT), JSON.stringify(e)).toBe(false)
  })

  it('rename은 무시하지 않는다(untracked는 origPath가 없다)', () => {
    expect(isToolOutputScratch(se('R', ' ', 'workflow/REQ-2026-011/codex-response.json', 'x.json'), ROOT)).toBe(false)
  })

  it('티켓 직계가 아니면 false (중첩 경로)', () => {
    expect(isToolOutputScratch(u('workflow/REQ-2026-011/sub/codex-response.json'), ROOT)).toBe(false)
  })
  it('티켓 디렉터리명이 REQ-<4자리>-<숫자>가 아니면 false', () => {
    expect(isToolOutputScratch(u('workflow/NOTREQ/codex-response.json'), ROOT)).toBe(false)
    expect(isToolOutputScratch(u('workflow/REQ-26-1/codex-response.json'), ROOT)).toBe(false) // 연도 4자리 아님
    expect(isToolOutputScratch(u('workflow/REQ-2026-/codex-response.json'), ROOT)).toBe(false) // 숫자 없음
    expect(isToolOutputScratch(u('workflow/REQ-2026-abc/codex-response.json'), ROOT)).toBe(false)
  })
  it('ticketRoot 밖이면 false', () => {
    expect(isToolOutputScratch(u('other/REQ-2026-011/codex-response.json'), ROOT)).toBe(false)
    // ticketRoot 접두가 부분일치해도(workflow2) false여야 — prefix는 슬래시 경계
    expect(isToolOutputScratch(u('workflow2/REQ-2026-011/codex-response.json'), ROOT)).toBe(false)
  })
  it('basename이 도구 산출물이 아니면 false (오타·유사)', () => {
    expect(isToolOutputScratch(u('workflow/REQ-2026-011/codex-response.json.bak'), ROOT)).toBe(false)
    expect(isToolOutputScratch(u('workflow/REQ-2026-011/other.json'), ROOT)).toBe(false)
  })
  it('여러 자리 티켓 번호도 허용(REQ-2026-1 / REQ-2026-1234)', () => {
    expect(isToolOutputScratch(u('workflow/REQ-2026-1/codex-response.json'), ROOT)).toBe(true)
    expect(isToolOutputScratch(u('workflow/REQ-2026-1234/codex-response.json'), ROOT)).toBe(true)
  })
})

describe('isAllowedResponsesScratch — StatusEntry 기반(설계 D11)', () => {
  const T = 'workflow/REQ-2026-016'
  it('현재 티켓 responses/ 직계 untracked 아카이브 → true', () => {
    expect(isAllowedResponsesScratch(u(`${T}/responses/design-r01-needs-fix.json`), T)).toBe(true)
  })
  it('approvals.jsonl → false', () => {
    expect(isAllowedResponsesScratch(u(`${T}/responses/approvals.jsonl`), T)).toBe(false)
  })
  it('tracked(수정)·rename → false (untracked만)', () => {
    expect(isAllowedResponsesScratch(se(' ', 'M', `${T}/responses/design-r01-approved.json`), T)).toBe(false)
    expect(isAllowedResponsesScratch(se('R', ' ', `${T}/responses/x.json`, 'outside.json'), T)).toBe(false)
  })
  it('중첩 경로·다른 티켓 → false', () => {
    expect(isAllowedResponsesScratch(u(`${T}/responses/sub/design-r01-approved.json`), T)).toBe(false)
    expect(isAllowedResponsesScratch(u(`workflow/REQ-2026-999/responses/design-r01-approved.json`), T)).toBe(false)
  })
  it('역슬래시가 든 파일명을 뭉개지 않는다(옛 코드의 버그를 안 물려받음)', () => {
    // `-z`는 역슬래시를 파일명의 일부로 준다. 아카이브 패턴과 불일치 → false.
    expect(isAllowedResponsesScratch(u(`${T}/responses/a\\b.json`), T)).toBe(false)
  })
})

describe('isArchiveFileName — review-codex에서 이동', () => {
  it('아카이브 패턴만 true', () => {
    expect(isArchiveFileName('design-r01-needs-fix.json')).toBe(true)
    expect(isArchiveFileName('phase-A-r03-approved.json')).toBe(true)
    expect(isArchiveFileName('approvals.jsonl')).toBe(false)
    expect(isArchiveFileName('codex-response.json')).toBe(false)
    expect(isArchiveFileName('design-r1-approved.json')).toBe(false) // r 한자리 거부
  })
})
