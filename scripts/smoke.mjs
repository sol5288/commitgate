#!/usr/bin/env node
/**
 * pack tarball 기반 설치 smoke (CI/로컬 공용).
 *
 * ⚠️ 로컬 소스(`node bin/commitgate.mjs`)가 아니라 **`npm pack` tarball을 임시 repo에 설치해 그 bin을 실행**한다.
 *    → 실제 배포 아티팩트(`bin` 해소·`files` whitelist·deps 설치)를 검증. (REQ-2026-002 #2)
 *
 * 흐름: npm pack → 임시 target(git init·npm init) → `npm i -D <tgz>` → `npx commitgate --dry-run`
 *      → 실제 init → **Stage B 증명(REQ-2026-014)** → `npm run req:doctor` dispatch 도달 증명 → uninstall planner.
 * 크로스플랫폼: cross-spawn으로 npm/git/npx(.cmd)를 shell 없이 안전 실행(Windows 러너 호환).
 */
import spawn from 'cross-spawn'
import { mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { VERB_MODULES } from '../bin/dispatch.mjs'

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** companion skills 설치 경로(REQ-2026-020 D1 · REQ-2026-044 +quality). 정확히 5종. */
const COMPANION_SKILL_RELS = [
  '.claude/skills/commitgate-discovery/SKILL.md',
  '.claude/skills/commitgate-tdd/SKILL.md',
  '.claude/skills/commitgate-diagnosing-bugs/SKILL.md',
  '.claude/skills/commitgate-research/SKILL.md',
  '.claude/skills/commitgate-quality/SKILL.md',
]

/** 기준 upstream(REQ-2026-020 D8). 경로는 버전 간 이동하므로 **SHA 가 식별자**다. */
const UPSTREAM_SHA = 'd574778f94cf620fcc8ce741584093bc650a61d3'

/**
 * upstream LICENSE **전문**(github.com/mattpocock/skills @ d574778 — MIT).
 *
 * ⚠️ **한 문장만 검사하면 안 된다.** permission notice 뒤가 잘려 grant·나머지 조건·warranty disclaimer 가
 *    없는 상태여도 통과해 "MIT 고지 검증됨"이라고 **거짓 보고**하게 된다. MIT §2 는 저작권 표기와
 *    **permission notice 전체**를 요구하므로 전문을 대조한다.
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


const packDir = mkdtempSync(join(tmpdir(), 'cg-pack-'))
const target = mkdtempSync(join(tmpdir(), 'cg-target-'))
/**
 * 일회용 npm 캐시. npm/npx 호출이 **개발자의 실제 캐시를 건드리지 않게** 격리한다(이 저장소 규약, REQ-2026-009).
 * finally에서 packDir/target과 함께 지운다.
 */
const npmCache = mkdtempSync(join(tmpdir(), 'cg-npmcache-'))
const ENV = { ...process.env, npm_config_cache: npmCache }

function run(cmd, args, opts = {}) {
  const r = spawn.sync(cmd, args, { stdio: 'inherit', env: ENV, ...opts })
  if (r.error) throw r.error
  if (r.status !== 0) throw new Error(`smoke 실패: ${cmd} ${args.join(' ')} (exit=${r.status})`)
  return r
}

/** rc≠0을 **기대**하는 실행(도달 증명용). stdout+stderr를 캡처해 돌려준다. */
function runExpectFail(cmd, args, opts = {}) {
  const r = spawn.sync(cmd, args, { encoding: 'utf8', env: ENV, ...opts })
  if (r.error) throw r.error
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}

const assert = (cond, msg) => {
  if (!cond) throw new Error(`smoke: ${msg}`)
}

try {
  // 1) 배포 tarball 생성
  run('npm', ['pack', '--pack-destination', packDir], { cwd: pkgRoot })
  const tgz = readdirSync(packDir).find((f) => f.endsWith('.tgz'))
  if (!tgz) throw new Error('smoke: .tgz 생성 실패')
  const tgzAbs = join(packDir, tgz)

  // 2) 임시 target repo(git + package.json)
  run('git', ['init', '-q'], { cwd: target })
  run('git', ['config', 'user.email', 'smoke@example.com'], { cwd: target })
  run('git', ['config', 'user.name', 'smoke'], { cwd: target })
  // hermetic: 전역 core.excludesFile이 4b의 check-ignore에 새면 kit 규칙 누락을 못 잡는다(phase-2 리뷰 P3).
  const emptyExcludes = join(target, '.git', 'info', 'empty-excludes')
  writeFileSync(emptyExcludes, '')
  writeFileSync(join(target, '.git', 'info', 'exclude'), '')
  run('git', ['config', 'core.excludesFile', emptyExcludes], { cwd: target })
  writeFileSync(join(target, 'package.json'), JSON.stringify({ name: 'smoke-target', version: '0.0.0' }, null, 2))

  // 3) 배포본 설치(deps·bin 해소 검증)
  run('npm', ['install', '-D', tgzAbs, '--no-audit', '--no-fund'], { cwd: target })

  // 4) 설치된 패키지 bin 실행(dry-run) — rc=0이어야 통과
  run('npx', ['--no-install', 'commitgate', '--dry-run'], { cwd: target })

  // 4b) **실제 init**(dry-run 아님) — packed payload에서 templates/workflow.gitignore가 실제로 실려
  //     workflow/.gitignore로 복사되고, 티켓 scratch를 무시하는지 확인(REQ-2026-012 phase-2 리뷰 R5).
  //     dry-run·소스 트리 스캔은 npm의 .gitignore 제외를 못 잡는다 — tgz 설치본으로만 드러난다.
  run('npx', ['--no-install', 'commitgate'], { cwd: target })
  const wgi = join(target, 'workflow', '.gitignore')
  if (!existsSync(wgi)) throw new Error('smoke: tarball 설치본이 workflow/.gitignore를 만들지 않았다(templates/workflow.gitignore 누락 의심)')
  mkdirSync(join(target, 'workflow', 'REQ-2026-001'), { recursive: true })
  writeFileSync(join(target, 'workflow', 'REQ-2026-001', 'codex-response.json'), '{}')
  const ci = spawn.sync('git', ['check-ignore', '-q', '--', 'workflow/REQ-2026-001/codex-response.json'], { cwd: target })
  if (ci.status !== 0) throw new Error('smoke: workflow/.gitignore가 codex-response.json을 무시하지 못한다')

  // 4b-2) **repo-root 런타임 스크래치**(REQ-2026-047). `appendReviewCallLog`가 소비자 루트의
  //   `workflow/.review-calls.jsonl`에 리뷰마다 append하는데, 이 경로는 티켓 밖이라 `/REQ-*/…` 앵커에
  //   걸리지 않고 D10 스크래치 허용목록(`reviewScratchPaths`)에도 없다 → **gitignore가 유일한 방어**다.
  //   0.9.6은 루트 .gitignore에만 패턴을 넣고 배포 템플릿에 누락해, 소비자가 첫 리뷰를 돌린 뒤
  //   D10 FAIL로 모든 커밋이 막혔다. 템플릿 **내용을 문자열로 단언하지 않는다** — 그러면 무효 패턴
  //   (`workflow/.review-calls.jsonl`, 중첩에서 `workflow/workflow/…`)도 통과시킨다. git이 오라클이다.
  //   ⚠️ `-q`가 아니라 **`-v`로 매칭 출처까지 단언**한다(phase-1 리뷰 P1). `check-ignore`는 global/system
  //   excludes와 `.git/info/exclude`도 함께 적용하므로, 종료 코드만 보면 "무엇이 무시했는지"를 증명하지 못한다.
  //   :102-106의 hermetic 설정이 그 원천들을 이미 무력화하지만(모의 global `*.jsonl` ignore를 주입하고
  //   템플릿 행을 지운 상태에서 이 단언이 실제로 실패함을 확인했다), 그 불변식은 **20줄 위**에 있어
  //   나중 편집이 조용히 깨뜨릴 수 있다. 출처를 직접 확인하면 오라클이 스스로를 증명한다.
  writeFileSync(join(target, 'workflow', '.review-calls.jsonl'), '{"smoke":1}\n')
  const ciLog = spawn.sync('git', ['check-ignore', '-v', '--', 'workflow/.review-calls.jsonl'], {
    cwd: target,
    encoding: 'utf8',
  })
  if (ciLog.status !== 0)
    throw new Error(
      'smoke: workflow/.gitignore가 .review-calls.jsonl을 무시하지 못한다 — templates/workflow.gitignore에 앵커형 `/.review-calls.jsonl` 누락(REQ-2026-047)',
    )
  // `-v` 출력: `<source>:<line>:<pattern>\t<pathname>`. source가 절대경로(전역 excludes)면 드라이브 문자의
  // `:`가 섞이므로 `:<숫자>:` 경계로 잘라낸다.
  const ignoreSource = (/^(.*?):(\d+):/.exec((ciLog.stdout ?? '').split('\t')[0] ?? '')?.[1] ?? '').replace(/\\/g, '/')
  if (ignoreSource !== 'workflow/.gitignore')
    throw new Error(
      `smoke: .review-calls.jsonl 을 무시한 규칙의 출처가 workflow/.gitignore 가 아니다(출처=${ignoreSource || '불명'}) — ` +
        '배포 템플릿 규칙이 아니라 다른 ignore 원천이 매칭했다. 이 상태면 clean consumer에서 P0가 재발한다(REQ-2026-047)',
    )

  // ── 4c) **Stage B 인수 기준(REQ-2026-014)** — packed 설치본에서만 드러나는 것들.
  const pkgAfter = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8'))

  // (a) R3 무복사: 실행 코드는 node_modules/commitgate 에만 있다.
  assert(!existsSync(join(target, 'scripts', 'req')), '대상에 scripts/req/ 가 복사됐다(Stage B 무복사 위반)')

  // (b) R3 무주입: tsx·ajv·cross-spawn 은 commitgate 패키지의 runtime dependency지 대상의 것이 아니다.
  for (const dep of ['tsx', 'ajv', 'cross-spawn']) {
    assert(!(dep in (pkgAfter.devDependencies ?? {})), `대상 devDependencies 에 ${dep} 가 주입됐다(Stage B 무주입 위반)`)
    assert(!(dep in (pkgAfter.dependencies ?? {})), `대상 dependencies 에 ${dep} 가 주입됐다(Stage B 무주입 위반)`)
  }
  // 사용자가 설치한 commitgate 선언은 그대로 있어야 한다(init 의 D14 전제).
  assert('commitgate' in (pkgAfter.devDependencies ?? {}), '대상 devDependencies.commitgate 선언이 사라졌다')

  // (c) R1/R2: 다섯 req:* 값이 패키지 bin dispatch를 가리킨다.
  //     검증 목록을 하드코딩하지 않고 **dispatch 의 VERB_MODULES 에서 파생**한다 — SSOT 1개 유지, verb 누락 시 smoke 가 잡는다.
  const reqVerbs = Object.keys(VERB_MODULES).filter((v) => v.startsWith('req:'))
  assert(reqVerbs.length === 5, `dispatch 의 req:* verb 가 5개가 아니다(${reqVerbs.length}개)`)
  for (const verb of reqVerbs) {
    const got = (pkgAfter.scripts ?? {})[verb]
    assert(got === `commitgate ${verb}`, `대상 scripts.${verb} = ${JSON.stringify(got)} — 기대: "commitgate ${verb}"`)
  }

  // (d) **실제 dispatch 도달 증명** — 성공 종료가 아니라 "어느 모듈에 도달했는가"로 증명한다.
  //     fresh·티켓 없는 대상에서 rc=0 으로 끝나는 req:* verb 는 **하나도 없다**(new=clean tree 필요, next/doctor=티켓 필요,
  //     commit=승인 필요, review-codex=live Codex 필요). 그래서 req-doctor **자신의 사용법 오류**를 관찰한다.
  //     이 한 번으로 Stage B 사슬 전체가 증명된다:
  //       npm script("commitgate req:doctor") → node_modules/.bin/commitgate 해소 → launcher 가 tsx 등록
  //       → dispatch 가 **패키지 안의** scripts/req/req-doctor.ts 로 라우팅 → 그 모듈의 parseArgs 실행.
  //     판별력: 미등록 verb면 launcher 의 "알 수 없는 명령", bin 해소 실패면 npm 의 "not found" — 셋은 서로 다른 메시지다.
  //     ⚠️ 이것은 "doctor 가 통과한다"는 증명이 **아니다**(티켓이 없으므로 통과할 수 없다). "dispatch 가 도달한다"는 증명이다.
  const doctor = runExpectFail('npm', ['run', '--silent', 'req:doctor'], { cwd: target })
  assert(doctor.status !== 0, 'req:doctor 가 티켓 없이 rc=0 이 났다(사용법 오류가 나야 정상)')
  assert(
    doctor.out.includes('REQ id 또는 --ticket'),
    `req:doctor 가 자기 사용법 오류를 내지 않았다 — dispatch 가 모듈에 도달하지 못했을 수 있다. 출력:\n${doctor.out}`,
  )
  assert(!doctor.out.includes('알 수 없는 명령'), 'dispatch 가 req:doctor 를 미지 verb 로 취급했다')

  // (e) **companion skills**(REQ-2026-020/022 R4) — packed 설치본에서 5종이 실제로 깔리는가.
  //     단위 테스트는 로컬 소스로 돌지만, 여기서는 `files[]` whitelist 를 통과한 **tarball** 이 근거다.
  //     tarball 에서 빠지면 walkFiles 가 ENOENT 로 죽거나 조용히 미설치된다 — 그 축은 여기서만 잡힌다.
  assertCompanionSkills(target)

  // 5) uninstall verb 해소(REQ-2026-007) — 배포 아티팩트에서 bin/uninstall.ts가 로드되고 rc=0.
  //    R4: planner 는 읽기 전용이다 — 실행 전후 대상 tree 가 동일해야 한다.
  //    ⚠️ 그 판정은 snapshot 의 지문에 달려 있다. 먼저 지문이 실제로 내용 변경을 잡는지 자기검증한다(REQ-2026-022 R7) —
  //       크기 기반으로 퇴행하면 아래 assertSameTree 가 조용히 통과해 이 축이 공허해진다.
  assertFingerprintDetectsSameSizeEdit()
  const beforeUninstall = snapshot(target)
  run('npx', ['--no-install', 'commitgate', 'uninstall'], { cwd: target })
  assertSameTree(beforeUninstall, snapshot(target), 'uninstall planner 가 대상 tree 를 변경했다(읽기 전용 위반)')

  // 6) migrate: 별도 Stage A 시드 대상에서 dry-run 무부작용 + --apply exact-match 전환·사용자 값 보존.
  //    ⚠️ 위 fresh 대상에 겹쳐 쓰지 않는다 — Stage A 서명이 생기면 init 의 D19 가 발동해 다른 것을 검증하게 된다.
  smokeMigrate(tgzAbs)

  console.log(
    '\n[smoke] ✅ pack tarball 설치본 OK — Stage B 인수 기준(무복사·무주입·commitgate <verb>·dispatch 도달) · uninstall 읽기 전용(SHA-256 지문) · migrate 비파괴·companion 무추가 · companion skills 5종 + MIT 고지',
  )
} finally {
  rmSync(packDir, { recursive: true, force: true })
  rmSync(target, { recursive: true, force: true })
  rmSync(npmCache, { recursive: true, force: true })
}

/**
 * 트리 지문 — `.git`·`node_modules` 제외 전체 파일의 **내용 기반 SHA-256**(경로 → sha256). (REQ-2026-022 R7)
 *
 * ⚠️ 이전 구현은 `readFileSync(abs).length` 로 **크기만** 저장해 **같은 크기의 내용 변경을 놓쳤다**.
 *    smoke 는 uninstall 의 "읽기 전용"을 이 snapshot 으로 검증하므로(아래 `assertSameTree` 호출부),
 *    그 축의 **유일한 end-to-end 방어선이 공허**했다 — planner 가 파일을 같은 크기로 고쳐도 통과했다.
 *
 * `assertSameTree` 는 값 비교라 수정할 필요가 없다 — 비교 축만 바뀐다.
 */
function snapshot(dir) {
  const out = new Map()
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === '.git' || e.name === 'node_modules') continue
      const abs = join(d, e.name)
      if (e.isDirectory()) walk(abs)
      else out.set(abs.slice(dir.length + 1).replace(/\\/g, '/'), createHash('sha256').update(readFileSync(abs)).digest('hex'))
    }
  }
  walk(dir)
  return out
}

