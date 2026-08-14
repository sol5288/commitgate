/**
 * REQ-2026-149 phase-1 — 예약 placeholder 등록부 + 셸 안전 판정.
 *
 * 🔴 이 스위트의 핵심은 **표면 짝 맞추기**다. REQ-2026-148/149 는 사람-결정 인자를 내는 표면을
 *    **세 번** 놓쳤다(`req:close --abandon` · `req:confirm --method` · `req:delegate --sentence`).
 *    마지막 것은 **main 병합 권한**을 연다. 손으로 세는 목록은 또 놓친다 — 가드가 소스를 봐야 한다.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  RESERVED_HUMAN_PLACEHOLDERS,
  isReservedPlaceholder,
  humanDecisionProblem,
  PLACEHOLDER_APPROVAL,
  PLACEHOLDER_DELEGATE_SENTENCE,
  PLACEHOLDER_REASON,
} from '../../scripts/req/lib/placeholders'
import { shellSafeArg, allShellSafe, quoteArg } from '../../scripts/req/lib/shell-safe'
import { issueProblem } from '../../scripts/req/req-delegate'
import { planResolveReplace } from '../../scripts/req/req-review-exception'
import { main as delegateMain, revokeProblem } from '../../scripts/req/req-delegate'
import { nonConvergenceReport, nextChoices } from '../../scripts/req/lib/nonconvergence'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { readFileSync as readFileSyncFs } from 'node:fs'
import { packageRoot } from '../../scripts/req/lib/config'

describe('[REQ-2026-149] 예약 placeholder', () => {
  it('🔴 등록부의 모든 값이 예약으로 판정된다', () => {
    for (const p of RESERVED_HUMAN_PLACEHOLDERS) expect(isReservedPlaceholder(p), p).toBe(true)
  })

  it('🔴 정규화 비교 — 공백·대소문자 차이를 흡수한다', () => {
    expect(isReservedPlaceholder('  승인  문장 ')).toBe(true)
    expect(isReservedPlaceholder('\t승인 문장\n')).toBe(true)
  })

  it('🔴 예약이 아닌 값은 짧아도 통과한다 — 값의 진정성은 판정하지 않는다', () => {
    for (const v of ['x', 'asdf', '요구가 철회됨', 'PM 승인 2026-08-01']) expect(isReservedPlaceholder(v)).toBe(false)
  })

  it('부분 일치는 예약이 아니다(다른 문장에 포함된 경우)', () => {
    expect(isReservedPlaceholder('승인 문장을 받았다: 팀장 구두 승인')).toBe(false)
  })
})

describe('[REQ-2026-149] humanDecisionProblem', () => {
  it('빈 값·공백만은 거부', () => {
    for (const v of ['', '   ', '\t\n', null, undefined]) expect(humanDecisionProblem('--x', v)).not.toBeNull()
  })

  it('🔴 예약값은 거부하고 무엇을 하라는지 말한다', () => {
    const p = humanDecisionProblem('--confirm', PLACEHOLDER_APPROVAL)
    expect(p).not.toBeNull()
    expect(p!).toContain('자리표시자')
    expect(p!).toContain('바꿔')
  })

  it('🔴 병합 권한을 여는 문장도 거부된다', () => {
    expect(humanDecisionProblem('--sentence', PLACEHOLDER_DELEGATE_SENTENCE)).not.toBeNull()
  })

  it('실제 값은 통과', () => {
    expect(humanDecisionProblem('--reason', '요구가 철회됨')).toBeNull()
  })
})

describe('[REQ-2026-149] 셸 안전 판정 — 허용 목록', () => {
  it('🔴 정상 값은 전부 통과한다(무회귀)', () => {
    for (const v of [
      'feat/req-2026-149-guidance-safety-and-attribution-successor',
      'REQ-2026-149',
      'workflow/REQ-2026-149',
      'design:-#1',
      'phase:phase-1-x#2',
      'guidance-safety-successor',
    ])
      expect(shellSafeArg(v), v).toBe(true)
  })

  it('🔴 `#` 을 반드시 허용한다 — 모든 series_id 가 `…#N` 이다', () => {
    expect(shellSafeArg('design:-#1')).toBe(true)
  })

  it('🔴 cmd.exe 가 큰따옴표 안에서도 확장하는 문자는 거부한다', () => {
    for (const v of ['feat/req-2026-149-%PATH%', 'feat/req-2026-149-!VAR!']) expect(shellSafeArg(v), v).toBe(false)
  })

  it('🔴 다른 셸 특수문자도 거부(허용 목록이라 자동)', () => {
    for (const v of ['a`b', 'a$b', 'a"b', 'a\\b', 'a;b', 'a&b', 'a|b', 'a>b', 'a b', 'a\nb', 'a^b', "a'b", 'a(b'])
      expect(shellSafeArg(v), JSON.stringify(v)).toBe(false)
  })

  it('빈 값·비문자열은 거부', () => {
    expect(shellSafeArg('')).toBe(false)
    expect(shellSafeArg(null)).toBe(false)
    expect(shellSafeArg(undefined)).toBe(false)
  })

  it('allShellSafe 는 하나라도 불안전하면 false', () => {
    expect(allShellSafe('REQ-2026-149', 'design:-#1')).toBe(true)
    expect(allShellSafe('REQ-2026-149', 'a%b')).toBe(false)
  })

  it('quoteArg 는 큰따옴표로 감싼다', () => {
    expect(quoteArg('design:-#1')).toBe('"design:-#1"')
  })
})

describe('[REQ-2026-149] 🔴 표면 짝 맞추기 가드', () => {
  const read = (p: string): string => readFileSync(join(process.cwd(), p), 'utf8')

  /**
   * 🔴 **값을 받는 다섯 표면이 전부 공용 검증을 쓴다.** 하나라도 빠지면 도구가 자기 출력을
   *    되받는 고리가 그 자리에서 다시 열린다. 이 REQ 가 실제로 세 번 놓친 자리들이다.
   */
  /**
   * 🔴 **import 줄만 보면 공허하다.** 초안 가드는 파일에 `humanDecisionProblem` 문자열이 있는지만
   *    봤는데, 검증 호출을 통째로 지워도 import 가 남아 통과했다(변이 검사로 실증).
   *    **인자까지 포함한 실제 호출**을 본다.
   */
  it('🔴 값을 받는 다섯 표면이 각자의 플래그로 검증을 호출한다', () => {
    const receivers: [string, string][] = [
      ['scripts/req/req-review-exception.ts', "humanDecisionProblem('--reason'"],
      ['scripts/req/req-review-exception.ts', "humanDecisionProblem('--confirm'"],
      ['scripts/req/lib/stale-attempt.ts', "humanDecisionProblem('--reason'"],
      ['scripts/req/req-close.ts', "humanDecisionProblem('--reason'"],
      ['scripts/req/req-close.ts', "humanDecisionProblem('--confirm'"],
      ['scripts/req/req-confirm.ts', "humanDecisionProblem('--method'"],
      // 🔴 main 병합 권한을 여는 자리 — 가장 중대하다.
      ['scripts/req/req-delegate.ts', "humanDecisionProblem('--sentence'"],
      // 🔴 여섯 번째로 놓친 자리: 발급 성공 안내가 `--revoke … --reason "<사유>"` 를 낸다.
      ['scripts/req/req-delegate.ts', "humanDecisionProblem('--reason'"],
    ]
    for (const [f, call] of receivers) expect(read(f), `${f} :: ${call}`).toContain(call)
  })

  /**
   * 🔴 **안내를 내는 표면 전부**가 등록부를 참조한다. 이 REQ 는 표면을 **다섯 번** 놓쳤다:
   *    `req:close --abandon` · `req:confirm --method` · `req:delegate --sentence` ·
   *    `req-commit` 의 HIGH 확인 안내 · `req-doctor` D27 의 종결 안내.
   *    한 곳이라도 리터럴이면 받는 쪽 검증과 갈라져 **정상 경로가 막힌다**(안내대로 해도 거부).
   */
  const EMITTERS = [
    'scripts/req/lib/nonconvergence.ts',
    'scripts/req/req-next.ts',
    'scripts/req/req-commit.ts',
    'scripts/req/req-doctor.ts',
    'scripts/req/req-delegate.ts',
  ]

  it('🔴 안내를 내는 곳은 등록부 상수를 참조한다(문자열을 두 벌 두지 않는다)', () => {
    for (const f of EMITTERS) expect(read(f), f).toMatch(/PLACEHOLDER_[A-Z_]+/)
  })

  it('🔴 안내를 내는 곳에 예약 문자열이 **리터럴로** 박혀 있지 않다', () => {
    for (const f of EMITTERS) {
      const src = read(f)
      for (const p of ['승인 문장', '왜 대체하는가', '왜 버리는가', '사람이 말한 승인 문장'])
        expect(src.includes(`"${p}"`), `${f} 에 "${p}" 리터럴`).toBe(false)
    }
  })

  it('🔴 자리표시자를 내는 안내는 "바꿔서 실행하라"고 말한다', () => {
    for (const f of ['scripts/req/req-commit.ts', 'scripts/req/req-doctor.ts'])
      expect(read(f), f).toContain('자리표시자')
  })

  it('🔴 셸 판정이 한 곳이다 — req-next 가 자체 정규식을 두지 않는다', () => {
    const src = read('scripts/req/req-next.ts')
    expect(src).toContain('sharedShellSafeArg')
    expect(src).not.toMatch(/!\/\["`\$/)
  })

  it('🔴 안내를 내는 곳이 셸 안전 판정을 쓴다', () => {
    for (const f of ['scripts/req/lib/nonconvergence.ts', 'scripts/req/req-review-exception.ts'])
      expect(read(f), f).toContain('allShellSafe')
  })
})

