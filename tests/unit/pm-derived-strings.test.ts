import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { nextStepHint } from '../../scripts/req/req-new'
import { missingTargetHint } from '../../scripts/req/req-next'
import { missingTicketHint } from '../../scripts/req/review-codex'
import { DEFAULTS, type PackageManager } from '../../scripts/req/lib/config'

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const REQ_DIR = join(PACKAGE_ROOT, 'scripts', 'req')

/**
 * REQ-2026-011 phase-3 — 사용자 대면 문구의 pm 리터럴 제거 (D2 / DEC-011-1).
 *
 * 규칙: **config 로드 이후**의 안내·throw 문구는 `buildScriptInvocation(cfg.packageManager, …)`으로
 * 파생한다. **config 로드 이전**(헤더 주석·early throw)은 pm-중립 bare 표기를 쓴다.
 *
 * `DEFAULTS.packageManager`를 폴백으로 쓰지 않는 이유: 그 값은 `'pnpm'`인데
 * `bin/init.ts`의 `detectPackageManager` 폴백은 `'npm'`이다. 문구용으로 DEFAULTS를 끌어오면
 * npm 프로젝트에 pnpm 명령이 새어 나간다 — 이 REQ가 고치려는 결함 그 자체가 된다.
 */
describe('[pm 문구] config 로드 이후 안내는 pm별로 파생된다 (REQ-2026-011 D2)', () => {
  const PMS: PackageManager[] = ['npm', 'pnpm', 'yarn']

  it('req:new 성공 안내 — npm은 `run` + `--` 구분자, pnpm/yarn은 bare 스크립트', () => {
    expect(nextStepHint('npm', 'REQ-2026-011')).toContain('npm run req:review-codex -- 2026-011 --run')
    expect(nextStepHint('pnpm', 'REQ-2026-011')).toContain('pnpm req:review-codex 2026-011 --run')
    expect(nextStepHint('yarn', 'REQ-2026-011')).toContain('yarn req:review-codex 2026-011 --run')
  })

  it('req:new 성공 안내 — `REQ-` 접두는 벗겨서 넘긴다', () => {
    expect(nextStepHint('pnpm', 'REQ-2026-011')).toBe(nextStepHint('pnpm', '2026-011'))
  })

  it('req:next 대상 미지정 문구 — pm별 실행 형식', () => {
    expect(missingTargetHint('npm')).toContain('npm run req:next -- 2026-010')
    expect(missingTargetHint('pnpm')).toContain('pnpm req:next 2026-010')
    expect(missingTargetHint('yarn')).toContain('yarn req:next 2026-010')
  })

  it('req:review-codex 대상 미지정 문구 — pm별 실행 형식', () => {
    expect(missingTicketHint('npm')).toContain('npm run req:review-codex -- 2026-001')
    expect(missingTicketHint('pnpm')).toContain('pnpm req:review-codex 2026-001')
    expect(missingTicketHint('yarn')).toContain('yarn req:review-codex 2026-001')
  })

  /**
   * 이 저장소의 `req.config.json`은 `packageManager: "npm"`이다. 그런데 `DEFAULTS.packageManager`는
   * `'pnpm'`이라, 문구를 DEFAULTS로 폴백시키면 npm 프로젝트가 pnpm 명령을 안내받는다.
   * REQ-2026-011 생성 시 `req:new --run`이 실제로 `pnpm req:review-codex …`를 출력했다.
   */
  // `'pnpm'`은 `'npm'`을 부분문자열로 포함한다 → 낱말 경계로 봐야 오탐이 없다.
  const asWord = (p: string) => new RegExp(String.raw`(?<![a-z])${p}(?![a-z])`)

  it.each(PMS)('%s 프로젝트의 안내에는 다른 pm 이름이 섞이지 않는다', (pm) => {
    const others = PMS.filter((p) => p !== pm)
    for (const hint of [nextStepHint(pm, '2026-011'), missingTargetHint(pm), missingTicketHint(pm)]) {
      expect(hint, `${pm} 안내에 ${pm}이 있어야 함`).toMatch(asWord(pm))
      for (const other of others) expect(hint, `${pm} 안내에 ${other}가 섞임`).not.toMatch(asWord(other))
    }
  })

  it('DEFAULTS.packageManager는 pnpm이다 — 그래서 문구 폴백으로 쓰면 안 된다(회귀 고정)', () => {
    // 이 단언이 깨지면 DEFAULTS가 바뀐 것이다. 그때는 문구 폴백 금지 근거를 다시 검토하라.
    expect(DEFAULTS.packageManager).toBe('pnpm')
  })
})

/**
 * config 로드 이전 문구(헤더 주석·early throw)와 소스 전반에 pm 실행 형식이 박혀 있지 않은지 전수 검사.
 * `buildScriptInvocation`이 런타임에 만들어 내는 문자열은 소스 리터럴이 아니므로 여기 걸리지 않는다.
 */
describe('[pm 문구] scripts/req/** 소스에 pm 실행 형식 리터럴이 없다', () => {
  const PM_LITERAL = /npm run req|pnpm req:|yarn req:/
  const sources = readdirSync(REQ_DIR, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.ts'))

  it('검사 대상이 비어 있지 않다(글롭 오류 방지)', () => {
    expect(sources.length).toBeGreaterThanOrEqual(5)
  })

  it.each(sources)('scripts/req/%s', (rel) => {
    const body = readFileSync(join(REQ_DIR, rel), 'utf8')
    expect(body).not.toMatch(PM_LITERAL)
  })
})