/**
 * packed 설치본에 companion 5종이 깔리고 **MIT 고지가 동행**하는가 (R4/R9).
 *
 * MIT §2 는 저작권 표기와 permission notice 를 "copies or substantial portions" 에 포함할 것을 요구한다.
 * 그 고지가 **설치되는 파일** 안에 있어야 하므로 tarball→설치 경로 끝에서 확인한다.
 */
function assertCompanionSkills(target) {
  const present = COMPANION_SKILL_RELS.filter((r) => existsSync(join(target, r)))
  assert(
    present.length === COMPANION_SKILL_RELS.length,
    `companion skills 가 packed 설치본에 깔리지 않았다(${present.length}/${COMPANION_SKILL_RELS.length}) — 누락: ${COMPANION_SKILL_RELS.filter((r) => !present.includes(r)).join(', ')}`,
  )
  for (const rel of COMPANION_SKILL_RELS) {
    // CRLF 체크아웃에서도 성립하도록 정규화(대상 repo 는 사용자 환경이다).
    const body = readFileSync(join(target, rel), 'utf8').replace(/\r\n/g, '\n')
    // 🔴 **전문** 대조. 한 문장만 보면 그 뒤가 잘려 grant·warranty disclaimer 가 없어도 통과해
    //    "MIT 고지 검증됨"이라고 거짓 보고한다(design 리뷰 P1).
    assert(
      body.includes(UPSTREAM_MIT),
      `${rel}: MIT 고지 **전문**이 없다 — 저작권 표기·permission grant·조건·warranty disclaimer 전체가 동행해야 MIT §2 충족`,
    )
    assert(body.includes(UPSTREAM_SHA), `${rel}: 기준 upstream SHA 가 없다`)
  }
  console.log(`[smoke] companion skills OK — 5종 설치 + MIT 고지·upstream SHA 동행`)
}

