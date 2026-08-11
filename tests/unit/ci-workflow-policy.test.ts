import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runIntegrate } from '../../bin/integrate'
import { decideCiRun } from '../../scripts/req/lib/merge-gate'
import { createFakeCiRunPort } from '../../scripts/req/lib/github-ci-run'
import { HEAD, makeDeps, runInfo, integrateOpts as opts, type FakeDeps } from '../support/integrate-fakes'

/**
 * **GitHub CI 기본 미실행 정책의 정본 가드** — 0.22.0 RC 보완.
 *
 * 확정 정책: *평소 CI 0회, 사람이 지시할 때만 1회.* GitHub Actions 사용량·한도가 실제 비용이므로
 * push·tag·PR로 CI가 자동으로 도는 구조는 정책 위반이다. 이 파일은 두 축을 함께 잠근다:
 *
 *  1. **워크플로 파일의 트리거 계약** — `.github/workflows/ci.yml`이 수동 실행 전용인가
 *  2. **명령의 결정 행렬** — 어떤 입력에서 dispatch가 나가고 어떤 입력에서 나가지 않는가
 *
 * 🔴 실제 `gh`·GitHub API·Actions를 호출하지 않는다. dispatch 관측은 fake 포트의 호출 기록으로 한다.
 */

const ROOT = join(__dirname, '..', '..')
const CI_YML_REL = join('.github', 'workflows', 'ci.yml')
const ciYml = (): string => readFileSync(join(ROOT, CI_YML_REL), 'utf8')

/** `on:` 블록만 잘라낸다 — 주석·jobs 본문의 단어가 트리거로 오독되지 않게 한다. */
function onBlock(yml: string): string {
  const lines = yml.split(/\r?\n/)
  const start = lines.findIndex((l) => /^on:/.test(l))
  expect(start, 'ci.yml 에 최상위 `on:` 블록이 없습니다').toBeGreaterThanOrEqual(0)
  const out: string[] = []
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break // 다음 최상위 키 → on 블록 끝
    if (line.trim().startsWith('#')) continue
    out.push(line)
  }
  return out.join('\n')
}

describe('ci.yml 트리거 계약 — 수동 실행 전용', () => {
  it('workflow_dispatch가 있다', () => {
    expect(onBlock(ciYml())).toMatch(/^\s+workflow_dispatch:/m)
  })

  it('push 자동 트리거가 없다', () => {
    expect(onBlock(ciYml())).not.toMatch(/^\s+push:/m)
  })

  it('pull_request 자동 트리거가 없다', () => {
    const block = onBlock(ciYml())
    expect(block).not.toMatch(/^\s+pull_request:/m)
    expect(block).not.toMatch(/^\s+pull_request_target:/m)
  })

  it('tag push 자동 트리거가 없다', () => {
    const block = onBlock(ciYml())
    expect(block).not.toMatch(/tags:/)
    expect(block).not.toMatch(/refs\/tags/)
  })

  it('그 밖의 자동 트리거(schedule·release·merge_group 등)도 없다', () => {
    const block = onBlock(ciYml())
    for (const t of ['schedule', 'release', 'merge_group', 'repository_dispatch', 'issue_comment', 'create', 'watch'])
      expect(block, `자동 트리거 ${t} 가 다시 들어왔습니다`).not.toMatch(new RegExp(`^\\s+${t}:`, 'm'))
  })

  it('on 블록의 트리거는 workflow_dispatch 하나뿐이다(화이트리스트 — 새 트리거는 red)', () => {
    const keys = onBlock(ciYml())
      .split('\n')
      .map((l) => /^\s{2}(\w+):/.exec(l)?.[1])
      .filter((k): k is string => k !== undefined)
    expect(keys).toEqual(['workflow_dispatch'])
  })

  it('수동 실행 시의 검증 내용(3 OS × 3 Node)은 유지된다', () => {
    const yml = ciYml()
    expect(yml).toContain('ubuntu-latest')
    expect(yml).toContain('macos-latest')
    expect(yml).toContain('windows-latest')
    expect(yml).toMatch(/node:\s*\[20,\s*22,\s*24\]/)
    for (const step of ['npm ci', 'npm run typecheck', 'npm test', 'npm run smoke']) expect(yml).toContain(step)
  })

  it('명시 요청한 실행은 취소되지 않는다(cancel-in-progress: false)', () => {
    expect(ciYml()).toMatch(/cancel-in-progress:\s*false/)
  })
})

describe('CI 설정은 사용자 소유 opt-in이다 — 소비자에게 강제되지 않는다', () => {
  it('req.config.json.sample 에 githubCi가 없다(sync/init이 심지 않는다)', () => {
    const sample = JSON.parse(readFileSync(join(ROOT, 'req.config.json.sample'), 'utf8')) as Record<string, unknown>
    expect(sample.githubCi).toBeUndefined()
  })

  it('이 저장소(own repo)에는 githubCi가 있어 대화형 질문·명시 실행이 가능하다', () => {
    const cfg = JSON.parse(readFileSync(join(ROOT, 'req.config.json'), 'utf8')) as {
      githubCi?: { workflow?: string; timeoutMinutes?: number }
    }
    expect(cfg.githubCi).toEqual({ workflow: 'ci.yml', timeoutMinutes: 30 })
  })
})

