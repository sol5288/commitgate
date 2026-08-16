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
  hasPersonaKitMarker,
  renderPersonaDiff,
  PERSONA_KIT_MARKER,
  PERSONA_DIFF_MAX_LINES,
  applyScriptInsert,
  detectJsonIndent,
  findScriptsObjectSpan,
  type SyncPlan,
} from '../../bin/sync'
import { expectedReqScripts } from '../../scripts/req/lib/command-surface'
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
  // REQ-2026-049: repo-local identity. 인라인 `-c`는 그 호출에만 적용돼 **피시험 코드의 커밋**을 보호하지 못한다.
  execFileSync('git', ['config', 'user.email', 't@t.t'], { cwd: dir })
  execFileSync('git', ['config', 'user.name', 't'], { cwd: dir })
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

// ─────────────────────────── REQ-2026-050: persona managed-drift 경로 ───────────────────────────
//
// 왜 이 경로가 생겼나: 0.9.8까지 persona 차이는 `preserved-differs`로 **미접촉**만 했다. 안전하지만
// 갱신 경로가 아예 없어, 배포된 리뷰 정책이 기존 프로젝트에 **영영 도달하지 못했다**(design-r02 P1).
// 이제 두 status 모두 "적용 전 실제 내용 diff → 이중 플래그 opt-in → 백업 → 교체"를 탄다.
// 마커는 **차단 조건이 아니라 경고 강도**다.

const shippedPersona = (): string => readFileSync(join(PACKAGE_ROOT, PERSONA_REL), 'utf8')

/** kit 계보(마커 有)이면서 shipped와는 다른 persona를 심는다. */
function seedMarkedDrift(dir: string): void {
  mkdirSync(join(dir, 'workflow'), { recursive: true })
  writeFileSync(join(dir, PERSONA_REL), shippedPersona() + '\n<!-- 사용자가 덧붙인 절 -->\n')
}

/** 마커 없는(직접 작성 가능성) persona를 심는다. */
function seedUnmarkedDrift(dir: string): void {
  mkdirSync(join(dir, 'workflow'), { recursive: true })
  writeFileSync(join(dir, PERSONA_REL), '# 내가 처음부터 쓴 persona\n')
}

const UNMARKED_BODY = '# 내가 처음부터 쓴 persona\n'

/** deps 스텁 — diff 텍스트·이벤트 순서를 관측한다. 실제 git을 호출하지 않는다. */
function stubDeps(diffText = '@@ -1 +1 @@\n-old line\n+new line\n') {
  const events: string[] = []
  const lines: string[] = []
  return {
    events,
    lines,
    deps: {
      diff: (): string => {
        events.push('diff-produced')
        return diffText
      },
      backup: (): void => {
        events.push('backup')
      },
      log: (l: string): void => {
        lines.push(l)
        if (l.includes('-old line') || l.includes('+new line')) events.push('diff-printed')
      },
    },
  }
}

describe('[sync] hasPersonaKitMarker — 계보 판정(순수)', () => {
  it('첫 줄이 마커면 true', () => {
    expect(hasPersonaKitMarker(PERSONA_KIT_MARKER + '\n# Reviewer\n')).toBe(true)
  })
  it('CRLF·BOM·선행 공백에 무관하다', () => {
    expect(hasPersonaKitMarker('﻿  ' + PERSONA_KIT_MARKER + '  \r\n# Reviewer\r\n')).toBe(true)
  })
  it('둘째 줄에 있으면 false(첫 줄만 본다)', () => {
    expect(hasPersonaKitMarker('# Reviewer\n' + PERSONA_KIT_MARKER + '\n')).toBe(false)
  })
  it('마커가 없으면 false', () => {
    expect(hasPersonaKitMarker('# Reviewer\n')).toBe(false)
  })
  it('shipped persona에는 마커가 있다(phase-1 산출물과의 결속)', () => {
    expect(hasPersonaKitMarker(shippedPersona())).toBe(true)
  })
})

