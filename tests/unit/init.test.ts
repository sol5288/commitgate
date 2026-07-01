import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runInit, detectPackageManager, parseArgs, type InitOptions } from '../../bin/init'

/**
 * 임시 대상 repo 생성.
 * - withGit: 'real'(기본) = 실제 `git init` / 'fake' = 빈 `.git` 마커만 / 'none' = git 없음
 * - withPkg: package.json 작성 여부(기본 true)
 */
function tmpTarget(opts?: { pkg?: object; lock?: string; withGit?: 'real' | 'fake' | 'none'; withPkg?: boolean }): string {
  const dir = mkdtempSync(join(tmpdir(), 'reqwf-init-'))
  const g = opts?.withGit ?? 'real'
  if (g === 'real') {
    execFileSync('git', ['init', '-q'], { cwd: dir })
  } else if (g === 'fake') {
    mkdirSync(join(dir, '.git'))
  }
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
      expect(existsSync(join(dir, 'scripts/req/req-new.ts'))).toBe(true)
      expect(existsSync(join(dir, 'scripts/req/lib/config.ts'))).toBe(true)
      expect(existsSync(join(dir, 'scripts/req/lib/adapters.ts'))).toBe(true)
      expect(existsSync(join(dir, 'workflow/machine.schema.json'))).toBe(true)
      expect(existsSync(join(dir, 'workflow/req.config.schema.json'))).toBe(true)
      // 티켓 디렉터리는 복사 대상 아님(스키마 2종만)
      expect(r.copied.some((f) => f.startsWith('workflow/REQ-'))).toBe(false)
      // config 시드: handoffPath null(palm 경로 미상속) + 감지 pm
      expect(r.configAction).toBe('created')
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
      expect(r2.configAction).toBe('unchanged')
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

describe('[init] 기존 config 누락키 병합(design R1 P2)', () => {
  it('기존 req.config.json에 handoffPath 없으면 병합, 기존 키는 보존', () => {
    // handoffPath 없는 부분 config → 병합으로 handoffPath:null 추가(palm 경로 resurface 차단)
    const dir = tmpTarget({ pkg: { name: 'x', scripts: { 'req:new': 'custom' }, devDependencies: { ajv: '^7.0.0' } } })
    try {
      writeFileSync(join(dir, 'req.config.json'), JSON.stringify({ branchPrefix: 'feat/x-' }), 'utf8')
      const r = runInit(OPTS(dir))
      expect(r.configAction).toBe('merged')
      const cfg = JSON.parse(readFileSync(join(dir, 'req.config.json'), 'utf8'))
      expect(cfg.branchPrefix).toBe('feat/x-') // 기존 키 보존
      expect(cfg.handoffPath).toBeNull() // 누락키 추가
      expect(cfg.packageManager).toBe('npm') // 누락키 추가
      // package.json: 기존 키 보존
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
      expect(pkg.scripts['req:new']).toBe('custom')
      expect(pkg.devDependencies.ajv).toBe('^7.0.0')
      expect(pkg.scripts['req:commit']).toBe('tsx scripts/req/req-commit.ts')
    } finally {
      cleanup(dir)
    }
  })

  it('기존 config에 handoffPath 명시값 있으면 유지', () => {
    const dir = tmpTarget()
    try {
      writeFileSync(join(dir, 'req.config.json'), JSON.stringify({ handoffPath: 'keep/me.md', packageManager: 'pnpm' }), 'utf8')
      const r = runInit(OPTS(dir))
      expect(r.configAction).toBe('unchanged')
      const cfg = JSON.parse(readFileSync(join(dir, 'req.config.json'), 'utf8'))
      expect(cfg.handoffPath).toBe('keep/me.md')
      expect(cfg.packageManager).toBe('pnpm')
    } finally {
      cleanup(dir)
    }
  })

  it('기존 config가 malformed면 fail-closed throw + 부분 복사 없음(design R2 P2)', () => {
    const dir = tmpTarget()
    try {
      writeFileSync(join(dir, 'req.config.json'), '{ not json', 'utf8')
      expect(() => runInit(OPTS(dir))).toThrow(/req\.config\.json 파싱 실패/)
      // preflight에서 실패 → kit 파일이 하나도 복사되지 않아야(부분 벤더링 방지)
      expect(existsSync(join(dir, 'scripts/req/req-new.ts'))).toBe(false)
      expect(existsSync(join(dir, 'workflow/machine.schema.json'))).toBe(false)
    } finally {
      cleanup(dir)
    }
  })

  it('package.json이 malformed/비객체면 throw + 부분 복사 없음(design R2 P2)', () => {
    const dir = tmpTarget()
    try {
      writeFileSync(join(dir, 'package.json'), '[1,2,3]', 'utf8') // 배열 = 비객체
      expect(() => runInit(OPTS(dir))).toThrow(/package\.json이 JSON 객체가 아님/)
      expect(existsSync(join(dir, 'scripts/req/req-new.ts'))).toBe(false)
    } finally {
      cleanup(dir)
    }
  })

  it('package.json scripts/devDependencies가 배열이면 throw + 부분 복사 없음(phase R1 P2)', () => {
    for (const bad of [{ name: 'x', scripts: [] }, { name: 'x', devDependencies: [1, 2] }]) {
      const dir = tmpTarget({ pkg: bad })
      try {
        expect(() => runInit(OPTS(dir))).toThrow(/필드가 객체가 아님/)
        expect(existsSync(join(dir, 'scripts/req/req-new.ts'))).toBe(false)
      } finally {
        cleanup(dir)
      }
    }
  })
})

describe('[init] 기존 config 스키마/경로 검증(phase R2 P2)', () => {
  it('schema-invalid 기존 config는 복사 전 throw + 부분 복사 없음', () => {
    const cases = [
      { bogusUnknownKey: 1 }, // additionalProperties:false
      { packageManager: 'bun' }, // enum 위반
      { branchPrefix: '' }, // minLength 위반(D11 무력화 차단)
      { ticketRoot: '../escape' }, // root 밖 탈출
    ]
    for (const bad of cases) {
      const dir = tmpTarget()
      try {
        writeFileSync(join(dir, 'req.config.json'), JSON.stringify(bad), 'utf8')
        expect(() => runInit(OPTS(dir))).toThrow()
        expect(existsSync(join(dir, 'scripts/req/req-new.ts'))).toBe(false)
      } finally {
        cleanup(dir)
      }
    }
  })
})

describe('[init] dry-run', () => {
  it('파일을 쓰지 않고 계획만 반환', () => {
    const dir = tmpTarget()
    try {
      const r = runInit(OPTS(dir, { dryRun: true }))
      expect(r.copied.length).toBeGreaterThan(0)
      expect(r.configAction).toBe('created')
      expect(existsSync(join(dir, 'scripts/req/req-new.ts'))).toBe(false)
      expect(existsSync(join(dir, 'req.config.json'))).toBe(false)
      expect(existsSync(join(dir, 'AGENTS.md'))).toBe(false)
      expect(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).scripts).toBeUndefined()
    } finally {
      cleanup(dir)
    }
  })
})

describe('[init] fail-closed', () => {
  it('git repo 아니면 throw(실제 probe)', () => {
    const dir = tmpTarget({ withGit: 'none' })
    try {
      expect(() => runInit(OPTS(dir))).toThrow(/git repo가 아님/)
    } finally {
      cleanup(dir)
    }
  })

  it('빈 .git 마커만 있는 fake repo도 거부(design R1 P2)', () => {
    const dir = tmpTarget({ withGit: 'fake' })
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
