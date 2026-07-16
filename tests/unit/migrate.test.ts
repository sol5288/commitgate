import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join, relative, dirname } from 'node:path'
import { decideScripts, planMigrate, runMigrate, parseArgs, renderPlan } from '../../bin/migrate'
import { REQ_SCRIPTS, STAGE_B_REQ_SCRIPTS, KIT_SOURCE_DIR_REL } from '../../bin/init'

/**
 * REQ-2026-014 Phase 3 — `commitgate migrate`(Stage A → Stage B 비파괴 전환).
 *
 * 이 명령의 계약은 **하나**다: `package.json`의 `req:*` 중 **현재 값이 정확히 Stage A 주입값인 키만**
 * `commitgate <verb>`로 바꾼다. 그 외에는 아무것도 하지 않는다 — 특히 **아무것도 삭제하지 않는다**.
 */

const COMMITGATE_DEP = { commitgate: '^0.6.0' }

/** repo 전체(.git 제외)의 `경로 → sha256`. "쓰기 0건"·"삭제 0건"을 전수 검증한다. */
function snapshot(dir: string): Map<string, string> {
  const out = new Map<string, string>()
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === '.git') continue
      const abs = join(d, e.name)
      if (e.isDirectory()) walk(abs)
      else out.set(relative(dir, abs).replace(/\\/g, '/'), createHash('sha256').update(readFileSync(abs)).digest('hex'))
    }
  }
  walk(dir)
  return out
}

/**
 * Stage A 설치본 픽스처. 실제 Stage A repo의 서명을 재현한다:
 * vendored `scripts/req/**` + `req:*` = Stage A 주입값 + (기본) commitgate devDep 선언.
 */
function tmpStageA(opts?: { scripts?: Record<string, string>; noCommitgateDep?: boolean; files?: Record<string, string> }): string {
  const dir = mkdtempSync(join(tmpdir(), 'reqwf-migrate-'))
  execFileSync('git', ['init', '-q'], { cwd: dir })
  const pkg: Record<string, unknown> = {
    name: 'x',
    version: '0.0.0',
    scripts: opts?.scripts ?? { ...REQ_SCRIPTS },
  }
  if (opts?.noCommitgateDep !== true) pkg.devDependencies = { ...COMMITGATE_DEP }
  writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n')
  // vendored 실행코드(내용은 무관 — 존재만으로 Stage A 서명이다)
  mkdirSync(join(dir, KIT_SOURCE_DIR_REL, 'lib'), { recursive: true })
  writeFileSync(join(dir, KIT_SOURCE_DIR_REL, 'req-new.ts'), '// vendored\n')
  writeFileSync(join(dir, KIT_SOURCE_DIR_REL, 'lib', 'config.ts'), '// vendored\n')
  // 보존돼야 하는 프로젝트 자산
  mkdirSync(join(dir, 'workflow', 'REQ-2026-001'), { recursive: true })
  writeFileSync(join(dir, 'workflow', 'REQ-2026-001', 'state.json'), '{"id":"REQ-2026-001"}\n')
  writeFileSync(join(dir, 'workflow', 'machine.schema.json'), '{"$schema":"x"}\n')
  writeFileSync(join(dir, 'workflow', 'review-persona.md'), '# 우리 팀 페르소나\n')
  writeFileSync(join(dir, 'req.config.json'), '{"packageManager":"npm"}\n')
  writeFileSync(join(dir, 'AGENTS.md'), '# 계약\n')
  for (const [rel, body] of Object.entries(opts?.files ?? {})) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true })
    writeFileSync(join(dir, rel), body)
  }
  return dir
}

const cleanup = (dir: string): void => rmSync(dir, { recursive: true, force: true })
const readPkg = (dir: string): { scripts: Record<string, string>; devDependencies?: Record<string, string> } =>
  JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))