describe('[sync] planSync — persona 마커 유무 2분기', () => {
  it('① 마커 有 · shipped와 다름 → managed-drift', () => {
    const dir = mk()
    try {
      seedSchemas(dir, 'shipped')
      seedMarkedDrift(dir)
      const plan = planSync(dir, cfgFor(dir), true)
      expect(findAsset(plan, PERSONA_REL)?.status).toBe('managed-drift')
      expect(plan.personaDiff?.unmarked).toBe(false)
    } finally {
      rm(dir)
    }
  })

  it('② 마커 無 · 다름 → preserved-differs(기존 식별자 유지)', () => {
    const dir = mk()
    try {
      seedSchemas(dir, 'shipped')
      seedUnmarkedDrift(dir)
      const plan = planSync(dir, cfgFor(dir), true)
      expect(findAsset(plan, PERSONA_REL)?.status).toBe('preserved-differs')
      expect(plan.personaDiff?.unmarked).toBe(true)
    } finally {
      rm(dir)
    }
  })

  it('③ --persona-apply 없으면 두 status 모두 writes 0건', () => {
    for (const seed of [seedMarkedDrift, seedUnmarkedDrift]) {
      const dir = mk()
      try {
        seedSchemas(dir, 'shipped')
        seed(dir)
        const plan = planSync(dir, cfgFor(dir), true, false, false)
        expect(inWrites(plan, PERSONA_REL)).toBe(false)
        expect(plan.backups.length).toBe(0)
      } finally {
        rm(dir)
      }
    }
  })

  it('--persona-apply 면 두 status 모두 writes + backups에 들어간다', () => {
    for (const seed of [seedMarkedDrift, seedUnmarkedDrift]) {
      const dir = mk()
      try {
        seedSchemas(dir, 'shipped')
        seed(dir)
        const plan = planSync(dir, cfgFor(dir), true, false, true)
        expect(inWrites(plan, PERSONA_REL)).toBe(true)
        expect(plan.backups).toEqual([{ srcRel: PERSONA_REL, bakRel: PERSONA_REL + '.bak' }])
      } finally {
        rm(dir)
      }
    }
  })

  it('⑫ unmanaged(custom·null)는 --persona-apply 여도 writes 0건', () => {
    for (const raw of [{ reviewPersonaPath: 'docs/my-persona.md' }, { reviewPersonaPath: null }]) {
      const dir = mk()
      try {
        seedSchemas(dir, 'shipped')
        writeFileSync(join(dir, 'req.config.json'), JSON.stringify(raw))
        const plan = planSync(dir, cfgFor(dir), true, false, true)
        expect(plan.writes.some((w) => w.destRel.includes('persona'))).toBe(false)
        expect(plan.backups.length).toBe(0)
        expect(plan.personaDiff).toBeNull()
      } finally {
        rm(dir)
      }
    }
  })
})

describe('[sync] renderPersonaDiff — 실제 내용 diff 표시', () => {
  const d = {
    shippedAbs: '/pkg/workflow/review-persona.md',
    targetAbs: '/t/workflow/review-persona.md',
    targetRel: PERSONA_REL,
    unmarked: false,
  }

  it('④ 실제 변경 행이 출력에 포함된다(요약이 아니다)', () => {
    const out = renderPersonaDiff('@@ -1 +1 @@\n-옛 문장\n+새 문장\n', d).join('\n')
    expect(out).toContain('-옛 문장')
    expect(out).toContain('+새 문장')
  })

  it('⑤ 상한 초과면 절단 표시 + shipped 절대경로를 낸다', () => {
    const many = Array.from({ length: PERSONA_DIFF_MAX_LINES + 50 }, (_, i) => '+line ' + i).join('\n')
    const out = renderPersonaDiff(many, d).join('\n')
    expect(out).toContain('출력 상한 ' + PERSONA_DIFF_MAX_LINES + '행에서 잘림')
    expect(out).toContain('50행 더 있음')
    expect(out).toContain(d.shippedAbs)
  })

  it('상한 이내면 절단 표시가 없다', () => {
    expect(renderPersonaDiff('+one\n+two\n', d).join('\n')).not.toContain('잘림')
  })

  it('⑪ 마커 없으면 "직접 작성했을 수 있다" 경고가 붙고, 있으면 안 붙는다', () => {
    const marked = renderPersonaDiff('+x\n', { ...d, unmarked: false }).join('\n')
    const unmarked = renderPersonaDiff('+x\n', { ...d, unmarked: true }).join('\n')
    expect(unmarked).toContain('직접 작성했을 수 있습니다')
    expect(marked).not.toContain('직접 작성했을 수 있습니다')
  })

  it('diff 텍스트가 비면 그 사실을 숨기지 않고 알린다', () => {
    expect(renderPersonaDiff('', d).join('\n')).toContain('diff 출력이 비어 있습니다')
  })
})

