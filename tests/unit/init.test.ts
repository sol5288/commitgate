import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runInit, detectPackageManager, parseArgs, type InitOptions } from '../../bin/init'

/** 최소 git repo(빈 .git 마커 + package.json) 임시 생성. */
function tmpTarget(opts?: { pkg?: object; lock?: string; withGit?: boolean; withPkg?: boolean }): string {
  const dir = mkdtempSync(join(tmpdir(), 'reqwf-init-'))
  if (opts?.withGit !== false) mkdirSync(join(dir, '.git'))
  if (opts?.withPkg !== false)
    writeFileSync(join(dir, 'package.json'), JSON.stringify(opts?.pkg ?? { name: 'x', version: '0.0.0' }, null, 2))
  if (opts?.lock) writeFileSync(join(dir, opts.lock), '')
  return dir
}
function cleanup(dir: string): void {
  rmSync(dir, { recursive: true, force: true })
}
const OPTS = (dir: string, over?: Partial<InitOptions>): InitOptions => ({ dir, force: false, dryRun: false, ...over })

describe('[init] 정상 설치', () => {
  it('kit 파일·config·package.json·AGENTS를 설치', () => {
    const dir = tmpTarget()
    try {
      const r = runInit(OPTS(dir))
      // kit 소스 복사
      expect(existsSync(join(dir, 'scripts/req/req-new.ts'))).toBe(true)
      expect(existsSync(join(dir, 'scripts/req/lib/config.ts'))).toBe(true)
      expect(existsSync(join(dir, 'scripts/req/lib/adapters.ts'))).toBe(true)
      // 스키마 2종
      expect(existsSync(join(dir, 'workflow/machine.schema.json'))).toBe(true)
      expect(existsSync(join(dir, 'workflow/req.config.schema.json'))).toBe(true)
      // 티켓 디렉터리는 복사 대상 아님(스키마 2종만)
      expect(r.copied.some((f) => f.startsWith('workflow/REQ-'))).toBe(false)
      // config 시드: handoffPath null(palm 경로 미상속) + 감지 pm
      expect(r.configCreated).toBe(true)
      const cfg = JSON.parse(readFileSync(join(dir, 'req.config.json'), 'utf8'))
      expect(cfg.handoffPath).toBeNull()
      expect(cfg.packageManager).toBe('npm')
      // package.json 패치
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
      expect(pkg.scripts['req:new']).toBe('tsx scripts/req/req-new.ts')
      expect(pkg.scripts['req:commit']).toBe('tsx scripts/req/req-commit.ts')
      expect(pkg.devDependencies.tsx).toBeTruthy()
      expect(pkg.devDependencies.ajv).toBeTruthy()
      // AGENTS 생성
      expect(r.agentsCreated).toBe(true)
      expect(existsSync(join(dir, 'AGENTS.md'))).toBe(true)
    } finally {
      cleanup(dir)
    }
  })
})

describe('[init] 멱등성(재실행)', () => {
  it('두 번째 실행은 kit을 스킵하고 config/AGENTS를 덮어쓰지 않음', () => {
    const dir = tmpTarget()
    try {
      runInit(OPTS(dir))
      const r2 = runInit(OPTS(dir))
      expect(r2.copied.length).toBe(0)
      expect(r2.skipped).toContain('scripts/req/req-new.ts')
      expect(r2.configCreated).toBe(false)
      expect(r2.agentsCreated).toBe(false)
      expect(r2.packageJsonAdded.length).toBe(0)
    } finally {
      cleanup(dir)
    }
  })

  it('--force는 기존 kit 파일을 덮어씀', () => {
    const dir = tmpTarget()
    try {
      runInit(OPTS(dir))
      writeFileSync(join(dir, 'scripts/req/req-new.ts'), '// tampered', 'utf8')
      const r = runInit(OPTS(dir, { force: true }))
      expect(r.copied).toContain('scripts/req/req-new.ts')
      expect(readFileSync(join(dir, 'scripts/req/req-new.ts'), 'utf8')).not.toBe('// tampered')
    } finally {
      cleanup(dir)
    }
  })
})

