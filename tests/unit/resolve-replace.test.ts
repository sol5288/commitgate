/**
 * REQ-2026-145 — `req:review-exception --resolve replace`(대체 결정 기록).
 *
 * 🔴 이 스위트의 핵심은 **배선 e2e** 다. `closeSeriesHumanResolution` 은 이 REQ 이전에도 존재했고
 *    단위 테스트도 있었지만, **어떤 verb 도 부르지 않아** `req:new --successor-of` 가 영영 막혀 있었다.
 *    순수 테스트는 그 끊김을 못 본다(이 저장소 4회 실증) — 실제 진입점을 **두 번 연속** 구동한다.
 */
import { describe, it, expect, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { packageRoot } from '../../scripts/req/lib/config'
import {
  main as reviewExceptionMain,
  planResolveReplace,
  successorSlug,
} from '../../scripts/req/req-review-exception'
import { main as reqNewMain } from '../../scripts/req/req-new'
import type { WorkflowState } from '../../scripts/req/review-codex'

const gitOf = (repo: string) => (args: string[]): string =>
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: repo, encoding: 'utf8' })

/** hardCap 에 닿은 티켓(열린 design series, attempts=8). */
const setupRepo = (): { repo: string; ticket: string } => {
  const repo = mkdtempSync(join(tmpdir(), 'req145-'))
  const git = gitOf(repo)
  git(['init', '-q'])
  git(['config', 'user.email', 't@t.t'])
  git(['config', 'user.name', 't'])
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'x', version: '0.0.0' }))
  mkdirSync(join(repo, 'workflow'), { recursive: true })
  writeFileSync(
    join(repo, 'workflow', 'machine.schema.json'),
    readFileSync(join(packageRoot(), 'workflow', 'machine.schema.json'), 'utf8'),
  )
  writeFileSync(join(repo, 'workflow', '.gitignore'), '/.review-calls.jsonl\n')
  writeFileSync(join(repo, 'req.config.json'), JSON.stringify({ packageManager: 'npm', reviewPersonaPath: null }))
  const ticket = join(repo, 'workflow', 'REQ-2026-001')
  mkdirSync(ticket, { recursive: true })
  for (const f of ['00-requirement.md', '01-design.md', '02-plan.md']) writeFileSync(join(ticket, f), `# ${f}\n본문\n`)
  writeFileSync(join(ticket, 'codex-request.md'), '# req\n리뷰 포인트\n')
  writeFileSync(
    join(ticket, 'state.json'),
    JSON.stringify(
      {
        id: 'REQ-2026-001',
        phase: 'INTAKE',
        phases: [],
        branch: 'feat/req-2026-001-parent-slug',
        approval_evidence_required: true,
        evidence_durability_required: true,
        review_series_model_version: 1,
        review_series: [
          { series_id: 'design:-#1', review_kind: 'design', phase_id: null, attempts: 8, closed_reason: null },
        ],
      },
      null,
      2,
    ) + '\n',
  )
  git(['add', '-A'])
  git(['commit', '-qm', 'baseline'])
  return { repo, ticket }
}

const readState = (ticket: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(ticket, 'state.json'), 'utf8')) as Record<string, unknown>
const commitCount = (repo: string): number => Number(gitOf(repo)(['rev-list', '--count', 'HEAD']).trim())