describe('[REQ-2026-149] 🔴 동작 — 순수 판정기가 실제로 거부한다', () => {
  it('req:delegate 의 issueProblem 이 예약 문장을 거부한다(main 병합 권한)', () => {
    const base = { scope: { kind: 'ticket', req_id: 'REQ-2026-149' }, source: 'feat/x' } as never
    const withSentence = (sentence: string) => ({ ...(base as object), sentence }) as never
    expect(issueProblem(withSentence(PLACEHOLDER_DELEGATE_SENTENCE))).not.toBeNull()
    expect(issueProblem(withSentence(PLACEHOLDER_APPROVAL))).not.toBeNull()
    expect(issueProblem(withSentence('팀장이 구두로 승인함'))).toBeNull()
  })

  it('planResolveReplace 가 예약 reason/confirm 을 거부한다', () => {
    const state = {
      review_series: [{ series_id: 'design:-#1', review_kind: 'design', phase_id: null, attempts: 8, closed_reason: null }],
    } as never
    const call = (reason: string, confirm: string) =>
      planResolveReplace(state, { resolve: 'replace', seriesId: 'design:-#1', reason, confirm })
    expect(call('왜 대체하는가', '승인 문장').ok).toBe(false)
    expect(call('실제 사유', '승인 문장').ok).toBe(false)
    expect(call('왜 대체하는가', '실제 승인').ok).toBe(false)
    expect(call('설계가 비수렴', '팀장 승인 2026-08-14').ok).toBe(true)
  })
})

