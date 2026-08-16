import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  runChecks,
  renderHuman,
  renderJson,
  parseArgs,
  loadConfigResult,
  collectContracts,
  collectInputs,
  printHelp,
  CONTRACT_FILES,
  TEMPLATE_COMPARE_PATH,
  HelpRequested,
  type CheckInputs,
  type CheckReport,
} from '../../bin/check'
import { expectedReqScripts, commandSurfaceGuidance } from '../../scripts/req/lib/command-surface'
import { parseArgs as syncParseArgs } from '../../bin/sync'
import { packageRoot } from '../../scripts/req/lib/config'
import { RETIRED_CLAIMS, retiredClaimsIn } from '../../scripts/req/lib/retired-claims'
import { I2_APPROVAL } from '../../scripts/req/lib/control-points'
import { readFileSync, existsSync, statSync } from 'node:fs'
import type { AuthProbeResult, VersionProbeResult, ReviewerProbes } from '../../scripts/req/lib/adapters'
import { DEFAULTS } from '../../scripts/req/lib/config'

/**
 * REQ-2026-061 — `commitgate check`(비대화형 진단).
 *
 * 🔴 이 파일의 헤드라인 단언 둘:
 *   1. **`unknown` 로그인은 WARN이지 FAIL이 아니다** — probe는 진단이지 승인 무결성 게이트가 아니므로,
 *      codex 출력 포맷이 바뀐 날 진단이 곧 오탐 경보가 되면 안 된다(설계 DEC-3).
 *   2. **한 항목의 실패가 나머지 진단을 가리지 않는다** — 설정이 깨져도 C2/C3는 계속 평가된다(DEC-6).
 */

const OK_VERSION: VersionProbeResult = { ok: true, version: 'codex-cli 0.144.1', detail: 'codex-cli 0.144.1' }
const NO_CLI: VersionProbeResult = { ok: false, version: null, detail: 'ENOENT' }
const LOGGED_IN: AuthProbeResult = { state: 'logged-in', reason: 'ok', detail: 'Logged in using ChatGPT' }
const LOGGED_OUT: AuthProbeResult = { state: 'logged-out', reason: 'ok', detail: 'Not logged in' }
const UNKNOWN: AuthProbeResult = { state: 'unknown', reason: 'unrecognized-output', detail: '???' }

/** 기본 입력 = 전부 정상. 각 테스트가 필요한 축만 덮어쓴다. */
function inputs(over: Partial<CheckInputs> = {}): CheckInputs {
  return {
    config: { ok: true, cfg: { reviewModel: 'gpt-5.6-terra', reviewReasoningEffort: 'high' } as never },
    version: OK_VERSION,
    auth: LOGGED_IN,
    // C5 기본값 = 계약 파일 없음(점검 불요). 각 테스트가 필요할 때만 덮어쓴다.
    contracts: [
      { rel: 'AGENTS.md', content: null },
      { rel: 'AGENTS.commitgate.md', content: null },
    ],
    ...over,
  }
}

const byId = (r: CheckReport, id: string) => r.checks.find((c) => c.id === id)

describe('[check] 전부 정상 → ok', () => {
  it('FAIL 0건이면 ok=true, 모든 항목 OK', () => {
    const r = runChecks(inputs())
    expect(r.ok).toBe(true)
    // C5 추가(0.22.0)·C6 추가(REQ-2026-161)는 **additive** 다 — 기존 C1~C4 의 의미·등급은 그대로다.
    expect(r.summary).toEqual({ ok: 6, warn: 0, fail: 0 })
  })

  it('항목 id는 C1~C6 순서로 고정된다(에이전트 소비 안정성)', () => {
    // 🔴 순서가 계약이다. 새 검사는 **뒤에만** 붙는다 — 기존 인덱스를 밀면 소비자가 깨진다.
    expect(runChecks(inputs()).checks.map((c) => c.id)).toEqual(['C1', 'C2', 'C3', 'C4', 'C5', 'C6'])
  })
})

