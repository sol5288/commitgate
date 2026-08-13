import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { parseArgs, buildConfirm, scopeMeaning, CONFIRM_SCOPES, main } from '../../scripts/req/req-confirm'
import { userConfirmProblem, requiredConfirmScope, effectiveConfirmScope } from '../../scripts/req/lib/evidence'
import type { StopGate } from '../../scripts/req/lib/config'
import { resolveDispatch, VERB_MODULES } from '../../bin/dispatch.mjs'
import { STAGE_B_REQ_VERBS, STAGE_B_REQ_SCRIPTS } from '../../bin/init'

/**
 * REQ-2026-071 phase-2 — `req:confirm`.
 *
 * 🔴 이 명령의 존재 이유: 지금까지 HIGH 확인을 넣는 방법은 **`state.json` 손편집**뿐이었고,
 *    그것이 REQ-2026-019 가 폐기된 표면과 같다 — 시각을 사람이 적어 넣으면 **지어낼 수 있다**.
 *    시각을 실제 시계에서 읽는 것이 이 명령의 핵심이며, 주입 seam 은 테스트를 위한 것이지
 *    값을 지어내기 위한 것이 아니다.
 */

describe('[req:confirm] parseArgs — fail-closed', () => {
  it('REQ·scope·method 를 읽는다', () => {
    const o = parseArgs(['2026-071', '--scope', 'req', '--method', '사용자 확인', '--run'])
    expect(o).toEqual({ reqId: '2026-071', scope: 'req', method: '사용자 확인', note: null, root: null, run: true })
  })

  it('🔴 scope enum 밖은 거부한다(조용히 phase 로 읽지 않는다)', () => {
    expect(() => parseArgs(['x', '--scope', 'all'])).toThrow('--scope')
    expect(() => parseArgs(['x', '--scope'])).toThrow('--scope')
  })

  /**
   * 🔴 REQ-2026-129 phase-2 r02 P1과 **같은 결함**: `--method --run` 이 플래그를 승인 문장으로 삼켜
   *    사용자가 요청하지 않은 조합(DRY-RUN 의도 → 실제 기록)으로 명령이 성립했다.
   */
  it('🔴 --method/--note 값 자리의 알려진 옵션은 값이 아니라 누락이다', () => {
    for (const flag of ['--method', '--note']) {
      for (const opt of ['--run', '--scope', '--root']) {
        expect(() => parseArgs(['x', flag, opt]), `${flag} ${opt}`).toThrow('옵션')
      }
    }
    // 대조군: 알려지지 않은 대시 문자열은 그대로 값이다.
    expect(parseArgs(['x', '--method', '-승인']).method).toBe('-승인')
  })

  it('알 수 없는 옵션은 조용히 무시하지 않는다', () => {
    expect(() => parseArgs(['x', '--force'])).toThrow('알 수 없는 옵션')
  })

  /** 승인 문장은 `-`로 시작할 수도 있다 — 그 자리에서만 접두 검사를 하지 않는다. */
  it('--method 값은 대시로 시작해도 받는다', () => {
    expect(parseArgs(['x', '--method', '-확인']).method).toBe('-확인')
  })

  it('--root 는 다음 옵션을 값으로 삼키지 않는다', () => {
    expect(() => parseArgs(['x', '--root', '--run'])).toThrow('--root')
  })
})

describe('[req:confirm] buildConfirm — 기록 형식', () => {
  const now = '2026-07-27T01:02:03.000Z'

  it('기존 검증기를 그대로 통과한다', () => {
    for (const scope of CONFIRM_SCOPES) {
      const c = buildConfirm({ scope, method: 'm', note: null, nowIso: now })
      expect(userConfirmProblem(c)).toBeNull()
      expect(effectiveConfirmScope(c)).toBe(scope)
    }
  })

  it('시각은 주입된 값 그대로다(고정 검증)', () => {
    expect(buildConfirm({ scope: 'req', method: 'm', note: null, nowIso: now }).confirmed_at).toBe(now)
  })

  it('note 는 있을 때만 들어간다(없으면 키 자체가 없다)', () => {
    expect(buildConfirm({ scope: 'req', method: 'm', note: null, nowIso: now }).note).toBeUndefined()
    expect(buildConfirm({ scope: 'req', method: 'm', note: 'n', nowIso: now }).note).toBe('n')
  })
})

/**
 * 🔴 넓은 범위는 **아직 없는 변경까지 미리 승인**한다. 그 문장이 없으면 사용자는
 *    "지금 이 변경만 승인했다"고 믿는다 — 이 REQ 가 받아들인 트레이드오프의 고지다.
 */
describe('[req:confirm] scopeMeaning — 넓은 범위의 뜻을 말한다', () => {
  it('phase 는 하나만 승인한다고 말한다', () => {
    expect(scopeMeaning('phase')).toContain('다음 phase는 다시 확인')
  })

  it('🔴 req·delivery 는 "아직 작성되지 않은 변경까지"를 명시한다', () => {
    for (const s of ['req', 'delivery'] as const) {
      expect(scopeMeaning(s)).toContain('미리 승인')
      expect(scopeMeaning(s)).toContain('아직 작성되지 않은 변경')
    }
  })
})