/** Stage A migrate 대상에 companion 이 생기지 않았는가 (R6). 설치는 명시적 init 에서만이다. */
function assertNoCompanionSkills(dir, when) {
  const leaked = COMPANION_SKILL_RELS.filter((r) => existsSync(join(dir, r)))
  assert(leaked.length === 0, `${when}: migrate 가 companion 을 생성했다 — 설치는 명시적 init 에서만이다: ${leaked.join(', ')}`)
}

/**
 * 🔴 fingerprint 자기검증 — **같은 크기·다른 내용**을 `assertSameTree` 가 실제로 거부하는가.
 *
 * 이 대조가 없으면 "SHA 로 바꿨다"는 주장이 공허하다. 크기 기반이었다면 두 Map 의 값이 같아 통과한다.
 */
function assertFingerprintDetectsSameSizeEdit() {
  const probe = mkdtempSync(join(tmpdir(), 'cg-fp-'))
  try {
    const f = join(probe, 'probe.txt')
    writeFileSync(f, 'AAAA')
    const before = snapshot(probe)
    writeFileSync(f, 'BBBB') // 같은 4바이트, 다른 내용
    const after = snapshot(probe)
    assert(
      before.get('probe.txt') !== after.get('probe.txt'),
      'fingerprint 가 같은 크기의 내용 변경을 구분하지 못한다(크기 기반으로 퇴행)',
    )
    let rejected = false
    try {
      assertSameTree(before, after, 'probe')
    } catch {
      rejected = true
    }
    assert(rejected, 'assertSameTree 가 같은 크기·다른 내용을 거부하지 못한다 — uninstall 읽기 전용 검증이 공허하다')
    console.log('[smoke] fingerprint 자기검증 OK — 같은 크기·다른 내용을 거부한다')
  } finally {
    rmSync(probe, { recursive: true, force: true })
  }
}

