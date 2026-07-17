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
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { VERB_MODULES } from '../bin/dispatch.mjs'

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

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

  // 5) uninstall verb 해소(REQ-2026-007) — 배포 아티팩트에서 bin/uninstall.ts가 로드되고 rc=0.
  //    R4: planner 는 읽기 전용이다 — 실행 전후 대상 tree 가 동일해야 한다.
  const beforeUninstall = snapshot(target)
  run('npx', ['--no-install', 'commitgate', 'uninstall'], { cwd: target })
  assertSameTree(beforeUninstall, snapshot(target), 'uninstall planner 가 대상 tree 를 변경했다(읽기 전용 위반)')

  // 6) migrate: 별도 Stage A 시드 대상에서 dry-run 무부작용 + --apply exact-match 전환·사용자 값 보존.
  //    ⚠️ 위 fresh 대상에 겹쳐 쓰지 않는다 — Stage A 서명이 생기면 init 의 D19 가 발동해 다른 것을 검증하게 된다.
  smokeMigrate(tgzAbs)

  console.log(
    '\n[smoke] ✅ pack tarball 설치본 OK — Stage B 인수 기준(무복사·무주입·commitgate <verb>·dispatch 도달) · uninstall 읽기 전용 · migrate 비파괴',
  )
} finally {
  rmSync(packDir, { recursive: true, force: true })
  rmSync(target, { recursive: true, force: true })
  rmSync(npmCache, { recursive: true, force: true })
}

/** `.git` 제외 전체 파일 목록+크기(경로 → size). 읽기 전용 검증용(내용 해시까지는 불필요 — 변경/삭제만 잡으면 된다). */
function snapshot(dir) {
  const out = new Map()
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === '.git' || e.name === 'node_modules') continue
      const abs = join(d, e.name)
      if (e.isDirectory()) walk(abs)
      else out.set(abs.slice(dir.length + 1).replace(/\\/g, '/'), readFileSync(abs).length)
    }
  }
  walk(dir)
  return out
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

    // --apply: 정확한 Stage A 값만 전환, 사용자 값·vendored 파일 보존(비파괴).
    run('npx', ['--no-install', 'commitgate', 'migrate', '--apply'], { cwd: t })
    const pkg = JSON.parse(readFileSync(join(t, 'package.json'), 'utf8'))
    assert(pkg.scripts['req:new'] === 'commitgate req:new', 'migrate --apply 가 정확한 Stage A 값을 전환하지 않았다')
    assert(pkg.scripts['req:doctor'] === 'echo MY-CUSTOM', 'migrate 가 사용자 정의 req:doctor 를 덮어썼다')
    assert(pkg.scripts['build'] === 'tsc', 'migrate 가 무관한 스크립트를 건드렸다')
    assert(existsSync(join(t, 'scripts', 'req', 'req-new.ts')), 'migrate 가 vendored 파일을 삭제했다(비파괴 위반)')
  } finally {
    rmSync(t, { recursive: true, force: true })
  }
}