describe('[sync] runSync — persona 교체의 fail-closed 계약', () => {
  it('⑨ 정상 경로: 마커 無(pre-050 설치분)에서도 .bak 생성 후 교체된다', () => {
    const dir = mk()
    try {
      gitInit(dir)
      seedSchemas(dir, 'shipped')
      seedUnmarkedDrift(dir)
      const st = stubDeps()
      runSync(
        { dir, apply: true, persona: true, personaApply: true },
        { ...st.deps, backup: (s: string, b: string): void => writeFileSync(b, readFileSync(s)) },
      )
      expect(existsSync(join(dir, PERSONA_REL + '.bak'))).toBe(true)
      expect(readFileSync(join(dir, PERSONA_REL + '.bak'), 'utf8')).toBe(UNMARKED_BODY)
      expect(readFileSync(join(dir, PERSONA_REL), 'utf8')).toBe(shippedPersona())
    } finally {
      rm(dir)
    }
  })

  it('교체된 파일에는 마커가 생겨 다음부터 managed-drift로 판정된다', () => {
    const dir = mk()
    try {
      gitInit(dir)
      seedSchemas(dir, 'shipped')
      seedUnmarkedDrift(dir)
      const st = stubDeps()
      runSync(
        { dir, apply: true, persona: true, personaApply: true },
        { ...st.deps, backup: (s: string, b: string): void => writeFileSync(b, readFileSync(s)) },
      )
      expect(hasPersonaKitMarker(readFileSync(join(dir, PERSONA_REL), 'utf8'))).toBe(true)
    } finally {
      rm(dir)
    }
  })

  it('⑥ diff 출력이 어떤 파일 쓰기보다 먼저다(백업 시점에 대상은 아직 원본)', () => {
    const dir = mk()
    try {
      gitInit(dir)
      seedSchemas(dir, 'shipped')
      seedUnmarkedDrift(dir)
      const st = stubDeps()
      let contentAtBackup = ''
      runSync(
        { dir, apply: true, persona: true, personaApply: true },
        {
          ...st.deps,
          backup: (s: string, b: string): void => {
            st.events.push('backup')
            contentAtBackup = readFileSync(join(dir, PERSONA_REL), 'utf8')
            writeFileSync(b, readFileSync(s))
          },
        },
      )
      expect(st.events.indexOf('diff-printed')).toBeGreaterThan(-1)
      expect(st.events.indexOf('backup')).toBeGreaterThan(st.events.indexOf('diff-printed'))
      // 백업 시점에도 대상은 **아직 교체 전**이다 = diff가 사후 설명이 아니다.
      expect(contentAtBackup).toBe(UNMARKED_BODY)
    } finally {
      rm(dir)
    }
  })

  it('⑦ diff 생산 실패 → 교체하지 않는다(fail-closed)', () => {
    const dir = mk()
    try {
      gitInit(dir)
      seedSchemas(dir, 'shipped')
      seedUnmarkedDrift(dir)
      const st = stubDeps()
      const plan = runSync(
        { dir, apply: true, persona: true, personaApply: true },
        {
          ...st.deps,
          diff: (): string => {
            throw new Error('git diff --no-index 실패(exit=128)')
          },
        },
      )
      expect(inWrites(plan, PERSONA_REL)).toBe(false)
      expect(readFileSync(join(dir, PERSONA_REL), 'utf8')).toBe(UNMARKED_BODY)
      expect(st.lines.join('\n')).toContain('diff 없이는 교체하지 않습니다')
    } finally {
      rm(dir)
    }
  })

  it('⑧ 백업 실패 → 교체하지 않는다(fail-closed)', () => {
    const dir = mk()
    try {
      gitInit(dir)
      seedSchemas(dir, 'shipped')
      seedUnmarkedDrift(dir)
      const st = stubDeps()
      runSync(
        { dir, apply: true, persona: true, personaApply: true },
        {
          ...st.deps,
          backup: (): void => {
            throw new Error('EACCES')
          },
        },
      )
      expect(readFileSync(join(dir, PERSONA_REL), 'utf8')).toBe(UNMARKED_BODY)
      expect(existsSync(join(dir, PERSONA_REL + '.bak'))).toBe(false)
      expect(st.lines.join('\n')).toContain('백업 없이는 교체하지 않습니다')
    } finally {
      rm(dir)
    }
  })

  it('③ --persona-apply 없이 --apply 만 → 교체 안 함 · diff는 그래도 보여준다', () => {
    const dir = mk()
    try {
      gitInit(dir)
      seedSchemas(dir, 'shipped')
      seedUnmarkedDrift(dir)
      const st = stubDeps()
      runSync({ dir, apply: true, persona: true }, st.deps)
      expect(readFileSync(join(dir, PERSONA_REL), 'utf8')).toBe(UNMARKED_BODY)
      expect(st.events).toContain('diff-printed')
      expect(st.lines.join('\n')).toContain('--persona-apply')
    } finally {
      rm(dir)
    }
  })

  it('④ dry-run(--apply 없음)에서도 diff를 보여준다 — 적용 전에 봐야 고를 수 있다', () => {
    const dir = mk()
    try {
      gitInit(dir)
      seedSchemas(dir, 'shipped')
      seedMarkedDrift(dir)
      const st = stubDeps()
      runSync({ dir, apply: false, persona: true }, st.deps)
      expect(st.events).toContain('diff-printed')
    } finally {
      rm(dir)
    }
  })

  it('⑩ --persona 없이 --persona-apply 만 → persona 축 완전 미접촉', () => {
    const dir = mk()
    try {
      gitInit(dir)
      seedSchemas(dir, 'shipped')
      seedUnmarkedDrift(dir)
      const st = stubDeps()
      const plan = runSync({ dir, apply: true, persona: false, personaApply: true }, st.deps)
      expect(plan.assets.some((a) => a.axis === 'persona')).toBe(false)
      expect(plan.personaDiff).toBeNull()
      expect(readFileSync(join(dir, PERSONA_REL), 'utf8')).toBe(UNMARKED_BODY)
      expect(st.lines.join('\n')).toContain('--persona-apply 는 --persona 를 함의하지 않습니다')
    } finally {
      rm(dir)
    }
  })

  it('in-sync persona는 diff도 교체도 없다(멱등)', () => {
    const dir = mk()
    try {
      gitInit(dir)
      seedSchemas(dir, 'shipped')
      mkdirSync(join(dir, 'workflow'), { recursive: true })
      writeFileSync(join(dir, PERSONA_REL), shippedPersona())
      const st = stubDeps()
      const plan = runSync({ dir, apply: true, persona: true, personaApply: true }, st.deps)
      expect(findAsset(plan, PERSONA_REL)?.status).toBe('in-sync')
      expect(plan.personaDiff).toBeNull()
      expect(st.events).not.toContain('diff-produced')
    } finally {
      rm(dir)
    }
  })
})