describe('[REQ-2026-149] 🔴 보고가 치환을 안내한다', () => {
  it('자리표시자를 바꿔서 실행하라는 문구가 있다', () => {
    const report = nonConvergenceReport({
      reqId: 'REQ-2026-149',
      seriesId: 'design:-#1',
      hasOpenAttempt: false,
      ticketDirty: false,
      outsideDirty: [],
      ticketRel: 'workflow/REQ-2026-149',
      successorSlug: 's',
      rounds: [],
      hardCap: 8,
      attempt: 9,
    })
    expect(report).toContain('자리표시자')
    expect(report).toContain('바꿔서')
    // 🔴 안내 없이 원문만 내면 사용자는 실행한 뒤에야 거부 오류를 본다.
    expect(report.indexOf('자리표시자')).toBeLessThan(report.indexOf('req:close'))
  })
})

describe('[REQ-2026-149] 🔴 e2e — req:next 가 낸 위임 명령 원문은 거부된다', () => {
  it('원문 실행은 발급되지 않고, 실제 문장이면 발급된다', () => {
    const repo = mkdtempSync(join(tmpdir(), 'req149-'))
    const git = (args: string[]): string =>
      execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: repo, encoding: 'utf8' })
    git(['init', '-q'])
    git(['config', 'user.email', 't@t.t'])
    git(['config', 'user.name', 't'])
    writeFileSync(join(repo, 'package.json'), '{"name":"x","version":"0.0.0"}')
    mkdirSync(join(repo, 'workflow', 'REQ-2026-149'), { recursive: true })
    // setup 게이트 충족 — 다른 near-e2e 스위트와 같은 최소 fixture.
    writeFileSync(
      join(repo, 'workflow', 'machine.schema.json'),
      readFileSyncFs(join(packageRoot(), 'workflow', 'machine.schema.json'), 'utf8'),
    )
    writeFileSync(join(repo, 'req.config.json'), JSON.stringify({ packageManager: 'npm', reviewPersonaPath: null }))
    writeFileSync(join(repo, 'workflow', 'REQ-2026-149', 'state.json'), '{"id":"REQ-2026-149"}')
    git(['add', '-A'])
    git(['commit', '-qm', 'baseline'])

    const args = (sentence: string): string[] => [
      '--scope', 'ticket:REQ-2026-149', '--source', 'main', '--sentence', sentence, '--run', '--root', repo,
    ]
    // 🔴 req:next 가 실제로 내는 문자열을 그대로 넘긴다.
    expect(() => delegateMain(args(PLACEHOLDER_DELEGATE_SENTENCE))).toThrow(/자리표시자/)
    /**
     * 무회귀: 실제 사람 문장은 **이 검증을 통과한다**. 그 뒤 단계(브랜치·trunk 해소)는 이 fixture 가
     * 갖추지 않았으므로 다른 오류로 멈추는데, 🔴 **자리표시자 거부가 아님**을 확인하는 것이 요점이다.
     */
    let msg = ''
    try {
      delegateMain(args('팀장이 2026-08-14 구두로 승인함'))
    } catch (e) {
      msg = (e as Error).message
    }
    expect(msg).not.toMatch(/자리표시자/)
    rmSync(repo, { recursive: true, force: true })
  })
})

