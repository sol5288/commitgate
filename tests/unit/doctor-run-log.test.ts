/**
 * REQ-2026-111 phase-1 — `req:doctor` 실행 관측 로그.
 *
 * 🔴 **왜 순수 테스트로 부족한가**: `buildDoctorRunRow`를 직접 호출하는 테스트는 `main()`이 그것을
 *    **호출하지 않아도** 통과한다. 이 저장소는 그 실패를 세 번 실증했다(REQ-2026-083·097·099 —
 *    "빌더 직접호출 가드는 배선끊김을 못 잡는다"). 그래서 AC-1~AC-3·AC-5는 실제 진입점 `main()`을 돌린다.
 *
 * 🔴 **AC-3이 이 REQ의 핵심 오라클이다**: 요구 제약 1은 "관측이 판정을 바꾸지 않는다"이다. 그것이 깨지면
 *    관측 추가가 게이트를 망가뜨린다. mock이 아니라 **실제 쓰기 실패**(경로를 디렉터리로 만들기)를 만들어
 *    두 실행의 출력·exit 동작을 비교한다.
 */
import { describe, it, expect, vi } from 'vitest'
import { writeFileSync, mkdirSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import {
  main as doctorMain,
  buildDoctorRunRow,
  DOCTOR_RUN_LOG_REL,
  type Check,
} from '../../scripts/req/req-doctor'
import { mkRepo, git } from './fixtures/stale-devcomplete'

const TICKET_ID = 'REQ-2026-999'
const SHORT = '2026-999'
const TICKET_REL = `workflow/${TICKET_ID}`
/** 존재하지 않는 브랜치를 state에 적어 D2(불일치)·D3(부재)를 확정적으로 FAIL시킨다 — nonok 표본이 필요하다. */
const GONE_BRANCH = 'feat/req-2026-999-gone'

const PROJECT_ROOT = join(__dirname, '..', '..')

/** 최소 티켓 하나를 가진 hermetic repo. */
const repoWithTicket = (): string => {
  const repo = mkRepo('req111-doctor-')
  mkdirSync(join(repo, TICKET_REL), { recursive: true })
  writeFileSync(
    join(repo, TICKET_REL, 'state.json'),
    JSON.stringify({ id: TICKET_ID, branch: GONE_BRANCH, risk_level: 'LOW', commit_allowed: false, phases: [] }),
  )
  writeFileSync(join(repo, TICKET_REL, '00-requirement.md'), '# req\n')
  writeFileSync(join(repo, TICKET_REL, '01-design.md'), '# design\n')
  writeFileSync(join(repo, TICKET_REL, '02-plan.md'), '# plan\n')
  git(repo, ['add', '-A'])
  git(repo, ['commit', '-qm', 'ticket'])
  return repo
}

/** `main()`을 돌리고 출력 줄과 `process.exit` 호출 여부를 함께 돌려준다. */
const runDoctor = (repo: string): { lines: string[]; exited: boolean } => {
  const lines: string[] = []
  let exited = false
  const log = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void lines.push(a.join(' ')))
  const exit = vi.spyOn(process, 'exit').mockImplementation(((): never => {
    exited = true
    return undefined as never
  }) as never)
  try {
    doctorMain([SHORT, '--root', repo])
  } finally {
    log.mockRestore()
    exit.mockRestore()
  }
  return { lines, exited }
}

const logAbs = (repo: string): string => join(repo, ...DOCTOR_RUN_LOG_REL.split('/'))
const readRows = (repo: string): Record<string, unknown>[] =>
  readFileSync(logAbs(repo), 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as Record<string, unknown>)
/** 첫 행을 꺼낸다 — 없으면 테스트를 실패시킨다(옵셔널 접근으로 조용히 통과시키지 않는다). */
const firstRow = (repo: string): Record<string, unknown> => {
  const row = readRows(repo)[0]
  if (!row) throw new Error(`${DOCTOR_RUN_LOG_REL}에 행이 없다`)
  return row
}

describe('[REQ-2026-111] buildDoctorRunRow (순수)', () => {
  const mk = (id: string, level: Check['level']): Check => ({ id, level, msg: `m-${id}` }) as Check

  it('non-OK만 담고 OK는 개수로만 남는다', () => {
    const row = buildDoctorRunRow([mk('D2', 'OK'), mk('D10', 'FAIL'), mk('D18', 'WARN')], {
      ticketId: TICKET_ID,
      at: '2026-08-02T00:00:00.000Z',
    })
    expect(row.evaluated).toBe(3)
    expect(row.nonok).toEqual([
      { id: 'D10', level: 'FAIL' },
      { id: 'D18', level: 'WARN' },
    ])
    // msg는 담지 않는다(요구 제약 5 — 경로·파일명이 섞이면 안 된다).
    expect(JSON.stringify(row)).not.toContain('m-D10')
  })

  it('verdict는 main() 요약과 같은 기준이다 — FAIL 1건 이상이면 FAIL', () => {
    const at = '2026-08-02T00:00:00.000Z'
    expect(buildDoctorRunRow([mk('D2', 'OK'), mk('D18', 'WARN')], { ticketId: 'X', at }).verdict).toBe('PASS')
    expect(buildDoctorRunRow([mk('D2', 'OK'), mk('D10', 'FAIL')], { ticketId: 'X', at }).verdict).toBe('FAIL')
  })
})