describe('[check] C3 로그인 — unknown은 WARN이지 FAIL이 아니다(DEC-3)', () => {
  it('logged-in → OK', () => {
    expect(byId(runChecks(inputs()), 'C3')?.level).toBe('OK')
  })

  it('logged-out → FAIL + 조치 안내(예산 차감 사실 포함)', () => {
    const c = byId(runChecks(inputs({ auth: LOGGED_OUT })), 'C3')
    expect(c?.level).toBe('FAIL')
    expect(c?.msg).toContain('예산')
    expect(c?.msg).toContain('commitgate setup')
  })

  // 🔴 회귀 가드: 이걸 FAIL로 바꾸면 codex가 출력 문자열만 바꿔도 모든 소비자의 진단이 빨갛게 된다.
  it('🔴 unknown → WARN(리뷰를 막지 않는다는 문장 포함)', () => {
    const r = runChecks(inputs({ auth: UNKNOWN }))
    const c = byId(r, 'C3')
    expect(c?.level).toBe('WARN')
    expect(c?.msg).toContain('막지는 않습니다')
    expect(r.ok).toBe(true) // WARN은 exit 0
  })
})

describe('[check] C2 리뷰어 CLI', () => {
  it('미설치 → FAIL', () => {
    const r = runChecks(inputs({ version: NO_CLI }))
    expect(byId(r, 'C2')?.level).toBe('FAIL')
    expect(r.ok).toBe(false)
  })
})

describe('[check] C1/C4 — 설정', () => {
  it('설정 깨짐 → C1 FAIL', () => {
    const r = runChecks(inputs({ config: { ok: false, error: '스키마 위반: …' } }))
    expect(byId(r, 'C1')?.level).toBe('FAIL')
    expect(r.ok).toBe(false)
  })

  // 🔴 DEC-6: 한 항목의 실패가 나머지 진단을 가리지 않는다.
  it('🔴 설정이 깨져도 C2·C3는 계속 평가된다', () => {
    const r = runChecks(inputs({ config: { ok: false, error: 'broken' }, version: NO_CLI, auth: LOGGED_OUT }))
    expect(byId(r, 'C2')?.level).toBe('FAIL')
    expect(byId(r, 'C3')?.level).toBe('FAIL')
    expect(r.summary.fail).toBe(3)
  })

  // 같은 원인을 두 번 세지 않는다 — C1이 실패하면 C4는 판정 불가다.
  it('설정이 깨지면 C4는 점검 불요(OK)로 남는다', () => {
    const c = byId(runChecks(inputs({ config: { ok: false, error: 'broken' } })), 'C4')
    expect(c?.level).toBe('OK')
    expect(c?.msg).toContain('점검 불요')
  })

  it('모델·effort가 null이면 C4 WARN(전역 상속 = 비용·재현성 미고정)', () => {
    const r = runChecks(
      inputs({ config: { ok: true, cfg: { reviewModel: null, reviewReasoningEffort: null } as never } }),
    )
    const c = byId(r, 'C4')
    expect(c?.level).toBe('WARN')
    expect(c?.msg).toContain('reviewModel')
    expect(c?.msg).toContain('reviewReasoningEffort')
    expect(r.ok).toBe(true)
  })

  it('한쪽만 null이어도 WARN이고 그 키만 언급한다', () => {
    const c = byId(
      runChecks(inputs({ config: { ok: true, cfg: { reviewModel: 'm', reviewReasoningEffort: null } as never } })),
      'C4',
    )
    expect(c?.level).toBe('WARN')
    expect(c?.msg).toContain('reviewReasoningEffort')
    expect(c?.msg).not.toContain('reviewModel,')
  })
})

describe('[check] 렌더링 — 두 출력이 같은 report에서 파생된다(DEC-5)', () => {
  it('사람용은 등급·id·요약을 담는다', () => {
    const out = renderHuman(runChecks(inputs()))
    expect(out).toContain('[OK] C1:')
    expect(out).toContain('PASS')
  })

  it('FAIL이면 요약이 FAIL로 바뀐다', () => {
    expect(renderHuman(runChecks(inputs({ version: NO_CLI })))).toContain('FAIL —')
  })

  // 🔴 파이프 소비자가 파싱에 실패하지 않도록 JSON 출력에 사람용 줄을 섞지 않는다.
  it('🔴 --json 출력은 그 자체로 파싱 가능하고 report와 동등하다', () => {
    const report = runChecks(inputs({ auth: UNKNOWN }))
    const parsed = JSON.parse(renderJson(report))
    expect(parsed).toEqual(report)
    expect(parsed.summary.warn).toBe(1)
  })
})