describe('[init] 기존 키 보존', () => {
  it('기존 req:new 스크립트/handoffPath를 덮어쓰지 않음', () => {
    const dir = tmpTarget({ pkg: { name: 'x', scripts: { 'req:new': 'custom' }, devDependencies: { ajv: '^7.0.0' } } })
    try {
      writeFileSync(join(dir, 'req.config.json'), JSON.stringify({ handoffPath: 'keep/me.md' }), 'utf8')
      const r = runInit(OPTS(dir))
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
      expect(pkg.scripts['req:new']).toBe('custom') // 기존 유지
      expect(pkg.devDependencies.ajv).toBe('^7.0.0') // 기존 버전 유지
      expect(pkg.scripts['req:commit']).toBe('tsx scripts/req/req-commit.ts') // 없던 건 추가
      expect(r.configCreated).toBe(false)
      expect(JSON.parse(readFileSync(join(dir, 'req.config.json'), 'utf8')).handoffPath).toBe('keep/me.md')
    } finally {
      cleanup(dir)
    }
  })
})

describe('[init] dry-run', () => {
  it('파일을 쓰지 않고 계획만 반환', () => {
    const dir = tmpTarget()
    try {
      const r = runInit(OPTS(dir, { dryRun: true }))
      expect(r.copied.length).toBeGreaterThan(0)
      expect(r.configCreated).toBe(true)
      expect(existsSync(join(dir, 'scripts/req/req-new.ts'))).toBe(false)
      expect(existsSync(join(dir, 'req.config.json'))).toBe(false)
      expect(existsSync(join(dir, 'AGENTS.md'))).toBe(false)
      // package.json 미변경
      expect(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).scripts).toBeUndefined()
    } finally {
      cleanup(dir)
    }
  })
})

describe('[init] fail-closed', () => {
  it('git repo 아니면 throw', () => {
    const dir = tmpTarget({ withGit: false })
    try {
      expect(() => runInit(OPTS(dir))).toThrow(/git repo가 아님/)
    } finally {
      cleanup(dir)
    }
  })

  it('package.json 없으면 throw', () => {
    const dir = tmpTarget({ withPkg: false })
    try {
      expect(() => runInit(OPTS(dir))).toThrow(/package\.json 없음/)
    } finally {
      cleanup(dir)
    }
  })

  it('존재하지 않는 디렉터리면 throw', () => {
    expect(() => runInit(OPTS(join(tmpdir(), 'reqwf-nope-does-not-exist-xyz')))).toThrow(/대상 디렉터리가 없음/)
  })
})

describe('[init] packageManager 감지', () => {
  it('pnpm-lock → pnpm, yarn.lock → yarn, package-lock → npm, 없음 → npm', () => {
    for (const [lock, pm] of [
      ['pnpm-lock.yaml', 'pnpm'],
      ['yarn.lock', 'yarn'],
      ['package-lock.json', 'npm'],
    ] as const) {
      const dir = tmpTarget({ lock })
      try {
        expect(detectPackageManager(dir)).toBe(pm)
      } finally {
        cleanup(dir)
      }
    }
    const bare = tmpTarget()
    try {
      expect(detectPackageManager(bare)).toBe('npm')
    } finally {
      cleanup(bare)
    }
  })
})

describe('[init] parseArgs', () => {
  it('--dir/--force/--dry-run 파싱, 미지의 인자 거부, --dir 값 누락 거부', () => {
    expect(parseArgs(['--force', '--dry-run']).force).toBe(true)
    expect(parseArgs(['--dry-run']).dryRun).toBe(true)
    expect(() => parseArgs(['--bogus'])).toThrow(/알 수 없는 인자/)
    expect(() => parseArgs(['--dir'])).toThrow(/--dir 값 누락/)
  })
})
