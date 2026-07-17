import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * publish payload 위생 **보조 가드** (REQ-2026-009).
 *
 * ⚠️ 이 테스트는 exit 판정의 정본이 아니다. 정본은 `npm pack --dry-run --json`이 반환하는
 *    실제 payload 파일 목록을 스캔하는 것이고, 그건 phase exit 증거로 별도 실행한다.
 *    여기서는 npm을 실행하지 않고 `package.json`의 `files` 집합을 온디스크로 해소해
 *    **전 플랫폼 CI에서 빠르고 결정적으로 회귀를 잡는다**(npm 캐시·네트워크 무의존).
 *
 * 목적: 공개 npm 패키지 소스에 무관한 사설 프로젝트의 이름·경로가 실리지 않게 한다.
 */
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** payload에 있어선 안 되는 문자열(대소문자 무시). REQ-2026-009 PM 지시 최소 집합. */
const FORBIDDEN = ['palm-kiosk', 'palm-kiosk-app', '../palm-kiosk', 'project-memory/ai-handoff.md'] as const

/** npm이 `files`와 무관하게 항상 포함하는 파일(대략) — 스캔 대상에 함께 넣는다. */
const ALWAYS_INCLUDED = ['package.json', 'README.md', 'README.en.md', 'LICENSE']

/**
 * 텍스트 여부는 **확장자가 아니라 내용**으로 판정한다(phase R1 P3).
 * 확장자 화이트리스트는 `req.config.json.sample`(.sample)·`LICENSE`(확장자 없음)처럼
 * payload에 실리는 텍스트 파일을 조용히 건너뛰어 가드에 구멍을 낸다.
 * NUL 바이트가 있으면 바이너리로 보고 스캔에서 제외한다.
 */
function readTextOrNull(abs: string): string | null {
  const buf = readFileSync(abs)
  if (buf.includes(0)) return null // 바이너리
  return buf.toString('utf8')
}

function walkFiles(abs: string): string[] {
  if (!existsSync(abs)) return []
  if (!statSync(abs).isDirectory()) return [abs]
  const out: string[] = []
  for (const entry of readdirSync(abs)) out.push(...walkFiles(join(abs, entry)))
  return out
}

/** package.json의 `files` + 항상 포함되는 파일 → 절대경로 목록. */
function payloadFiles(): string[] {
  const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')) as { files?: string[] }
  const entries = [...(pkg.files ?? []), ...ALWAYS_INCLUDED]
  const seen = new Set<string>()
  for (const e of entries) for (const f of walkFiles(join(PACKAGE_ROOT, e))) seen.add(f)
  return [...seen].sort()
}

