import { describe, it, expect } from 'vitest'
import type { StatusEntry } from '../../scripts/req/lib/porcelain'
import {
  TOOL_OUTPUT_BASENAMES,
  reviewScratchPaths,
  isToolOutputScratch,
  isAllowedResponsesScratch,
  isArchiveFileName,
  sourceCommitForbiddenStaged,
  ARCHIVE_BASE_RE,
} from '../../scripts/req/lib/scratch'
import { PHASE_ID_RE, CLI_SAFE_ARG_RE, REQ_ID_RE } from '../../scripts/req/req-next'
import { archiveBaseName, isConfinedArchivePath, expectedArchivePaths } from '../../scripts/req/lib/evidence'
import { archiveFileName, resolvePhaseTarget } from '../../scripts/req/review-codex'

/** StatusEntry 조립. */
const se = (index: string, worktree: string, path: string, origPath?: string): StatusEntry =>
  origPath === undefined ? { index, worktree, path } : { index, worktree, path, origPath }
/** untracked 엔트리(X=Y=`?`). */
const u = (path: string): StatusEntry => se('?', '?', path)

describe('sourceCommitForbiddenStaged — source 커밋 금지 staged 경로 (REQ-2026-092 DEC-1)', () => {
  const T = 'workflow/REQ-2026-001'
  const run = (paths: string[], ticket = T): string[] => sourceCommitForbiddenStaged(paths, ticket)

  it('티켓 state.json을 금지한다(교착의 직접 원인)', () => {
    expect(run([`${T}/state.json`])).toEqual([`${T}/state.json`])
  })
  it('responses/ 하위는 전부 금지한다(승인 증거 누수)', () => {
    const paths = [`${T}/responses/approvals.jsonl`, `${T}/responses/review-ledger.jsonl`, `${T}/responses/phase-1-r01-approved.json`]
    expect(run(paths)).toEqual(paths)
  })
  it('설계 문서·codex-request는 허용한다 — 이것들은 phase 커밋에 같이 실리는 정상 경로다', () => {
    expect(run([`${T}/00-requirement.md`, `${T}/01-design.md`, `${T}/02-plan.md`, `${T}/codex-request.md`])).toEqual([])
  })
  it('코드는 허용한다', () => {
    expect(run(['scripts/req/lib/scratch.ts', 'src/app.ts', 'package.json'])).toEqual([])
  })
  it('🔴 다른 티켓의 state.json은 대상이 아니다 — 현재 티켓만 본다', () => {
    expect(run([`workflow/REQ-2026-002/state.json`, `workflow/REQ-2026-002/responses/approvals.jsonl`])).toEqual([])
  })
  it('🔴 정확 일치다 — state.json.bak·state.jsonx는 걸리지 않는다', () => {
    expect(run([`${T}/state.json.bak`, `${T}/state.jsonx`])).toEqual([])
  })
  it('🔴 responses는 디렉터리 경계로 판정한다 — responses-old/ 는 다른 디렉터리다', () => {
    expect(run([`${T}/responses-old/x.json`])).toEqual([])
  })
  /**
   * 🔴 **계약이 뒤집혔다**(REQ-2026-155 DEC-2). 여기 있던 "역슬래시 입력을 정규화한다"는 **틀린
   *    동작을 고정**하고 있었다 — POSIX 에서 `workflow\REQ-…\state.json` 은 리터럴 역슬래시를 가진
   *    **다른 파일**이고, 정규화하면 그 무고한 파일을 금지 경로로 오인한다. 바로 위 주석이
   *    `trim()` 을 금지한 것과 **같은 이유**다. 지우지 않고 반대 계약으로 남긴다.
   */
  it('🔴 역슬래시 입력을 정규화하지 않는다 — Git 경로가 정본이다', () => {
    expect(run([`${T}\\state.json`.replace(/\//g, '\\')])).toEqual([])
  })
  it('ticketDirRel의 후행 슬래시·역슬래시를 정규화한다', () => {
    expect(run([`${T}/state.json`], 'workflow\\REQ-2026-001\\')).toEqual([`${T}/state.json`])
  })
  it('빈 조각을 버린다(-z 출력의 마지막 NUL 뒤 빈 문자열)', () => {
    expect(run([`${T}/state.json`, ''])).toEqual([`${T}/state.json`])
  })
  it('🔴 앞뒤 공백은 경로의 일부다 — 공백 있는 경로를 금지 경로로 오인하지 않는다(phase-1 r01 P1)', () => {
    // ` <T>/state.json`(선행 공백)은 Git에서 **다른 파일**이다. trim하면 무고한 파일이 차단된다.
    expect(run([` ${T}/state.json`])).toEqual([])
    expect(run([`${T}/state.json `])).toEqual([])
    expect(run([` ${T}/responses/approvals.jsonl`])).toEqual([])
    // 공백만 있는 조각도 경로로 취급하되 금지 대상은 아니다(빈 문자열만 버린다).
    expect(run(['  '])).toEqual([])
  })
  it('🔴 공백 경로를 걸러도 진짜 위반은 여전히 잡는다(fail-open 아님)', () => {
    expect(run([` ${T}/state.json`, `${T}/state.json`])).toEqual([`${T}/state.json`])
  })
  it('위반이 없으면 빈 배열(통과)', () => {
    expect(run([])).toEqual([])
  })
  it('입력 순서를 유지한다 — 안내 메시지가 사용자가 stage한 순서를 그대로 보여준다', () => {
    const paths = [`${T}/responses/approvals.jsonl`, `${T}/state.json`]
    expect(run(['src/a.ts', ...paths])).toEqual(paths)
  })

  it('🔴 reviewScratchPaths와의 비대칭이 의도된 것임을 고정한다 — 같은 state.json을 한쪽은 관용, 한쪽은 금지', () => {
    // 이 비대칭이 소비자 교착의 원인이었다. 축이 다르다: scratch=워킹트리 관용, 이 술어=인덱스 금지.
    // 둘 중 하나만 바꾸면 다시 갈라지므로 두 사실을 한 테스트에 묶어 고정한다.
    expect(reviewScratchPaths(T)).toContain(`${T}/state.json`)
    expect(sourceCommitForbiddenStaged([`${T}/state.json`], T)).toEqual([`${T}/state.json`])
  })
})

describe('reviewScratchPaths — review/doctor의 4경로', () => {
  it('codex-response.json · .review-preview.txt · state.json · review-ledger.jsonl', () => {
    // REQ-2026-051: 리뷰 원장이 4번째. state.json과 같은 범주(리뷰 중 append되는 도구 산출물, 승인 시 커밋).
    expect(reviewScratchPaths('workflow/REQ-2026-001')).toEqual([
      'workflow/REQ-2026-001/codex-response.json',
      'workflow/REQ-2026-001/.review-preview.txt',
      'workflow/REQ-2026-001/state.json',
      'workflow/REQ-2026-001/responses/review-ledger.jsonl',
    ])
  })
  it('후행 슬래시·역슬래시를 정규화한다', () => {
    expect(reviewScratchPaths('workflow\\REQ-2026-001\\')).toEqual([
      'workflow/REQ-2026-001/codex-response.json',
      'workflow/REQ-2026-001/.review-preview.txt',
      'workflow/REQ-2026-001/state.json',
      'workflow/REQ-2026-001/responses/review-ledger.jsonl',
    ])
  })
  it('원장은 exact 경로만 허용 — responses/ 하위지만 다른 파일은 미포함(증거 변조 차단)', () => {
    const paths = reviewScratchPaths('workflow/REQ-2026-001')
    expect(paths).toContain('workflow/REQ-2026-001/responses/review-ledger.jsonl')
    expect(paths.some((p) => p.includes('approvals.jsonl'))).toBe(false)
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
  it("ticketRoot='.' 또는 canonical root('')면 repo 루트 직계 REQ를 허용", () => {
    const entry = u('REQ-2026-001/codex-response.json')
    expect(isToolOutputScratch(entry, '.')).toBe(true)
    expect(isToolOutputScratch(entry, '')).toBe(true)
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

/**
 * REQ-2026-096 — phase id와 아카이브 파일명의 문자 집합이 갈라지면 **도구가 쓴 승인 아카이브를 도구
 * 자신이 인식하지 못한다**(0.16.0 소비자 교착). 여기서 그 통일을 property로 고정한다.
 *
 * ⚠️ 기대값을 SUT 상수로 만들지 않는다(tautology 방지 — REQ-B 교훈). 샘플은 아래 리터럴이 정본이다.
 */
describe('phase id ↔ 아카이브 base 문자 집합 통일 (REQ-2026-096)', () => {
  const T = 'workflow/REQ-2026-999'
  /** `req:next`가 통과시켜야 하고, 아카이브 경로 전 구간이 인식해야 하는 id. */
  const SAFE_PHASE_IDS = ['phase-1-charset-parity', 'phase-1a-persona-install', 'phase-2-req-next', 'p1', 'A0', 'phase-3b-entrypoint-uninstall']
  /** 파일명 base로 쓸 수 없어 교착을 만드는 id — 이제 진입 자체가 거부돼야 한다. */
  const UNSAFE_PHASE_IDS = ['phase_1', 'phase.1', 'phase_1_schema', 'phase-3b.entrypoint_uninstall', '-phase', 'phase 1']

  it('왕복: PHASE_ID_RE를 통과한 id로 쓴 아카이브는 전 구간이 인식한다', () => {
    for (const id of SAFE_PHASE_IDS) {
      expect(PHASE_ID_RE.test(id), `PHASE_ID_RE: ${id}`).toBe(true)
      const name = archiveFileName(archiveBaseName('phase', id), 1, 'approved')
      const path = `${T}/responses/${name}`
      expect(isArchiveFileName(name), `isArchiveFileName: ${name}`).toBe(true)
      expect(isAllowedResponsesScratch(u(path), T), `scratch: ${path}`).toBe(true)
      expect(isConfinedArchivePath(path, T), `confined: ${path}`).toBe(true)
      expect(expectedArchivePaths([name], 'phase', id, T), `staged: ${name}`).toEqual([path])
    }
  })

  it('음성: 파일명 base로 못 쓰는 id는 PHASE_ID_RE가 거부한다(0.16.0에선 통과했다)', () => {
    for (const id of UNSAFE_PHASE_IDS) expect(PHASE_ID_RE.test(id), `PHASE_ID_RE: ${id}`).toBe(false)
  })

  it('포함관계: 아카이브 안전 ⊂ CLI 안전 (좁히기만 했고 argv 안전성은 유지된다)', () => {
    for (const id of SAFE_PHASE_IDS) {
      expect(ARCHIVE_BASE_RE.test(id), `archive-safe: ${id}`).toBe(true)
      expect(CLI_SAFE_ARG_RE.test(id), `cli-safe: ${id}`).toBe(true)
    }
    // 역은 성립하지 않는다 — CLI 안전하지만 아카이브 base로는 못 쓰는 값이 존재한다(그것이 이 REQ의 결함).
    expect(CLI_SAFE_ARG_RE.test('phase_1')).toBe(true)
    expect(ARCHIVE_BASE_RE.test('phase_1')).toBe(false)
  })

  it('CLI_SAFE_ARG_RE·REQ_ID_RE는 좁히지 않았다(모델명 등 `.`이 필요한 값이 있다)', () => {
    expect(CLI_SAFE_ARG_RE.test('gpt-5.6-terra')).toBe(true)
    expect(REQ_ID_RE.test('2026-096')).toBe(true)
  })

  it('유료 호출 전 차단: resolvePhaseTarget이 base로 못 쓰는 --phase를 거부한다', () => {
    const state = { id: 'REQ-2026-999', phases: [{ id: 'phase_1' }], review_series_model_version: 1 } as never
    const r = resolvePhaseTarget(state, 'phase', 'phase_1')
    expect(r.ok).toBe(false)
    expect(r.phaseId).toBe(null)
    // 왜 거부됐는지가 메시지에 있어야 한다 — 그래야 D10 더러움으로 오진하지 않는다.
    expect(r.error).toContain('승인 아카이브')
    expect(r.error).toContain('커밋할 수 없습니다')
  })

  it('design base와 레거시 폴백 base는 영향받지 않는다', () => {
    expect(isArchiveFileName(archiveFileName(archiveBaseName('design', 'phase_1'), 1, 'approved'))).toBe(true)
    expect(isArchiveFileName(archiveFileName(archiveBaseName('phase', null), 2, 'needs-fix'))).toBe(true)
  })
})
