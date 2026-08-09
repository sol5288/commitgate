/**
 * REQ-2026-120 phase-1 — secret scan **배선**(실 git near-e2e·phase 리뷰 r01 P1).
 *
 * 🔴 순수 `secretScanGate` 테스트만으로는 게이트가 `gateAndRecordAttempt`·reviewer 호출 **뒤로**
 *    이동해도 통과한다(빌더 직접호출 가드는 배선끊김을 못 잡는다 — 이 저장소 3회 실증). 그래서
 *    실제 진입점 `main()`을 fake reviewer로 돌려 "차단 시 호출 0회·attempt-opened 부재"를 고정한다.
 * 🔴 비밀 픽스처는 분할 구성 — 이 파일 자체가 리뷰 diff에 실린다(secret-scan.test.ts와 같은 이유).
 */
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { packageRoot } from '../../scripts/req/lib/config'
import { main as reviewCodexMain } from '../../scripts/req/review-codex'
import { createFakeReviewerAdapter } from '../../scripts/req/lib/adapters'

const SECRET = 'AKIA' + 'ABCDEFGH12345678' // 합성 — 형식만 유효

const gitOf = (repo: string) => (args: string[]): string =>
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: repo, encoding: 'utf8' })

/** review-lifecycle-wiring.test.ts의 hermetic 픽스처와 같은 최소 형태 + secretScan config. */
const setupRepo = (secretScan?: 'block' | 'warn' | 'off'): { repo: string; ticket: string; head: string } => {
  const repo = mkdtempSync(join(tmpdir(), 'req120-wiring-'))
  const git = gitOf(repo)
  git(['init', '-q'])
  git(['config', 'user.email', 't@t.t'])
  git(['config', 'user.name', 't'])
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'x', version: '0.0.0' }))
  mkdirSync(join(repo, 'workflow'), { recursive: true })
  writeFileSync(join(repo, 'workflow', 'machine.schema.json'), readFileSync(join(packageRoot(), 'workflow', 'machine.schema.json'), 'utf8'))
  writeFileSync(join(repo, 'workflow', '.gitignore'), '/.review-calls.jsonl\n')
  writeFileSync(
    join(repo, 'req.config.json'),
    JSON.stringify({ packageManager: 'npm', reviewPersonaPath: null, ...(secretScan ? { secretScan } : {}) }),
  )
  const ticket = join(repo, 'workflow', 'REQ-2026-001')
  mkdirSync(ticket, { recursive: true })
  // 🔴 비밀은 설계 문서 본문에 넣는다 — design 리뷰 프롬프트의 권위 아티팩트라 조립 프롬프트에 실린다.
  writeFileSync(join(ticket, '00-requirement.md'), '# req\n본문\n')
  writeFileSync(join(ticket, '01-design.md'), `# design\naws_key = "${SECRET}"\n`)
  writeFileSync(join(ticket, '02-plan.md'), '# plan\n본문\n')
  writeFileSync(join(ticket, 'codex-request.md'), '# req\n리뷰 포인트\n')
  writeFileSync(
    join(ticket, 'state.json'),
    JSON.stringify({ id: 'REQ-2026-001', phase: 'INTAKE', phases: [], approval_evidence_required: true, review_series_model_version: 1 }, null, 2) + '\n',
  )
  git(['add', '-A'])
  git(['commit', '-qm', 'baseline'])
  return { repo, ticket, head: git(['rev-parse', 'HEAD']).trim() }
}

const cannedApproved = (): ReturnType<typeof createFakeReviewerAdapter> =>
  createFakeReviewerAdapter({
    rawStdout: '',
    threadId: 'tid-120',
    lastMessage: JSON.stringify({
      machine_schema_version: '1.1',
      review_base_sha: 'x'.repeat(40), // echoPromptBase(기본 true)가 프롬프트 base로 덮어쓴다
      risk_level: 'LOW',
      review_kind: 'design',
      status: 'STEP_COMPLETE',
      commit_approved: 'yes',
      merge_ready: 'no',
      findings: [],
      next_action: '',
    }),
  })

const ledgerEvents = (ticket: string): string[] => {
  const f = join(ticket, 'responses', 'review-ledger.jsonl')
  if (!existsSync(f)) return []
  return readFileSync(f, 'utf8').split('\n').filter((l) => l.trim()).map((l) => (JSON.parse(l) as { event: string }).event)
}

const run = (repo: string, reviewer: ReturnType<typeof createFakeReviewerAdapter>): { threw: string | null } => {
  try {
    reviewCodexMain(['2026-001', '--kind', 'design', '--run', '--root', repo], { reviewer })
    return { threw: null }
  } catch (err) {
    return { threw: err instanceof Error ? err.message : String(err) }
  }
}

describe('[REQ-2026-120] secret scan 배선(near-e2e)', () => {
  it('🔴 기본(block): reviewer 호출 0회 + attempt-opened 부재 + 예산 미차감 문구로 실패(완료 기준 1·2)', () => {
    const { repo, ticket } = setupRepo() // secretScan 미지정 = 기본 block
    const reviewer = cannedApproved()
    const { threw } = run(repo, reviewer)
    expect(threw).toContain('secret 패턴')
    expect(threw).toContain('예산도 차감되지 않았습니다')
    expect(threw).not.toContain(SECRET) // 오류 메시지가 비밀을 재출력하지 않는다(마스킹)
    expect(reviewer.requests).toHaveLength(0) // 외부 전송 없음
    expect(ledgerEvents(ticket)).toEqual([]) // attempt-opened 미기록 = 예산 미차감
  })

  it("warn: 경고 후 진행 — reviewer 정확히 1회 호출·attempt-opened 기록(완료 기준 3)", () => {
    const { repo, ticket } = setupRepo('warn')
    const reviewer = cannedApproved()
    const { threw } = run(repo, reviewer)
    expect(threw).toBeNull()
    expect(reviewer.requests).toHaveLength(1)
    expect(ledgerEvents(ticket)).toContain('attempt-opened')
  })

  it("off: 스캔 없이 진행 — 비밀이 있어도 호출된다(명시적 opt-out)", () => {
    const { repo } = setupRepo('off')
    const reviewer = cannedApproved()
    const { threw } = run(repo, reviewer)
    expect(threw).toBeNull()
    expect(reviewer.requests).toHaveLength(1)
  })
})
