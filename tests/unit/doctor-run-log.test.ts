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
  runChecks,
  DOCTOR_RUN_LOG_REL,
  type Check,
  type DoctorInputs,
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

/**
 * `main()`을 돌리고 출력 줄과 `process.exit` **인자**를 함께 돌려준다.
 *
 * 🔴 **호출 여부가 아니라 인자를 모은다**(REQ-2026-115). 여부만 비교하면 `exit(1)`을 `exit(2)`로
 *    바꿔도 두 실행이 함께 바뀌어 동일성 비교를 통과한다 — 회귀가 조용히 지나간다.
 */
const runDoctor = (repo: string): { lines: string[]; exitCodes: (number | undefined)[] } => {
  const lines: string[] = []
  const exitCodes: (number | undefined)[] = []
  const log = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void lines.push(a.join(' ')))
  const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number): never => {
    exitCodes.push(code)
    return undefined as never
  }) as never)
  try {
    doctorMain([SHORT, '--root', repo])
  } finally {
    log.mockRestore()
    exit.mockRestore()
  }
  return { lines, exitCodes }
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

  it('[REQ-2026-117] subjects가 있으면 담고, 없거나 비면 키 자체를 생략한다(하위호환)', () => {
    const at = '2026-08-09T00:00:00.000Z'
    const withSubjects: Check = { id: 'D30', level: 'WARN', msg: 'm', subjects: ['REQ-2026-009'] } as Check
    const emptySubjects: Check = { id: 'D25', level: 'WARN', msg: 'm', subjects: [] } as Check
    const noSubjects: Check = { id: 'D18', level: 'WARN', msg: 'm' } as Check
    const row = buildDoctorRunRow([withSubjects, emptySubjects, noSubjects], { ticketId: 'X', at })
    expect(row.nonok).toEqual([
      { id: 'D30', level: 'WARN', subjects: ['REQ-2026-009'] },
      { id: 'D25', level: 'WARN' },
      { id: 'D18', level: 'WARN' },
    ])
    // 직렬화에서도 subjects 없는 항목엔 키가 없다 — 기존 소비자와 같은 형태.
    expect(JSON.stringify(row.nonok[1])).toBe('{"id":"D25","level":"WARN"}')
  })

  it('[REQ-2026-117] 기존 행(subjects 부재)은 그대로 유효한 형태다 — 새 스키마가 과거를 거부하지 않는다', () => {
    const legacy = '{"ticket_id":"X","at":"2026-08-02T14:10:12.132Z","verdict":"PASS","evaluated":24,"nonok":[{"id":"D30","level":"WARN"}]}'
    const parsed = JSON.parse(legacy) as { nonok: { id: string; level: string; subjects?: string[] }[] }
    expect(parsed.nonok[0]?.subjects).toBeUndefined() // 부재 = 정상(선택 키)
  })
})

/** runChecks 최소 입력(req-doctor.test.ts의 base 형태 — 이 테스트는 D25/D29/D30 subjects만 본다). */
function mkInputs(over: Partial<DoctorInputs>): DoctorInputs {
  return {
    state: {
      id: TICKET_ID,
      branch: 'feat/req-2026-999-x',
      phase: 'IMPLEMENT',
      commit_allowed: false,
    } as never,
    currentBranch: 'feat/req-2026-999-x',
    branchExists: true,
    branchPrefix: 'feat/req-',
    stagedTree: 'TREE',
    statusEntries: [],
    scratch: [`${TICKET_REL}/codex-response.json`],
    responseVerdict: null,
    responseStructureOk: false,
    designApproved: false,
    designApprovedHash: null,
    currentDesignHash: null,
    ticketDocs: [],
    ticketRel: TICKET_REL,
    ...over,
  } as DoctorInputs
}

