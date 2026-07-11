import { describe, it, expect } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
    expect(s.phase).toBe('INTAKE')
    expect(s.commit_allowed).toBe(false)
    expect(s.risk_level).toBe('LOW')
    expect(s.approved_diff_hash).toBe(null)
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
    writeRel(dir, 'req.config.json', JSON.stringify({ packageManager: 'npm' }) + '\n')
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

  it("실제 req:new --run은 ticketRoot='.'도 canonical Git 경로로 판정한다", () => {
    const dir = fixture()
    try {
      writeRel(dir, 'req.config.json', JSON.stringify({ packageManager: 'npm', ticketRoot: '.' }) + '\n')
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