describe('[migrate] decideScripts — 정확한 Stage A 값만 전환 대상(D5, 순수)', () => {
  it('Stage A 주입값 → convert', () => {
    const d = decideScripts({ ...REQ_SCRIPTS })
    expect(d.every((x) => x.kind === 'convert')).toBe(true)
    for (const x of d) expect(x.next).toBe(STAGE_B_REQ_SCRIPTS[x.key])
  })

  it('이미 Stage B 값 → stage-b(재전환 안 함)', () => {
    const d = decideScripts({ ...STAGE_B_REQ_SCRIPTS })
    expect(d.every((x) => x.kind === 'stage-b')).toBe(true)
    expect(d.every((x) => x.next === undefined)).toBe(true)
  })

  it('사용자 정의 값 → custom(보존 — next 없음)', () => {
    const d = decideScripts({ 'req:new': 'node custom.mjs', 'req:doctor': 'echo hi' })
    const byKey = Object.fromEntries(d.map((x) => [x.key, x]))
    expect(byKey['req:new']!.kind).toBe('custom')
    expect(byKey['req:new']!.next).toBeUndefined()
    expect(byKey['req:doctor']!.kind).toBe('custom')
  })

  it('키 없음 → absent(새로 만들지 않는다 — migrate는 설치가 아니다)', () => {
    const d = decideScripts({})
    expect(d.every((x) => x.kind === 'absent')).toBe(true)
    expect(d.every((x) => x.next === undefined)).toBe(true)
  })

  it('한 글자만 달라도 사용자 값이다(바이트 정확 일치만 전환)', () => {
    const almost = REQ_SCRIPTS['req:new']! + ' '
    const d = decideScripts({ 'req:new': almost })
    expect(d.find((x) => x.key === 'req:new')!.kind).toBe('custom')
  })

  it('혼합(mixed): Stage A·Stage B·사용자 값이 섞여도 각각 독립 판정', () => {
    const d = decideScripts({
      'req:new': REQ_SCRIPTS['req:new']!,
      'req:next': STAGE_B_REQ_SCRIPTS['req:next']!,
      'req:doctor': 'node mine.mjs',
    })
    const byKey = Object.fromEntries(d.map((x) => [x.key, x]))
    expect(byKey['req:new']!.kind).toBe('convert')
    expect(byKey['req:next']!.kind).toBe('stage-b')
    expect(byKey['req:doctor']!.kind).toBe('custom')
    expect(byKey['req:commit']!.kind).toBe('absent')
  })
})

describe('[migrate] dry-run(기본) — 부작용 0건', () => {
  it('쓰기도 삭제도 하지 않는다(전후 snapshot 동일)', () => {
    const dir = tmpStageA()
    try {
      const before = snapshot(dir)
      runMigrate({ dir, apply: false })
      expect(snapshot(dir), 'dry-run은 어떤 파일도 건드리지 않는다').toEqual(before)
    } finally {
      cleanup(dir)
    }
  })

  it('계획에 전환 대상을 정확히 보고한다', () => {
    const dir = tmpStageA()
    try {
      const plan = planMigrate({ dir, apply: false })
      expect(plan.converts.map((d) => d.key).sort()).toEqual(Object.keys(REQ_SCRIPTS).sort())
      expect(plan.customs).toEqual([])
      expect(plan.vendoredPresent).toBe(true)
      const text = renderPlan(plan, false).join('\n')
      expect(text).toContain('dry-run')
      expect(text).toContain('commitgate migrate --apply')
    } finally {
      cleanup(dir)
    }
  })

  it('dry-run은 commitgate 미선언이어도 계획을 낸다(--apply 에서만 fail-closed)', () => {
    const dir = tmpStageA({ noCommitgateDep: true })
    try {
      expect(() => runMigrate({ dir, apply: false })).not.toThrow()
    } finally {
      cleanup(dir)
    }
  })
})

