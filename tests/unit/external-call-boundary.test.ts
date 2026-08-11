import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/**
 * **외부 호출 경계 메타 테스트** — 0.22.0 RC 보완.
 *
 * ## 이 테스트가 보장하는 것 (그리고 보장하지 않는 것)
 *
 * `COMMITGATE_TEST` kill switch(`assertNotTestEnv`)는 **현재 알려진** production 외부 호출 경로
 * (codex · gh · `git ls-remote` · `fetch`)를 테스트에서 즉시 실패시킨다. 그것은 보편적 샌드박스가
 * **아니다** — 새 모듈이 새 방식으로 밖에 나가면 kill switch는 그것을 모른다.
 *
 * 🔴 그래서 이 파일은 **경계 자체를 고정**한다: 프로세스를 띄우거나 네트워크로 나가는 production
 *    파일의 목록을 손으로 유지하고, 목록 밖에서 그런 코드가 생기면 red다. 즉 보장은
 *    "모든 미래 호출을 막는다"가 아니라 **"새 호출 경로가 조용히 생기지 않는다"**이다.
 *
 * 🔴 **로컬 git은 막지 않는다.** 로컬 `git`은 이 도구의 정상 동작이고 과금·원격 효과가 없다.
 *    경계를 긋는 축은 (a) 프로세스 스폰 자체, (b) **원격·과금** 대상(gh·codex·ls-remote·fetch)
 *    두 가지이며, 후자만 kill switch 대상이다.
 */

const ROOT = join(__dirname, '..', '..')

/** production 소스 = bin/ + scripts/ (tests/ 제외). */
function productionFiles(): string[] {
  const out: string[] = []
  for (const dir of ['bin', 'scripts']) {
    for (const entry of readdirSync(join(ROOT, dir), { recursive: true })) {
      const rel = join(dir, String(entry))
      if (/\.(ts|mts|mjs|cjs|js)$/.test(rel) && !rel.endsWith('.d.mts')) out.push(rel)
    }
  }
  return out.map((p) => p.split(sep).join('/')).sort()
}

const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8')

/**
 * **프로세스를 스폰하는 production 파일**의 정본 목록.
 *
 * 여기 없는 파일이 `node:child_process` 또는 `cross-spawn`을 import하면 이 테스트가 실패한다.
 * 추가할 때는 **왜 그 파일이 직접 스폰해야 하는지**를 함께 적는다 — 대부분은 `adapters.ts`의
 * `safeSpawnSync`를 쓰는 것이 옳다.
 */
const SPAWNING_FILES: Record<string, string> = {
  'scripts/req/lib/adapters.ts': '안전 spawn 경계 자체(shell 없는 cross-spawn 단일 경로) + kill switch가 사는 곳',
  'scripts/req/lib/git-batch.ts': 'cat-file --batch 스트리밍 — safeSpawnSync의 1회 왕복 모델로는 표현되지 않는 로컬 git 배치',
  'scripts/req/lib/evidence-ports.ts': '로컬 git 증거 조회(execFileSync) — 원격 효과 없음',
  'bin/init.ts': '대상 저장소의 패키지 매니저·git 실행(설치 절차) — 로컬',
  'scripts/smoke.mjs': '릴리스 smoke 도구(배포 tarball을 임시 디렉터리에 실제 설치) — 개발 도구',
  'scripts/verify-review-overrides.mjs': '🔴 실제 codex를 호출하는 **수동** 검증 도구 — npm test에 배선되지 않는다',
}

/**
 * **원격·과금 표면**의 정본 목록. 이 파일들만 gh·codex·ls-remote·fetch를 다룰 수 있고,
 * 다루는 순간 `assertNotTestEnv`로 kill switch에 묶여 있어야 한다.
 */
const REMOTE_SURFACES: Record<string, string> = {
  'scripts/req/lib/adapters.ts': 'codex 리뷰어 어댑터 + assertNotTestEnv 정의',
  'scripts/req/lib/github-ci-run.ts': 'gh workflow_dispatch·run 조회 + git ls-remote(원격 SHA 대조)',
  'bin/verify-range.ts': 'gh check-runs 조회(1회, 실행 아님)',
  'scripts/verify-review-overrides.mjs': '실제 codex를 호출하는 수동 도구 — .mjs라 adapters를 import할 수 없어 COMMITGATE_TEST를 직접 본다',
}

/**
 * kill switch에 묶였다고 인정하는 표지. `.ts`는 `assertNotTestEnv`를, `.mjs` 독립 스크립트는
 * 같은 env 변수를 직접 본다 — **묶임의 실체는 env 변수**이지 함수 이름이 아니다.
 */
const KILL_SWITCH_MARKERS = ['assertNotTestEnv', 'COMMITGATE_TEST'] as const

