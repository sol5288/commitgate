#!/usr/bin/env node
/**
 * pack tarball 기반 설치 smoke (CI/로컬 공용).
 *
 * ⚠️ 로컬 소스(`node bin/commitgate.mjs`)가 아니라 **`npm pack` tarball을 임시 repo에 설치해 그 bin을 실행**한다.
 *    → 실제 배포 아티팩트(`bin` 해소·`files` whitelist·deps 설치)를 검증. (REQ-2026-002 #2)
 *
 * 흐름: npm pack → 임시 target(git init·npm init) → `npm i -D <tgz>` → `npx commitgate --dry-run`(rc=0).
 * 크로스플랫폼: cross-spawn으로 npm/git/npx(.cmd)를 shell 없이 안전 실행(Windows 러너 호환).
 */
import spawn from 'cross-spawn'
import { mkdtempSync, rmSync, readdirSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function run(cmd, args, opts = {}) {
  const r = spawn.sync(cmd, args, { stdio: 'inherit', ...opts })
  if (r.error) throw r.error
  if (r.status !== 0) throw new Error(`smoke 실패: ${cmd} ${args.join(' ')} (exit=${r.status})`)
  return r
}

const packDir = mkdtempSync(join(tmpdir(), 'cg-pack-'))
const target = mkdtempSync(join(tmpdir(), 'cg-target-'))
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

  // 5) uninstall verb 해소(REQ-2026-007) — 배포 아티팩트에서 bin/uninstall.ts가 로드되고 rc=0.
  run('npx', ['--no-install', 'commitgate', 'uninstall'], { cwd: target })

  console.log('\n[smoke] ✅ pack tarball 설치본 OK (init dry-run·real-init·workflow/.gitignore 효과·uninstall planner)')
} finally {
  rmSync(packDir, { recursive: true, force: true })
  rmSync(target, { recursive: true, force: true })
}