describe('[check] parseArgs — fail-closed', () => {
  it('기본은 cwd + 사람용 출력', () => {
    expect(parseArgs([])).toEqual({ dir: process.cwd(), json: false })
  })

  it('--json / --dir', () => {
    expect(parseArgs(['--json']).json).toBe(true)
    expect(parseArgs(['--dir', '.']).dir).toBe(process.cwd())
  })

  it('--dir 값 누락 → throw', () => {
    expect(() => parseArgs(['--dir'])).toThrow('--dir')
  })

  /**
   * 🔴 phase-1 r01 P1 회귀 가드. 값을 빠뜨리면 뒤따르는 **옵션이 경로로 소비**되어
   * JSON 모드가 꺼진 채 존재하지 않는 `<cwd>/--json`을 진단하고, codex가 정상이면 그것이
   * **exit 0으로 성공**한다 — 잘못된 호출이 조용히 통과하는 fail-closed 우회다.
   */
  for (const bad of [
    ['--dir', '--json'],
    ['--dir', '--dir', 'x'],
    ['--dir', '-h'],
  ]) {
    it(`🔴 값 자리의 옵션을 삼키지 않는다: ${bad.join(' ')}`, () => {
      expect(() => parseArgs(bad)).toThrow('--dir 에 경로가 필요합니다')
    })
  }

  it('정상 조합은 그대로 동작한다(과잉 거부 아님)', () => {
    expect(parseArgs(['--dir', '.', '--json'])).toEqual({ dir: process.cwd(), json: true })
    expect(parseArgs(['--json', '--dir', '.'])).toEqual({ dir: process.cwd(), json: true })
  })

  it('알 수 없는 옵션 → throw', () => {
    expect(() => parseArgs(['--fix'])).toThrow('알 수 없는 옵션')
  })

  it('-h/--help → HelpRequested', () => {
    expect(() => parseArgs(['-h'])).toThrow(HelpRequested)
  })
})

describe('[check] loadConfigResult — throw를 진단으로 흡수(DEC-6)', () => {
  it('설정 파일이 없으면 DEFAULTS로 성공한다(수용기준 1 — 티켓 없는 repo)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cg-check-'))
    try {
      const r = loadConfigResult(dir)
      expect(r.ok).toBe(true)
      if (r.ok) expect(r.cfg.reviewModel).toBe(DEFAULTS.reviewModel)
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
    }
  })

  it('🔴 깨진 설정이 스택트레이스로 죽지 않고 진단 결과가 된다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cg-check-'))
    try {
      writeFileSync(join(dir, 'req.config.json'), '{ not json', 'utf8')
      const r = loadConfigResult(dir)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error).toContain('파싱 실패')
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
    }
  })

  it('스키마 위반도 진단 결과가 된다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cg-check-'))
    try {
      writeFileSync(join(dir, 'req.config.json'), JSON.stringify({ branchPrefix: '' }), 'utf8')
      const r = loadConfigResult(dir)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error).toContain('스키마')
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
    }
  })

  // 🔴 DEC-7: resolveRoot 의 package-root fallback 을 타면 소비자 repo 에서 **패키지 자신**을 진단한다.
  it('🔴 --dir 로 준 root 만 본다(패키지 fallback 으로 새지 않는다)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cg-check-'))
    try {
      writeFileSync(join(dir, 'req.config.json'), JSON.stringify({ reviewModel: 'sentinel-model' }), 'utf8')
      const r = loadConfigResult(dir)
      expect(r.ok).toBe(true)
      if (r.ok) expect(r.cfg.reviewModel).toBe('sentinel-model')
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
    }
  })
})


/**
 * **C5 — 업그레이드 소비자의 오래된 계약 문서**(0.22.0 최종 보완).
 *
 * 세 소비자 복제본에 0.22.0을 실제로 설치하고 `sync --apply --gitignore`를 돌려도
 * `AGENTS.md`에는 0.21 계약이 그대로 남았다. `sync`가 사용자 소유 파일을 덮어쓰지 않기 때문이며
 * **그 정책은 유지해야 한다**(프로젝트 고유 내용이 지워진다). 그래서 고치는 대신 **알린다**.
 */