describe('decideCiRun — 순수 결정 행렬(기본은 언제나 skip)', () => {
  const cases: { label: string; flag: boolean | null; configured: boolean; interactive: boolean; want: string }[] = [
    { label: '미지정·config 없음·비대화형', flag: null, configured: false, interactive: false, want: 'skip' },
    { label: '미지정·config 없음·대화형 → 질문조차 없다', flag: null, configured: false, interactive: true, want: 'skip' },
    { label: '미지정·config 있음·비대화형 → 묻지 못하므로 skip', flag: null, configured: true, interactive: false, want: 'skip' },
    { label: '미지정·config 있음·대화형 → 질문', flag: null, configured: true, interactive: true, want: 'ask' },
    { label: '--no-github-ci → 항상 skip', flag: false, configured: true, interactive: true, want: 'skip' },
    { label: '--run-github-ci + config → run', flag: true, configured: true, interactive: false, want: 'run' },
    { label: '--run-github-ci + config 없음 → fail(추측 금지)', flag: true, configured: false, interactive: false, want: 'fail-no-config' },
  ]
  for (const c of cases) {
    it(`${c.label} → ${c.want}`, () => {
      expect(decideCiRun({ flag: c.flag, configured: c.configured, interactive: c.interactive })).toBe(c.want)
    })
  }
})

/**
 * end-to-end 관측: **fake 포트가 한 번이라도 호출됐는가**로 잰다.
 * 순수 결정 함수만 보면 배선이 끊겨도 통과한다 — 이 저장소가 여러 번 겪은 실패 방식이다.
 */
describe('integrate 실행 경로 — dispatch가 실제로 나가는지 관측', () => {
  function scenario(over: Parameters<typeof makeDeps>[0] & { answers?: string[] } = {}) {
    const answers = over.answers ?? []
    const asked: string[] = []
    const port = createFakeCiRunPort({ remoteSha: HEAD, runStates: [runInfo()] })
    const deps: FakeDeps = makeDeps({
      ...over,
      ciPort: port,
      ask: async (q) => {
        asked.push(q)
        return answers.shift() ?? ''
      },
    })
    return { deps, port, asked, dispatches: () => port.calls.filter((c) => c.method === 'dispatch').length }
  }

  const CONFIG = { workflow: 'ci.yml', timeoutMinutes: 30 }

  it('대화형 + config + Enter(빈 문자열) → CI 미호출', async () => {
    // 질문 2개: CI 실행 [y/N] → Enter, 최종 확인 [y/N] → Enter
    const s = scenario({ interactive: true, githubCi: CONFIG, answers: ['', ''] })
    await runIntegrate(opts({ run: true }), s.deps)
    expect(s.asked[0]).toContain('[y/N]')
    expect(s.dispatches()).toBe(0)
    expect(s.port.calls).toHaveLength(0) // 원격 조회조차 하지 않는다
  })

  it('대화형 + config + n → CI 미호출', async () => {
    const s = scenario({ interactive: true, githubCi: CONFIG, answers: ['n', 'y'] })
    await runIntegrate(opts({ run: true }), s.deps)
    expect(s.dispatches()).toBe(0)
  })

  it('대화형 + config + y → fake dispatch 정확히 1회', async () => {
    const s = scenario({ interactive: true, githubCi: CONFIG, answers: ['y', 'y'] })
    const r = await runIntegrate(opts({ run: true }), s.deps)
    expect(s.dispatches()).toBe(1)
    expect(r.merged).toBe(true)
  })

  it('config 없음(대화형) → 질문도 dispatch도 없다', async () => {
    const s = scenario({ interactive: true, githubCi: null, answers: ['y'] })
    await runIntegrate(opts({ run: true }), s.deps)
    expect(s.asked.some((q) => q.includes('GitHub CI'))).toBe(false)
    expect(s.dispatches()).toBe(0)
  })

  it('비대화형 --run 만 → dispatch 없음(config 유무와 무관)', async () => {
    for (const githubCi of [null, CONFIG]) {
      const s = scenario({ interactive: false, githubCi })
      await runIntegrate(opts({ run: true }), s.deps)
      expect(s.asked).toHaveLength(0)
      expect(s.dispatches()).toBe(0)
    }
  })

  it('비대화형 --run --run-github-ci → config가 있을 때만 dispatch', async () => {
    const withCfg = scenario({ interactive: false, githubCi: CONFIG })
    await runIntegrate(opts({ run: true, runGithubCi: true }), withCfg.deps)
    expect(withCfg.dispatches()).toBe(1)

    const noCfg = scenario({ interactive: false, githubCi: null })
    const r = await runIntegrate(opts({ run: true, runGithubCi: true }), noCfg.deps)
    expect(noCfg.dispatches()).toBe(0)
    expect(r.exit).toBe(1) // 추측하지 않고 실패한다
  })

  it('--no-github-ci → 질문·dispatch 모두 없다(대화형이어도)', async () => {
    const s = scenario({ interactive: true, githubCi: CONFIG, answers: ['y', 'y'] })
    await runIntegrate(opts({ run: true, runGithubCi: false }), s.deps)
    expect(s.asked.some((q) => q.includes('GitHub CI'))).toBe(false)
    expect(s.dispatches()).toBe(0)
  })

  it('dry-run(기본)은 CI 결정 단계에 도달조차 하지 않는다', async () => {
    const s = scenario({ interactive: true, githubCi: CONFIG, answers: ['y', 'y'] })
    await runIntegrate(opts(), s.deps)
    expect(s.asked).toHaveLength(0)
    expect(s.dispatches()).toBe(0)
  })
})