describe('[REQ-2026-117] subjects 허용 규칙 — 저위험 식별자만', () => {
  /**
   * 🔴 subjects에 워킹트리 경로·메시지 본문이 새는 회귀를 막는다. 허용: 티켓 id(`REQ-…`) 또는
   *    계약 파일명(`CONTRACT_FILE_RELS`). runChecks가 실제로 채우는 값 전수를 이 규칙으로 검사한다.
   */
  const ALLOWED = /^REQ-\d{4}-\d+$/
  const CONTRACT_FILES = ['AGENTS.md', 'AGENTS.commitgate.md']

  it('D25·D29·D30이 채우는 subjects 전수가 허용 목록 안이다', () => {
    const checks = runChecks(
      mkInputs({
        unmergedClosedTickets: ['REQ-2026-001'],
        retiredClaimHits: [
          { file: 'AGENTS.md', claim: { text: 'x', why: 'y' } as never },
          { file: 'AGENTS.commitgate.md', claim: { text: 'x', why: 'y' } as never },
        ],
        strandedEvidence: [{ id: 'REQ-2026-009', reviews: 7 }],
        strandedClassified: [{ id: 'REQ-2026-009', reviews: 7, category: 'branch-alive', ageDays: 3 }],
        remoteTrunkFreshness: null,
        trunkBranch: 'main',
      }),
    )
    const fired = checks.filter((c) => c.subjects !== undefined)
    expect(fired.map((c) => c.id).sort()).toEqual(['D25', 'D29', 'D30'])
    for (const c of fired)
      for (const s of c.subjects!) {
        expect(ALLOWED.test(s) || CONTRACT_FILES.includes(s), `허용되지 않은 subject: ${c.id} → ${s}`).toBe(true)
      }
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

    // 실제 쓰기 실패를 만든다: 로그 경로를 **디렉터리**로 바꾼다(appendFileSync → EISDIR).
    rmSync(logAbs(repo), { force: true })
    mkdirSync(logAbs(repo), { recursive: true })

    const after = runDoctor(repo)

    // ① 이 REQ가 지키려는 성질 — 관측 실패가 판정을 바꾸지 않는다.
    expect(after.lines).toEqual(before.lines)
    expect(after.exitCodes).toEqual(before.exitCodes)
    /**
     * ② 그 성질이 **어떤 값 위에서** 성립하는지 고정한다(REQ-2026-115).
     *    ①만 있으면 공통 exit 코드를 바꿔도 양쪽이 함께 바뀌어 통과한다.
     *    현재 계약: FAIL 1건 이상 → `exit(1)`. 이 픽스처는 D2·D3가 FAIL이다.
     */
    expect(before.exitCodes).toEqual([1])
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

describe('[REQ-2026-129] 스키마 v2 — evaluations·applicable·reason_code', () => {


  it('v2 행: schema_version=2 + v1 필드(verdict·evaluated·nonok) 유지(하위호환)', () => {
    const row = buildDoctorRunRow(
      [
        { id: 'D9', level: 'OK', msg: 'ok' },
        { id: 'D30', level: 'WARN', msg: 'w', subjects: ['REQ-1'] },
      ],
      { ticketId: 'REQ-X', at: 'T' },
    )
    expect(row.schema_version).toBe(2)
    expect(row.verdict).toBe('PASS')
    expect(row.evaluated).toBe(2)
    expect(row.nonok).toEqual([{ id: 'D30', level: 'WARN', subjects: ['REQ-1'] }])
  })

  it('outcome 매핑: OK→pass · OK+applicable:false→not-applicable · WARN→warn · FAIL→fail(blocked)', () => {
    const row = buildDoctorRunRow(
      [
        { id: 'D9', level: 'OK', msg: 'ok' },
        { id: 'D25', level: 'OK', applicable: false, msg: '점검 불요' },
        { id: 'D30', level: 'WARN', msg: 'w' },
        { id: 'D10', level: 'FAIL', msg: 'f' },
      ],
      { ticketId: 'REQ-X', at: 'T' },
    )
    expect(row.evaluations).toEqual([
      { id: 'D9', applicable: true, outcome: 'pass', blocked: false },
      { id: 'D25', applicable: false, outcome: 'not-applicable', blocked: false },
      { id: 'D30', applicable: true, outcome: 'warn', blocked: false, reason_code: 'd30-warn' },
      { id: 'D10', applicable: true, outcome: 'fail', blocked: true, reason_code: 'd10-fail' },
    ])
  })

  it('reason_code: 검사 명시값 우선·미지정은 안정 폴백 슬러그·subjects 보존', () => {
    const row = buildDoctorRunRow(
      [{ id: 'D22', level: 'WARN', reason_code: 'unprotected-scratch', msg: 'w', subjects: ['workflow/.x'] }],
      { ticketId: 'REQ-X', at: 'T' },
    )
    expect(row.evaluations?.[0]).toMatchObject({ reason_code: 'unprotected-scratch', subjects: ['workflow/.x'] })
  })
})