describe('[check] C5 — 계약 문서의 폐기된 CommitGate 서술', () => {
  /** 등재 목록에서 실제 문구를 가져온다 — 테스트에 사본 문자열을 두지 않는다. */
  const staleText = RETIRED_CLAIMS[0]!.text
  const contracts = (over: Record<string, string | null>): CheckInputs['contracts'] =>
    CONTRACT_FILES.map((rel) => ({ rel, content: rel in over ? (over[rel] as string | null) : null }))

  it('AGENTS.md 에 폐기 주장이 있으면 C5 WARN', () => {
    const r = runChecks(inputs({ contracts: contracts({ 'AGENTS.md': `계약 본문
${staleText}
끝` }) }))
    expect(byId(r, 'C5')?.level).toBe('WARN')
    expect(byId(r, 'C5')?.msg).toContain('AGENTS.md')
  })

  it('AGENTS.commitgate.md 에 있으면 C5 WARN', () => {
    const r = runChecks(inputs({ contracts: contracts({ 'AGENTS.commitgate.md': staleText }) }))
    expect(byId(r, 'C5')?.level).toBe('WARN')
    expect(byId(r, 'C5')?.msg).toContain('AGENTS.commitgate.md')
  })

  it('두 파일 모두 현행 정책이면 C5 OK', () => {
    const good = `통합 통제점: [I2] ${I2_APPROVAL}. GitHub CI는 기본 미실행 opt-in이며 생략은 정상입니다.`
    const r = runChecks(inputs({ contracts: contracts({ 'AGENTS.md': good, 'AGENTS.commitgate.md': good }) }))
    expect(byId(r, 'C5')?.level).toBe('OK')
  })

  it('파일이 없으면 C5 OK(점검 불요 — 설치 형태에 따라 정상)', () => {
    expect(byId(runChecks(inputs({ contracts: contracts({}) })), 'C5')?.level).toBe('OK')
    expect(byId(runChecks(inputs({ contracts: [] })), 'C5')?.level).toBe('OK')
  })

  it('🔴 retiredClaimsIn 의 정규화가 그대로 적용된다(강조·줄바꿈 우회 불가)', () => {
    const bolded = `**${staleText.slice(0, 4)}**${staleText.slice(4)}`
    expect(byId(runChecks(inputs({ contracts: contracts({ 'AGENTS.md': bolded }) })), 'C5')?.level).toBe('WARN')
    const mid = Math.floor(staleText.length / 2)
    const folded = `${staleText.slice(0, mid)}
${staleText.slice(mid)}`
    expect(byId(runChecks(inputs({ contracts: contracts({ 'AGENTS.md': folded }) })), 'C5')?.level).toBe('WARN')
  })

  it('🔴 C5 WARN 이어도 전체 check 는 통과(exit 0) — 기존 소비자를 막지 않는다', () => {
    const r = runChecks(inputs({ contracts: contracts({ 'AGENTS.md': staleText }) }))
    expect(byId(r, 'C5')?.level).toBe('WARN')
    expect(r.ok).toBe(true) // ok=true → exit 0
    expect(r.summary.fail).toBe(0)
  })

  it('WARN 메시지가 발견 문장·사유·현행 정책·정확한 비교 경로·수동 병합을 모두 담는다', () => {
    const msg = byId(runChecks(inputs({ contracts: contracts({ 'AGENTS.md': staleText }) })), 'C5')?.msg ?? ''
    expect(msg).toContain('AGENTS.md')
    // 🔴 **발견한 실제 문장**을 보여준다 — 사유만으로는 자기 파일 어디를 고칠지 알 수 없다.
    expect(msg).toContain(RETIRED_CLAIMS[0]!.text)
    expect(msg).toContain(RETIRED_CLAIMS[0]!.why) // 사유는 등재 정본을 그대로 쓴다
    expect(msg).toContain(I2_APPROVAL)
    expect(msg).toContain('자동으로 실행하지 않고')
    expect(msg).toContain('수동')
    expect(msg).toContain('자동 교체하지 않습니다')
    // 🔴 사용자가 실제로 열 수 있는 정확한 경로.
    expect(msg).toContain(TEMPLATE_COMPARE_PATH)
    expect(TEMPLATE_COMPARE_PATH).toBe('node_modules/commitgate/AGENTS.template.md')
  })

  it('🔴 CLI 출력에 Markdown 강조 기호를 넣지 않는다(터미널에 그대로 보인다)', () => {
    const msg = byId(runChecks(inputs({ contracts: contracts({ 'AGENTS.md': staleText }) })), 'C5')?.msg ?? ''
    expect(msg).not.toContain('**')
  })

  it('🔴 저장소 자체 워크플로가 자동 실행될 수 있음을 함께 알린다(단정 금지)', () => {
    const msg = byId(runChecks(inputs({ contracts: contracts({ 'AGENTS.md': staleText }) })), 'C5')?.msg ?? ''
    expect(msg).toContain('저장소 자체 워크플로')
    expect(msg).toContain('.github/workflows/')
  })

  it('두 파일의 여러 claim 을 각각 구분해 표시한다', () => {
    const a = RETIRED_CLAIMS[0]!
    const b = RETIRED_CLAIMS[1]!
    const msg =
      byId(
        runChecks(inputs({ contracts: contracts({ 'AGENTS.md': `${a.text} 그리고 ${b.text}`, 'AGENTS.commitgate.md': a.text }) })),
        'C5',
      )?.msg ?? ''
    // 파일별로 줄이 나뉘고, 같은 파일의 서로 다른 claim 도 각각 나온다.
    expect(msg).toContain(`AGENTS.md: "${a.text}"`)
    expect(msg).toContain(`AGENTS.md: "${b.text}"`)
    expect(msg).toContain(`AGENTS.commitgate.md: "${a.text}"`)
    expect(msg.split('AGENTS.commitgate.md:').length - 1).toBe(1)
  })

  /**
   * 🔴 소비자(lean_lms) `AGENTS.md`의 **완료 정의**에 CI green 전제가 있었다.
   *    통제점표가 아니라 다른 절이라 기존 항목에 걸리지 않았다.
   */
  it('완료 정의에 CI green 을 둔 옛 문장도 C5 WARN 이다', () => {
    const leanSentence =
      '- **완료 정의**: Phase/티켓은 코드 작성 여부가 아니라 **DoD + 검증 증적(+ 해당 O·CI green)** 충족으로 판단.'
    const r = runChecks(inputs({ contracts: contracts({ 'AGENTS.md': leanSentence }) }))
    expect(byId(r, 'C5')?.level).toBe('WARN')
    expect(byId(r, 'C5')?.msg).toContain('완료 조건에 CI green')
    expect(r.ok).toBe(true)
  })

  it('🔴 CI green 을 부정하는 정정문에는 발화하지 않는다(오탐 경계)', () => {
    const corrected =
      '완료 정의는 DoD와 필수 로컬 검증 증적 충족으로 판단한다. GitHub CI green 은 완료의 필수 조건이 아니다.'
    expect(byId(runChecks(inputs({ contracts: contracts({ 'AGENTS.md': corrected }) })), 'C5')?.level).toBe('OK')
  })

  /**
   * 🔴 **릴리즈 전제가 빠진 R1/R2/R3 문장**(0.22.0 릴리스 직전).
   *    CI green 전제를 걷어내면서 `verify-range --strict` 전제를 넣지 않은 중간 상태가 배포될 뻔했다.
   *    소비자 AGENTS.md 에 그 상태가 남으면 C5 가 잡아야 한다.
   */
  it('전제가 빠진 R1/R2/R3 문장은 C5 WARN', () => {
    const incomplete = '- `R1`·`R2`·`R3`는 반영(`I2` 또는 `B1`) 이후 각각 **따로** 요청한다. 셋을 하나의 "릴리즈 승인"으로 뭉뚱그리지 않는다.'
    const r = runChecks(inputs({ contracts: contracts({ 'AGENTS.md': incomplete }) }))
    expect(byId(r, 'C5')?.level).toBe('WARN')
    expect(byId(r, 'C5')?.msg).toContain('verify-range --strict')
    expect(r.ok).toBe(true)
  })

  it('🔴 정본 R1/R2/R3 문장에는 발화하지 않는다(줄 경계 — 오탐 금지)', () => {
    const canonical =
      '- `R1`·`R2`·`R3`는 반영(`I2` 또는 `B1`) 이후 `npx commitgate verify-range --strict` 통과를 확인한 뒤 각각 **따로** 요청한다. GitHub CI green은 전제가 아니다. 셋을 하나의 "릴리즈 승인"으로 뭉뚱그리지 않는다.'
    expect(byId(runChecks(inputs({ contracts: contracts({ 'AGENTS.md': canonical }) })), 'C5')?.level).toBe('OK')
  })

  it('🔴 강조 표시 유무가 판정을 바꾸지 않는다(정규화 경계)', () => {
    // 전제가 빠진 문장은 강조를 빼도 WARN, 정본은 강조를 붙여도 OK.
    const incompletePlain = '- R1·R2·R3는 반영(I2 또는 B1) 이후 각각 따로 요청한다.'
    expect(byId(runChecks(inputs({ contracts: contracts({ 'AGENTS.md': incompletePlain }) })), 'C5')?.level).toBe('WARN')
    const canonicalBold =
      '- **`R1`·`R2`·`R3`**는 반영(`I2` 또는 `B1`) 이후 **`npx commitgate verify-range --strict` 통과**를 확인한 뒤 각각 **따로** 요청한다.'
    expect(byId(runChecks(inputs({ contracts: contracts({ 'AGENTS.md': canonicalBold }) })), 'C5')?.level).toBe('OK')
  })

  it('옛 승인 명칭 2종은 C5 WARN', () => {
    const stale = '- `merge/push 승인`은 `required status checks bypass 승인`이 아니다.'
    const r = runChecks(inputs({ contracts: contracts({ 'AGENTS.md': stale }) }))
    expect(byId(r, 'C5')?.level).toBe('WARN')
    const msg = byId(r, 'C5')?.msg ?? ''
    expect(msg).toContain('옛 승인 명칭')
    expect(msg).toContain(I2_APPROVAL)
  })

  it('🔴 현재 정본 승인 비동일성 문장에는 발화하지 않는다', () => {
    const good = '- `검증 결과 확인 후 PR merge 승인`(`I2`)은 `branch protection bypass를 사용한 direct push 승인`(`B1`)이 아니다.'
    expect(byId(runChecks(inputs({ contracts: contracts({ 'AGENTS.md': good }) })), 'C5')?.level).toBe('OK')
  })

  it('--json 출력에도 같은 진단이 실린다(같은 report 파생)', () => {
    const r = runChecks(inputs({ contracts: contracts({ 'AGENTS.md': staleText }) }))
    const parsed = JSON.parse(renderJson(r)) as CheckReport
    const c5 = parsed.checks.find((c) => c.id === 'C5')
    expect(c5?.level).toBe('WARN')
    expect(c5?.msg).toBe(byId(r, 'C5')?.msg)
    expect(renderHuman(r)).toContain('[WARN] C5:')
  })

  it('🔴 check 는 계약 파일을 수정하지 않는다(내용·mtime 불변)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cg-check-c5-'))
    try {
      const abs = join(dir, 'AGENTS.md')
      writeFileSync(abs, staleText, 'utf8')
      const before = { body: readFileSync(abs, 'utf8'), mtime: statSync(abs).mtimeMs }
      const collected = collectContracts(dir)
      const r = runChecks(inputs({ contracts: collected }))
      expect(byId(r, 'C5')?.level).toBe('WARN')
      expect(readFileSync(abs, 'utf8')).toBe(before.body)
      expect(statSync(abs).mtimeMs).toBe(before.mtime)
      // 없던 파일을 만들지도 않는다.
      expect(existsSync(join(dir, 'AGENTS.commitgate.md'))).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
    }
  })

  it('collectContracts 는 두 계약 파일만 읽고 부재는 null 이다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cg-check-c5b-'))
    try {
      writeFileSync(join(dir, 'AGENTS.md'), 'x', 'utf8')
      const got = collectContracts(dir)
      expect(got.map((c) => c.rel)).toEqual([...CONTRACT_FILES])
      expect(got.find((c) => c.rel === 'AGENTS.md')?.content).toBe('x')
      expect(got.find((c) => c.rel === 'AGENTS.commitgate.md')?.content).toBeNull()
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
    }
  })

  /**
   * 🔴 **매처 사본 금지**(구조 고정). C5가 자기만의 목록·매칭을 갖는 순간, 등재부가 갱신돼도
   *    소비자 진단은 옛 목록을 보게 된다 — 이 저장소가 자산 skew로 여러 번 데인 형태다.
   */
  it('🔴 C5 가 retiredClaimsIn 정본을 그대로 쓴다(사본 없음)', () => {
    const src = readFileSync(join(__dirname, '..', '..', 'bin', 'check.ts'), 'utf8')
    expect(src).toContain("from '../scripts/req/lib/retired-claims'")
    expect(src).toContain('retiredClaimsIn(')
    // 목록·매칭 로직을 다시 만들지 않았다.
    expect(src).not.toContain('RETIRED_CLAIMS')
    expect(src).not.toContain('normalizeForClaimScan')
    // 참조 동일성: C5가 발화한 사유가 정본 매처의 사유와 정확히 같다.
    const claims = retiredClaimsIn(staleText)
    expect(claims.length).toBeGreaterThan(0)
    const msg = byId(runChecks(inputs({ contracts: contracts({ 'AGENTS.md': staleText }) })), 'C5')?.msg ?? ''
    for (const c of claims) expect(msg).toContain(c.why)
  })
})

