/**
 * REQ-2026-112 phase-2 — D29: 소비자 계약 파일의 **폐기된 주장** 진단.
 *
 * 🔴 **왜 순수 테스트로 부족한가**: `runChecks`에 `retiredClaimHits`를 손으로 넣는 테스트는
 *    `main()`이 그 값을 **계산해 주입하는 배선**이 끊겨도 통과한다. 이 저장소는 그 실패를
 *    세 번 실증했다(REQ-2026-083·097·099). 그래서 AC-5·AC-6·AC-7b는 실제 진입점을 돌린다.
 *
 * 🔴 **AC-7(정본 결속)은 세 겹이다**(설계 DEC-4). 설계 리뷰가 두 라운드에 걸쳐 좁힌 결과다:
 *    ① 구조 — `req-doctor`가 목록을 import하지 않는다(배열을 쥐지 않으면 사본을 둘 자리가 없다)
 *    ② 참조(AC-7a) — 재수출된 매칭 함수가 정본과 **같은 객체**인가. 내용이 같은 사본도 여기서 실패한다
 *    ③ 행동(AC-7b) — `main()`을 통해 정본의 **모든 항목**이 발화하는가
 */
import { describe, it, expect, vi } from 'vitest'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { main as doctorMain, retiredClaimsIn as doctorRetiredClaimsIn } from '../../scripts/req/req-doctor'
import { RETIRED_CLAIMS, retiredClaimsIn as canonicalRetiredClaimsIn } from '../../scripts/req/lib/retired-claims'
import { mkRepo, git } from './fixtures/stale-devcomplete'

const TICKET_ID = 'REQ-2026-998'
const SHORT = '2026-998'
const TICKET_REL = `workflow/${TICKET_ID}`

/** 계약 파일 내용을 지정해 hermetic repo를 만든다. `null`이면 `AGENTS.md`를 두지 않는다. */
const repoWith = (agentsBody: string | null): string => {
  const repo = mkRepo('req112-d29-')
  mkdirSync(join(repo, TICKET_REL), { recursive: true })
  writeFileSync(
    join(repo, TICKET_REL, 'state.json'),
    JSON.stringify({ id: TICKET_ID, branch: 'feat/req-2026-998-x', risk_level: 'LOW', commit_allowed: false, phases: [] }),
  )
  if (agentsBody !== null) writeFileSync(join(repo, 'AGENTS.md'), agentsBody)
  git(repo, ['add', '-A'])
  git(repo, ['commit', '-qm', 'fixture'])
  return repo
}

/** `main()`을 돌리고 D29 줄을 돌려준다. 없으면 빈 문자열(그 자체가 실패 신호다). */
const d29Line = (repo: string): string => {
  const lines: string[] = []
  const log = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void lines.push(a.join(' ')))
  const exit = vi.spyOn(process, 'exit').mockImplementation(((): never => undefined as never) as never)
  try {
    doctorMain([SHORT, '--root', repo])
  } finally {
    log.mockRestore()
    exit.mockRestore()
  }
  return lines.find((l) => l.includes('] WARN D29:') || l.includes('] OK D29:')) ?? ''
}

describe('[REQ-2026-112] D29 — 계약 파일의 폐기된 서술', () => {
  /** AC-5 */
  it('🔴 AGENTS.md에 폐기된 주장이 있으면 WARN하고 사유를 그대로 전한다', () => {
    const claim = RETIRED_CLAIMS[0]
    if (!claim) throw new Error('정본 목록이 비어 있다')
    const line = d29Line(repoWith(`# AGENTS\n\n어떤 규칙: ${claim.text} 입니다.\n`))

    expect(line).toContain('WARN D29')
    expect(line).toContain('AGENTS.md')
    expect(line).toContain(claim.text)
    // 사유는 정본의 `why`를 **그대로** 쓴다 — 두 표면이 다른 말을 하면 사람이 판단해야 한다(D28과 같은 원칙).
    expect(line).toContain(claim.why)
    // 파일을 고치지 않는다는 사실을 안내에 담는다.
    expect(line).toContain('고치지 않습니다')
  })

  /** AC-6 — 오탐 대조군 */
  it('🔴 폐기된 주장이 없으면 조용하다(OK)', () => {
    const line = d29Line(repoWith('# AGENTS\n\n정지 지점은 stopGate가 정합니다.\n'))
    expect(line).toContain('OK D29')
    expect(line).not.toContain('WARN')
  })

  /** 계약 파일이 아예 없는 저장소(대부분의 dev repo)에서도 조용하다. */
  it('AGENTS.md가 없으면 점검 불요(OK)', () => {
    const line = d29Line(repoWith(null))
    expect(line).toContain('OK D29')
    expect(line).toContain('점검 불요')
  })

  /**
   * 🔴 AC-7a — **참조 동일성**. 설계 리뷰 r02가 지적한 "내용이 같은 배열 사본" 시나리오를 막는다.
   *    `req-doctor`가 매칭을 재구현하면 `toBe`가 실패한다.
   */
  it('🔴 req-doctor의 매칭 함수가 정본과 같은 객체다(사본 구현 금지)', () => {
    expect(doctorRetiredClaimsIn).toBe(canonicalRetiredClaimsIn)
  })

  /**
   * 🔴 AC-7b — **행동 전수**. 정본에 항목을 추가했는데 진단이 못 잡으면 여기서 실패한다.
   *    ①(구조)·②(참조)가 정적 결속을, 이것이 **배선**을 보장한다.
   */
  it('🔴 정본의 모든 항목이 main()을 통해 발화한다', () => {
    expect(RETIRED_CLAIMS.length).toBeGreaterThan(5) // 목록이 비면 이 검사가 무의미해진다
    for (const claim of RETIRED_CLAIMS) {
      const line = d29Line(repoWith(`# AGENTS\n\n${claim.text}\n`))
      expect(line, `등재 문구가 발화하지 않음: ${claim.text}`).toContain('WARN D29')
      expect(line).toContain(claim.text)
    }
  })
})
