import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, symlinkSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  planSync,
  runSync,
  parseArgs,
  normalizeIgnoreLine,
  missingKitIgnoreRules,
  appendIgnoreRules,
  type SyncPlan,
} from '../../bin/sync'
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

// ─────────────────────────────── workflow/.gitignore 보강 축 (REQ-2026-047 phase-2) ──

/**
 * 🔴 kit 규칙 목록을 SUT(`kitGitignoreRules()`)에서 가져와 기대값을 만들면 동어반복이 된다.
 *    가장 중요한 규칙은 **테스트 안에 리터럴로 고정**하고, 최종 판정은 **실제 `git check-ignore`**로 한다.
 */
const REVIEW_CALLS_RULE = '/.review-calls.jsonl'

function seedWorkflowGitignore(dir: string, content: string): string {
  mkdirSync(join(dir, 'workflow'), { recursive: true })
  const p = join(dir, 'workflow', '.gitignore')
  writeFileSync(p, content)
  return p
}

/** 전역 excludes가 check-ignore에 새지 않도록 격리(smoke:102-106과 동일 근거). */
function hermeticGit(dir: string): void {
  const empty = join(dir, '.git', 'info', 'empty-excludes')
  writeFileSync(empty, '')
  writeFileSync(join(dir, '.git', 'info', 'exclude'), '')
  execFileSync('git', ['config', 'core.excludesFile', empty], { cwd: dir })
}

/** `git check-ignore -v` 로 매칭 **출처**까지 확인(종료코드만 보면 무엇이 무시했는지 모른다). */
function ignoredBy(dir: string, rel: string): string | null {
  try {
    const out = execFileSync('git', ['check-ignore', '-v', '--', rel], { cwd: dir, encoding: 'utf8' })
    return (/^(.*?):(\d+):/.exec(out.split('\t')[0] ?? '')?.[1] ?? '').replace(/\\/g, '/')
  } catch {
    return null // 종료코드≠0 = 무시되지 않음
  }
}

describe('[sync] gitignore 축 — 순수 함수(Git 의미론 보존)', () => {
  it('normalizeIgnoreLine: 후행 공백·CR 은 제거하고 앞 공백은 보존한다', () => {
    expect(normalizeIgnoreLine('/.review-calls.jsonl   ')).toBe('/.review-calls.jsonl')
    expect(normalizeIgnoreLine('/.review-calls.jsonl\r')).toBe('/.review-calls.jsonl')
    // 🔴 앞 공백은 gitignore(5)에서 패턴의 일부다 — 제거하면 안 된다.
    expect(normalizeIgnoreLine(' /.review-calls.jsonl')).toBe(' /.review-calls.jsonl')
    // 백슬래시로 이스케이프된 후행 공백은 패턴의 일부라 보존.
    expect(normalizeIgnoreLine('foo\\ ')).toBe('foo\\ ')
  })

  it('missingKitIgnoreRules: 앞 공백이 붙은 행은 동등이 아니라 누락으로 판정한다(design r01 P1)', () => {
    expect(missingKitIgnoreRules(' /.review-calls.jsonl\n', [REVIEW_CALLS_RULE])).toEqual([REVIEW_CALLS_RULE])
    // 정확한 형태면 누락 아님.
    expect(missingKitIgnoreRules('/.review-calls.jsonl\n', [REVIEW_CALLS_RULE])).toEqual([])
    // 후행 공백만 다른 행은 Git이 동일 패턴으로 보므로 누락 아님.
    expect(missingKitIgnoreRules('/.review-calls.jsonl   \n', [REVIEW_CALLS_RULE])).toEqual([])
  })

  it('appendIgnoreRules: 기존 본문을 바꾸지 않고 말미에만 추가하며 개행 관례를 따른다', () => {
    expect(appendIgnoreRules('a\n', ['b'])).toBe('a\nb\n')
    expect(appendIgnoreRules('a', ['b'])).toBe('a\nb\n') // 마지막 개행 없으면 채운다
    expect(appendIgnoreRules('a\r\n', ['b'])).toBe('a\r\nb\r\n') // CRLF 보존
    expect(appendIgnoreRules('a\n', [])).toBe('a\n') // 누락 0건이면 무변경
  })
})