describe('[REQ-2026-149] 🔴 갈래는 전부 나오거나 하나도 안 나온다', () => {
  const base = {
    reqId: 'REQ-2026-149',
    seriesId: 'design:-#1',
    hasOpenAttempt: false,
    outsideDirty: [],
    successorSlug: 'x-successor',
    rounds: [],
    hardCap: 8,
    attempt: 9,
  }

  it('안전한 경로 + 더러움 → 파킹 2줄 + req:new 3줄', () => {
    const { replace } = nextChoices({ ...base, ticketDirty: true, ticketRel: 'workflow/REQ-2026-149' })
    expect(replace).toHaveLength(4) // resolve + add + commit + new
    expect(replace[replace.length - 1]!.text).toContain('req:new')
  })

  it('🔴 ticketRel 이 불안전 + 더러움 → 반쪽 명령열을 내지 않는다(req:new 도 빠진다)', () => {
    const { replace } = nextChoices({ ...base, ticketDirty: true, ticketRel: 'work flow/REQ-2026-149' })
    expect(replace).toHaveLength(0)
  })

  it('ticketRel 이 불안전해도 **깨끗하면** 파킹이 필요 없어 정상 안내가 나온다', () => {
    const { replace } = nextChoices({ ...base, ticketDirty: false, ticketRel: 'work flow/REQ-2026-149' })
    expect(replace.length).toBeGreaterThan(0)
    expect(replace.some((c) => c.text.includes('req:new'))).toBe(true)
  })

  it('🔴 slug 가 불안전하면 갈래 전체가 빠진다', () => {
    const { replace } = nextChoices({
      ...base,
      ticketDirty: true,
      ticketRel: 'workflow/REQ-2026-149',
      successorSlug: '%PATH%-successor',
    })
    expect(replace).toHaveLength(0)
  })
})

describe('[REQ-2026-149] 🔴 철회 안내도 자기 출력을 되받지 않는다', () => {
  it('revokeProblem 이 예약 사유를 거부한다', () => {
    const o = (reason: string) => ({ revokeId: 'abc-123', reason }) as never
    expect(revokeProblem(o(PLACEHOLDER_REASON))).not.toBeNull()
    expect(revokeProblem(o('권한이 더 필요 없어짐'))).toBeNull()
  })
})
