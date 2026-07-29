import { describe, it, expect } from 'vitest'
import { resolveDispatch, VERB_MODULES } from '../../bin/dispatch.mjs'
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { resolve, dirname, join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

/**
 * REQ-2026-014 Phase 1 — bin verb dispatch(설계 D3).
 *
 * launcher는 알려진 verb를 해당 모듈로 보내고(verb 토큰 소비), init 옵션(`-` 시작)·verb 없음은 init에
 * argv 전체를 넘긴다(하위호환: `npx commitgate --dry-run`). 그 외 비-옵션 토큰은 fail-closed(`unknown`).
 *
 * `migrate`는 **Phase 3에서 `bin/migrate.ts` 생성과 동시에 등록**됐다. Phase 1의 "미등록 → unknown" 단언은
 * 그때까지 깨진 import를 노출하지 않기 위한 **의도된 tripwire**였고, 등록과 함께 이 파일에서 갱신됐다.
 */
describe('[dispatch] resolveDispatch — 알려진 req:* verb 라우팅(verb 토큰 소비)', () => {
  const cases: Array<[string, string]> = [
    ['req:new', '../scripts/req/req-new.ts'],
    ['req:next', '../scripts/req/req-next.ts'],
    ['req:review-codex', '../scripts/req/review-codex.ts'],
    ['req:doctor', '../scripts/req/req-doctor.ts'],
    ['req:commit', '../scripts/req/req-commit.ts'],
  ]
  for (const [verb, entry] of cases) {
    it(`${verb} → ${entry} (인자 통과)`, () => {
      const d = resolveDispatch([verb, 'foo', '--run'])
      expect(d).toEqual({ entry, rest: ['foo', '--run'] })
    })
  }

  it('uninstall / init verb 라우팅(토큰 소비)', () => {
    expect(resolveDispatch(['uninstall', '--dir', 'x'])).toEqual({ entry: 'uninstall.ts', rest: ['--dir', 'x'] })
    expect(resolveDispatch(['init', '--strict'])).toEqual({ entry: 'init.ts', rest: ['--strict'] })
  })

  it('migrate verb 라우팅 — Phase 3에서 파일 생성과 동시에 등록(인자 통과)', () => {
    expect('migrate' in VERB_MODULES).toBe(true)
    expect(resolveDispatch(['migrate'])).toEqual({ entry: 'migrate.ts', rest: [] })
    expect(resolveDispatch(['migrate', '--apply', '--dir', 'x'])).toEqual({
      entry: 'migrate.ts',
      rest: ['--apply', '--dir', 'x'],
    })
  })

  it('sync verb 라우팅 — REQ-2026-038 파일 생성과 동시에 등록(인자 통과)', () => {
    expect('sync' in VERB_MODULES).toBe(true)
    expect(resolveDispatch(['sync'])).toEqual({ entry: 'sync.ts', rest: [] })
    expect(resolveDispatch(['sync', '--apply', '--persona', '--dir', 'x'])).toEqual({
      entry: 'sync.ts',
      rest: ['--apply', '--persona', '--dir', 'x'],
    })
  })

  it('quickstart verb 라우팅 — REQ-2026-040 파일 생성과 동시에 등록(인자 통과)', () => {
    expect('quickstart' in VERB_MODULES).toBe(true)
    expect(resolveDispatch(['quickstart'])).toEqual({ entry: 'quickstart.ts', rest: [] })
    expect(resolveDispatch(['quickstart', '--apply', '--dir', 'x'])).toEqual({
      entry: 'quickstart.ts',
      rest: ['--apply', '--dir', 'x'],
    })
  })

  it('setup verb 라우팅 — REQ-2026-060 파일 생성과 동시에 등록(인자 통과)', () => {
    expect('setup' in VERB_MODULES).toBe(true)
    expect(resolveDispatch(['setup'])).toEqual({ entry: 'setup.ts', rest: [] })
    expect(resolveDispatch(['setup', '--dir', 'x'])).toEqual({ entry: 'setup.ts', rest: ['--dir', 'x'] })
  })

  it('check verb 라우팅 — REQ-2026-061 파일 생성과 동시에 등록(인자 통과)', () => {
    expect('check' in VERB_MODULES).toBe(true)
    expect(resolveDispatch(['check'])).toEqual({ entry: 'check.ts', rest: [] })
    expect(resolveDispatch(['check', '--json', '--dir', 'x'])).toEqual({
      entry: 'check.ts',
      rest: ['--json', '--dir', 'x'],
    })
  })

  it('verb 뒤 bare `--`는 그대로 전달된다(스트립은 각 스크립트 parseArgs의 몫)', () => {
    expect(resolveDispatch(['req:next', '--', '2026-014'])).toEqual({
      entry: '../scripts/req/req-next.ts',
      rest: ['--', '2026-014'],
    })
  })
})

describe('[dispatch] init 라우팅 — 옵션 선행/verb 없음은 init에 argv 전체(D3, 하위호환)', () => {
  for (const opt of ['--dry-run', '--dir', '--strict', '--force', '--no-agent-entrypoints', '-h']) {
    it(`${opt} 선행 → init.ts 에 argv 전체 전달(verb 미소비)`, () => {
      const argv = opt === '--dir' ? ['--dir', 'target'] : [opt]
      expect(resolveDispatch(argv)).toEqual({ entry: 'init.ts', rest: argv })
    })
  }

  it('인자 없음 → init.ts (기존 `npx commitgate` 하위호환)', () => {
    expect(resolveDispatch([])).toEqual({ entry: 'init.ts', rest: [] })
  })
})

describe('[dispatch] fail-closed — 비-옵션 미지 토큰', () => {
  it('알 수 없는 명령은 unknown으로 표시(호출부가 exit 1)', () => {
    expect(resolveDispatch(['bogus'])).toEqual({ unknown: 'bogus' })
  })

  it('오타난 migrate도 조용히 init으로 가지 않는다', () => {
    expect(resolveDispatch(['migrat', '--apply'])).toEqual({ unknown: 'migrat' })
  })

  it('오타난 req 접두 명령도 조용히 init으로 가지 않는다', () => {
    expect(resolveDispatch(['req:doctorr'])).toEqual({ unknown: 'req:doctorr' })
  })
})

// ───────────── REQ-2026-090: dispatch 계약(runCli) 전수 검사 ──
describe('[REQ-2026-090] dispatch 대상은 전부 runCli 경계를 갖는다', () => {
  /**
   * 🔴 이 검사가 필요한 이유: `req:rebind`·`req:confirm`은 **라우팅도 설치도 정상이었다.**
   *    `VERB_MODULES`에 키가 있었고(위 테스트 통과), 대상 package.json에도 `commitgate <verb>`로
   *    설치돼 있었다(smoke 통과). **모듈만 계약을 어겨서** Stage B 소비자에게만 TypeError로 터졌다.
   *    "키가 있는가"·"설치됐는가"가 아니라 **"모듈이 실행 가능한가"**를 봐야 잡힌다.
   */
  it('🔴 모든 VERB_MODULES 대상이 runCli 함수를 export한다', async () => {
    const entries = Object.entries(VERB_MODULES as Record<string, string>)
    // 표본이 비면 이 검사는 아무것도 지키지 못한다 — 하한을 함께 고정한다.
    expect(entries.length).toBeGreaterThanOrEqual(10)

    const missing: string[] = []
    for (const [verb, rel] of entries) {
      const abs = pathToFileURL(resolve(REPO_ROOT, 'bin', rel)).href
      const mod = (await import(abs)) as Record<string, unknown>
      if (typeof mod.runCli !== 'function') missing.push(`${verb} (${rel})`)
    }
    expect(missing).toEqual([])
  })

  /**
   * 🔴 phase-1 r01 P1: 소스 문자열 검사는 **가드가 주석 처리되거나 도달 불가능해져도 통과**한다.
   *    실제 bin을 subprocess로 돌려 exit code·메시지·TypeError 비노출을 본다.
   *
   *    실행 방법: `bin/commitgate.mjs`를 임시 디렉터리에 복사하고 `dispatch.mjs`를 **계약 위반 모듈로
   *    라우팅하는 stub**으로 둔다. commitgate.mjs는 `./dispatch.mjs`를 상대 import하고 entry를 binDir
   *    기준으로 해소하므로, 복사본만으로 진짜 가드 코드가 그대로 실행된다.
   */
  it('🔴 bin이 계약 위반 모듈을 만나면 exit 1 + 진단 메시지(원시 TypeError 아님)', () => {
    // 🔴 **repo 안**(`node_modules/.cache`)에 둔다. OS 임시 폴더에 두면 복사본의
    //    `import ... from 'tsx/esm/api'`가 해소되지 않는다 — ESM bare specifier는 cwd가 아니라
    //    **importing 파일 위치**에서 위로 올라가며 node_modules를 찾기 때문이다.
    //    `node_modules/`는 gitignore라 D10(워킹트리 클린)에도 걸리지 않는다.
    const cacheRoot = resolve(REPO_ROOT, 'node_modules', '.cache')
    mkdirSync(cacheRoot, { recursive: true })
    const dir = mkdtempSync(join(cacheRoot, 'cg-dispatch-'))
    try {
      copyFileSync(resolve(REPO_ROOT, 'bin', 'commitgate.mjs'), join(dir, 'commitgate.mjs'))
      // 계약 위반 모듈: main만 export하고 runCli는 없다(수정 전 req:rebind·req:confirm과 같은 형태).
      writeFileSync(join(dir, 'bad.mjs'), 'export function main() { console.log("MAIN-WAS-CALLED") }\n')
      writeFileSync(join(dir, 'dispatch.mjs'), "export function resolveDispatch() { return { entry: './bad.mjs', rest: [] } }\n")

      const r = spawnSync(process.execPath, [join(dir, 'commitgate.mjs'), 'req:whatever'], {
        encoding: 'utf8',
        cwd: REPO_ROOT, // tsx/esm/api 는 패키지 기준 해소 — 루트에서 실행한다
      })
      const out = `${r.stdout ?? ''}${r.stderr ?? ''}`
      expect(r.status, out).toBe(1)
      expect(out).toContain('dispatch 계약 위반')
      expect(out).not.toContain('TypeError') // 🔴 원시 예외가 새어 나오면 안 된다
      expect(out).not.toContain('MAIN-WAS-CALLED') // 🔴 DEC-2: main 폴백 금지
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('폴백 관용구가 소스에 없다(DEC-2 — main 폴백은 오류 경계를 지운다)', () => {
    expect(readFileSync(resolve(REPO_ROOT, 'bin', 'commitgate.mjs'), 'utf8')).not.toContain('mod.runCli ?? mod.main')
  })
})
