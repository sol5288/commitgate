import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  runInit,
  detectPackageManager,
  runScriptCmd,
  parseArgs,
  crossSpawnBelowFloor,
  KIT_COPY_RELPATHS,
  KIT_SCHEMA_RELPATHS,
  type InitOptions,
} from '../../bin/init'
import { DEFAULT_REVIEW_PERSONA_RELPATH } from '../../scripts/req/lib/config'

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
const OPTS = (dir: string, over?: Partial<InitOptions>): InitOptions => ({
  dir,
  force: false,
  dryRun: false,
  strict: false,
  ...over,
})

/**
 * REQ-2026-010 phase-1a — **설치 축과 tarball 축은 다르다** (design R1 P1).
 *
 * `package.json`의 `files[]`는 npm tarball에 무엇이 실리는가이고,
 * `KIT_COPY_RELPATHS`는 **대상 repo에 무엇이 깔리는가**다.
 * phase-1b가 `review-codex`에 persona fail-closed를 켜므로, persona 파일이 설치 축에서
 * 빠지면 신규 설치본의 **모든 리뷰가 멈춘다**. 두 SSOT가 갈라지는 순간 여기서 실패한다.
 */
describe('[init] 설치 축 SSOT (persona)', () => {
  it('KIT_COPY_RELPATHS가 코어 기본 persona 경로를 포함한다', () => {
    expect(KIT_COPY_RELPATHS).toContain(DEFAULT_REVIEW_PERSONA_RELPATH)
  })

  it('KIT_SCHEMA_RELPATHS는 스키마 축으로 남는다(persona 미포함)', () => {
    // uninstall.ts의 "설정된 schemaPath가 init이 깐 스키마인가" 판정이 이 상수에 의존한다.
    // persona를 여기 섞으면 그 판정이 오염된다.
    expect(KIT_SCHEMA_RELPATHS as readonly string[]).not.toContain(DEFAULT_REVIEW_PERSONA_RELPATH)
    expect([...KIT_COPY_RELPATHS]).toEqual(expect.arrayContaining([...KIT_SCHEMA_RELPATHS]))
  })

  it('설치가 persona 파일을 실제로 복사한다', () => {
    const dir = tmpTarget()
    try {
      const r = runInit(OPTS(dir))
      expect(r.copied).toContain(DEFAULT_REVIEW_PERSONA_RELPATH)
      expect(existsSync(join(dir, DEFAULT_REVIEW_PERSONA_RELPATH))).toBe(true)
    } finally {
      cleanup(dir)
    }
  })

  it('dry-run은 persona 파일을 쓰지 않는다', () => {
    const dir = tmpTarget()
    try {
      const r = runInit(OPTS(dir, { dryRun: true }))
      expect(r.copied).toContain(DEFAULT_REVIEW_PERSONA_RELPATH)
      expect(existsSync(join(dir, DEFAULT_REVIEW_PERSONA_RELPATH))).toBe(false)
    } finally {
      cleanup(dir)
    }
  })
})

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
      // config 시드: handoffPath null(비활성을 config에 명시 기록) + 감지 pm
      expect(r.configAction).toBe('created')
      const cfg = JSON.parse(readFileSync(join(dir, 'req.config.json'), 'utf8'))
      expect(cfg.handoffPath).toBeNull()
      expect(cfg.packageManager).toBe('npm')
      // package.json 패치
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
      expect(pkg.scripts['req:new']).toBe('tsx scripts/req/req-new.ts')
      expect(pkg.scripts['req:commit']).toBe('tsx scripts/req/req-commit.ts')
      // REQ-2026-010 phase-2: req:next가 5번째 주입 스크립트로 추가됐다.
      expect(pkg.scripts['req:next']).toBe('tsx scripts/req/req-next.ts')
      expect(Object.keys(pkg.scripts).sort()).toEqual(
        ['req:commit', 'req:doctor', 'req:new', 'req:next', 'req:review-codex'].sort(),
      )
      expect(pkg.devDependencies.tsx).toBeTruthy()
      expect(pkg.devDependencies.ajv).toBeTruthy()
      expect(pkg.devDependencies['cross-spawn']).toBeTruthy() // 복사된 adapters.ts 안전 spawn 의존(P1)
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
    // handoffPath 없는 부분 config → 병합으로 handoffPath:null 추가(비활성을 명시 기록)
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