/**
 * C6 — 설치본의 `req:*` **명령 표면**이 설치된 패키지보다 좁은가 (REQ-2026-161 phase-2).
 *
 * 🔴 실측이 이 검사의 존재 이유다: 0.23.1 설치본 2곳에서 `req:delegate`가 없는데 `check`는 C1~C5
 *    PASS, `doctor`는 `OK D19: Stage B`, `sync`는 "변경 없음"이었다. 결함은 `req:next`가 안내한
 *    명령이 **실행 시점에** 없는 것으로만 드러났다.
 */
describe('[check] C6 — req:* 명령 표면 skew', () => {
  const full = (): Record<string, string> => ({ ...expectedReqScripts(), build: 'vite build' })

  it('전부 있으면 OK(일치 · 개수 표기)', () => {
    const c = byId(runChecks(inputs({ packageScripts: full(), packageRootDiffers: true })), 'C6')
    expect(c?.level).toBe('OK')
    expect(c?.msg).toContain(String(Object.keys(expectedReqScripts()).length))
  })

  it('🔴 없는 verb 를 이름으로 말하고 해소 명령을 준다(WARN)', () => {
    const partial = full()
    delete partial['req:delegate']
    delete partial['req:repolicy']
    const c = byId(runChecks(inputs({ packageScripts: partial, packageRootDiffers: true })), 'C6')
    expect(c?.level).toBe('WARN')
    expect(c?.msg).toContain('req:delegate')
    expect(c?.msg).toContain('req:repolicy')
    expect(c?.msg).toContain('npx commitgate sync --apply --scripts')
  })

  it('🔴 WARN 이지 FAIL 이 아니다 — 스크립트 부재가 기존 작업을 막으면 안 된다', () => {
    const r = runChecks(inputs({ packageScripts: {}, packageRootDiffers: true }))
    expect(byId(r, 'C6')?.level).toBe('WARN')
    expect(r.ok).toBe(true)
    expect(r.summary.fail).toBe(0)
  })

  it('🔴 dogfood(packageRoot === 대상 root)면 점검 불요 — 이 저장소가 스스로 WARN 이 되지 않는다', () => {
    const c = byId(runChecks(inputs({ packageScripts: {}, packageRootDiffers: false })), 'C6')
    expect(c?.level).toBe('OK')
    expect(c?.msg).toContain('dogfood')
  })

  it('🔴 판정 불가(scripts 읽기 실패)는 "부족"이 아니다 — 같은 원인을 두 번 세지 않는다', () => {
    const c = byId(runChecks(inputs({ packageScripts: null, packageRootDiffers: true })), 'C6')
    expect(c?.level).toBe('OK')
    expect(c?.msg).toContain('읽지 못함')
  })

  it('미계산(legacy 입력 리터럴)이면 점검 불요 — 기존 호출부가 깨지지 않는다', () => {
    expect(byId(runChecks(inputs()), 'C6')?.level).toBe('OK')
    expect(byId(runChecks(inputs()), 'C6')?.msg).toContain('미계산')
  })

  it('값이 사용자 정의여도 부재가 아니다(값은 판정 대상이 아니다 — 모드는 D19 의 몫)', () => {
    const custom = Object.fromEntries(Object.keys(expectedReqScripts()).map((k) => [k, 'my-wrapper']))
    expect(byId(runChecks(inputs({ packageScripts: custom, packageRootDiffers: true })), 'C6')?.level).toBe('OK')
  })
})