describe('[payload] 공개 패키지에 사설 프로젝트 참조가 없다', () => {
  const files = payloadFiles()

  it('payload 파일 목록이 비어 있지 않다(스캔이 공회전하지 않음을 보장)', () => {
    // 가드가 빈 집합을 훑고 통과해버리는 위양성 방지.
    expect(files.length).toBeGreaterThan(10)
    expect(files.some((f) => f.endsWith('config.ts'))).toBe(true)
    expect(files.some((f) => f.endsWith('review-codex.ts'))).toBe(true)
    // phase R1 P3: 확장자 없는/비표준 확장자 텍스트 파일도 스캔 대상에 들어와야 한다.
    expect(files.some((f) => f.endsWith('LICENSE'))).toBe(true)
    expect(files.some((f) => f.endsWith('req.config.json.sample'))).toBe(true)
  })

  /**
   * REQ-2026-010 phase-1a — tarball 축(`files[]`) 가드.
   * 설치 축(`KIT_COPY_RELPATHS`)은 `init.test.ts`가 따로 지킨다. **두 축은 다르다**:
   * 하나만 갱신하면 tarball엔 있는데 대상 repo엔 안 깔리거나(또는 그 반대) 한다.
   */
  it('persona 파일이 tarball payload에 실린다', () => {
    const rels = files.map((f) => relative(PACKAGE_ROOT, f).replace(/\\/g, '/'))
    expect(rels).toContain('workflow/review-persona.md')
  })

  /**
   * REQ-2026-012 — kit gitignore는 **비-점 이름**으로 실려야 한다.
   * npm은 tarball에서 `.gitignore`라는 이름을 제외한다(files[]에 넣어도). 그래서 패키지엔
   * `templates/workflow.gitignore`로 두고 init이 `workflow/.gitignore`로 복사한다(설계 D5·D11).
   * 누가 이 파일을 `.gitignore` 이름으로 바꾸면 tarball에서 조용히 사라져 설치본이 규칙을 못 받는다.
   */
  it('kit gitignore가 비-점 이름으로 payload에 실린다', () => {
    const rels = files.map((f) => relative(PACKAGE_ROOT, f).replace(/\\/g, '/'))
    expect(rels).toContain('templates/workflow.gitignore')
    // 점으로 시작하는 basename은 npm이 제외할 수 있으므로 kit 파일명에 두지 않는다.
    expect(rels.some((r) => r.startsWith('templates/') && r.split('/').pop()?.startsWith('.'))).toBe(false)
  })

  /**
   * REQ-2026-013 P1 — `verify:overrides` npm 스크립트가 배포본에서 동작하려면 대상 `.mjs`가 payload에 있어야 한다.
   * `scripts/req`(디렉터리)만 files에 있으면 `scripts/verify-review-overrides.mjs`는 빠져 publish된 tarball에서 명령이 실패한다.
   */
  it('[REQ-2026-013] verify:overrides 스크립트가 payload에 실린다', () => {
    const rels = files.map((f) => relative(PACKAGE_ROOT, f).replace(/\\/g, '/'))
    expect(rels).toContain('scripts/verify-review-overrides.mjs')
  })

  it('열거된 payload 파일 중 텍스트는 전부 스캔된다(건너뛴 텍스트 0개)', () => {
    const skipped = files.filter((f) => readTextOrNull(f) === null)
    // 현재 payload는 전부 텍스트다. 바이너리가 생기면 여기서 드러난다.
    expect(skipped.map((f) => relative(PACKAGE_ROOT, f).replace(/\\/g, '/'))).toEqual([])
  })

  it.each(FORBIDDEN)('금지 문자열 "%s" 이 payload에 0건', (needle) => {
    const hits: string[] = []
    for (const abs of files) {
      const text = readTextOrNull(abs)
      if (text === null) continue // 바이너리
      text.split('\n').forEach((line, i) => {
        if (line.toLowerCase().includes(needle.toLowerCase()))
          hits.push(`${relative(PACKAGE_ROOT, abs).replace(/\\/g, '/')}:${i + 1}: ${line.trim()}`)
      })
    }
    expect(hits).toEqual([])
  })

  it('스캔이 실제로 파일을 읽는다(대조군 — 위양성 통과 방지)', () => {
    let control = 0
    for (const abs of files) {
      const text = readTextOrNull(abs)
      if (text !== null && text.toLowerCase().includes('handoffpath')) control++
    }
    expect(control).toBeGreaterThan(0)
  })

  it('DEFAULTS.handoffPath 기본값이 payload 소스에서 null이다', () => {
    const src = readFileSync(join(PACKAGE_ROOT, 'scripts', 'req', 'lib', 'config.ts'), 'utf8')
    expect(src).toMatch(/handoffPath:\s*null as string \| null/)
  })
})

// ───────────────────────────────────── REQ-2026-019 phase-1: companion skills 번들 ──

/** 번들 대상 4종. 디렉터리명 == frontmatter `name`(Agent Skills open standard). */
const COMPANION_SKILLS = ['commitgate-discovery', 'commitgate-tdd', 'commitgate-diagnosing-bugs', 'commitgate-research'] as const