describe('[init] BOM 이식성(P3)', () => {
  it('BOM 붙은 package.json도 파싱·패치(PowerShell5 UTF8)', () => {
    const dir = tmpTarget({ withPkg: false })
    try {
      writeFileSync(join(dir, 'package.json'), '﻿' + JSON.stringify({ name: 'x', version: '0.0.0' }), 'utf8')
      expect(() => runInit(OPTS(dir))).not.toThrow()
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) // init은 BOM 없이 재작성
      expect(pkg.scripts['req:new']).toBe('tsx scripts/req/req-new.ts')
    } finally {
      cleanup(dir)
    }
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

describe('[#1] cross-spawn 버전 하한 진단', () => {
  const below = (dir: string, pkg: Record<string, unknown>) => crossSpawnBelowFloor(dir, pkg)?.below

  it('[순수] range 판정 매트릭스(설치·lock 없음) — ^7.0.0 오탐 방지', () => {
    const dir = tmpTarget()
    try {
      // 하한(>=7.0.6)으로 절대 해소 불가 → below
      for (const s of ['^6.0.0', '6.x', '~6.1.0', '7.0.1', '7.0.5'])
        expect(below(dir, { devDependencies: { 'cross-spawn': s } })).toBe(true)
      // 하한 이상 해소 가능 → 무경고(오탐 방지: 특히 ^7.0.0·~7.0.1)
      for (const s of ['^7.0.0', '~7.0.1', '>=7.0.6', '^7.0.6', '7.0.9', '^8.0.0', '*'])
        expect(below(dir, { devDependencies: { 'cross-spawn': s } })).toBe(false)
      // 기존 cross-spawn 없음 → null(진단 불필요), deps 쪽도 감지
      expect(crossSpawnBelowFloor(dir, {})).toBeNull()
      expect(below(dir, { dependencies: { 'cross-spawn': '^6.0.0' } })).toBe(true)
    } finally {
      cleanup(dir)
    }
  })

  it('[lockfile] ^7.0.0 spec + package-lock 7.0.1 핀 → below(range fallback 전에 잡음, R1 P2)', () => {
    const dir = tmpTarget()
    try {
      writeFileSync(
        join(dir, 'package-lock.json'),
        JSON.stringify({ lockfileVersion: 3, packages: { 'node_modules/cross-spawn': { version: '7.0.1' } } }),
      )
      expect(below(dir, { devDependencies: { 'cross-spawn': '^7.0.0' } })).toBe(true)
    } finally {
      cleanup(dir)
    }
  })

  it('[설치버전 우선] node_modules 설치본이 lockfile·range보다 우선', () => {
    const dir = tmpTarget()
    try {
      mkdirSync(join(dir, 'node_modules', 'cross-spawn'), { recursive: true })
      writeFileSync(join(dir, 'node_modules/cross-spawn/package.json'), JSON.stringify({ version: '7.0.9' }))
      writeFileSync(
        join(dir, 'package-lock.json'),
        JSON.stringify({ packages: { 'node_modules/cross-spawn': { version: '6.0.0' } } }),
      )
      // 설치본 7.0.9(>=floor) → lock 6.0.0·spec ^6.0.0이 낮아도 무경고
      expect(below(dir, { devDependencies: { 'cross-spawn': '^6.0.0' } })).toBe(false)
    } finally {
      cleanup(dir)
    }
  })

  it('[통합] 하한 미만 → WARN(기본, 설치 계속)', () => {
    const dir = tmpTarget({ pkg: { name: 'x', devDependencies: { 'cross-spawn': '^6.0.0' } } })
    try {
      const r = runInit(OPTS(dir))
      expect(r.crossSpawnFloorWarned).toBe(true)
      expect(existsSync(join(dir, 'scripts/req/req-new.ts'))).toBe(true) // 비파괴 — 설치 계속
    } finally {
      cleanup(dir)
    }
  })

  it('[통합] --strict → throw + 부분 복사 없음', () => {
    const dir = tmpTarget({ pkg: { name: 'x', dependencies: { 'cross-spawn': '5.0.0' } } })
    try {
      expect(() => runInit(OPTS(dir, { strict: true }))).toThrow(/cross-spawn.*하한/)
      expect(existsSync(join(dir, 'scripts/req/req-new.ts'))).toBe(false)
    } finally {
      cleanup(dir)
    }
  })

  it('[통합] cross-spawn 없음/>=floor → 무경고', () => {
    const d1 = tmpTarget()
    const d2 = tmpTarget({ pkg: { name: 'x', devDependencies: { 'cross-spawn': '^7.0.6' } } })
    try {
      expect(runInit(OPTS(d1)).crossSpawnFloorWarned).toBe(false)
      expect(runInit(OPTS(d2)).crossSpawnFloorWarned).toBe(false)
    } finally {
      cleanup(d1)
      cleanup(d2)
    }
  })

  it('[통합] dependencies가 배열이면 throw(shape 검증, R1 P3) + 부분 복사 없음', () => {
    const dir = tmpTarget({ pkg: { name: 'x', dependencies: [] } })
    try {
      expect(() => runInit(OPTS(dir))).toThrow(/dependencies 필드가 객체가 아님/)
      expect(existsSync(join(dir, 'scripts/req/req-new.ts'))).toBe(false)
    } finally {
      cleanup(dir)
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

describe('[init] runScriptCmd — pm별 유효 실행 커맨드(안내 정확성)', () => {
  it('npm은 run + `--` 구분자, pnpm/yarn은 bare script + 인자 직접', () => {
    // npm: `npm req:new …`은 Unknown command로 실패 → run + -- 필수(README 수동 명령과 동일)
    expect(runScriptCmd('npm', 'req:new', '<slug> --run')).toBe('npm run req:new -- <slug> --run')
    expect(runScriptCmd('pnpm', 'req:new', '<slug> --run')).toBe('pnpm req:new <slug> --run')
    expect(runScriptCmd('yarn', 'req:new', '<slug> --run')).toBe('yarn req:new <slug> --run')
  })
})