describe('[sync] parseArgs — --persona-apply', () => {
  it('--persona-apply 를 인식한다', () => {
    expect(parseArgs(['--persona', '--persona-apply']).personaApply).toBe(true)
  })
  it('기본값은 false(기존 동작 불변)', () => {
    expect(parseArgs(['--persona']).personaApply).toBe(false)
  })
  it('--persona-apply 는 --persona 를 함의하지 않는다', () => {
    const o = parseArgs(['--persona-apply'])
    expect(o.personaApply).toBe(true)
    expect(o.persona).toBe(false)
  })
})

/**
 * `--scripts` — `package.json` 의 누락 `req:*` 백필 (REQ-2026-161 phase-2).
 *
 * 🔴 이 축의 헤드라인 단언 둘:
 *   1. **플래그가 없으면 `package.json` 을 열지도 않는다** — 세 문서가 공표한 "sync 는 package.json 을
 *      건드리지 않는다"가 기본 동작으로 그대로 남는다는 회귀 가드다.
 *   2. **insert-only** — 사용자가 바꿔 둔 값은 한 글자도 안 바뀐다(`init` 이 Stage A 시절부터 지킨 규칙).
 */
describe('[sync] --scripts — 누락 req:* 백필(opt-in · insert-only)', () => {
  const PKG_4SPACE = `{
    "name": "probe",
    "scripts": {
        "build": "vite build",
        "req:new": "commitgate req:new",
        "req:commit": "my-custom-wrapper --keep"
    }
}
`
  const seedPkg = (dir: string, body = PKG_4SPACE): void => writeFileSync(join(dir, 'package.json'), body, 'utf8')
  const scriptsOf = (dir: string): Record<string, string> =>
    (JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { scripts: Record<string, string> }).scripts

  it('🔴 플래그 없으면 scripts 축이 계획에 아예 없다(기본 동작 불변)', () => {
    const dir = mk()
    try {
      gitInit(dir)
      seedSchemas(dir, 'shipped')
      seedPkg(dir)
      const plan = planSync(dir, cfgFor(dir), false)
      expect(plan.assets.some((a) => a.axis === 'scripts')).toBe(false)
      expect(plan.scriptInsert ?? null).toBeNull()
    } finally {
      rm(dir)
    }
  })

  it('--scripts: 누락 키를 계획에 담는다(이미 있는 키는 제외)', () => {
    const dir = mk()
    try {
      gitInit(dir)
      seedSchemas(dir, 'shipped')
      seedPkg(dir)
      const plan = planSync(dir, cfgFor(dir), false, false, false, true)
      const a = findAsset(plan, 'package.json')
      expect(a?.axis).toBe('scripts')
      expect(a?.status).toBe('keys-missing')
      const keys = Object.keys(plan.scriptInsert?.missing ?? {})
      expect(keys).toContain('req:delegate')
      expect(keys).not.toContain('req:new') // 이미 있음
      expect(keys).not.toContain('req:commit') // 사용자 정의 값이지만 **있으므로** 대상 아님
    } finally {
      rm(dir)
    }
  })

  it('전부 있으면 in-sync · 삽입 계획 없음(멱등)', () => {
    const dir = mk()
    try {
      gitInit(dir)
      seedSchemas(dir, 'shipped')
      seedPkg(dir, JSON.stringify({ scripts: expectedReqScripts() }, null, 2) + '\n')
      const plan = planSync(dir, cfgFor(dir), false, false, false, true)
      expect(findAsset(plan, 'package.json')?.status).toBe('in-sync')
      expect(plan.scriptInsert ?? null).toBeNull()
    } finally {
      rm(dir)
    }
  })

  it('🔴 package.json 을 읽지 못하면 "부족"이 아니라 unreadable(미접촉)', () => {
    const dir = mk()
    try {
      gitInit(dir)
      seedSchemas(dir, 'shipped')
      seedPkg(dir, '{ not json')
      const plan = planSync(dir, cfgFor(dir), false, false, false, true)
      expect(findAsset(dir === '' ? plan : plan, 'package.json')?.status).toBe('unreadable')
      expect(plan.scriptInsert ?? null).toBeNull()
    } finally {
      rm(dir)
    }
  })

  it('🔴 dry-run(--scripts, --apply 없음)은 파일을 바꾸지 않는다', () => {
    const dir = mk()
    try {
      gitInit(dir)
      seedSchemas(dir, 'shipped')
      seedPkg(dir)
      const before = readFileSync(join(dir, 'package.json'), 'utf8')
      runSync({ dir, apply: false, persona: false, scripts: true }, { log: () => {} })
      expect(readFileSync(join(dir, 'package.json'), 'utf8')).toBe(before)
    } finally {
      rm(dir)
    }
  })

  it('🔴 --apply --scripts: 없는 키만 넣고 사용자 정의 값은 보존한다', () => {
    const dir = mk()
    try {
      gitInit(dir)
      seedSchemas(dir, 'shipped')
      seedPkg(dir)
      runSync({ dir, apply: true, persona: false, scripts: true }, { log: () => {} })
      const after = scriptsOf(dir)
      expect(after['req:delegate']).toBe('commitgate req:delegate')
      expect(after['req:commit']).toBe('my-custom-wrapper --keep') // 🔴 덮지 않는다
      expect(after['build']).toBe('vite build') // 무관한 키도 그대로
      for (const k of Object.keys(expectedReqScripts())) expect(after).toHaveProperty(k)
    } finally {
      rm(dir)
    }
  })

  it('🔴 들여쓰기·키 순서·말미 개행을 보존한다(diff 가 삽입한 키로 한정된다)', () => {
    const dir = mk()
    try {
      gitInit(dir)
      seedSchemas(dir, 'shipped')
      seedPkg(dir)
      runSync({ dir, apply: true, persona: false, scripts: true }, { log: () => {} })
      const raw = readFileSync(join(dir, 'package.json'), 'utf8')
      expect(raw).toContain('\n    "name": "probe"') // 4-space 유지(2-space 로 재포맷하지 않는다)
      expect(raw.endsWith('\n')).toBe(true)
      const keys = Object.keys(scriptsOf(dir))
      expect(keys.slice(0, 3)).toEqual(['build', 'req:new', 'req:commit']) // 기존 순서 그대로, 새 키는 뒤에
    } finally {
      rm(dir)
    }
  })

  it('멱등: 두 번 적용해도 두 번째는 변경 없음', () => {
    const dir = mk()
    try {
      gitInit(dir)
      seedSchemas(dir, 'shipped')
      seedPkg(dir)
      runSync({ dir, apply: true, persona: false, scripts: true }, { log: () => {} })
      const once = readFileSync(join(dir, 'package.json'), 'utf8')
      runSync({ dir, apply: true, persona: false, scripts: true }, { log: () => {} })
      expect(readFileSync(join(dir, 'package.json'), 'utf8')).toBe(once)
    } finally {
      rm(dir)
    }
  })

  it('scripts 가 객체가 아니면 삽입하지 않고 실패한다(fail-closed)', () => {
    const dir = mk()
    try {
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: 'nope' }), 'utf8')
      expect(() => applyScriptInsert(dir, { destRel: 'package.json', missing: { 'req:new': 'x' } })).toThrow('객체가 아닙니다')
    } finally {
      rm(dir)
    }
  })

  it('계획 이후 키가 채워졌으면 덮지 않고 빈 결과를 낸다(TOCTOU)', () => {
    const dir = mk()
    try {
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { 'req:new': '기존값' } }, null, 2), 'utf8')
      const added = applyScriptInsert(dir, { destRel: 'package.json', missing: { 'req:new': 'commitgate req:new' } })
      expect(added).toEqual([])
      expect(scriptsOf(dir)['req:new']).toBe('기존값')
    } finally {
      rm(dir)
    }
  })

  it('parseArgs 가 --scripts 를 받는다', () => {
    expect(parseArgs(['--scripts']).scripts).toBe(true)
    expect(parseArgs([]).scripts).toBe(false)
    expect(parseArgs(['--apply', '--scripts']).scripts).toBe(true)
  })

  it('들여쓰기 판정: 2·4·탭·판정불가', () => {
    expect(detectJsonIndent('{\n  "a": 1\n}')).toBe(2)
    expect(detectJsonIndent('{\n    "a": 1\n}')).toBe(4)
    expect(detectJsonIndent('{\n\t"a": 1\n}')).toBe('\t')
    expect(detectJsonIndent('{"a":1}')).toBe(2)
  })

})