/** 기준 upstream(설계 D8). 경로는 버전 간 이동하므로 **SHA가 식별자**다. */
const UPSTREAM_SHA = 'd574778f94cf620fcc8ce741584093bc650a61d3'

/**
 * upstream LICENSE **원문**(github.com/mattpocock/skills @ d574778 — 21줄).
 * 설계 D8·R9: MIT §2가 "copyright notice **and this permission notice**"를 모든 복제본에 요구하므로
 * 저작권 한 줄만으로는 미충족이다. **손으로 재작성한 변형본을 통과시키지 않기 위해** 전문 대조한다.
 */
const UPSTREAM_MIT = `MIT License

Copyright (c) 2026 Matt Pocock

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`

/** CRLF 체크아웃(Windows)에서도 문자열 대조가 성립하도록 정규화. */
function lf(s: string): string {
  return s.replace(/\r\n/g, '\n')
}

/** `---` 프론트매터 블록만 잘라낸다(YAML 파서 미도입 — leaf 파싱만 필요). */
function frontmatter(text: string): string | null {
  const t = lf(text)
  if (!t.startsWith('---\n')) return null
  const end = t.indexOf('\n---\n', 3)
  return end < 0 ? null : t.slice(4, end + 1)
}

function fmValue(fm: string, key: string): string | null {
  for (const line of fm.split('\n')) {
    const i = line.indexOf(':')
    if (i < 0) continue
    if (line.slice(0, i).trim() === key) return line.slice(i + 1).trim()
  }
  return null
}

