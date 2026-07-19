import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, symlinkSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { planSync, runSync, parseArgs, type SyncPlan } from '../../bin/sync'
import { PACKAGE_ROOT, KIT_SCHEMA_RELPATHS, sha256File } from '../../bin/init'
import { loadConfig, DEFAULT_REVIEW_PERSONA_RELPATH } from '../../scripts/req/lib/config'

const SCHEMA_REL = 'workflow/machine.schema.json'
const PERSONA_REL = DEFAULT_REVIEW_PERSONA_RELPATH

const mk = (): string => mkdtempSync(join(tmpdir(), 'cg-sync-'))
const rm = (d: string): void => rmSync(d, { recursive: true, force: true })
const cfgFor = (dir: string): ReturnType<typeof loadConfig> => loadConfig({ root: dir })
const findAsset = (plan: SyncPlan, rel: string): SyncPlan['assets'][number] | undefined => plan.assets.find((a) => a.rel === rel)
const inWrites = (plan: SyncPlan, rel: string): boolean => plan.writes.some((w) => w.destRel === rel)

function gitInit(dir: string): void {
  execFileSync('git', ['init', '-q'], { cwd: dir })
}

/** KIT_SCHEMA_RELPATHS 2종을 shipped 원본으로(in-sync) 또는 stale 내용으로 씀. */
function seedSchemas(dir: string, mode: 'shipped' | 'stale'): void {
  mkdirSync(join(dir, 'workflow'), { recursive: true })
  for (const rel of KIT_SCHEMA_RELPATHS) {
    const content = mode === 'shipped' ? readFileSync(join(PACKAGE_ROOT, rel), 'utf8') : `{"stale":"0.7.0","_rel":"${rel}"}`
    writeFileSync(join(dir, rel), content)
  }
}

describe('[sync] planSync — 스키마 축(계약 = --force 축)', () => {
  it('stale 스키마 → status=stale · writes에 포함', () => {
    const dir = mk()
    try {
      seedSchemas(dir, 'stale')
      const plan = planSync(dir, cfgFor(dir), false)
      expect(findAsset(plan, SCHEMA_REL)?.status).toBe('stale')
      expect(inWrites(plan, SCHEMA_REL)).toBe(true)
    } finally {
      rm(dir)
    }
  })

  it('shipped와 동일 → status=in-sync · writes 제외(멱등)', () => {
    const dir = mk()
    try {
      seedSchemas(dir, 'shipped')
      const plan = planSync(dir, cfgFor(dir), false)
      expect(findAsset(plan, SCHEMA_REL)?.status).toBe('in-sync')
      expect(inWrites(plan, SCHEMA_REL)).toBe(false)
      expect(plan.writes.length).toBe(0)
    } finally {
      rm(dir)
    }
  })

  it('부재 → status=new · writes에 포함', () => {
    const dir = mk()
    try {
      const plan = planSync(dir, cfgFor(dir), false)
      expect(findAsset(plan, SCHEMA_REL)?.status).toBe('new')
      expect(inWrites(plan, SCHEMA_REL)).toBe(true)
    } finally {
      rm(dir)
    }
  })
})

describe('[sync] planSync — 페르소나(opt-in · 파괴적 쓰기 0건)', () => {
  it('--persona 없으면 페르소나 자산 없음(완전 미접촉)', () => {
    const dir = mk()
    try {
      seedSchemas(dir, 'shipped')
      const plan = planSync(dir, cfgFor(dir), false)
      expect(plan.assets.some((a) => a.axis === 'persona')).toBe(false)
    } finally {
      rm(dir)
    }
  })

  it('--persona + 기본경로 + 차이 → preserved-differs · 절대 미기록(design-r02 P1)', () => {
    const dir = mk()
    try {
      seedSchemas(dir, 'shipped')
      writeFileSync(join(dir, PERSONA_REL), '# 사용자가 직접 고친 persona\n')
      const plan = planSync(dir, cfgFor(dir), true)
      expect(findAsset(plan, PERSONA_REL)?.status).toBe('preserved-differs')
      expect(inWrites(plan, PERSONA_REL)).toBe(false)
    } finally {
      rm(dir)
    }
  })

  it('--persona + 기본경로 + 부재 → new · 부재 복원(writes 포함)', () => {
    const dir = mk()
    try {
      seedSchemas(dir, 'shipped')
      const plan = planSync(dir, cfgFor(dir), true)
      expect(findAsset(plan, PERSONA_REL)?.status).toBe('new')
      expect(inWrites(plan, PERSONA_REL)).toBe(true)
    } finally {
      rm(dir)
    }
  })

  it('--persona + custom 경로 → unmanaged-custom · 미접촉', () => {
    const dir = mk()
    try {
      seedSchemas(dir, 'shipped')
      writeFileSync(join(dir, 'req.config.json'), JSON.stringify({ reviewPersonaPath: 'docs/my-persona.md' }))
      const plan = planSync(dir, cfgFor(dir), true)
      const p = plan.assets.find((a) => a.axis === 'persona')
      expect(p?.status).toBe('unmanaged-custom')
      expect(plan.writes.some((w) => w.destRel.includes('persona'))).toBe(false)
    } finally {
      rm(dir)
    }
  })

  it('--persona + reviewPersonaPath:null → unmanaged-null · 미접촉', () => {
    const dir = mk()
    try {
      seedSchemas(dir, 'shipped')
      writeFileSync(join(dir, 'req.config.json'), JSON.stringify({ reviewPersonaPath: null }))
      const plan = planSync(dir, cfgFor(dir), true)
      const p = plan.assets.find((a) => a.axis === 'persona')
      expect(p?.status).toBe('unmanaged-null')
    } finally {
      rm(dir)
    }
  })
})