/**
 * 원문 보존 — phase-2 r01 P1 두 건의 회귀 가드.
 *
 * 🔴 `JSON.stringify` 왕복은 **기존 값의 원문 표현을 바꾼다**. "부재만 삽입·기존 값 바이트 불변"은
 *    선언이 아니라 검사로 지켜야 한다.
 */
describe('[sync] --scripts — 원문 보존(재직렬화 금지 · BOM)', () => {
  const scriptsOf = (dir: string): Record<string, string> =>
    (JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8').replace(/^﻿/, '')) as {
      scripts: Record<string, string>
    }).scripts

  it('🔴 기존 값의 원문 표현이 바뀌지 않는다(이스케이프·숫자 리터럴)', () => {
    const dir = mk()
    try {
      const body = `{
  "version": 1e+0,
  "homepage": "http:\/\/example.com",
  "scripts": {
    "build": "node .\/build",
    "req:new": "commitgate req:new"
  }
}
`
      writeFileSync(join(dir, 'package.json'), body, 'utf8')
      const added = applyScriptInsert(dir, { destRel: 'package.json', missing: { 'req:delegate': 'commitgate req:delegate' } })
      expect(added).toEqual(['req:delegate'])
      const after = readFileSync(join(dir, 'package.json'), 'utf8')
      // 🔴 원문 바이트가 그대로다 — 왕복 직렬화였다면 아래 셋 모두 정규화됐다.
      expect(after).toContain('"version": 1e+0')
      expect(after).toContain('"homepage": "http:\/\/example.com"')
      expect(after).toContain('"build": "node .\/build"')
      expect(scriptsOf(dir)['req:delegate']).toBe('commitgate req:delegate')
    } finally {
      rm(dir)
    }
  })

  it('🔴 BOM 이 있어도 적용된다 — 계획과 적용이 같은 방식으로 다룬다', () => {
    const dir = mk()
    try {
      const body = '﻿' + JSON.stringify({ scripts: { 'req:new': 'commitgate req:new' } }, null, 2) + '\n'
      writeFileSync(join(dir, 'package.json'), body, 'utf8')
      const added = applyScriptInsert(dir, { destRel: 'package.json', missing: { 'req:delegate': 'commitgate req:delegate' } })
      expect(added).toEqual(['req:delegate'])
      const after = readFileSync(join(dir, 'package.json'), 'utf8')
      expect(after.charCodeAt(0)).toBe(0xfeff) // BOM 을 되돌린다
      expect(scriptsOf(dir)['req:delegate']).toBe('commitgate req:delegate')
    } finally {
      rm(dir)
    }
  })

  it('빈 scripts 객체에도 삽입된다', () => {
    const dir = mk()
    try {
      writeFileSync(join(dir, 'package.json'), '{\n  "scripts": {}\n}\n', 'utf8')
      applyScriptInsert(dir, { destRel: 'package.json', missing: { 'req:new': 'commitgate req:new' } })
      expect(scriptsOf(dir)['req:new']).toBe('commitgate req:new')
    } finally {
      rm(dir)
    }
  })

  it('CRLF 파일은 CRLF 로 삽입한다', () => {
    const dir = mk()
    try {
      writeFileSync(join(dir, 'package.json'), '{\r\n  "scripts": {\r\n    "build": "x"\r\n  }\r\n}\r\n', 'utf8')
      applyScriptInsert(dir, { destRel: 'package.json', missing: { 'req:new': 'commitgate req:new' } })
      const after = readFileSync(join(dir, 'package.json'), 'utf8')
      expect(after).toContain('\r\n    "req:new": "commitgate req:new"\r\n')
      expect(after).not.toMatch(/[^\r]\n/)
    } finally {
      rm(dir)
    }
  })

  it('🔴 문자열 안의 중괄호·"scripts" 를 구조로 오인하지 않는다', () => {
    const raw = '{\n  "desc": "{ \\"scripts\\": { } }",\n  "scripts": {\n    "a": "1"\n  }\n}\n'
    const span = findScriptsObjectSpan(raw)
    expect(span).not.toBeNull()
    expect(raw.slice((span as { innerStart: number }).innerStart, (span as { innerEnd: number }).innerEnd)).toContain('"a": "1"')
  })

  it('중첩 객체 안의 scripts 키는 최상위로 오인하지 않는다', () => {
    const raw = '{\n  "nested": { "scripts": { "x": "1" } },\n  "scripts": {\n    "top": "2"\n  }\n}\n'
    const span = findScriptsObjectSpan(raw)
    const inner = raw.slice((span as { innerStart: number }).innerStart, (span as { innerEnd: number }).innerEnd)
    expect(inner).toContain('"top": "2"')
    expect(inner).not.toContain('"x": "1"')
  })

  it('scripts 가 없으면 null(호출부가 fail-closed)', () => {
    expect(findScriptsObjectSpan('{\n  "name": "x"\n}\n')).toBeNull()
  })
})