/**
 * REQ-2026-128 DEC-2 — 대응은 **표가 아니라 함수**다. `merge` 가 요구하는 scope 는 이 REQ 가
 * delivery 묶음에 속하는지에 달려 있고, 표는 그 조건을 담지 못한다.
 *
 * 🔴 expected 를 SUT 로 구성하지 않는다(과거 phase-4 r04 P1 동어반복 교훈) — 전부 리터럴로 고정한다.
 */
describe('[req:confirm] requiredConfirmScope — stopGate ↔ scope 진리표', () => {
  it('phase·req 는 묶음 맥락과 무관하다', () => {
    expect(requiredConfirmScope('phase')).toBe('phase')
    expect(requiredConfirmScope('req')).toBe('req')
    expect(requiredConfirmScope('phase', { inDeliverySet: true })).toBe('phase')
    expect(requiredConfirmScope('req', { inDeliverySet: true })).toBe('req')
  })

  it('🔴 merge + 묶음에 속함 → delivery(현행 유지)', () => {
    expect(requiredConfirmScope('merge', { inDeliverySet: true })).toBe('delivery')
  })

  /**
   * 🔴 이 REQ 의 핵심. 존재하지 않는 묶음을 승인하라고 요구하면 `scopeMeaning('delivery')` 가 말하는
   *    "이 묶음의 남은 REQ 전부"가 **거짓 진술**이 된다. 묶음이 없을 때의 참값은 `req` 다.
   */
  it('🔴 merge + 묶음 없음 → req', () => {
    expect(requiredConfirmScope('merge', { inDeliverySet: false })).toBe('req')
  })
})

describe('[req:confirm] verb 등록', () => {
  it('dispatch 가 모듈로 보낸다', () => {
    expect(resolveDispatch(['req:confirm', '2026-071'])).toEqual({
      entry: VERB_MODULES['req:confirm'],
      rest: ['2026-071'],
    })
  })

  /** 🔴 파생이 끊기면 소비자 프로젝트에 `npm run req:confirm` 자체가 없다. */
  it('🔴 Stage B 주입 목록에 따라온다', () => {
    expect(STAGE_B_REQ_VERBS).toContain('req:confirm')
    expect(STAGE_B_REQ_SCRIPTS['req:confirm']).toBe('commitgate req:confirm')
  })
})

/**
 * 🔴 `stopGate` 값과 `scope` 값은 **이름이 다르다**: `merge → delivery`(설계 r04 P1).
 *    `merge`는 "언제 멈추는가"이고 `delivery`는 "무엇을 승인했는가"다 — 승인 대상은 묶음이지 병합 행위가 아니다.
 */
describe('[req:confirm] merge → delivery 대응(양방향)', () => {
  it('🔴 merge 가 묶음 안에서 요구하는 것은 delivery 다', () => {
    expect(requiredConfirmScope('merge', { inDeliverySet: true })).toBe('delivery')
  })

  it("🔴 scope 에 'merge' 라는 값은 존재하지 않는다", () => {
    expect(CONFIRM_SCOPES).not.toContain('merge')
  })

  it('🔴 --scope merge 는 기록조차 되지 않는다', () => {
    expect(() => parseArgs(['x', '--scope', 'merge'])).toThrow('--scope')
  })
})

/**
 * 🔴 설계 r05 P1: **불일치 scope 는 거부한다.** 경고만 하면 사용자는 성공·checkpoint 를 받고서
 *    나중에 종결 지점에서 막힌다 — 그 사이 기록은 아무것도 통과시키지 못하는 쓸모없는 커밋이다.
 *
 * `main()` 은 config·fs 를 만지므로 여기서는 **거부 규칙 자체**를 표로 고정한다
 * (실행 경로는 REQ 티켓에서 실측된다).
 */
describe('[req:confirm] stopGate 와 다른 scope 는 거부된다', () => {
  const mismatches: Array<[StopGate, boolean, string]> = [
    ['phase', false, 'req'],
    ['phase', false, 'delivery'],
    ['req', false, 'phase'],
    ['req', false, 'delivery'],
    ['merge', true, 'phase'],
    ['merge', true, 'req'],
    // 🔴 REQ-2026-128: 묶음이 없으면 `delivery` 가 오히려 불일치다(없는 묶음을 승인할 수 없다).
    ['merge', false, 'phase'],
    ['merge', false, 'delivery'],
  ]
  for (const [stopGate, inDeliverySet, given] of mismatches) {
    it(`stopGate:'${stopGate}'(묶음 ${inDeliverySet ? '있음' : '없음'}) 에 scope:'${given}' 는 요구와 다르다`, () => {
      expect(requiredConfirmScope(stopGate, { inDeliverySet })).not.toBe(given)
    })
  }

  it('일치하는 조합만 요구를 만족한다', () => {
    expect(requiredConfirmScope('phase', { inDeliverySet: false })).toBe('phase')
    expect(requiredConfirmScope('req', { inDeliverySet: false })).toBe('req')
    expect(requiredConfirmScope('merge', { inDeliverySet: true })).toBe('delivery')
    expect(requiredConfirmScope('merge', { inDeliverySet: false })).toBe('req')
  })
})