describe('[sync] planSync — confinement(재구현 없이 init.statWritableDest 재사용)', () => {
  it('workflow 상위가 symlink면 throw(대상 밖 쓰기 거부)', () => {
    const dir = mk()
    const ext = mk()
    try {
      try {
        symlinkSync(ext, join(dir, 'workflow'), 'dir')
      } catch {
        return // symlink 권한 없는 환경(Windows) — skip
      }
      expect(() => planSync(dir, cfgFor(dir), false)).toThrow(/confinement|symlink/)
    } finally {
      rm(dir)
      rm(ext)
    }
  })
})

describe('[sync] runSync — packageRoot 가드(fail-closed)', () => {
  it('대상이 CommitGate 패키지 자신이면 어떤 쓰기 전에도 거부', () => {
    expect(() => runSync({ dir: PACKAGE_ROOT, apply: false, persona: false })).toThrow(/패키지 자신/)
  })
})

describe('[sync] runSync --apply', () => {
  it('stale 스키마를 shipped 사본으로 갱신한다', () => {
    const dir = mk()
    try {
      gitInit(dir)
      seedSchemas(dir, 'stale')
      runSync({ dir, apply: true, persona: false })
      for (const rel of KIT_SCHEMA_RELPATHS)
        expect(sha256File(join(dir, rel)), rel).toBe(sha256File(join(PACKAGE_ROOT, rel)))
    } finally {
      rm(dir)
    }
  })

  it('기본경로 수정 persona는 --apply --persona 여도 불변(사용자 편집 보존, design-r02 P1)', () => {
    const dir = mk()
    try {
      gitInit(dir)
      seedSchemas(dir, 'shipped')
      const edited = '# 사용자 편집 persona — 덮이면 안 된다\n'
      writeFileSync(join(dir, PERSONA_REL), edited)
      runSync({ dir, apply: true, persona: true })
      expect(readFileSync(join(dir, PERSONA_REL), 'utf8')).toBe(edited)
    } finally {
      rm(dir)
    }
  })

  it('부재 persona는 --apply --persona로 복원된다', () => {
    const dir = mk()
    try {
      gitInit(dir)
      seedSchemas(dir, 'shipped')
      expect(existsSync(join(dir, PERSONA_REL))).toBe(false)
      runSync({ dir, apply: true, persona: true })
      expect(sha256File(join(dir, PERSONA_REL))).toBe(sha256File(join(PACKAGE_ROOT, PERSONA_REL)))
    } finally {
      rm(dir)
    }
  })

  it('apply 후 재실행은 멱등(writes 0건)', () => {
    const dir = mk()
    try {
      gitInit(dir)
      seedSchemas(dir, 'stale')
      runSync({ dir, apply: true, persona: false })
      const plan2 = planSync(dir, cfgFor(dir), false)
      expect(plan2.writes.length).toBe(0)
      expect(plan2.assets.every((a) => a.status === 'in-sync')).toBe(true)
    } finally {
      rm(dir)
    }
  })
})

describe('[sync] parseArgs', () => {
  it('--apply --persona --dir 파싱', () => {
    const o = parseArgs(['--apply', '--persona', '--dir', '/tmp/x'])
    expect(o.apply).toBe(true)
    expect(o.persona).toBe(true)
    expect(o.dir.replace(/\\/g, '/')).toMatch(/\/tmp\/x$|x$/)
  })
  it('기본은 dry-run(apply=false) · persona=false', () => {
    const o = parseArgs([])
    expect(o.apply).toBe(false)
    expect(o.persona).toBe(false)
  })
  it('알 수 없는 인자는 throw(fail-closed)', () => {
    expect(() => parseArgs(['--bogus'])).toThrow(/알 수 없는/)
  })
})