/**
 * 계획과 적용이 **같은 판정**을 쓰는가 — phase-2 r02 P1 두 건의 회귀 가드.
 *
 * 🔴 이 REQ 가 고치는 병이 바로 "안내와 실제가 다르다"이므로, 그 병을 자기 구현에서 재현하면 안 된다.
 */
describe('[sync] --scripts — 계획과 적용의 판정 일치', () => {
  it('🔴 이스케이프된 scripts 키(\u0073cripts)에서도 백필된다', () => {
    const dir = mk()
    try {
      const body = '{\n  "\u0073cripts": {\n    "build": "x"\n  }\n}\n'
      writeFileSync(join(dir, 'package.json'), body, 'utf8')
      // 계획 단계(JSON.parse)가 scripts 로 읽는 것과 같은 것을 스캐너도 찾아야 한다.
      expect(findScriptsObjectSpan(body)).not.toBeNull()
      const added = applyScriptInsert(dir, { destRel: 'package.json', missing: { 'req:new': 'commitgate req:new' } })
      expect(added).toEqual(['req:new'])
      const parsed = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { scripts: Record<string, string> }
      expect(parsed.scripts['req:new']).toBe('commitgate req:new')
      expect(parsed.scripts['build']).toBe('x')
    } finally {
      rm(dir)
    }
  })

  it('🔴 비문자열 값의 기존 req 키는 "누락"으로 세지 않는다(계획 = 적용)', () => {
    const dir = mk()
    try {
      gitInit(dir)
      seedSchemas(dir, 'shipped')
      writeFileSync(
        join(dir, 'package.json'),
        JSON.stringify({ scripts: { 'req:new': null, build: 'x' } }, null, 2) + '\n',
        'utf8',
      )
      const plan = planSync(dir, cfgFor(dir), false, false, false, true)
      const planned = Object.keys(plan.scriptInsert?.missing ?? {})
      // 값이 null 이어도 **존재**하므로 삽입 대상이 아니다 — 적용 단계의 `k in scripts` 와 같은 판정.
      expect(planned).not.toContain('req:new')
      expect(planned).toContain('req:delegate')
      const added = applyScriptInsert(dir, plan.scriptInsert as { destRel: string; missing: Record<string, string> })
      expect(added).toEqual(planned) // 계획한 것과 실제 삽입이 정확히 같다
      const parsed = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { scripts: Record<string, unknown> }
      expect(parsed.scripts['req:new']).toBeNull() // 기존 값 미변경
    } finally {
      rm(dir)
    }
  })
})