describe('[REQ-2026-019] companion skills 번들(payload 축)', () => {
  const rels = payloadFiles().map((f) => relative(PACKAGE_ROOT, f).replace(/\\/g, '/'))

  /**
   * tarball 축. `files[]`에 `skills`가 없으면 tarball에서 통째로 빠지고, 설치기는
   * 패키지에서 `walkFiles` ENOENT로 죽는다(과거 P1 유형). 설치 축은 phase-2가 따로 지킨다.
   */
  it.each(COMPANION_SKILLS)('%s/SKILL.md 가 tarball payload에 실린다', (name) => {
    expect(rels).toContain(`skills/${name}/SKILL.md`)
  })

  it('ATTRIBUTION.md 가 tarball payload에 실린다', () => {
    expect(rels).toContain('skills/ATTRIBUTION.md')
  })

  /** npm은 dot-basename을 tarball에서 제외한다 — 조용히 사라지는 회귀 방지(templates/workflow.gitignore와 같은 이유). */
  it('skills/ 아래에 dot-prefix 파일명이 없다', () => {
    const dotted = rels.filter((r) => r.startsWith('skills/') && (r.split('/').pop() ?? '').startsWith('.'))
    expect(dotted).toEqual([])
  })

  describe.each(COMPANION_SKILLS)('%s', (name) => {
    const text = (): string => lf(readFileSync(join(PACKAGE_ROOT, 'skills', name, 'SKILL.md'), 'utf8'))

    /** R9 + MIT §2 회귀 고정점. 축약·의역은 여기서 죽는다. */
    it('MIT permission notice 전문이 원문 그대로 들어 있다', () => {
      expect(text()).toContain(UPSTREAM_MIT)
    })

    it('기준 upstream SHA가 명시돼 있다', () => {
      expect(text()).toContain(UPSTREAM_SHA)
    })

    /** Agent Skills open standard 준수 — Claude Code는 관대하지만 거기 기대면 API·claude.ai 이식성이 깨진다. */
    it('frontmatter가 open standard를 만족한다', () => {
      const fm = frontmatter(text())
      expect(fm).not.toBeNull()
      const nm = fmValue(fm as string, 'name')
      expect(nm).toBe(name) // 부모 디렉터리명과 일치
      expect(nm).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/) // 소문자+하이픈, 연속/양끝 하이픈 불가
      expect((nm as string).length).toBeLessThanOrEqual(64)
      const desc = fmValue(fm as string, 'description')
      expect(desc, 'description은 모델이 언제 쓸지 판단하는 유일한 근거다').toBeTruthy()
      expect((desc as string).length).toBeLessThanOrEqual(1024)
    })

    /** 권한 경계(R7)는 강제가 아니라 본문의 문장이다 — 그 문장이 실제로 있는지만 고정한다(설계 D10). */
    it('req:next 정본 원칙과 커밋 금지 경계를 본문에 담는다', () => {
      expect(text()).toContain('req:next')
      expect(text()).toMatch(/req:commit/)
    })
  })

  /**
   * discovery는 `req:new` **전에** 사용자가 부르는 front door다(설계 D8).
   * 나머지 3종은 모델 호출을 허용해야 상황에 맞게 뜬다 — 잘못 잠그면 기능이 죽는다.
   */
  it('discovery만 사용자 호출 전용(disable-model-invocation)이다', () => {
    for (const name of COMPANION_SKILLS) {
      const fm = frontmatter(lf(readFileSync(join(PACKAGE_ROOT, 'skills', name, 'SKILL.md'), 'utf8'))) as string
      const v = fmValue(fm, 'disable-model-invocation')
      if (name === 'commitgate-discovery') expect(v, `${name}: 사용자 호출형이어야 한다`).toBe('true')
      else expect(v, `${name}: 모델 호출을 막으면 안 된다`).toBeNull()
    }
  })

  it('ATTRIBUTION.md 가 upstream repo·SHA·MIT 전문을 담는다', () => {
    const t = lf(readFileSync(join(PACKAGE_ROOT, 'skills', 'ATTRIBUTION.md'), 'utf8'))
    expect(t).toContain('github.com/mattpocock/skills')
    expect(t).toContain(UPSTREAM_SHA)
    expect(t).toContain(UPSTREAM_MIT)
  })

  /**
   * R2 회귀 고정 — `npm install` 자체가 대상 프로젝트를 건드리면 안 된다.
   * 설치는 명시적 `commitgate init`에서만. 누가 postinstall을 추가하면 여기서 죽는다.
   */
  it('install 생명주기 훅이 없다(npm install이 대상을 수정하지 않는다)', () => {
    const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')) as { scripts?: Record<string, string> }
    const hooks = ['preinstall', 'install', 'postinstall', 'prepare', 'prepublish']
    expect(hooks.filter((h) => pkg.scripts?.[h] !== undefined)).toEqual([])
  })
})

/**
 * ───────────── D11 본문 가드 (R12) — REQ-2026-020 ─────────────
 *
 * 🔴 **Codex phase 리뷰는 이걸 못 잡는다.** 리뷰 축은 staged diff의 명세 정합성이지 **본문 의미의 계약 위반**이 아니다.
 * REQ-2026-019 phase-1은 findings 0으로 승인받고도 아래 4건을 전부 어겼다 — upstream 원문을 CommitGate
 * 권한 모델에 **적응하지 않고 옮겼기** 때문이다. 그래서 이 테스트가 유일한 방어선이다.
 *
 * ⚠️ 한계: 문자열 수준만 본다. 의미까지 보장하지 못한다 — `AGENTS.md`가 계약 정본이고 스킬은 협조적
 *    텍스트라는 사실은 그대로다(설계 D10). **과대 주장하지 않는다.**
 */