/**
 * 🔴 **배선 테스트**(설계: 순수 판정만 테스트하면 배선 끊김을 못 잡는다 — REQ-2026-096~099 3연속 실증).
 *    `collectInputs`가 실제로 두 입력을 채우는지, 그리고 그것이 `runChecks`까지 도달하는지 본다.
 */
describe('[check] C6 배선 — collectInputs → runChecks 실경로', () => {
  const tmps: string[] = []
  const repo = (pkg: unknown): string => {
    const dir = mkdtempSync(join(tmpdir(), 'cg-check-c6-'))
    tmps.push(dir)
    writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg), 'utf8')
    return dir
  }
  // 🔴 probe 는 stub 이다 — 이 describe 는 **명령 표면 배선**만 본다(codex 호출 없음).
  const probes: ReviewerProbes = {
    version: () => OK_VERSION,
    auth: () => LOGGED_IN,
    login: () => {
      throw new Error('배선 테스트는 로그인을 호출하지 않는다')
    },
  }
  const cleanup = (): void => {
    while (tmps.length) rmSync(tmps.pop() as string, { recursive: true, force: true })
  }

  it('collectInputs 가 packageScripts·packageRootDiffers 를 실제로 채운다', () => {
    try {
      const dir = repo({ scripts: { 'req:new': 'commitgate req:new' } })
      const inp = collectInputs(dir, probes)
      expect(inp.packageScripts).toEqual({ 'req:new': 'commitgate req:new' })
      expect(inp.packageRootDiffers).toBe(true) // tmp repo ≠ 패키지 루트
    } finally {
      cleanup()
    }
  })

  it('실경로: 누락 설치본 → C6 WARN 이 누락 verb 를 이름으로 말한다', () => {
    try {
      const dir = repo({ scripts: { 'req:new': 'commitgate req:new' } })
      const c = byId(runChecks(collectInputs(dir, probes)), 'C6')
      expect(c?.level).toBe('WARN')
      expect(c?.msg).toContain('req:delegate')
    } finally {
      cleanup()
    }
  })

  it('실경로: 전부 갖춘 설치본 → C6 OK', () => {
    try {
      const dir = repo({ scripts: expectedReqScripts() })
      expect(byId(runChecks(collectInputs(dir, probes)), 'C6')?.level).toBe('OK')
    } finally {
      cleanup()
    }
  })

  it('🔴 실경로: 이 저장소 자신(dogfood) → C6 가 WARN 이 되지 않는다', () => {
    // 이 저장소의 req:* 는 5개(Stage A 형태)뿐이고 VERB_MODULES 는 그보다 많다 —
    // skip 이 없으면 여기서 WARN 이 난다. 그 회귀를 고정한다.
    const inp = collectInputs(packageRoot(), probes)
    expect(inp.packageRootDiffers).toBe(false)
    expect(byId(runChecks(inp), 'C6')?.level).toBe('OK')
  })
})