describe('[sync] --scripts — 중복 최상위 scripts 키(phase-2 r03 P1)', () => {
  it('🔴 JSON.parse 와 같은 객체(마지막)를 편집한다', () => {
    const dir = mk()
    try {
      const body = '{\n  "scripts": {\n    "build": "x"\n  },\n  "scripts": {\n    "req:new": "custom"\n  }\n}\n'
      writeFileSync(join(dir, 'package.json'), body, 'utf8')
      applyScriptInsert(dir, { destRel: 'package.json', missing: { 'req:delegate': 'commitgate req:delegate' } })
      const raw = readFileSync(join(dir, 'package.json'), 'utf8')
      // 의미상 채택되는 것은 마지막 객체다 — 거기 들어가야 백필이 실제로 성립한다.
      const parsed = JSON.parse(raw) as { scripts: Record<string, string> }
      expect(parsed.scripts['req:delegate']).toBe('commitgate req:delegate')
      expect(parsed.scripts['req:new']).toBe('custom')
      // 첫 번째 객체는 건드리지 않는다.
      expect(raw.indexOf('"build": "x"')).toBeLessThan(raw.indexOf('"req:delegate"'))
      expect(raw.slice(0, raw.indexOf('"req:new"'))).not.toContain('req:delegate')
    } finally {
      rm(dir)
    }
  })

  it('span 이 마지막 scripts 를 가리킨다', () => {
    const raw = '{\n  "scripts": { "a": "1" },\n  "scripts": { "b": "2" }\n}\n'
    const span = findScriptsObjectSpan(raw) as { innerStart: number; innerEnd: number }
    const inner = raw.slice(span.innerStart, span.innerEnd)
    expect(inner).toContain('"b": "2"')
    expect(inner).not.toContain('"a": "1"')
  })
})