function assertSameTree(before, after, msg) {
  const changed = [...after.keys()].filter((k) => after.get(k) !== before.get(k))
  const removed = [...before.keys()].filter((k) => !after.has(k))
  assert(changed.length === 0 && removed.length === 0, `${msg} (변경: ${changed.join(', ')} / 삭제: ${removed.join(', ')})`)
}

/**
 * `commitgate migrate` 를 **packed 설치본**으로 검증한다(REQ-2026-014 R5).
 * Stage A 시드 대상: `req:*` 일부가 Stage A 주입값 · 하나는 사용자 정의 · vendored `scripts/req/**` 존재.
 */
function smokeMigrate(tgzAbs) {
  const t = mkdtempSync(join(tmpdir(), 'cg-migrate-'))
  try {
    run('git', ['init', '-q'], { cwd: t })
    writeFileSync(
      join(t, 'package.json'),
      JSON.stringify(
        {
          name: 'stage-a-target',
          version: '0.0.0',
          scripts: { 'req:new': 'tsx scripts/req/req-new.ts', 'req:doctor': 'echo MY-CUSTOM', build: 'tsc' },
        },
        null,
        2,
      ),
    )
    mkdirSync(join(t, 'scripts', 'req'), { recursive: true })
    writeFileSync(join(t, 'scripts', 'req', 'req-new.ts'), '// vendored\n')
    run('npm', ['install', '-D', tgzAbs, '--no-audit', '--no-fund'], { cwd: t })

    // dry-run(기본): 부작용 0건.
    const before = snapshot(t)
    run('npx', ['--no-install', 'commitgate', 'migrate'], { cwd: t })
    assertSameTree(before, snapshot(t), 'migrate dry-run 이 파일을 건드렸다')
    // R6: migrate 는 companion 을 설치하지 않는다 — 설치는 명시적 init 에서만이다.
    assertNoCompanionSkills(t, 'migrate dry-run')

    // --apply: 정확한 Stage A 값만 전환, 사용자 값·vendored 파일 보존(비파괴).
    run('npx', ['--no-install', 'commitgate', 'migrate', '--apply'], { cwd: t })
    const pkg = JSON.parse(readFileSync(join(t, 'package.json'), 'utf8'))
    assert(pkg.scripts['req:new'] === 'commitgate req:new', 'migrate --apply 가 정확한 Stage A 값을 전환하지 않았다')
    assert(pkg.scripts['req:doctor'] === 'echo MY-CUSTOM', 'migrate 가 사용자 정의 req:doctor 를 덮어썼다')
    assert(pkg.scripts['build'] === 'tsc', 'migrate 가 무관한 스크립트를 건드렸다')
    assert(existsSync(join(t, 'scripts', 'req', 'req-new.ts')), 'migrate 가 vendored 파일을 삭제했다(비파괴 위반)')
    // ⚠️ dry-run 은 원래 무부작용이라 **--apply 가 진짜 검증점**이다. 위 전환 단언이 --apply 가 실제로 일했음을
    //    보장하므로, 여기서의 부재는 "아무것도 안 해서 없다"는 위양성이 아니다.
    assertNoCompanionSkills(t, 'migrate --apply')
  } finally {
    rmSync(t, { recursive: true, force: true })
  }
}