describe('[REQ-2026-111] main() 배선 (실 git)', () => {
  /** AC-1 */
  it('🔴 실행 1회가 로그에 정확히 1행을 append한다', () => {
    const repo = repoWithTicket()
    expect(existsSync(logAbs(repo))).toBe(false)

    runDoctor(repo)

    expect(existsSync(logAbs(repo))).toBe(true)
    expect(readRows(repo)).toHaveLength(1)
    const row = firstRow(repo)
    expect(row.ticket_id).toBe(TICKET_ID)
    expect(typeof row.at).toBe('string')
    // 등록부가 22개다 — 실행이 실제 체크를 돌렸다는 최소 증거(빈 배열을 통과시키지 않는다).
    expect(row.evaluated as number).toBeGreaterThan(10)

    runDoctor(repo)
    expect(readRows(repo)).toHaveLength(2) // append-only
  })

  /** AC-2 */
  it('🔴 FAIL한 검사의 id·level이 그 행에 담긴다', () => {
    const repo = repoWithTicket()
    const { lines } = runDoctor(repo)
    // 화면 출력과 로그가 같은 사실을 말하는지 대조한다(로그가 화면과 어긋나면 관측이 거짓이 된다).
    expect(lines.some((l) => l.includes('] FAIL D2:'))).toBe(true)

    const row = firstRow(repo)
    const nonok = row.nonok as { id: string; level: string }[]
    expect(nonok).toContainEqual({ id: 'D2', level: 'FAIL' })
    expect(row.verdict).toBe('FAIL')
    // OK인 검사는 담기지 않는다.
    expect(nonok.every((n) => n.level !== 'OK')).toBe(true)
  })

  /** AC-3 — 이 REQ의 핵심 오라클 */
  it('🔴 로그 쓰기가 실패해도 출력과 exit 동작이 동일하다', () => {
    const repo = repoWithTicket()
    const before = runDoctor(repo)
    expect(before.exited).toBe(true) // D2/D3 FAIL → exit 1

    // 실제 쓰기 실패를 만든다: 로그 경로를 **디렉터리**로 바꾼다(appendFileSync → EISDIR).
    rmSync(logAbs(repo), { force: true })
    mkdirSync(logAbs(repo), { recursive: true })

    const after = runDoctor(repo)

    expect(after.lines).toEqual(before.lines)
    expect(after.exited).toBe(before.exited)
  })

  /** AC-5 — 소스 정규식이 아니라 **런타임 발화**로 검증한다(REQ-2026-099: 권위를 관찰에서 구하지 않는다). */
  it('🔴 로그가 gitignore되지 않으면 D22가 그 경로를 지목해 WARN한다', () => {
    const repo = repoWithTicket()
    writeFileSync(logAbs(repo), '') // gitignore 규칙이 없는 상태로 파일만 존재

    const { lines } = runDoctor(repo)
    const d22 = lines.find((l) => l.includes('] WARN D22:')) ?? ''
    expect(d22).toContain(DOCTOR_RUN_LOG_REL)
  })
})

describe('[REQ-2026-111] gitignore 자산 skew 방지', () => {
  const ROOT_RULE = 'workflow/.doctor-runs.jsonl'
  const TEMPLATE_RULE = '/.doctor-runs.jsonl'

  /** AC-4 — 한쪽만 넣는 것이 이 저장소의 반복된 실패다(REQ-2026-025·038). */
  it('🔴 루트 .gitignore와 배포 템플릿 **양쪽**에 규칙이 있다', () => {
    expect(readFileSync(join(PROJECT_ROOT, '.gitignore'), 'utf8')).toContain(ROOT_RULE)
    expect(readFileSync(join(PROJECT_ROOT, 'templates', 'workflow.gitignore'), 'utf8')).toContain(TEMPLATE_RULE)
  })

  /**
   * 🔴 변이 검사: 템플릿은 `workflow/` **기준 상대경로**다. 루트 형식(`workflow/…`)을 복사하면
   *    `workflow/workflow/…`를 찾아 **조용히 무효**가 된다 — 템플릿 자신이 그 함정을 주석으로 적어 두었다.
   */
  it('🔴 템플릿에 루트 형식이 복사돼 있지 않다(무효 규칙 방지)', () => {
    const tpl = readFileSync(join(PROJECT_ROOT, 'templates', 'workflow.gitignore'), 'utf8')
    const active = tpl
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l !== '' && !l.startsWith('#'))
    expect(active).toContain(TEMPLATE_RULE)
    expect(active).not.toContain(ROOT_RULE)
  })
})
