/**
 * REQ-2026-146 — `req:next` 통합 안내가 **그 티켓의 실제 정책**을 말한다.
 *
 * 🔴 실측 재현: `stopGate: "auto"` 티켓에서 `req:next` 는 `stopGate=merge` 라고 했고, 같은 순간
 *    `req:doctor` 는 `OK D32: 정지 정책 일치(stopGate="auto")` 라고 했다 — **두 도구가 같은 티켓의
 *    정책을 다르게 말했다**. 원인은 `req-next.ts:904` 의 하드코딩이었다.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { terminalIntegrationAction, type NextInput } from '../../scripts/req/req-next'
import type { StopGate } from '../../scripts/req/lib/config'

const BRANCH = 'feat/req-2026-146-stopgate-message-drift'

/** 모든 phase 가 승인·커밋된 종단 상태(통합이 다음 지점). */
const terminalInput = (over: Partial<NextInput> = {}, stateOver: Record<string, unknown> = {}): NextInput =>
  ({
    target: { kind: 'id', id: 'REQ-2026-146' },
    packageManager: 'npm',
    state: {
      id: 'REQ-2026-146',
      branch: BRANCH,
      risk_level: 'LOW',
      phases: [{ id: 'p1', title: 'p1', status: 'approved' }],
      review_series_model_version: 1,
      ...stateOver,
    },
    stopGate: 'merge',
    phaseCommitAutoApprove: 'low-only',
    completesReq: true,
    worktreeReviewClean: true,
    designApproved: true,
    ...over,
  }) as unknown as NextInput

/** 종단 통합 안내를 얻는다(구현 세부에 의존하지 않도록 resolveNext 를 통해 얻는다). */
const guidance = (sg: StopGate, stateOver: Record<string, unknown> = {}): { detail: string; command?: string; controlPoint?: string } => {
  const a = terminalIntegrationAction(terminalInput({ stopGate: sg }, stateOver), { prefix: `stopGate=${sg} 인데 이 feature 가 속한 delivery 묶음이 없다 — 이 REQ 의 통합이 다음 지점이다. ` })
  return { detail: a.detail, command: a.command, controlPoint: a.controlPoint }
}

describe('[REQ-2026-146] 정책명 드리프트', () => {
  /**
   * 🔴 **배열 리터럴이 아니라 `Record<StopGate, …>` 다.** 배열이면 `StopGate` 에 값이 추가돼도 조용히
   *    그대로 돌아 같은 드리프트가 재발한다. Record 면 새 값이 생기는 순간 **타입 검사가 깨져**
   *    테스트를 갱신하지 않을 수 없다(REQ-2026-099 등록부-강제 교훈).
   */
  const OTHERS: Record<StopGate, StopGate[]> = {
    phase: ['req', 'merge', 'auto'],
    req: ['phase', 'merge', 'auto'],
    merge: ['phase', 'req', 'auto'],
    auto: ['phase', 'req', 'merge'],
  }

  it('🔴 안내에 자기 정책 이름이 들어가면 다른 정책 이름은 섞이지 않는다', () => {
    for (const sg of Object.keys(OTHERS) as StopGate[]) {
      const g = guidance(sg)
      const blob = `${g.detail} ${g.command ?? ''} ${g.controlPoint ?? ''}`
      for (const other of OTHERS[sg]) {
        expect(blob, `${sg} 안내에 ${other} 가 섞였다`).not.toContain(`stopGate=${other}`)
        expect(blob, `${sg} 안내에 ${other} 가 섞였다`).not.toContain(`stopGate="${other}"`)
      }
    }
  })

  it('🔴 auto 티켓의 안내가 auto 라고 말한다(실측 재현 — merge 가 나오면 실패)', () => {
    const g = guidance('auto')
    const blob = `${g.detail} ${g.controlPoint ?? ''}`
    expect(blob).toContain('auto')
    expect(blob).not.toContain('stopGate=merge')
  })

  it('merge 티켓은 여전히 merge 라고 말한다(보간 후에도 값이 같다)', () => {
    expect(guidance('merge').detail).toContain('stopGate=merge')
  })
})

describe('[REQ-2026-146] auto 는 다음 명령이 다르다', () => {
  it('🔴 다음 명령이 req:delegate 이고 실제 REQ id·branch 가 박혀 있다', () => {
    const cmd = guidance('auto').command ?? ''
    expect(cmd).toContain('req:delegate')
    expect(cmd).toContain('--scope ticket:REQ-2026-146')
    expect(cmd).toContain(BRANCH)
    expect(cmd.trim().endsWith('--run')).toBe(true)
  })

  it('🔴 꺾쇠 자리표시자가 없다 — PowerShell 에서 `<` 는 리디렉션이라 명령이 죽는다', () => {
    const cmd = guidance('auto').command ?? ''
    expect(cmd).not.toContain('<')
  })

  it('🔴 권한 확대 플래그는 안내하지 않는다 — 기본 불허가 안전 속성이다', () => {
    const cmd = guidance('auto').command ?? ''
    expect(cmd).not.toContain('--allow-push')
    expect(cmd).not.toContain('--allow-bypass')
  })

  it('🔴 HIGH 는 --high-risk 를 포함한다 — 없으면 high-risk-unacked 로 막힌다', () => {
    const cmd = guidance('auto', { risk_level: 'HIGH' }).command ?? ''
    expect(cmd).toContain('--high-risk')
  })

  it('🔴 LOW 에는 --high-risk 가 없다(불필요한 확인을 요구하지 않는다)', () => {
    expect(guidance('auto').command ?? '').not.toContain('--high-risk')
  })

  it('통제점이 통합이 아니라 사전 위임 발급이다', () => {
    expect(guidance('auto').controlPoint ?? '').toContain('사전 위임')
  })

  it('왜 필요한지 말한다 — 명령만 주면 선택인지 필수인지 모른다', () => {
    expect(guidance('auto').detail).toContain('absent')
  })
})