/** 원격·과금 신호. 로컬 git은 **의도적으로 빠져 있다**. */
const REMOTE_SIGNALS: { label: string; re: RegExp }[] = [
  { label: 'gh CLI', re: /(['"`])gh\1\s*,/ },
  { label: 'codex CLI', re: /(['"`])codex\1\s*,/ },
  { label: 'git ls-remote', re: /['"`]ls-remote['"`]/ },
  { label: 'fetch()', re: /(?<![.\w])fetch\s*\(/ },
]

describe('프로세스 스폰 경계 — 목록 밖에서 새 spawn 경로가 생기지 않는다', () => {
  const found = productionFiles().filter((f) => /from '(node:)?child_process'|from 'cross-spawn'/.test(read(f)))

  it('스폰하는 production 파일 집합이 allowlist와 정확히 일치한다', () => {
    expect(found.sort()).toEqual(Object.keys(SPAWNING_FILES).sort())
  })

  it('allowlist의 모든 항목이 실재한다(죽은 항목이 목록을 부풀리지 않는다)', () => {
    for (const f of Object.keys(SPAWNING_FILES)) expect(() => read(f), `${f} 가 없습니다`).not.toThrow()
  })

  it('allowlist의 모든 항목에 사유가 적혀 있다', () => {
    for (const [f, why] of Object.entries(SPAWNING_FILES)) expect(why.length, `${f} 사유 없음`).toBeGreaterThan(10)
  })
})

describe('원격·과금 표면 — gh/codex/원격 git/네트워크는 guarded adapter 안에만 있다', () => {
  const hits = productionFiles()
    .map((f) => ({ f, signals: REMOTE_SIGNALS.filter((s) => s.re.test(read(f))).map((s) => s.label) }))
    .filter((x) => x.signals.length > 0)

  it('원격 신호를 담은 production 파일 집합이 allowlist와 정확히 일치한다', () => {
    // 🔴 여기가 red면: 새 gh/네트워크 경로가 guarded adapter 밖에 생겼거나, 기존 경로가 옮겨졌다.
    //    옮긴 것이라면 allowlist를 갱신하고, 새로 만든 것이라면 assertNotTestEnv로 묶어라.
    expect(hits.map((h) => h.f).sort()).toEqual(Object.keys(REMOTE_SURFACES).sort())
  })

  it('원격 표면은 전부 assertNotTestEnv 로 kill switch에 묶여 있다', () => {
    for (const { f, signals } of hits)
      expect(
        KILL_SWITCH_MARKERS.some((m) => read(f).includes(m)),
        `${f} (${signals.join(', ')}) 가 kill switch에 묶여 있지 않습니다`,
      ).toBe(true)
  })

  it('로컬 git은 경계 밖이 아니다 — 신호 목록에 포함되지 않는다(정상 동작 차단 금지)', () => {
    const localGitOnly = "spawn('git', ['status'], {})"
    expect(REMOTE_SIGNALS.filter((s) => s.re.test(localGitOnly))).toEqual([])
  })

  it('신호 정규식이 실제로 발화한다(변이 검사 — 죽은 가드 방지)', () => {
    const samples: Record<string, string> = {
      'gh CLI': "spawn('gh', ['api', 'x'], {})",
      'codex CLI': "spawn('codex', args, {})",
      'git ls-remote': "spawn('git', ['ls-remote', 'origin'], {})",
      'fetch()': 'await fetch(url)',
    }
    for (const [label, sample] of Object.entries(samples)) {
      const sig = REMOTE_SIGNALS.find((s) => s.label === label)
      expect(sig, `${label} 신호가 목록에서 사라졌습니다`).toBeDefined()
      expect(sig?.re.test(sample), `${label} 정규식이 샘플을 못 잡습니다`).toBe(true)
    }
  })
})

describe('kill switch의 범위를 정확히 서술한다', () => {
  it('assertNotTestEnv는 adapters.ts 한 곳에만 정의된다(사본 금지)', () => {
    const definers = productionFiles().filter((f) => /export function assertNotTestEnv/.test(read(f)))
    expect(definers).toEqual(['scripts/req/lib/adapters.ts'])
  })

  it('CHANGELOG는 "모든 외부 호출 차단"이 아니라 알려진 경로 차단으로 서술한다', () => {
    const changelog = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8')
    const section = changelog.slice(0, changelog.indexOf('## 0.21.0'))
    // 과장 표현이 들어오면 red. (등재된 폐기 주장과 달리 이건 이 릴리스 섹션 한정 검사다.)
    for (const overclaim of ['모든 외부 호출을 차단', '어떤 외부 호출도 불가능', '완전한 샌드박스'])
      expect(section, `CHANGELOG 0.22.0 섹션의 과장 표현: ${overclaim}`).not.toContain(overclaim)
  })
})

describe('메타 테스트 자신이 production 파일을 실제로 훑는지', () => {
  it('production 파일 수집이 비어 있지 않고 tests/를 포함하지 않는다', () => {
    const files = productionFiles()
    expect(files.length).toBeGreaterThan(20)
    expect(files.some((f) => f.startsWith('tests/'))).toBe(false)
    expect(files).toContain('scripts/req/lib/adapters.ts')
    expect(files).toContain('bin/integrate.ts')
    // 상대 경로 정규화가 깨지면(Windows sep) 위 단언이 먼저 red다.
    expect(relative(ROOT, join(ROOT, 'bin', 'integrate.ts')).split(sep).join('/')).toBe('bin/integrate.ts')
  })
})
