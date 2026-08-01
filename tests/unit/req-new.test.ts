import { describe, it, expect } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  validateSlug,
  nextReqId,
  branchName,
  buildInitialState,
  parseArgs,
  findReqNewDirtyEntries,
} from '../../scripts/req/req-new'
import { parseStatusZ, STATUS_Z_ARGS } from '../../scripts/req/lib/porcelain'

/**
 * REQ-2026-062: 픽스처 repo는 **"setup을 마친 프로젝트"**를 나타낸다.
 * 이 마커가 없으면 setup 게이트가 먼저 막아 이 파일이 검증하려는 다른 단언에 도달하지 못한다.
 * (실제 `commitgate init` 설치본은 grandfather 신호를 4개 갖지만, 이 픽스처들은 최소 repo다.)
 */
const SETUP_OK = { setup: { completedVersion: '0.0.0-test', completedAt: '2026-01-01T00:00:00Z' } }


describe('req:new — slug 검증', () => {
  it('kebab-case 허용', () => {
    expect(() => validateSlug('camera-hardfail')).not.toThrow()
    expect(() => validateSlug('a1-b2-c3')).not.toThrow()
  })
  it('대문자/공백/언더스코어/선후행 하이픈 거부', () => {
    expect(() => validateSlug('Camera')).toThrow()
    expect(() => validateSlug('a b')).toThrow()
    expect(() => validateSlug('a_b')).toThrow()
    expect(() => validateSlug('-x')).toThrow()
    expect(() => validateSlug('x-')).toThrow()
  })
})

describe('req:new — REQ id 채번(nextReqId)', () => {
  it('빈 목록이면 001', () => {
    expect(nextReqId(2026, [])).toBe('REQ-2026-001')
  })
  it('같은 연도 max+1, 3자리 zero-pad', () => {
    expect(nextReqId(2026, ['REQ-2026-001', 'REQ-2026-004', 'REQ-2025-009'])).toBe('REQ-2026-005')
  })
  it('다른 연도는 무시', () => {
    expect(nextReqId(2026, ['REQ-2025-099'])).toBe('REQ-2026-001')
  })
})

describe('req:new — 인자 파싱(parseArgs) fail-closed', () => {
  it('정상: slug + --risk HIGH + --run', () => {
    const o = parseArgs(['camera', '--risk', 'HIGH', '--run'])
    expect(o.slug).toBe('camera')
    expect(o.risk).toBe('HIGH')
    expect(o.run).toBe(true)
  })
  it('--risk 오타(HGIH)는 즉시 throw(조용한 LOW fallback 금지)', () => {
    expect(() => parseArgs(['camera', '--risk', 'HGIH'])).toThrow(/--risk/)
  })
  it('--risk 값 누락은 throw', () => {
    expect(() => parseArgs(['camera', '--risk'])).toThrow(/--risk/)
  })
  it('--title 값 누락은 throw', () => {
    expect(() => parseArgs(['camera', '--title'])).toThrow(/--title/)
  })
  it('알 수 없는 옵션은 throw', () => {
    expect(() => parseArgs(['camera', '--nope'])).toThrow(/알 수 없는/)
  })
  it('[P2] --root 수용(config 탐색 루트 주입)', () => {
    expect(parseArgs(['camera', '--root', '/some/dir']).root).toBe('/some/dir')
    expect(parseArgs(['camera']).root).toBe(null)
  })
  it('[P2] --root 값 누락은 throw', () => {
    expect(() => parseArgs(['camera', '--root'])).toThrow(/--root/)
  })
})