describe('[REQ-2026-145] planResolveReplace (순수)', () => {
  const open = (): WorkflowState =>
    ({
      id: 'REQ-2026-001',
      review_series_model_version: 1,
      review_series: [
        { series_id: 'design:-#1', review_kind: 'design', phase_id: null, attempts: 8, closed_reason: null },
        { series_id: 'phase:phase#alpha#2', review_kind: 'phase', phase_id: 'phase#alpha', attempts: 1, closed_reason: null },
        { series_id: 'design:-#0', review_kind: 'design', phase_id: null, attempts: 3, closed_reason: 'approved' },
      ],
    }) as unknown as WorkflowState
  const good = { resolve: 'replace', seriesId: 'design:-#1', reason: '비수렴', confirm: '대체 승인' }

  it('열린 series 를 찾아 kind·phase 를 그대로 돌려준다', () => {
    const p = planResolveReplace(open(), good)
    expect(p.ok).toBe(true)
    if (!p.ok) return
    expect(p.kind).toBe('design')
    expect(p.phaseId).toBeNull()
  })

  it('🔴 series_id 를 파싱하지 않는다 — phase id 에 # 이 있어도 원문 대조로 찾는다', () => {
    const p = planResolveReplace(open(), { ...good, seriesId: 'phase:phase#alpha#2' })
    expect(p.ok).toBe(true)
    if (!p.ok) return
    expect(p.phaseId).toBe('phase#alpha')
    expect(p.kind).toBe('phase')
  })

  it('replace 외의 decision 은 거부', () => {
    const p = planResolveReplace(open(), { ...good, resolve: 'terminate' })
    expect(p.ok).toBe(false)
    if (p.ok) return
    expect(p.reason).toMatch(/replace/)
  })

  it('🔴 --reason 이 공백만이어도 거부 — "필수"는 인자 존재가 아니라 내용 존재다', () => {
    for (const r of ['', '   ', '\t\n']) expect(planResolveReplace(open(), { ...good, reason: r }).ok).toBe(false)
  })

  it('🔴 --confirm 이 공백만이어도 거부', () => {
    expect(planResolveReplace(open(), { ...good, confirm: '  ' }).ok).toBe(false)
  })

  it('없는 series 는 거부하고 **열린** series 목록을 실제 값으로 준다', () => {
    const p = planResolveReplace(open(), { ...good, seriesId: 'nope#9' })
    expect(p.ok).toBe(false)
    if (p.ok) return
    expect(p.hint).toContain('design:-#1')
    expect(p.hint).toContain('phase:phase#alpha#2')
    expect(p.hint).not.toContain('design:-#0')
  })

  it('🔴 이미 종결된 series 는 조용한 no-op 이 아니라 명시적 거부', () => {
    const p = planResolveReplace(open(), { ...good, seriesId: 'design:-#0' })
    expect(p.ok).toBe(false)
    if (p.ok) return
    expect(p.reason).toMatch(/이미 종결/)
  })
})

describe('[REQ-2026-145] successorSlug — 자리표시자를 내지 않는다', () => {
  it('부모 branch 에서 벗겨 낸다', () => {
    expect(successorSlug('feat/req-2026-144-hardcap-nonconvergence-report', 'REQ-2026-144')).toBe(
      'hardcap-nonconvergence-report-successor',
    )
  })

  it('🔴 벗길 수 없어도 값이 나온다 — 자리표시자로 떨어지지 않는다', () => {
    for (const b of [null, undefined, '', 'main', 'wip/foo']) {
      const slug = successorSlug(b, 'REQ-2026-144')
      expect(slug.length).toBeGreaterThan(0)
      expect(slug).not.toContain('<')
      expect(slug).not.toContain(' ')
    }
  })

  it('결정론 — 같은 입력이면 같은 값', () => {
    expect(successorSlug('feat/req-2026-001-x', 'REQ-2026-001')).toBe(
      successorSlug('feat/req-2026-001-x', 'REQ-2026-001'),
    )
  })
})