describe('[REQ-2026-146] 안전 렌더링', () => {
  it('🔴 셸이 해석하는 문자가 든 branch 는 명령으로 만들지 않고 데이터로 보여 준다', () => {
    const g = guidance('auto', { branch: 'feat/req-2026-146-$(whoami)' })
    expect(g.command).toBeUndefined()
    expect(g.detail).toContain('feat/req-2026-146-$(whoami)')
    expect(g.detail).toContain('직접 넣어')
  })

  it('🔴 `;` 나 공백은 따옴표로 감싸 무해하게 렌더링한다(명령은 그대로 나온다)', () => {
    const cmd = guidance('auto', { branch: 'feat/req-;whoami x' }).command ?? ''
    expect(cmd).toContain('"feat/req-;whoami x"')
  })
})

describe('[REQ-2026-146] merge·req 무회귀', () => {
  it('🔴 merge 안내는 I1/I2/B1 경로 그대로이고 command 가 없다', () => {
    const g = guidance('merge')
    expect(g.detail).toContain('AGENTS.md 통제점표(I1/I2/B1)')
    expect(g.controlPoint).toBe('통합(feature→main)')
    expect(g.command).toBeUndefined()
  })

  it('🔴 req 안내도 종전과 같다', () => {
    const g = guidance('req')
    expect(g.detail).toContain('AGENTS.md 통제점표(I1/I2/B1)')
    expect(g.controlPoint).toBe('통합(feature→main)')
  })

  it('🔴 merge·req 는 req:delegate 를 안내하지 않는다', () => {
    for (const sg of ['merge', 'req'] as const) {
      const g = guidance(sg)
      expect(`${g.detail} ${g.command ?? ''}`).not.toContain('req:delegate')
    }
  })
})

describe('[REQ-2026-146] 배선 가드', () => {
  const src = readFileSync(join(process.cwd(), 'scripts/req/req-next.ts'), 'utf8')

  it('🔴 defersToIntegration 분기의 prefix 가 정책명을 보간한다(하드코딩 금지)', () => {
    // 이 한 줄이 `'stopGate=merge …'` 로 박혀 있어 auto 티켓이 다른 정책 이름을 들었다.
    expect(src).toMatch(/prefix: `stopGate=\$\{input\.stopGate/)
    expect(src).not.toContain("prefix: 'stopGate=merge")
  })

  it('🔴 auto 분기가 terminalIntegrationAction 안에 배선돼 있다', () => {
    expect(src).toMatch(/if \(input\.stopGate === 'auto'\) return autoDelegationAction\(/)
  })
})

describe('[REQ-2026-146] HIGH + auto 는 두 단계다', () => {
  const highInput = (confirmed: boolean): NextInput =>
    terminalInput(
      { stopGate: 'auto' },
      {
        risk_level: 'HIGH',
        ...(confirmed
          ? { user_commit_confirmed: { confirmed: true, scope: 'req', method: '승인함', confirmed_at: '2026-08-14T00:00:00Z' } }
          : {}),
      },
    )

  /**
   * 🔴 HIGH 확인을 건너뛰고 위임 안내를 먼저 내지 **않는다**. HIGH 확인은 안전 중단이고 자동화가
   *    넘어도 되는 것이 아니다. 대신 1단계가 2단계를 **미리 알린다** — 모른 채 확인만 하면
   *    그 다음에 integrate 가 `absent` 로 막혀 또 멈춘다.
   */
  it('1단계: 확인 전에는 req:confirm 을 내되, 다음 단계(--high-risk 위임)를 함께 알린다', () => {
    const a = terminalIntegrationAction(highInput(false), { requireHighConfirm: true })
    expect(a.command ?? '').toContain('req:confirm')
    expect(a.detail).toContain('req:delegate')
    expect(a.detail).toContain('--high-risk')
    expect(a.detail).toContain('high-risk-unacked')
  })

  it('2단계: 확인이 기록되면 req:delegate --high-risk 를 낸다', () => {
    const a = terminalIntegrationAction(highInput(true), { requireHighConfirm: true })
    expect(a.command ?? '').toContain('req:delegate')
    expect(a.command ?? '').toContain('--high-risk')
    expect(a.controlPoint ?? '').toContain('사전 위임')
  })

  it('🔴 두 단계가 같은 명령을 말한다 — 앞이 알린 것과 뒤가 주는 것이 갈리지 않는다', () => {
    const step1 = terminalIntegrationAction(highInput(false), { requireHighConfirm: true }).detail
    const step2 = terminalIntegrationAction(highInput(true), { requireHighConfirm: true }).command ?? ''
    expect(step1).toContain(step2)
  })

  it('LOW + auto 는 확인 단계 없이 바로 위임을 안내한다', () => {
    const a = terminalIntegrationAction(terminalInput({ stopGate: 'auto' }), { requireHighConfirm: true })
    expect(a.command ?? '').toContain('req:delegate')
    expect(a.command ?? '').not.toContain('--high-risk')
  })
})