describe('req:new — 브랜치명/초기 state', () => {
  it('branchName (기본 prefix=feat/req- → behavior-preserving)', () => {
    expect(branchName('REQ-2026-001', 'camera-hardfail', 'feat/req-')).toBe('feat/req-2026-001-camera-hardfail')
  })
  it('[P2] branchName: config branchPrefix override', () => {
    expect(branchName('REQ-2026-001', 'camera-hardfail', 'feature/REQ-')).toBe('feature/REQ-2026-001-camera-hardfail')
  })
  it('buildInitialState 기본값(BOM 없는 writeState로 기록될 객체)', () => {
    const s = buildInitialState('REQ-2026-001', 'feat/req-2026-001-x', 'LOW')
    expect(s.id).toBe('REQ-2026-001')
    expect(s.commit_allowed).toBe(false)
    expect(s.risk_level).toBe('LOW')
    expect(s.approved_diff_hash).toBe(null)
  })

  // 🔴 REQ-2026-085 DEC-5.1: 죽은 필드를 더 이상 방출하지 않는다. 키 **부재**를 단언한다 —
  //    `toBeUndefined()`는 키가 `undefined` 값으로 있어도 통과하므로 직렬화 결과에도 없음을 확인한다.
  it('[REQ-085 R4] buildInitialState는 죽은 state.phase를 방출하지 않는다', () => {
    const s = buildInitialState('REQ-2026-001', 'feat/req-2026-001-x', 'LOW')
    expect('phase' in s).toBe(false)
    expect(Object.keys(JSON.parse(JSON.stringify(s)) as object)).not.toContain('phase')
  })

  it('[Phase2] buildInitialState: DEC-WF-027 design/phase 상태 필드 초기화', () => {
    const s = buildInitialState('REQ-2026-001', 'feat/req-2026-001-x', 'LOW')
    expect(s.design_approved).toBe(false)
    expect(s.design_approved_hash).toBe(null)
    expect(s.current_phase).toBe(null)
    expect(s.phases).toEqual([])
  })

  it('[REQ-016 A1] buildInitialState: 신규 REQ는 approval_evidence_required=true stamp(grandfathering 트리거)', () => {
    const s = buildInitialState('REQ-2026-001', 'feat/req-2026-001-x', 'LOW')
    expect(s.approval_evidence_required).toBe(true)
  })

  // REQ-2026-027 phase-1 O1-1: 새 ticket은 첫 리뷰 전에도 review series 모델 버전을 갖는다(D1).
  // 이 stamp가 "새 ticket(레코드 없음)"과 "legacy(필드 부재)"를 구분한다 — 빼면 새 ticket이 legacy로 오분류된다.
  it('[REQ-2026-027] buildInitialState: 새 ticket에 review_series_model_version=1 stamp', () => {
    const s = buildInitialState('REQ-2026-001', 'feat/req-2026-001-x', 'LOW')
    expect((s as { review_series_model_version?: number }).review_series_model_version).toBe(1)
  })
})

/**
 * REQ-2026-012 Phase 3 — gitignore 규칙이 없는 레거시 설치본의 clean-tree 예외.
 * 실제 Git porcelain -z 출력을 사용해, 술어가 실행되지 않은 채 테스트가 거짓 통과하는 것을 막는다(D6).
 */
