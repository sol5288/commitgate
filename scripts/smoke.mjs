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
import { mkdtempSync, rmSync, readdirSync, writeFileSync } from 'node:fs'
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
  writeFileSync(join(target, 'package.json'), JSON.stringify({ name: 'smoke-target', version: '0.0.0' }, null, 2))

  // 3) 배포본 설치(deps·bin 해소 검증)
  run('npm', ['install', '-D', tgzAbs, '--no-audit', '--no-fund'], { cwd: target })

  // 4) 설치된 패키지 bin 실행(dry-run) — rc=0이어야 통과
  run('npx', ['--no-install', 'commitgate', '--dry-run'], { cwd: target })

  console.log('\n[smoke] ✅ pack tarball 설치본의 commitgate bin 실행 OK')
} finally {
  rmSync(packDir, { recursive: true, force: true })
  rmSync(target, { recursive: true, force: true })
}