describe('[sync] --scripts — 말미 공백·빈 줄 보존(phase-2 r04 P1)', () => {
  it('🔴 닫는 } 앞의 빈 줄이 삽입과 무관하게 사라지지 않는다', () => {
    const dir = mk()
    try {
      const body = '{\n  "scripts": {\n    "build": "x"\n\n\n  }\n}\n'
      writeFileSync(join(dir, 'package.json'), body, 'utf8')
      applyScriptInsert(dir, { destRel: 'package.json', missing: { 'req:new': 'commitgate req:new' } })
      const after = readFileSync(join(dir, 'package.json'), 'utf8')
      expect(after).toContain('"req:new": "commitgate req:new"\n\n\n  }')
      expect(after).toContain('"build": "x",\n')
    } finally {
      rm(dir)
    }
  })

  it('🔴 인라인 닫는 브레이스 앞 공백도 보존한다', () => {
    const dir = mk()
    try {
      writeFileSync(join(dir, 'package.json'), '{\n  "scripts": { "build": "x"    }\n}\n', 'utf8')
      applyScriptInsert(dir, { destRel: 'package.json', missing: { 'req:new': 'commitgate req:new' } })
      const after = readFileSync(join(dir, 'package.json'), 'utf8')
      expect(after).toContain('"req:new": "commitgate req:new"    }')
    } finally {
      rm(dir)
    }
  })

  it('🔴 인라인 빈 객체의 말미 공백({    })도 보존한다', () => {
    const dir = mk()
    try {
      writeFileSync(join(dir, 'package.json'), '{\n  "scripts": {    }\n}\n', 'utf8')
      applyScriptInsert(dir, { destRel: 'package.json', missing: { 'req:new': 'commitgate req:new' } })
      const after = readFileSync(join(dir, 'package.json'), 'utf8')
      expect(after).toContain('"req:new": "commitgate req:new"    }')
    } finally {
      rm(dir)
    }
  })

  it('완전히 빈 객체({})에도 삽입된다 — 보존할 바이트가 없는 유일한 폴백', () => {
    const dir = mk()
    try {
      writeFileSync(join(dir, 'package.json'), '{\n  "scripts": {}\n}\n', 'utf8')
      applyScriptInsert(dir, { destRel: 'package.json', missing: { 'req:new': 'commitgate req:new' } })
      const parsed = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { scripts: Record<string, string> }
      expect(parsed.scripts['req:new']).toBe('commitgate req:new')
    } finally {
      rm(dir)
    }
  })

  it('여러 줄 빈 객체({\n  })에도 삽입되고 말미 형태가 남는다', () => {
    const dir = mk()
    try {
      writeFileSync(join(dir, 'package.json'), '{\n  "scripts": {\n  }\n}\n', 'utf8')
      applyScriptInsert(dir, { destRel: 'package.json', missing: { 'req:new': 'commitgate req:new' } })
      const after = readFileSync(join(dir, 'package.json'), 'utf8')
      expect(after).toContain('"req:new": "commitgate req:new"\n  }')
    } finally {
      rm(dir)
    }
  })
})