describe('[REQ-2026-145] --resolve replace (실 git e2e)', () => {
  const resolveArgs = (repo: string): string[] => [
    '2026-001',
    '--resolve',
    'replace',
    '--series',
    'design:-#1',
    '--reason',
    '설계가 비수렴이라 범위를 나눠 다시 만든다',
    '--confirm',
    'REQ-2026-001 대체 승인',
    '--run',
    '--root',
    repo,
  ]
  const capture = (fn: () => void): string => {
    const lines: string[] = []
    const spy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void lines.push(a.join(' ')))
    try {
      fn()
    } finally {
      spy.mockRestore()
    }
    return lines.join('\n')
  }

  it('🔴 --run 없으면 아무것도 쓰지 않는다(dry-run 무부작용)', () => {
    const { repo, ticket } = setupRepo()
    const before = readFileSync(join(ticket, 'state.json'), 'utf8')
    const commits = commitCount(repo)
    capture(() => reviewExceptionMain(resolveArgs(repo).filter((a) => a !== '--run')))
    expect(readFileSync(join(ticket, 'state.json'), 'utf8')).toBe(before)
    expect(commitCount(repo)).toBe(commits)
    rmSync(repo, { recursive: true, force: true })
  })

  it('🔴 두 입력이 서로 다른 필드에 저장되고, state 가 커밋돼 워킹트리가 clean 해진다', () => {
    const { repo, ticket } = setupRepo()
    const commits = commitCount(repo)
    capture(() => reviewExceptionMain(resolveArgs(repo)))
    const rec = (readState(ticket).review_series as Record<string, unknown>[])[0]!
    expect(rec.closed_reason).toBe('human-resolution')
    const hr = rec.human_resolution as Record<string, unknown>
    expect(hr.decision).toBe('replace')
    expect(hr.method).toBe('REQ-2026-001 대체 승인')
    expect(hr.note).toBe('설계가 비수렴이라 범위를 나눠 다시 만든다')
    // 🔴 decided_at 은 실제 시계다(고정값 주입 없음 — REQ-2026-019 날조 폐기 이력).
    expect(String(hr.decided_at)).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(Number.isNaN(Date.parse(String(hr.decided_at)))).toBe(false)
    // 🔴 checkpoint 를 명시적으로 커밋한다 — 안 하면 다음 req:new 가 clean-tree 검사에 막힌다.
    expect(commitCount(repo)).toBe(commits + 1)
    expect(gitOf(repo)(['status', '--porcelain']).trim()).toBe('')
    rmSync(repo, { recursive: true, force: true })
  })

  it('🔴 배선 e2e — 그 직후 req:new --successor-of 가 다른 조작 없이 성공한다', () => {
    const { repo } = setupRepo()
    capture(() => reviewExceptionMain(resolveArgs(repo)))
    capture(() => reqNewMain(['x-successor', '--successor-of', 'REQ-2026-001', '--run', '--root', repo]))
    expect(gitOf(repo)(['branch', '--list'])).toMatch(/x-successor/)
    rmSync(repo, { recursive: true, force: true })
  })

  it('🔴 --resolve 없이는 실패한다 — 이 REQ 이전 상태(탈출구 없음)를 고정', () => {
    const { repo } = setupRepo()
    expect(() => reqNewMain(['x-successor', '--successor-of', 'REQ-2026-001', '--run', '--root', repo])).toThrow(
      /사람 결정 기록이 없다/,
    )
    rmSync(repo, { recursive: true, force: true })
  })

  it('🔴 남의 staged 파일은 커밋하지 않고, 막는 경로를 실제 값으로 열거한다', () => {
    const { repo, ticket } = setupRepo()
    // 실제 hardCap 상태 재현 — 리뷰에 올린 설계 문서가 staged 로 남아 있다.
    writeFileSync(join(ticket, '01-design.md'), '# 01-design.md\n수정됨\n')
    gitOf(repo)(['add', '--', 'workflow/REQ-2026-001/01-design.md'])
    const out = capture(() => reviewExceptionMain(resolveArgs(repo)))
    expect(gitOf(repo)(['status', '--porcelain', '--', 'workflow/REQ-2026-001/state.json']).trim()).toBe('')
    expect(gitOf(repo)(['status', '--porcelain', '--', 'workflow/REQ-2026-001/01-design.md']).trim()).not.toBe('')
    // "정리하십시오"만으로는 무엇을 정리할지 모른다 — 실제 경로를 준다.
    expect(out).toContain('workflow/REQ-2026-001/01-design.md')
    expect(out).toContain('git commit -m')
    gitOf(repo)(['commit', '-qm', 'chore: parking'])
    capture(() => reqNewMain(['x-successor', '--successor-of', 'REQ-2026-001', '--run', '--root', repo]))
    expect(gitOf(repo)(['branch', '--list'])).toMatch(/x-successor/)
    rmSync(repo, { recursive: true, force: true })
  })

  it('🔴 안내의 CommitGate 명령은 붙여넣어 실행되는 형태다 — 꺾쇠 없음·npx 접두·--run', () => {
    const { repo } = setupRepo()
    const out = capture(() => reviewExceptionMain(resolveArgs(repo)))
    const cg = out
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('npx commitgate'))
    expect(cg.length).toBeGreaterThan(0)
    for (const c of cg) {
      expect(c.endsWith('--run')).toBe(true)
      // PowerShell 에서 `<` 는 리디렉션 토큰이라 붙여넣으면 명령이 파싱 오류로 죽는다.
      expect(c).not.toContain('<')
    }
    rmSync(repo, { recursive: true, force: true })
  })
})