describe('[sync] gitignore 축 — planSync/runSync', () => {
  it('--gitignore 미지정이면 gitignore 축을 완전히 미접촉한다(기본 동작 불변)', () => {
    const dir = mk()
    try {
      seedSchemas(dir, 'shipped')
      seedWorkflowGitignore(dir, '/REQ-*/codex-response.json\n')
      const plan = planSync(dir, cfgFor(dir), false) // 4번째 인자 없음 = 기존 호출부
      expect(plan.assets.some((a) => a.axis === 'gitignore')).toBe(false)
      expect(plan.appends.length).toBe(0)
    } finally {
      rm(dir)
    }
  })

  it('누락 규칙이 있으면 status=rules-missing · appends에 누락 행만 담는다', () => {
    const dir = mk()
    try {
      seedSchemas(dir, 'shipped')
      seedWorkflowGitignore(dir, '/REQ-*/codex-response.json\n')
      const plan = planSync(dir, cfgFor(dir), false, true)
      expect(findAsset(plan, 'workflow/.gitignore')?.status).toBe('rules-missing')
      expect(plan.appends[0]?.missing).toContain(REVIEW_CALLS_RULE)
      // 이미 있던 규칙은 누락 목록에 없다.
      expect(plan.appends[0]?.missing).not.toContain('/REQ-*/codex-response.json')
    } finally {
      rm(dir)
    }
  })

  it('kit 규칙이 전부 있으면 status=in-sync · appends 0건(멱등)', () => {
    const dir = mk()
    try {
      seedSchemas(dir, 'shipped')
      seedWorkflowGitignore(dir, readFileSync(join(PACKAGE_ROOT, 'templates/workflow.gitignore'), 'utf8'))
      const plan = planSync(dir, cfgFor(dir), false, true)
      expect(findAsset(plan, 'workflow/.gitignore')?.status).toBe('in-sync')
      expect(plan.appends.length).toBe(0)
    } finally {
      rm(dir)
    }
  })

  it('파일 부재면 kit 템플릿 전체로 생성(writes 경유)', () => {
    const dir = mk()
    try {
      seedSchemas(dir, 'shipped')
      const plan = planSync(dir, cfgFor(dir), false, true)
      expect(findAsset(plan, 'workflow/.gitignore')?.status).toBe('new')
      expect(inWrites(plan, 'workflow/.gitignore')).toBe(true)
    } finally {
      rm(dir)
    }
  })

  it('dry-run 은 아무것도 쓰지 않는다', () => {
    const dir = mk()
    try {
      gitInit(dir)
      seedSchemas(dir, 'shipped')
      const before = '/REQ-*/codex-response.json\n'
      const p = seedWorkflowGitignore(dir, before)
      runSync({ dir, apply: false, persona: false, gitignore: true })
      expect(readFileSync(p, 'utf8')).toBe(before)
    } finally {
      rm(dir)
    }
  })

  it('--apply: 사용자 커스텀 행·주석을 보존하고 누락 규칙만 말미에 추가한다(재실행 멱등)', () => {
    const dir = mk()
    try {
      gitInit(dir)
      seedSchemas(dir, 'shipped')
      const before = '# 우리 팀 정책\n/REQ-*/codex-response.json\nmy-local-scratch/\n'
      const p = seedWorkflowGitignore(dir, before)
      runSync({ dir, apply: true, persona: false, gitignore: true })
      const after = readFileSync(p, 'utf8')
      expect(after.startsWith(before)).toBe(true) // 기존 본문이 한 글자도 안 바뀐 채 앞에 남는다
      expect(after).toContain(REVIEW_CALLS_RULE)
      // 두 번 돌려도 중복되지 않는다(멱등).
      runSync({ dir, apply: true, persona: false, gitignore: true })
      const twice = readFileSync(p, 'utf8')
      expect(twice).toBe(after)
      expect(twice.split(REVIEW_CALLS_RULE).length - 1).toBe(1)
    } finally {
      rm(dir)
    }
  })

  /**
   * 🔴 design r01 P1 회귀 고정. 앞 공백이 붙은 행은 Git이 **다른 패턴**으로 보므로 파일이 실제로는
   * 무시되지 않는다. 트림 비교였다면 "이미 있다"고 오판해 append를 건너뛰고 P0가 재발한다.
   * 판정 오라클은 **실제 `git check-ignore`** 다(문자열 비교 아님).
   */
  it('앞 공백만 있는 행은 무시가 성립하지 않으므로 정확한 규칙을 추가한다(실제 git check-ignore 검증)', () => {
    const dir = mk()
    try {
      gitInit(dir)
      hermeticGit(dir)
      seedSchemas(dir, 'shipped')
      seedWorkflowGitignore(dir, ' /.review-calls.jsonl\n') // 앞 공백 — Git은 이걸로 무시하지 않는다
      writeFileSync(join(dir, 'workflow', '.review-calls.jsonl'), '{}\n')

      // 전제 확인: 보강 전에는 무시되지 않는다(테스트가 공허하지 않음을 증명).
      expect(ignoredBy(dir, 'workflow/.review-calls.jsonl')).toBeNull()

      runSync({ dir, apply: true, persona: false, gitignore: true })

      // 보강 후에는 workflow/.gitignore 가 실제로 무시한다.
      expect(ignoredBy(dir, 'workflow/.review-calls.jsonl')).toBe('workflow/.gitignore')
    } finally {
      rm(dir)
    }
  })

  it('parseArgs: --gitignore 를 인식하고 기본은 false', () => {
    expect(parseArgs(['--gitignore']).gitignore).toBe(true)
    expect(parseArgs([]).gitignore).toBe(false)
  })
})