/**
 * 🔴 phase-4 r04 P1: 위 표 검증은 **동어반복**이었다 — `main()` 의 `throw` 를 경고-only 로 되돌려도
 *    전부 통과한다. 실행 경로를 실제로 태워서 **거부**와 **아무것도 쓰이지 않음**을 확인한다.
 *
 * (같은 함정을 REQ-B 에서 이미 겪었다: expected 를 SUT 로 구성하면 오라클이 사라진다.)
 */
describe('[req:confirm] main() — 불일치 scope 실행 경로', () => {
  const setup = (stopGate: 'phase' | 'req' | 'merge') => {
    const root = mkdtempSync(join(tmpdir(), 'cg-confirm-'))
    writeFileSync(
      join(root, 'req.config.json'),
      JSON.stringify({ stopGate, setup: { completedVersion: '0.10.0', completedAt: '2026-07-27T00:00:00.000Z' } }),
    )
    const ticket = join(root, 'workflow', 'REQ-2026-999')
    mkdirSync(ticket, { recursive: true })
    const state = { id: 'REQ-2026-999', phase: 'developing', risk_level: 'HIGH' }
    writeFileSync(join(ticket, 'state.json'), JSON.stringify(state))
    return { root, ticket, before: readFileSync(join(ticket, 'state.json'), 'utf8') }
  }
  const roots: string[] = []
  afterEach(() => {
    while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true })
  })

  const run = (root: string, scope: string, inDeliverySet = false) =>
    main(['2026-999', '--scope', scope, '--method', 'm', '--root', root, '--run'], {
      now: () => '2026-07-27T00:00:00.000Z',
      log: () => {},
      inDeliverySet: () => inDeliverySet,
    })

  /** `[stopGate, 묶음 소속, 거부되어야 할 scope]` */
  const cases: Array<[StopGate, boolean, string]> = [
    ['phase', false, 'req'],
    ['phase', false, 'delivery'],
    ['req', false, 'phase'],
    ['req', false, 'delivery'],
    ['merge', true, 'phase'],
    ['merge', true, 'req'],
    // 🔴 REQ-2026-128: 묶음이 없는 merge 에서 `delivery` 는 없는 묶음을 승인하는 거짓 진술이다.
    ['merge', false, 'phase'],
    ['merge', false, 'delivery'],
  ]

  for (const [stopGate, inDeliverySet, given] of cases) {
    it(`🔴 stopGate:'${stopGate}'(묶음 ${inDeliverySet ? '있음' : '없음'}) + --scope ${given} → 거부하고 state 를 쓰지 않는다`, () => {
      const { root, ticket, before } = setup(stopGate)
      roots.push(root)
      expect(() => run(root, given, inDeliverySet)).toThrow(/stopGate/)
      // 🔴 오라클의 핵심: 거부는 checkpoint **前**이므로 state 가 그대로여야 한다.
      expect(readFileSync(join(ticket, 'state.json'), 'utf8')).toBe(before)
    })
  }

  /**
   * 🔴 REQ-2026-128 의 안내↔도구 정합. `req:next` 종단이 `merge` + 묶음 없음에서 `--scope req` 를
   *    안내하는데 이 명령이 거부하면 사용자는 실행할 수 없는 명령을 받는다.
   */
  it('🔴 merge + 묶음 없음 + --scope req 는 scope 사유로 막히지 않는다', () => {
    const { root } = setup('merge')
    roots.push(root)
    let msg = ''
    try {
      run(root, 'req', false)
    } catch (e) {
      msg = (e as Error).message
    }
    expect(msg).not.toMatch(/요구합니다/)
  })

  /** 대조군: 같은 명령이 묶음 **안**에서는 거부된다 — 묶음 확인을 좁은 확인으로 대체할 수 없다. */
  it('🔴 merge + 묶음 있음 + --scope req 는 거부된다', () => {
    const { root } = setup('merge')
    roots.push(root)
    expect(() => run(root, 'req', true)).toThrow(/stopGate/)
  })

  /** 대조군: 일치하면 거부 사유가 scope 가 아니다(그 뒤 git 단계까지는 여기서 다루지 않는다). */
  it('일치하는 scope 는 scope 사유로 막히지 않는다', () => {
    const { root } = setup('req')
    roots.push(root)
    let msg = ''
    try {
      run(root, 'req')
    } catch (e) {
      msg = (e as Error).message
    }
    expect(msg).not.toMatch(/요구합니다/)
  })

  /** DRY-RUN 도 불일치면 거부한다 — 사용자가 "통과했다"고 오해하면 안 된다. */
  it('🔴 DRY-RUN 에서도 불일치는 거부한다', () => {
    const { root } = setup('req')
    roots.push(root)
    expect(() =>
      main(['2026-999', '--scope', 'phase', '--method', 'm', '--root', root], {
        now: () => 'x',
        log: () => {},
        inDeliverySet: () => false,
      }),
    ).toThrow(/stopGate/)
  })
})