/**
 * `--help` 가 실제 점검 항목과 일치하는가 (phase-2 r01 P1).
 *
 * 🔴 **id 목록을 이 파일에 손으로 적지 않는다.** 기대값은 `runChecks` 가 실제로 방출한 id 에서 오고,
 *    검사는 "help 가 그 전부를 열거하는가" 다. 그래서 C7 을 추가하고 help 를 안 고치면 **자동으로 red**
 *    가 된다 — 이 P1 이 다시 나지 않는 유일한 형태다(손으로 센 목록은 반드시 놓친다 — REQ-2026-149).
 */
describe('[check] --help 가 실제 점검 항목과 갈라지지 않는다', () => {
  const helpText = (): string => {
    const lines: string[] = []
    const orig = console.log
    console.log = (...a: unknown[]) => void lines.push(a.map(String).join(' '))
    try {
      printHelp()
    } finally {
      console.log = orig
    }
    return lines.join('\n')
  }

  it('🔴 runChecks 가 내는 모든 항목 id 를 help 가 열거한다', () => {
    const ids = runChecks(inputs()).checks.map((c) => c.id)
    expect(ids.length).toBeGreaterThan(5) // 오라클이 공허해지지 않게 표면이 실재함을 먼저 고정
    const help = helpText()
    for (const id of ids) expect(help).toContain(`  ${id}  `)
  })

  it('WARN 이 exit 0 이라는 서술이 WARN 을 낼 수 있는 항목을 빠뜨리지 않는다', () => {
    // C5·C6 는 WARN 상한 항목이다 — exit 설명이 둘 다 언급해야 사용자가 exit 계약을 오해하지 않는다.
    const help = helpText()
    const exitLine = help.split('\n').find((l) => l.startsWith('exit:')) ?? ''
    expect(exitLine).toContain('C5')
    expect(exitLine).toContain('C6')
  })

  it('C6 항목이 해소 명령과 dogfood 예외를 함께 말한다', () => {
    const help = helpText()
    expect(help).toContain('sync --apply --scripts')
    expect(help).toContain('dogfood')
  })
})

/**
 * C6 가 복구 안내를 낼 때 **그 명령이 실제로 존재하는가** (phase-2 r02 P1 → 계획 재정렬 DEC-7).
 *
 * 🔴 이 REQ 가 고치는 병이 "도구가 시킨 명령이 실행 시점에 없다" 이므로, 진단이 가리키는 복구 수단이
 *    실재함을 **검사로** 묶는다. 안내 문자열만 맞추면 다음 리팩터에서 또 갈라진다.
 */
describe('[check] C6 가 안내하는 복구 명령이 실재한다', () => {
  it('🔴 안내한 sync 옵션을 sync 가 실제로 파싱한다', () => {
    const missing = ['req:delegate']
    const msg = commandSurfaceGuidance(missing)
    expect(msg).toContain('--scripts')
    // 문자열이 아니라 **동작**으로 확인한다 — 옵션이 없으면 parseArgs 가 throw 한다.
    expect(syncParseArgs(['--apply', '--scripts']).scripts).toBe(true)
  })
})