describe('[migrate] --apply — exact-match만 전환, 그 외 전부 보존', () => {
  it('Stage A req:* 5개를 commitgate <verb> 로 전환한다', () => {
    const dir = tmpStageA()
    try {
      runMigrate({ dir, apply: true })
      const pkg = readPkg(dir)
      for (const k of Object.keys(REQ_SCRIPTS)) expect(pkg.scripts[k]).toBe(STAGE_B_REQ_SCRIPTS[k])
    } finally {
      cleanup(dir)
    }
  })

  it('사용자 정의 값은 덮어쓰지 않고 보존 + 수동 조치 안내', () => {
    const dir = tmpStageA({
      scripts: { ...REQ_SCRIPTS, 'req:doctor': 'echo MY-CUSTOM-DOCTOR', build: 'tsc' },
    })
    try {
      const plan = runMigrate({ dir, apply: true })
      const pkg = readPkg(dir)
      expect(pkg.scripts['req:doctor']).toBe('echo MY-CUSTOM-DOCTOR') // 미덮어씀
      expect(pkg.scripts['build']).toBe('tsc') // 무관 스크립트 보존
      expect(pkg.scripts['req:new']).toBe(STAGE_B_REQ_SCRIPTS['req:new']) // 정확 일치분만 전환
      expect(plan.customs.map((d) => d.key)).toEqual(['req:doctor'])
      expect(renderPlan(plan, true).join('\n')).toContain('덮어쓰지 않습니다')
    } finally {
      cleanup(dir)
    }
  })

  it('**비파괴**: scripts/req/**·schema·persona·config·AGENTS·workflow 증거를 삭제하지 않는다', () => {
    const dir = tmpStageA()
    try {
      const before = snapshot(dir)
      runMigrate({ dir, apply: true })
      const after = snapshot(dir)
      // package.json 한 파일만 바뀐다.
      const changed = [...after.keys()].filter((k) => after.get(k) !== before.get(k))
      expect(changed).toEqual(['package.json'])
      // 삭제 0건.
      expect([...before.keys()].filter((k) => !after.has(k)), '삭제된 파일이 있으면 안 된다').toEqual([])
      // 명시적으로 보존 확인.
      for (const p of [
        `${KIT_SOURCE_DIR_REL}/req-new.ts`,
        `${KIT_SOURCE_DIR_REL}/lib/config.ts`,
        'workflow/machine.schema.json',
        'workflow/review-persona.md',
        'workflow/REQ-2026-001/state.json',
        'req.config.json',
        'AGENTS.md',
      ])
        expect(after.has(p), `${p} 가 삭제됐다`).toBe(true)
    } finally {
      cleanup(dir)
    }
  })

  it('멱등: 두 번 실행해도 같은 결과(두 번째는 전환 대상 0건)', () => {
    const dir = tmpStageA()
    try {
      runMigrate({ dir, apply: true })
      const after1 = snapshot(dir)
      const plan2 = runMigrate({ dir, apply: true })
      expect(plan2.converts).toEqual([])
      expect(snapshot(dir)).toEqual(after1)
    } finally {
      cleanup(dir)
    }
  })

  it('devDependencies.commitgate 미선언이면 --apply fail-closed + 쓰기 0건', () => {
    const dir = tmpStageA({ noCommitgateDep: true })
    try {
      const before = snapshot(dir)
      expect(() => runMigrate({ dir, apply: true })).toThrow(/devDependencies\.commitgate[\s\S]*npm install -D commitgate/)
      expect(snapshot(dir), 'fail-closed면 아무것도 쓰지 않는다').toEqual(before)
    } finally {
      cleanup(dir)
    }
  })

  it('사용자 devDependencies·기타 package.json 필드를 보존한다', () => {
    const dir = tmpStageA()
    try {
      const pkgPath = join(dir, 'package.json')
      const p = JSON.parse(readFileSync(pkgPath, 'utf8'))
      p.devDependencies = { ...p.devDependencies, ajv: '^7.0.0' }
      p.private = true
      writeFileSync(pkgPath, JSON.stringify(p, null, 2) + '\n')
      runMigrate({ dir, apply: true })
      const pkg = readPkg(dir) as unknown as Record<string, unknown>
      expect((pkg.devDependencies as Record<string, string>)['ajv']).toBe('^7.0.0')
      expect((pkg.devDependencies as Record<string, string>)['commitgate']).toBe('^0.6.0')
      expect(pkg.private).toBe(true)
    } finally {
      cleanup(dir)
    }
  })
})

describe('[migrate] fail-closed 경계', () => {
  it('git repo가 아니면 throw', () => {
    const dir = mkdtempSync(join(tmpdir(), 'reqwf-migrate-nogit-'))
    try {
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x' }))
      expect(() => planMigrate({ dir, apply: false })).toThrow()
    } finally {
      cleanup(dir)
    }
  })

  it('package.json 없으면 throw', () => {
    const dir = mkdtempSync(join(tmpdir(), 'reqwf-migrate-nopkg-'))
    try {
      execFileSync('git', ['init', '-q'], { cwd: dir })
      expect(() => planMigrate({ dir, apply: false })).toThrow(/package\.json 없음/)
    } finally {
      cleanup(dir)
    }
  })

  it('scripts가 배열이면 throw(모양 검증)', () => {
    const dir = tmpStageA()
    try {
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x', scripts: [] }))
      expect(() => planMigrate({ dir, apply: false })).toThrow(/필드가 객체가 아님/)
    } finally {
      cleanup(dir)
    }
  })

  it('BOM 붙은 package.json도 파싱한다(PowerShell5 UTF8)', () => {
    const dir = tmpStageA()
    try {
      const raw = readFileSync(join(dir, 'package.json'), 'utf8')
      writeFileSync(join(dir, 'package.json'), '﻿' + raw, 'utf8')
      expect(() => planMigrate({ dir, apply: false })).not.toThrow()
    } finally {
      cleanup(dir)
    }
  })
})

describe('[migrate] parseArgs — 기존 CLI 관례(fail-closed)', () => {
  it('기본은 dry-run(apply=false)', () => {
    expect(parseArgs([]).apply).toBe(false)
  })
  it('--apply', () => {
    expect(parseArgs(['--apply']).apply).toBe(true)
  })
  it('--dry-run 명시도 허용', () => {
    expect(parseArgs(['--dry-run']).apply).toBe(false)
  })
  it('--dir 값 누락은 throw', () => {
    expect(() => parseArgs(['--dir'])).toThrow(/--dir 값 누락/)
  })
  it('알 수 없는 인자는 throw(조용히 무시하지 않는다)', () => {
    expect(() => parseArgs(['--bogus'])).toThrow(/알 수 없는 인자/)
    expect(() => parseArgs(['positional'])).toThrow(/알 수 없는 인자/)
  })
})