describe('req:new — 레거시 scratch만 허용하는 clean-tree 판정', () => {
  const TICKET_ROOT = 'workflow'
  const TICKET = `${TICKET_ROOT}/REQ-2026-001`
  const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
  const TSX_CLI = join(PACKAGE_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs')
  const REQ_NEW_CLI = join(PACKAGE_ROOT, 'scripts', 'req', 'req-new.ts')

  const git = (dir: string, args: readonly string[]): string =>
    execFileSync('git', [...args], { cwd: dir, encoding: 'utf8' })

  const writeRel = (dir: string, rel: string, content = 'x\n'): void => {
    const abs = join(dir, rel)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, content, 'utf8')
  }

  const fixture = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'req-new-clean-'))
    git(dir, ['init', '-q'])
    // spawned req:new도 전역 Git 설정과 무관하게 commit/status를 재현할 수 있어야 한다.
    git(dir, ['config', '--local', 'user.email', 'commitgate-test@example.invalid'])
    git(dir, ['config', '--local', 'user.name', 'CommitGate Test'])
    git(dir, ['config', '--local', 'commit.gpgSign', 'false'])
    const emptyGlobalExcludes = join(dir, '.git', 'empty-global-excludes')
    writeFileSync(emptyGlobalExcludes, '', 'utf8')
    writeFileSync(join(dir, '.git', 'info', 'exclude'), '', 'utf8')
    git(dir, ['config', '--local', 'core.excludesFile', emptyGlobalExcludes])
    // 의도적으로 .gitignore를 만들지 않는다 — Phase 3의 레거시 코드 경로가 실제로 발화해야 한다.
    writeRel(dir, 'package.json', JSON.stringify({ name: 'x', version: '0.0.0' }) + '\n')
    writeRel(dir, 'req.config.json', JSON.stringify({ ...SETUP_OK, packageManager: 'npm' }) + '\n')
    git(dir, ['add', '--', 'package.json', 'req.config.json'])
    git(dir, ['commit', '-qm', 'base'])
    return dir
  }

  const violations = (dir: string) => findReqNewDirtyEntries(git(dir, [...STATUS_Z_ARGS]), TICKET_ROOT)
  const expectRawUntracked = (dir: string, path: string): void => {
    expect(parseStatusZ(git(dir, [...STATUS_Z_ARGS]))).toContainEqual(
      expect.objectContaining({ index: '?', worktree: '?', path }),
    )
  }
  const expectCreatedBranch = (dir: string, slug: string, existingYear: number): void => {
    const branch = git(dir, ['branch', '--show-current']).trim()
    const match = /^feat\/req-(\d{4})-(\d{3})-(.+)$/.exec(branch)
    expect(match?.[3]).toBe(slug)
    const branchYear = Number(match?.[1])
    expect([existingYear, existingYear + 1]).toContain(branchYear)
    expect(match?.[2]).toBe(branchYear === existingYear ? '002' : '001')
  }

  it('?? <ticket>/codex-response.json만 있으면 통과', () => {
    const dir = fixture()
    try {
      writeRel(dir, `${TICKET}/codex-response.json`, '{}\n')
      expectRawUntracked(dir, `${TICKET}/codex-response.json`)
      expect(violations(dir)).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('?? <ticket>/.review-preview.txt만 있으면 통과', () => {
    const dir = fixture()
    try {
      writeRel(dir, `${TICKET}/.review-preview.txt`)
      expectRawUntracked(dir, `${TICKET}/.review-preview.txt`)
      expect(violations(dir)).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it(' M <ticket>/state.json은 위반', () => {
    const dir = fixture()
    try {
      writeRel(dir, `${TICKET}/state.json`, '{}\n')
      git(dir, ['add', '--', `${TICKET}/state.json`])
      git(dir, ['commit', '-qm', 'state'])
      writeRel(dir, `${TICKET}/state.json`, '{"dirty":true}\n')
      expect(violations(dir).map((e) => e.path)).toEqual([`${TICKET}/state.json`])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('?? <ticket>/responses 승인 아카이브는 위반', () => {
    const dir = fixture()
    try {
      writeRel(dir, `${TICKET}/responses/design-r01-approved.json`, '{}\n')
      expect(violations(dir).map((e) => e.path)).toEqual([`${TICKET}/responses/design-r01-approved.json`])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('M  staged-only 코드 변경은 위반', () => {
    const dir = fixture()
    try {
      writeRel(dir, 'src/foo.ts', 'export const value = 1\n')
      git(dir, ['add', '--', 'src/foo.ts'])
      git(dir, ['commit', '-qm', 'source'])
      writeRel(dir, 'src/foo.ts', 'export const value = 2\n')
      git(dir, ['add', '--', 'src/foo.ts'])
      expect(violations(dir).map((e) => `${e.index}${e.worktree}:${e.path}`)).toEqual(['M :src/foo.ts'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('?? codex-response.json.bak 변형은 위반', () => {
    const dir = fixture()
    try {
      writeRel(dir, `${TICKET}/codex-response.json.bak`)
      expect(violations(dir).map((e) => e.path)).toEqual([`${TICKET}/codex-response.json.bak`])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('?? 티켓 밖의 codex-response.json은 위반', () => {
    const dir = fixture()
    try {
      writeRel(dir, 'other/codex-response.json', '{}\n')
      expect(violations(dir).map((e) => e.path)).toEqual(['other/codex-response.json'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rename 목적지가 <ticket>/codex-response.json이어도 위반', () => {
    const dir = fixture()
    try {
      writeRel(dir, 'source.txt')
      git(dir, ['add', '--', 'source.txt'])
      git(dir, ['commit', '-qm', 'source'])
      mkdirSync(join(dir, TICKET), { recursive: true })
      git(dir, ['mv', 'source.txt', `${TICKET}/codex-response.json`])
      const [entry] = violations(dir)
      expect(entry).toMatchObject({ index: 'R', path: `${TICKET}/codex-response.json`, origPath: 'source.txt' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('실제 req:new --run도 codex-response.json만 남은 레거시 repo에서 성공한다', () => {
    const dir = fixture()
    try {
      const year = new Date().getFullYear()
      const oldTicket = `${TICKET_ROOT}/REQ-${year}-001`
      writeRel(dir, `${oldTicket}/codex-response.json`, '{}\n')
      expectRawUntracked(dir, `${oldTicket}/codex-response.json`)
      const result = spawnSync(process.execPath, [TSX_CLI, REQ_NEW_CLI, 'phase3-e2e', '--root', dir, '--run'], {
        cwd: PACKAGE_ROOT,
        encoding: 'utf8',
      })
      expect(result.status, result.stderr).toBe(0)
      expectCreatedBranch(dir, 'phase3-e2e', year)
      // 허용은 삭제가 아니다. 기존 live 응답은 그대로 남고 새 티켓만 커밋된다.
      expect(git(dir, [...STATUS_Z_ARGS])).toContain(`${oldTicket}/codex-response.json`)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 60_000)

  /**
   * REQ-2026-100 — 스캐폴드가 **테스트 실행 계층**을 말한다.
   *
   * 🔴 왜 고정하는가: 이 문구가 소비자에게 닿는 **실질 경로**다. `02-plan.md`는 에이전트가 매 phase
   *    읽는 문서이고, 예전 문구(`Exit: eslint0·typecheck0 · 단위 그린`)는 범위·시점이 없어 "매 phase
   *    전체 스위트"로 부풀었다(이 저장소에서 실제로 그랬다 — REQ 4건에 전체 5회·1475초).
   *    그리고 스캐폴드 텍스트를 검사하는 테스트가 그때까지 **0건**이라 조용히 되돌아갈 수 있었다.
   */
  it('[REQ-2026-100] 스캐폴드 02-plan.md가 테스트 실행 계층을 명시한다', () => {
    const dir = fixture()
    try {
      const result = spawnSync(process.execPath, [TSX_CLI, REQ_NEW_CLI, 'tiering-scaffold', '--root', dir, '--run'], {
        cwd: PACKAGE_ROOT,
        encoding: 'utf8',
      })
      expect(result.status, result.stderr).toBe(0)
      const branch = git(dir, ['branch', '--show-current']).trim()
      const reqId = /^feat\/req-(\d{4}-\d{3})-/.exec(branch)?.[1]
      const plan = readFileSync(join(dir, TICKET_ROOT, `REQ-${reqId}`, '02-plan.md'), 'utf8')

      // 두 시점이 모두 있어야 한다 — 하나만 있으면 계층이 아니다.
      expect(plan).toContain('phase 진행 중')
      expect(plan).toContain('통합(main 병합) 직전 1회')
      // 범위 한정이 전체를 대체하지 않는다는 한계 고지(REQ-098 교훈: 안내가 보장보다 강하면 안 된다).
      expect(plan).toContain('대체하지 않는다')
      // 게이트가 테스트를 실행한다는 오해를 남기지 않는다.
      expect(plan).toContain('게이트는 테스트를 **실행하지 않는다**')
      // 없는 도구를 Exit 조건으로 심지 않는다(이 저장소·기본 소비자에 eslint 스크립트 없음).
      expect(plan).not.toContain('eslint0')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 60_000)

  it("실제 req:new --run은 ticketRoot='.'도 canonical Git 경로로 판정한다", () => {
    const dir = fixture()
    try {
      writeRel(dir, 'req.config.json', JSON.stringify({ ...SETUP_OK, packageManager: 'npm', ticketRoot: '.' }) + '\n')
      git(dir, ['add', '--', 'req.config.json'])
      git(dir, ['commit', '-qm', 'root ticket config'])
      const year = new Date().getFullYear()
      const oldTicket = `REQ-${year}-001`
      writeRel(dir, `${oldTicket}/codex-response.json`, '{}\n')
      expectRawUntracked(dir, `${oldTicket}/codex-response.json`)

      const result = spawnSync(process.execPath, [TSX_CLI, REQ_NEW_CLI, 'root-e2e', '--root', dir, '--run'], {
        cwd: PACKAGE_ROOT,
        encoding: 'utf8',
      })
      expect(result.status, result.stderr).toBe(0)
      expectCreatedBranch(dir, 'root-e2e', year)
      expect(git(dir, [...STATUS_Z_ARGS])).toContain(`${oldTicket}/codex-response.json`)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 60_000)
})

/** REQ-2026-029 phase-2 — req:new --successor-of lineage(통합, spawnSync). */
describe('req:new — --successor-of lineage(REQ-2026-029)', () => {
  const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
  const TSX_CLI = join(PACKAGE_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs')
  const REQ_NEW_CLI = join(PACKAGE_ROOT, 'scripts', 'req', 'req-new.ts')
  const g = (dir: string, args: readonly string[]): string => execFileSync('git', [...args], { cwd: dir, encoding: 'utf8' })

  /** 부모 REQ를 심은 repo. parentReplace=true면 부모에 유효 replace 종결 기록. */
  const fixture = (parentReplace: boolean): string => {
    const dir = mkdtempSync(join(tmpdir(), 'req-new-succ-'))
    g(dir, ['init', '-q'])
    // REQ-2026-049: repo-local identity. 인라인 `-c`는 그 호출에만 적용돼 **피시험 코드의 커밋**을 보호하지 못한다.
    g(dir, ['config', 'user.email', 't@t.t'])
    g(dir, ['config', 'user.name', 't'])
    g(dir, ['config', '--local', 'user.email', 't@t.invalid']); g(dir, ['config', '--local', 'user.name', 'T'])
    g(dir, ['config', '--local', 'commit.gpgSign', 'false'])
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x', version: '0.0.0' }) + '\n')
    writeFileSync(join(dir, 'req.config.json'), JSON.stringify({ ...SETUP_OK, packageManager: 'npm' }) + '\n')
    const parentDir = join(dir, 'workflow', 'REQ-2026-020')
    mkdirSync(parentDir, { recursive: true })
    const series = parentReplace
      ? [{ series_id: 'design:-#1', review_kind: 'design', phase_id: null, attempts: 8, closed_reason: 'human-resolution', human_resolution: { decision: 'replace', method: '대체 승인', decided_at: '2026-07-18T00:00:00Z' } }]
      : [{ series_id: 'design:-#1', review_kind: 'design', phase_id: null, attempts: 3, closed_reason: 'approved' }]
    writeFileSync(join(parentDir, 'state.json'), JSON.stringify({ id: 'REQ-2026-020', phase: 'INTAKE', phases: [], approval_evidence_required: true, review_series_model_version: 1, review_series: series }, null, 2) + '\n')
    g(dir, ['add', '-A']); g(dir, ['commit', '-qm', 'base'])
    return dir
  }
  const run = (dir: string, args: string[]) => spawnSync('node', [TSX_CLI, REQ_NEW_CLI, ...args, '--root', dir], { cwd: dir, encoding: 'utf8' })
  const childState = (dir: string): Record<string, unknown> | null => {
    const p = join(dir, 'workflow', 'REQ-2026-021', 'state.json')
    return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null
  }
  // 🔴 R6: 실패 경로에서 브랜치·티켓 **디렉터리**가 남지 않아야 한다(state 부재만으론 부족 — design-r01 P1).
  const branchExists = (dir: string, reqId: string): boolean =>
    g(dir, ['branch', '--list', `feat/req-${reqId.replace('REQ-', '')}-*`]).trim().length > 0
  const childDirExists = (dir: string): boolean => existsSync(join(dir, 'workflow', 'REQ-2026-021'))

  const expectNoSideEffects = (dir: string): void => {
    expect(childState(dir)).toBeNull()           // state 파일 없음
    expect(childDirExists(dir)).toBe(false)       // 🔴 티켓 디렉터리도 없음
    expect(branchExists(dir, 'REQ-2026-021')).toBe(false) // 🔴 브랜치도 안 생김
  }

  it('O2-4 🔴 부모에 replace 기록 없으면 throw + 브랜치·디렉터리 미생성(R6)', () => {
    const dir = fixture(false)
    try {
      const r = run(dir, ['succ-child', '--successor-of', 'REQ-2026-020', '--run'])
      expect(r.status).not.toBe(0)
      expectNoSideEffects(dir) // checkout -b·mkdir가 lineage 해소 前이면 실패
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('O2-4 🔴 존재하지 않는 부모 → throw + 브랜치·디렉터리 미생성(R6)', () => {
    const dir = fixture(true)
    try {
      const r = run(dir, ['succ-child', '--successor-of', 'REQ-2026-999', '--run'])
      expect(r.status).not.toBe(0)
      expectNoSideEffects(dir)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('O2-5 정상 successor → 자식 생성 + successor_of 부모에서 채워짐 + 빈 review_series(새 예산)', () => {
    const dir = fixture(true)
    try {
      const r = run(dir, ['succ-child', '--successor-of', 'REQ-2026-020', '--run'])
      expect(r.status).toBe(0)
      const s = childState(dir)!
      const so = s.successor_of as Record<string, unknown>
      expect(so.req_id).toBe('REQ-2026-020')
      expect(so.parent_attempts_total).toBe(8) // 부모에서 읽음
      expect((so.parent_replace_resolution as Record<string, unknown>).decision).toBe('replace')
      expect(s.review_series ?? []).toEqual([]) // 새 예산(빈 series)
      expect(s.review_series_model_version).toBe(1)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('O2-6 --successor-of 없으면 successor_of 없이 정상 생성(opt-in, R9)', () => {
    const dir = fixture(true)
    try {
      const r = run(dir, ['plain-child', '--run'])
      expect(r.status).toBe(0)
      const s = childState(dir)!
      expect(s.successor_of).toBeUndefined()
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  // 🔴 REQ-2026-052 test #3: replace 종결이 부모에 ledger + series-terminal close proof를 **커밋**한다.
  it('REQ-2026-052: successor 생성 시 부모 series-terminal close proof가 HEAD에 커밋된다', () => {
    const dir = fixture(true)
    try {
      const r = run(dir, ['succ-child', '--successor-of', 'REQ-2026-020', '--run'])
      expect(r.status).toBe(0)
      const cpRel = 'workflow/REQ-2026-020/responses/ticket-close.jsonl'
      // HEAD(자식 브랜치)에 부모 close proof가 committed blob으로 존재.
      const t = g(dir, ['cat-file', '-t', `HEAD:${cpRel}`]).trim()
      expect(t).toBe('blob')
      const rows = g(dir, ['show', `HEAD:${cpRel}`]).trim().split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l))
      const term = rows.find((x: Record<string, unknown>) => x.event === 'series-terminal')
      expect(term).toBeTruthy()
      expect(term.ticket_id).toBe('REQ-2026-020')
      expect(term.resolution).toBe('replace')
      expect(term.reconstructed).toBe(false)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})