describe('[REQ-2026-020] D11 스킬 본문이 계약을 어기지 않는다', () => {
  const body = (name: string): string => lf(readFileSync(join(PACKAGE_ROOT, 'skills', name, 'SKILL.md'), 'utf8'))

  /**
   * 지시 본문만 — `## 출처·라이선스` 절은 뺀다.
   * 그 절은 **upstream과의 차이를 설명**하는 메타 텍스트라(예: "upstream의 '확인받아라'는 채택하지 않았다")
   * 지시로 오독하면 위양성이 난다. 라이선스 전문도 여기서 빠진다.
   */
  const instructions = (name: string): string => body(name).split('## 출처·라이선스')[0] as string
  /** AGENT형 3종 — `req:next`=AGENT 전제를 가진다. discovery는 pre-`req:new`라 예외(설계 D8). */
  const AGENT_SKILLS = ['commitgate-tdd', 'commitgate-diagnosing-bugs', 'commitgate-research'] as const

  /**
   * R12-a — CommitGate는 npm/pnpm/yarn을 지원한다. 본문이 `npm run …`을 단정하면 pnpm/yarn 사용자가 깨진다.
   * 대신 `02-plan.md`의 phase별 명령과 감지된 packageManager를 따르게 한다.
   */
  it.each(COMPANION_SKILLS)('%s: 본문에 npm run 하드코딩이 없다 (R12-a)', (name) => {
    const hits = body(name)
      .split('\n')
      .filter((l) => /\bnpm run\b/.test(l))
    expect(hits, 'pnpm/yarn 사용자를 깬다 — 02-plan.md와 감지된 packageManager를 참조하라').toEqual([])
  })

  /**
   * R12-c — 활성 REQ worktree에서 HEAD가 움직이면 REQ 상태와 staged 승인 바인딩(D9)이 깨진다.
   * `git bisect run` 유도가 019의 실제 결함이었다.
   */
  it.each(COMPANION_SKILLS)('%s: HEAD를 움직이는 명령을 유도하지 않는다 (R12-c)', (name) => {
    const hits = body(name)
      .split('\n')
      .filter((l) => /`git (bisect run|reset|checkout)/.test(l) && !/금지|하지 않는다|말라|말 것/.test(l))
    expect(hits, '활성 worktree에서 HEAD 이동 = REQ 상태·승인 바인딩 파괴').toEqual([])
  })

  /** R12-c 대조군 — 진단 스킬은 부재가 아니라 **명시적 금지**를 담아야 한다. */
  it('commitgate-diagnosing-bugs: 활성 worktree HEAD 이동 금지를 명시한다 (R12-c)', () => {
    const t = body('commitgate-diagnosing-bugs')
    expect(t).toMatch(/bisect/)
    expect(t, '금지 문구 없이 그냥 빠진 것과 명시적 금지는 다르다').toMatch(/(금지|하지 않는다)/)
  })

  /**
   * R12-b — `AGENT` 단계에 계약에 없는 사람 승인 지점을 만들지 않는다.
   * 019의 `commitgate-tdd`가 "seam을 확인받기 전엔 테스트 금지"로 숨은 게이트를 넣었다.
   * 승인된 01/02 범위 안의 판단은 에이전트가 한다 — 범위 변경 시에만 보고(이미 계약의 보고 사유).
   */
  it.each(AGENT_SKILLS)('%s: AGENT 단계에 숨은 사람 승인 지점을 만들지 않는다 (R12-b)', (name) => {
    // 승인 요구가 **정당한** 경우: 승인된 범위를 벗어나는 행위(별도 worktree·설계 변경·재승인).
    // 그건 이미 계약의 보고 사유다. 금지 대상은 **정상 경로 행위**에 승인을 거는 것(019의 "seam을 확인받기 전엔 테스트 금지").
    const legitimate = /범위|별도|재승인|승인 없이|승인받지|보고/
    const hits = instructions(name)
      .split('\n')
      .filter((l) => /(확인받|승인받|확인을 받|승인을 받)/.test(l) && !legitimate.test(l))
    expect(hits, 'AGENT 단계의 새 사람 게이트는 계약 위반 — 범위를 벗어날 때만 보고하라').toEqual([])
  })

  /** R12-b 대조군 — 승인된 설계·계획을 실제로 가리켜야 한다(그게 seam 결정의 근거다). */
  it('commitgate-tdd: 승인된 설계·계획을 seam 근거로 가리킨다 (R12-b)', () => {
    expect(body('commitgate-tdd')).toMatch(/02-plan\.md/)
  })

  /**
   * R12-d — `/req`는 Claude Code 전용 command다. 다른 harness에서는 존재하지 않는다.
   * harness 지원을 정직하게 표기하기로 해 놓고(설계 D1) 본문에서 단정하면 모순이다.
   */
  it('commitgate-discovery: 진입 흐름을 harness로 분기한다 (R12-d)', () => {
    const t = body('commitgate-discovery')
    const lines = t.split('\n')
    // `/req`를 언급하는 줄은 **어느 harness의 것인지 함께** 밝혀야 한다.
    // ⚠️ "본문에 /req와 AGENTS.md가 둘 다 있다"로는 부족하다 — REQ-019 본문이 정확히 그 상태로
    //    `/req`를 무조건 단정하면서(54행) AGENTS.md는 전혀 다른 목적으로 언급했고(57행), 이 가드를 통과했다.
    // ⚠️ 문서는 command를 백틱으로 감싼다(`/req`). 앞 문자를 제한하면 백틱 표기를 통째로 놓친다.
    //    `scripts/req/…` 같은 경로는 slash command가 아니므로 제외한다.
    const reqCmdLines = lines.filter((l) => /\/req\b/.test(l) && !/scripts\/req/.test(l))
    expect(reqCmdLines.length, '`/req` 경로 안내가 있어야 한다').toBeGreaterThan(0)
    // `/req`를 언급하는 모든 줄은 harness 맥락 안에 있어야 한다 — 소속 harness를 밝히거나(Claude Code),
    // 다른 harness엔 없다는 분기이거나(그 외/없다/AGENTS.md). 맥락 없이 단정하는 줄이 019의 결함이었다.
    const contextual = /Claude Code|그 외|없다|AGENTS\.md/
    const bare = reqCmdLines.filter((l) => !contextual.test(l))
    expect(bare, '`/req`는 Claude Code 전용 command다 — 맥락 없이 단정하면 다른 harness 사용자에게 없는 명령을 지시하게 된다').toEqual([])
    // 분기가 성립하려면 **양쪽**이 다 있어야 한다: Claude Code 경로 + 그 외 harness의 대체 경로.
    expect(reqCmdLines.some((l) => /Claude Code/.test(l)), 'Claude Code 경로가 명시돼야 한다').toBe(true)
    expect(t, '그 외 harness는 AGENTS.md의 진입 흐름을 따른다').toContain('AGENTS.md')
  })

  /**
   * 설계 D8 예외 — discovery는 `req:new` **전** front door다. 공통 전제(`req:next`=AGENT일 때만 유효)를
   * 담으면 fresh 프로젝트에서 REQ가 없어 AGENT가 나올 수 없고 → 본문이 복귀를 지시 → **REQ Brief를
   * 영원히 못 만든다**(design-r01 P1).
   */
  it('commitgate-discovery: AGENT 전제를 담지 않는다 — pre-req:new 진입이 막히면 안 된다 (D8 예외)', () => {
    const t = body('commitgate-discovery')
    expect(t, 'req:new 전 단계임을 명시해야 한다').toMatch(/req:new/)
    expect(t, 'REQ Brief가 산출물').toMatch(/Brief/)
    const gated = t.split('\n').filter((l) => /AGENT.*(일 때만|only)/.test(l))
    expect(gated, 'AGENT 전제를 담으면 fresh 프로젝트에서 진입 불가').toEqual([])
  })

  /** 위 테스트의 대조군 — AGENT형 3종은 실제로 전제를 담는다(가드가 공회전하지 않음을 보장). */
  it.each(AGENT_SKILLS)('%s: req:next=AGENT 전제를 담는다 (대조군)', (name) => {
    expect(body(name)).toMatch(/AGENT/)
  })
})

// ───────────── D12 진단 안전 경계 (R12-e/f/g) — REQ-2026-020 phase-1b ─────────────

/** 금지·부정 문맥이면 지시가 아니라 경계 서술이다. */
const PROHIBITION = /금지|하지 않는다|않는다|말라|말 것|불가|없이/

/**
 * 승인 요구가 **정당한** 문맥인가 — D12(3)으로 한정한다.
 *
 * ⚠️ phase-1의 R12-b 허용 목록(`/범위|별도|재승인|승인 없이|승인받지|보고/`)은 **`별도` 한 단어로 통과**한다 →
 *    "깨끗한 baseline이 있어도 승인받고 **별도** 사본에서 수행" 같은 게이트가 살아남는다(design-r04 P1).
 *    그래서 `별도`·`보고` 같은 약한 신호를 근거에서 빼고 **경계 위반 사유**만 남긴다.
 */
export function isLegitimateApprovalContext(line: string): boolean {
  return /baseline이 없|baseline 부재|깨끗한 승인 baseline이 아니|미승인 (변경을 )?커밋|설계|계획|비목표|재승인|범위 변경|범위를 벗어/.test(line)
}

/** D12(2) 무게이트 경로를 어기는 승인 게이트 문장들. */
export function approvalGateHits(text: string): string[] {
  return text
    .split('\n')
    .filter((l) => /(승인받|확인받|승인을 받|확인을 받)/.test(l) && !PROHIBITION.test(l) && !isLegitimateApprovalContext(l))
}

/** D12(1) 절대 금지 — 진단·조사를 위해 미승인 변경을 stage/commit하라는 유도. */
export function diagnosisCommitHits(text: string): string[] {
  return text
    .split('\n')
    .filter((l) => /(stage\/commit|stage하|스테이징하|commit해|커밋해|commit하|커밋하)/.test(l) && !PROHIBITION.test(l))
}

describe('[REQ-2026-020] D12 진단 스킬 안전 경계', () => {
  const body = (name: string): string => lf(readFileSync(join(PACKAGE_ROOT, 'skills', name, 'SKILL.md'), 'utf8'))
  const instructions = (name: string): string => body(name).split('## 출처·라이선스')[0] as string
  /** 조사 성격 스킬 — 진단·조사를 위해 미승인 변경을 만지면 안 된다. */
  const INVESTIGATION = ['commitgate-diagnosing-bugs', 'commitgate-research', 'commitgate-discovery'] as const

  /**
   * R12-e — phase-1이 실제로 어긴 축. 본문이 *"현재 작업을 stage/commit해 안전하게 만든 뒤"* 라고 유도해
   * **미승인 REQ 변경을 커밋시켜 리뷰 게이트를 우회**시켰다. phase-1의 D11 가드는 이 축이 없어 놓쳤다.
   */
  it.each(INVESTIGATION)('%s: 진단·조사를 위해 stage/commit하라고 유도하지 않는다 (R12-e)', (name) => {
    expect(diagnosisCommitHits(instructions(name)), '진단은 커밋 사유가 아니다 — 승인 없는 커밋은 리뷰 게이트 우회다').toEqual([])
  })

  /**
   * R12-e 대조군 — **정상 TDD의 stage는 잡히면 안 된다.** phase 산출물을 `git add`하는 건 `req:next`=AGENT의
   * 정상 경로다. 가드가 그것까지 잡으면 과잉이고, 가드를 못 쓰게 된다.
   */
  it('commitgate-tdd의 정상 stage 안내는 잡히지 않는다 (R12-e 과잉 방지 대조군)', () => {
    expect(instructions('commitgate-tdd'), 'tdd는 실제로 stage를 안내한다 — 대조군이 공회전하지 않음을 보장').toMatch(/stage/)
    expect(diagnosisCommitHits(instructions('commitgate-tdd'))).toEqual([])
  })

  /** R12-e 음성 대조군 — 실제 위반 문장은 반드시 잡힌다(가드가 살아 있음을 fixture로 증명). */
  it('R12-e 가드가 실제 위반 문장을 잡는다 (fixture)', () => {
    const violation = '현재 작업을 stage/commit해 안전하게 만든 뒤 별도 worktree나 사본에서 수행한다.'
    expect(diagnosisCommitHits(violation), 'phase-1이 실제로 담았던 문장 — 반드시 Red여야 한다').toHaveLength(1)
  })

  /**
   * R12-f — D12(2)의 무게이트 경로를 어기는 승인 게이트가 남아 있으면 실패.
   * "bisect가 필요해서" 멈추는 것은 범위 변경이 아니므로 R12-b 위반이다(design-r03 P1).
   */
  it('commitgate-diagnosing-bugs: 범위 내 진단에 사람 승인 게이트가 없다 (R12-f)', () => {
    expect(approvalGateHits(instructions('commitgate-diagnosing-bugs')), '멈춤 사유는 "bisect 필요"가 아니라 "경계 위반"이어야 한다').toEqual([])
  })

  /** R12-f 음성 대조군 — "깨끗한 baseline인데도 승인받으라"는 문장은 반드시 잡힌다(design-r04 P1의 회귀 고정). */
  it('R12-f 가드가 "깨끗한 baseline인데도 승인" 문장을 잡는다 (fixture)', () => {
    const gate = '깨끗한 승인 baseline이 있어도 bisect 전에 사람에게 승인받고 별도 사본에서 수행한다.'
    expect(approvalGateHits(gate), '`별도` 한 단어로 통과하면 안 된다 — design-r04 P1').toHaveLength(1)
  })

  /** R12-f 양성 대조군 — 정당한 승인 문맥(baseline 부재·설계 변경)은 잡히면 안 된다. */
  it('R12-f 가드가 정당한 승인 문맥은 잡지 않는다 (fixture)', () => {
    expect(approvalGateHits('복제할 깨끗한 승인 baseline이 없어 미승인 변경을 커밋해야 하면 사람에게 보고해 승인받는다.')).toEqual([])
    expect(approvalGateHits('진단 결과가 설계·비목표를 바꿔야 하면 재승인을 받는다.')).toEqual([])
  })

  /**
   * R12-g — 무게이트 경로가 **실제로 본문에 존재**해야 한다.
   * ⚠️ 없으면 R12-f가 "승인 문구가 없다"는 이유로 **공허하게 통과**한다(경로 자체가 없어도 그린).
   */
  it('commitgate-diagnosing-bugs: 승인 없이 disposable clone에서 조사하는 경로를 명시한다 (R12-g)', () => {
    const t = instructions('commitgate-diagnosing-bugs')
    const noGate = t.split('\n').filter((l) => /(승인 없이|게이트 없)/.test(l) && /(clone|사본|복제)/.test(l))
    expect(noGate.length, 'D12(2) 무게이트 경로가 본문에 없으면 R12-f는 공허하게 통과한다').toBeGreaterThan(0)
  })

  /** D12(1) 절대 금지가 본문에 명시된다 — 부재가 아니라 명시적 금지. */
  it('commitgate-diagnosing-bugs: 활성 worktree HEAD 이동과 진단용 커밋을 명시적으로 금지한다 (D12-1)', () => {
    const t = instructions('commitgate-diagnosing-bugs')
    expect(t).toMatch(/bisect/)
    expect(t, 'HEAD 이동 금지').toMatch(/(HEAD를 움직이지|HEAD 이동).*(금지|마라)|(금지|마라).*(HEAD)/)
    expect(t, '진단용 커밋 금지 — 사람이 승인해도 불가').toMatch(/(진단|조사).*(커밋|commit).*(금지|아니다)/)
  })
})
