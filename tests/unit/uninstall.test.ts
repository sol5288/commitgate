import { describe, it, expect, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join, resolve, relative, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  runInit,
  KIT_COPY_RELPATHS,
  KIT_AGENT_ENTRYPOINTS,
  KIT_GITIGNORE,
  KIT_SOURCE_DIR_REL,
  REQ_SCRIPTS,
  REQ_DEV_DEPS,
  STAGE_B_REQ_SCRIPTS,
} from '../../bin/init'
import { planUninstall, renderPlan, runUninstall, parseArgs } from '../../bin/uninstall'
import { DEFAULT_REVIEW_PERSONA_RELPATH } from '../../scripts/req/lib/config'
import type { GitRunner } from '../../scripts/req/lib/adapters'

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

/**
 * Stage B(REQ-2026-014 D14) 픽스처 전제: `runInit`은 대상에 `devDependencies.commitgate` **선언**을 요구한다
 * (선행 `npm i -D commitgate` 의도 표시). 이 파일은 `install()`(=runInit)을 설치 픽스처로 쓰므로 기본 pkg에 넣어 준다.
 */
const COMMITGATE_DEP: Record<string, string> = { commitgate: '^0.6.0' }

/** 임시 대상 repo(실제 git). baseline 커밋까지 만들어 둔다. */
function tmpRepo(opts?: { pkg?: object; files?: Record<string, string> }): string {
  const dir = mkdtempSync(join(tmpdir(), 'reqwf-uninst-'))
  execFileSync('git', ['init', '-q'], { cwd: dir })
  execFileSync('git', ['config', 'user.email', 't@t.t'], { cwd: dir })
  execFileSync('git', ['config', 'user.name', 't'], { cwd: dir })
  const basePkg = (opts?.pkg ?? { name: 'x', version: '0.0.0' }) as { devDependencies?: Record<string, string> }
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ ...basePkg, devDependencies: { ...(basePkg.devDependencies ?? {}), ...COMMITGATE_DEP } }, null, 2),
  )
  for (const [rel, body] of Object.entries(opts?.files ?? {})) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true })
    writeFileSync(join(dir, rel), body)
  }
  execFileSync('git', ['add', '-A'], { cwd: dir })
  execFileSync('git', ['commit', '-qm', 'baseline'], { cwd: dir })
  return dir
}
function cleanup(dir: string): void {
  rmSync(dir, { recursive: true, force: true })
}
function install(dir: string): void {
  runInit({ dir, force: false, dryRun: false, strict: false })
}

/**
 * **Stage A(vendored) 설치본** 픽스처 — REQ-2026-014.
 *
 * Stage B init(`runInit`)은 더 이상 `scripts/req/**` 를 복사하지도 devDeps를 주입하지도 않는다(R3).
 * 그러나 **uninstall planner의 실제 대상은 기존 Stage A 프로젝트**이므로 vendored 파일 분류 기능은 그대로 유지된다.
 * 그 분류를 검증하는 테스트는 Stage A 레이아웃을 **직접 시드**해야 한다.
 *
 * Stage A init의 주입 의미를 정확히 재현한다:
 *  - `scripts/req/**` 를 **패키지 원본에서** 복사 → planner의 "바이트 동일" 판정이 성립한다(PACKAGE_ROOT 원본과 비교).
 *  - `req:*` 는 **Stage B init이 방금 심은 `commitgate <verb>` 값만** Stage A 값으로 되돌린다.
 *    픽스처가 미리 넣은 사용자 정의 값은 건드리지 않는다 — Stage A init도 기존 키를 덮지 않았다(`if (!(k in scripts))`).
 *  - devDeps는 **없는 키만** 채운다 — 역시 Stage A의 미덮어씀 규칙.
 */
function installStageA(dir: string): void {
  install(dir) // MANAGED/SEED-ONCE 자산(스키마·persona·진입점·config·AGENTS)은 Stage B init이 그대로 깐다
  // 1) vendored 실행코드를 Stage A처럼 복사
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const abs = join(d, e.name)
      if (e.isDirectory()) {
        walk(abs)
        continue
      }
      const dest = join(dir, relative(PACKAGE_ROOT, abs).replace(/\\/g, '/'))
      mkdirSync(dirname(dest), { recursive: true })
      writeFileSync(dest, readFileSync(abs))
    }
  }
  walk(join(PACKAGE_ROOT, KIT_SOURCE_DIR_REL))
  // 2) package.json을 Stage A 주입 상태로
  const pkgPath = join(dir, 'package.json')
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
    scripts?: Record<string, string>
    devDependencies?: Record<string, string>
  }
  const scripts = pkg.scripts ?? {}
  for (const [k, stageA] of Object.entries(REQ_SCRIPTS)) if (scripts[k] === STAGE_B_REQ_SCRIPTS[k]) scripts[k] = stageA
  const devDeps = pkg.devDependencies ?? {}
  for (const [k, v] of Object.entries(REQ_DEV_DEPS)) if (!(k in devDeps)) devDeps[k] = v
  pkg.scripts = scripts
  pkg.devDependencies = devDeps
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
}
function commitAll(dir: string, msg = 'add commitgate scaffold'): void {
  execFileSync('git', ['add', '-A'], { cwd: dir })
  execFileSync('git', ['commit', '-qm', msg], { cwd: dir })
}

/** `.git` 제외 전체 파일 스냅샷(repo-rel 경로 → sha256). 읽기 전용 검증용. */
function snapshot(root: string): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (d: string): void => {
    for (const e of readdirSync(d)) {
      if (e === '.git') continue
      const abs = join(d, e)
      if (statSync(abs).isDirectory()) walk(abs)
      else out[relative(root, abs).replace(/\\/g, '/')] = createHash('sha256').update(readFileSync(abs)).digest('hex')
    }
  }
  walk(root)
  return out
}

/** git 호출을 기록하는 GitRunner(실제 git 실행). */
function recordingGit(): { run: GitRunner; calls: string[][] } {
  const calls: string[][] = []
  const run: GitRunner = (file, args, opts) => {
    calls.push([...args])
    return execFileSync(file, args, opts) as unknown as string
  }
  return { run, calls }
}

const READ_ONLY_GIT = ['rev-parse', 'status', 'ls-files', 'log']
const MUTATING_GIT = ['restore', 'clean', 'revert', 'checkout', 'reset', 'add', 'commit', 'rm', 'stash', 'apply', 'write-tree']

describe('[uninstall] 읽기 전용 계약', () => {
  it('planner 실행 전후 파일시스템 스냅샷이 동일(아무것도 생성·수정·삭제하지 않음)', () => {
    const dir = tmpRepo()
    try {
      install(dir)
      commitAll(dir)
      const before = snapshot(dir)
      const log = vi.spyOn(console, 'log').mockImplementation(() => {})
      try {
        runUninstall({ dir })
      } finally {
        log.mockRestore()
      }
      expect(snapshot(dir)).toEqual(before)
    } finally {
      cleanup(dir)
    }
  })

  it('git 호출이 read-only allowlist에 갇히고 mutating 서브커맨드는 0회', () => {
    const dir = tmpRepo()
    try {
      install(dir)
      commitAll(dir)
      const { run, calls } = recordingGit()
      planUninstall({ dir }, run)
      expect(calls.length).toBeGreaterThan(0)
      for (const args of calls) {
        const sub = args[0] ?? ''
        expect(READ_ONLY_GIT).toContain(sub)
        expect(MUTATING_GIT).not.toContain(sub)
      }
    } finally {
      cleanup(dir)
    }
  })

  it('bin/uninstall.ts 소스에 fs 쓰기 API 식별자가 없다(구조적 불변식)', () => {
    const src = readFileSync(join(PACKAGE_ROOT, 'bin', 'uninstall.ts'), 'utf8')
    for (const banned of [
      'writeFileSync',
      'rmSync',
      'unlinkSync',
      'mkdirSync',
      'copyFileSync',
      'renameSync',
      'appendFileSync',
      'rmdirSync',
      'writeFile',
    ]) {
      expect(src).not.toContain(banned)
    }
  })
})

describe('[uninstall] ambiguous 아티팩트는 자동 제거 대상이 아니다', () => {
  it('사용자가 소유한 기존 AGENTS.md의 삭제를 지시하지 않는다', () => {
    const dir = tmpRepo({ files: { 'AGENTS.md': '# 우리 팀 계약\n손대지 마시오\n' } })
    try {
      install(dir)
      const plan = planUninstall({ dir })
      const text = renderPlan(plan)
      expect(plan.removable.map((a) => a.path)).not.toContain('AGENTS.md')
      expect(plan.keep.map((a) => a.path)).toContain('AGENTS.md')
      expect(text).not.toMatch(/rm\s+(-\w+\s+)?AGENTS\.md/)
      // init이 스킵했으므로 사용자 내용 그대로여야 한다(planner가 만졌는지 교차 확인)
      expect(readFileSync(join(dir, 'AGENTS.md'), 'utf8')).toContain('손대지 마시오')
    } finally {
      cleanup(dir)
    }
  })

  it('init이 생성한 AGENTS.md(템플릿 동일)도 removable이 아니라 keep이다', () => {
    const dir = tmpRepo()
    try {
      install(dir)
      const plan = planUninstall({ dir })
      expect(plan.removable.map((a) => a.path)).not.toContain('AGENTS.md')
      expect(plan.keep.map((a) => a.path)).toContain('AGENTS.md')
    } finally {
      cleanup(dir)
    }
  })

  it('병합된 req.config.json은 삭제를 지시하지 않고 사용자 값 보존을 안내한다', () => {
    const dir = tmpRepo({ files: { 'req.config.json': JSON.stringify({ branchPrefix: 'team/' }, null, 2) } })
    try {
      install(dir)
      // init은 누락키만 병합하고 사용자 값은 보존한다(전제 확인)
      const cfg = JSON.parse(readFileSync(join(dir, 'req.config.json'), 'utf8')) as { branchPrefix?: string }
      expect(cfg.branchPrefix).toBe('team/')

      const plan = planUninstall({ dir })
      const text = renderPlan(plan)
      expect(plan.removable.map((a) => a.path)).not.toContain('req.config.json')
      const kept = plan.keep.find((a) => a.path === 'req.config.json')
      expect(kept).toBeTruthy()
      expect(kept?.note).toMatch(/사용자 값|병합/)
      expect(text).not.toMatch(/rm\s+(-\w+\s+)?req\.config\.json/)
    } finally {
      cleanup(dir)
    }
  })

  it('package.json의 기존 req:* / cross-spawn을 일괄 삭제하라고 하지 않는다', () => {
    const dir = tmpRepo({
      pkg: {
        name: 'x',
        version: '0.0.0',
        scripts: { 'req:doctor': 'echo MY-CUSTOM-DOCTOR' },
        devDependencies: { 'cross-spawn': '^7.0.3' },
      },
    })
    try {
      // 이 테스트는 uninstall의 **Stage A 주입값 vs 사용자 값** 분류를 검증한다 → Stage A 픽스처가 필요하다.
      installStageA(dir)
      const plan = planUninstall({ dir })
      const text = renderPlan(plan)

      // init이 기존 키를 덮어쓰지 않았음(전제 확인)
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
        scripts: Record<string, string>
        devDependencies: Record<string, string>
      }
      expect(pkg.scripts['req:doctor']).toBe('echo MY-CUSTOM-DOCTOR')
      expect(pkg.devDependencies['cross-spawn']).toBe('^7.0.3')

      // package.json 키는 어떤 것도 removable이 아니다
      expect(plan.removable.some((a) => a.path.startsWith('package.json'))).toBe(false)

      const doctor = plan.keep.find((a) => a.path === 'package.json#scripts.req:doctor')
      expect(doctor?.note).toMatch(/사용자 값/)
      const cs = plan.keep.find((a) => a.path === 'package.json#devDependencies.cross-spawn')
      expect(cs?.note).toMatch(/사용자 값/)
      // init 주입값 그대로인 키는 "동일"로 표기되지만 여전히 keep이다
      expect(plan.keep.find((a) => a.path === 'package.json#scripts.req:new')?.note).toMatch(/동일/)

      // devDeps 일괄 제거를 지시하지 않는다(공용 의존일 수 있음). 전역 패키지 제거 안내는 별개로 허용.
      expect(text).not.toMatch(/npm\s+(uninstall|un|rm|remove)\s+(-\w+\s+)*(ajv|cross-spawn|tsx)/)
      expect(text).toMatch(/ajv.*cross-spawn.*tsx|제거를 권하지 않습니다/)
    } finally {
      cleanup(dir)
    }
  })
})

describe('[uninstall] 커밋 전/후 안내 분기', () => {
  it('미커밋(untracked) 스캐폴딩: revert를 권하지 않고 직접 되돌리기를 안내', () => {
    const dir = tmpRepo()
    try {
      install(dir) // git add 하지 않음
      const plan = planUninstall({ dir })
      const text = renderPlan(plan)
      expect(plan.mode).toBe('uncommitted')
      expect(plan.scaffoldCommits).toHaveLength(0)
      expect(text).not.toContain('git revert')
      expect(text).toContain('git status')
    } finally {
      cleanup(dir)
    }
  })

  it('커밋된 스캐폴딩: 도입 커밋 후보 sha와 git revert 방향을 제시', () => {
    const dir = tmpRepo()
    try {
      install(dir)
      commitAll(dir, 'chore: add commitgate')
      const plan = planUninstall({ dir })
      const text = renderPlan(plan)
      expect(plan.mode).toBe('committed')
      expect(plan.scaffoldCommits.length).toBeGreaterThanOrEqual(1)
      expect(plan.scaffoldCommits[0]?.subject).toContain('add commitgate')
      expect(text).toContain('git revert')
      expect(text).toContain(plan.scaffoldCommits[0]?.sha ?? '__missing__')
    } finally {
      cleanup(dir)
    }
  })

  it('도입 커밋이 여러 개로 흩어지면 단일 revert를 권하지 않는다', () => {
    const dir = tmpRepo()
    try {
      install(dir)
      // 스키마만 먼저 커밋 → kit 소스는 다음 커밋
      execFileSync('git', ['add', 'workflow'], { cwd: dir })
      execFileSync('git', ['commit', '-qm', 'chore: schemas'], { cwd: dir })
      commitAll(dir, 'chore: kit sources')
      const plan = planUninstall({ dir })
      const text = renderPlan(plan)
      expect(plan.scaffoldCommits.length).toBeGreaterThan(1)
      expect(text).toMatch(/여러|흩어/)
    } finally {
      cleanup(dir)
    }
  })

  it('과거에 추가·삭제된 kit 경로가 있어도, 새 untracked 설치는 uncommitted로 본다 (phase R2 P2)', () => {
    const dir = tmpRepo()
    try {
      // 1) 예전에 설치했다가 커밋 — 아래에서 `git rm scripts/req` 하므로 Stage A 픽스처가 필요하다.
      installStageA(dir)
      commitAll(dir, 'chore: old commitgate install')
      const oldSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim()

      // 2) 이후 전부 제거하고 커밋 — 이력에는 add 커밋이 그대로 남는다
      // ⚠️ 제거 목록을 하드코딩하지 않는다. 설치물이 늘어나면(review-persona.md·진입점 3종·CLAUDE.md)
      //    "전부 제거" 픽스처가 조용히 불완전해지고, 남은 tracked 파일이 아래 단언을 깨뜨린다.
      execFileSync('git', ['rm', '-r', '-q', 'scripts/req'], { cwd: dir })
      execFileSync('git', ['rm', '-q', ...KIT_COPY_RELPATHS], { cwd: dir })
      execFileSync('git', ['rm', '-q', ...KIT_AGENT_ENTRYPOINTS.map((e) => e.dest)], { cwd: dir })
      execFileSync('git', ['rm', '-q', 'req.config.json', 'AGENTS.md', 'CLAUDE.md', KIT_GITIGNORE.dest], { cwd: dir })
      // package.json의 Stage A `req:*` 도 함께 되돌린다 — **"전부 제거"의 일부**다(uninstall planner가 수동 정리 후보로 표시하는 항목).
      // `git rm`은 파일만 지우므로 이것이 없으면 Stage A 서명이 package.json에 남아, 3)의 재설치가 D19(migrate 안내)로 정당하게 막힌다.
      const pkgPath = join(dir, 'package.json')
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { scripts?: Record<string, string> }
      for (const k of Object.keys(REQ_SCRIPTS)) delete pkg.scripts?.[k]
      writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
      execFileSync('git', ['add', 'package.json'], { cwd: dir })
      execFileSync('git', ['commit', '-qm', 'chore: remove commitgate'], { cwd: dir })

      // 3) 오늘 다시 설치(Stage B) — 아직 git add 하지 않음
      install(dir)

      const plan = planUninstall({ dir })
      const text = renderPlan(plan)
      expect(plan.facts.tool.filter((t) => t.present).every((t) => !t.tracked)).toBe(true)
      expect(plan.mode).toBe('uncommitted')
      expect(plan.scaffoldCommits).toHaveLength(0)
      expect(text).not.toContain('git revert')
      expect(text).not.toContain(oldSha)
    } finally {
      cleanup(dir)
    }
  })

  it('설치되지 않은 repo는 not-installed', () => {
    const dir = tmpRepo()
    try {
      const plan = planUninstall({ dir })
      expect(plan.mode).toBe('not-installed')
      expect(plan.facts.installed).toBe(false)
    } finally {
      cleanup(dir)
    }
  })
})

describe('[uninstall] 설치 경로 ≠ 설정 경로 (D3b)', () => {
  const customCfg = JSON.stringify({ ticketRoot: 'docs/req-tickets', schemaPath: 'docs/req-tickets/machine.schema.json' }, null, 2)

  it('ticketRoot 재설정 repo: workflow/*.schema.json 잔여물을 tool로 분류하고, 없는 경로를 주장하지 않는다', () => {
    const dir = tmpRepo({ files: { 'req.config.json': customCfg } })
    try {
      install(dir)
      const plan = planUninstall({ dir })
      const toolPaths = plan.facts.tool.filter((t) => t.present).map((t) => t.path)
      // init은 ticketRoot와 무관하게 항상 workflow/ 아래로 복사한다
      expect(toolPaths).toContain('workflow/machine.schema.json')
      expect(toolPaths).toContain('workflow/req.config.schema.json')
      // 존재하지 않는 footprint를 주장하지 않는다
      const allPaths = [...plan.facts.tool, ...plan.keep].map((a) => a.path)
      expect(allPaths).not.toContain('docs/req-tickets/req.config.schema.json')
      expect(allPaths).not.toContain('docs/req-tickets/machine.schema.json')
    } finally {
      cleanup(dir)
    }
  })

  it('ticketRoot 재설정 repo: 증거는 설정값에서 인식하고 보호한다(하드코딩 workflow/ 아님)', () => {
    const dir = tmpRepo({
      files: {
        'req.config.json': customCfg,
        'docs/req-tickets/REQ-2026-001/state.json': '{}',
        'docs/req-tickets/REQ-2026-001/responses/approvals.jsonl': '{"kind":"design"}\n',
      },
    })
    try {
      install(dir)
      const plan = planUninstall({ dir })
      const text = renderPlan(plan)
      expect(plan.facts.ticketRoot).toBe('docs/req-tickets')
      const ev = plan.protect.find((e) => e.path === 'docs/req-tickets')
      expect(ev?.ticketCount).toBe(1)
      expect(text).toContain('docs/req-tickets')
      // 증거 디렉터리 삭제를 지시하지 않는다
      expect(text).not.toMatch(/rm\s+-rf\s+docs\/req-tickets/)
      expect(text).not.toMatch(/rm\s+-rf\s+workflow(\s|$)/)
    } finally {
      cleanup(dir)
    }
  })

  it('기본 ticketRoot(workflow)에서도 디렉터리 삭제가 아니라 스키마 2개만 후보로 나온다', () => {
    const dir = tmpRepo({ files: { 'workflow/REQ-2026-001/state.json': '{}' } })
    try {
      install(dir)
      const plan = planUninstall({ dir })
      const text = renderPlan(plan)
      expect(plan.facts.ticketRoot).toBe('workflow')
      expect(plan.protect.find((e) => e.path === 'workflow')?.ticketCount).toBe(1)
      expect(plan.removable.map((r) => r.path)).toContain('workflow/machine.schema.json')
      expect(text).not.toMatch(/rm\s+-rf\s+workflow(\s|$)/)
    } finally {
      cleanup(dir)
    }
  })

  it('schemaPath가 init 복사 경로가 아니면 제거 후보가 아니라 정보 행으로만 표기', () => {
    const dir = tmpRepo({ files: { 'req.config.json': customCfg } })
    try {
      install(dir)
      const plan = planUninstall({ dir })
      expect(plan.facts.info.join('\n')).toContain('docs/req-tickets/machine.schema.json')
      expect(plan.removable.map((r) => r.path)).not.toContain('docs/req-tickets/machine.schema.json')
    } finally {
      cleanup(dir)
    }
  })

  /**
   * REQ-2026-010 phase-1b — `reviewPersonaPath`도 `schemaPath`와 같은 **설정 축**을 갖는다.
   * 커스텀 경로를 쓰면 런타임이 읽는 파일과 init이 깐 파일이 갈라진다. planner는 그 사실만 알리고
   * 커스텀 경로를 제거 후보로 올리지 않는다(사용자 소유 파일).
   */
  it('reviewPersonaPath가 init 복사 경로가 아니면 정보 행으로만 표기', () => {
    const personaCfg = JSON.stringify({ reviewPersonaPath: 'docs/my-persona.md' }, null, 2)
    const dir = tmpRepo({ files: { 'req.config.json': personaCfg, 'docs/my-persona.md': '# 내 페르소나\n' } })
    try {
      install(dir)
      const plan = planUninstall({ dir })
      expect(plan.facts.info.join('\n')).toContain('docs/my-persona.md')
      expect(plan.removable.map((r) => r.path)).not.toContain('docs/my-persona.md')
      // init이 깐 기본 경로는 그대로 제거 후보다.
      expect(plan.removable.map((r) => r.path)).toContain(DEFAULT_REVIEW_PERSONA_RELPATH)
    } finally {
      cleanup(dir)
    }
  })

  it('reviewPersonaPath가 기본 경로면 info를 내지 않는다(잡음 방지)', () => {
    const dir = tmpRepo()
    try {
      install(dir)
      const plan = planUninstall({ dir })
      expect(plan.facts.info.join('\n')).not.toContain('review-persona.md')
    } finally {
      cleanup(dir)
    }
  })
})

describe('[uninstall] tool 아티팩트 무결성 표기', () => {
  it('편집된 kit 파일은 removable이 아니라 review로 분류', () => {
    const dir = tmpRepo()
    try {
      // vendored 파일의 무결성 표기를 검증한다 → Stage A 픽스처.
      installStageA(dir)
      const p = join(dir, 'scripts', 'req', 'req-new.ts')
      writeFileSync(p, readFileSync(p, 'utf8') + '\n// 우리가 고친 부분\n')
      const plan = planUninstall({ dir })
      expect(plan.review.map((t) => t.path)).toContain('scripts/req/req-new.ts')
      expect(plan.removable.map((t) => t.path)).not.toContain('scripts/req/req-new.ts')
      expect(plan.review.find((t) => t.path === 'scripts/req/req-new.ts')?.match).toBe('differs')
    } finally {
      cleanup(dir)
    }
  })
})

/**
 * REQ-2026-010 phase-3b — 진입점은 `src ≠ dest`다.
 *
 * `tool` 분류가 "원본은 `join(PACKAGE_ROOT, rel)`"이라고 가정하면 `.claude/skills/commitgate/SKILL.md`의
 * 원본을 찾지 못해 `differs`로 오분류하고, 바이트가 같은데도 제거 후보에서 빠진다.
 */
describe('[uninstall] 에이전트 진입점 분류 (src≠dest)', () => {
  const DESTS = ['.claude/skills/commitgate/SKILL.md', '.claude/commands/req.md', '.cursor/rules/commitgate.mdc']

  it('바이트 동일한 진입점 3종은 tool/identical로 removable', () => {
    const dir = tmpRepo()
    try {
      install(dir)
      const plan = planUninstall({ dir })
      for (const d of DESTS) {
        const t = plan.facts.tool.find((x) => x.path === d)
        expect(t?.present, `${d} present`).toBe(true)
        expect(t?.match, `${d} match`).toBe('identical')
        expect(plan.removable.map((x) => x.path)).toContain(d)
      }
    } finally {
      cleanup(dir)
    }
  })

  it('편집된 진입점은 removable이 아니라 review', () => {
    const dir = tmpRepo()
    try {
      install(dir)
      const p = join(dir, '.cursor', 'rules', 'commitgate.mdc')
      writeFileSync(p, readFileSync(p, 'utf8') + '\n추가 규칙\n')
      const plan = planUninstall({ dir })
      expect(plan.review.find((x) => x.path === '.cursor/rules/commitgate.mdc')?.match).toBe('differs')
      expect(plan.removable.map((x) => x.path)).not.toContain('.cursor/rules/commitgate.mdc')
    } finally {
      cleanup(dir)
    }
  })

  it('제거 명령에 진입점 경로가 포함된다', () => {
    const dir = tmpRepo()
    try {
      install(dir)
      const text = renderPlan(planUninstall({ dir }))
      for (const d of DESTS) expect(text).toContain(`rm -f ${d}`)
      // 디렉터리 통삭제는 절대 제안하지 않는다.
      expect(text).not.toMatch(/rm\s+-rf\s+\.claude/)
      expect(text).not.toMatch(/rm\s+-rf\s+\.cursor/)
    } finally {
      cleanup(dir)
    }
  })

  it('CLAUDE.md는 ambiguous(자동 제거 금지) — AGENTS.md와 같은 계층', () => {
    const dir = tmpRepo()
    try {
      install(dir)
      const plan = planUninstall({ dir })
      const k = plan.keep.find((x) => x.path === 'CLAUDE.md')
      expect(k, 'CLAUDE.md가 keep에 있어야 함').toBeTruthy()
      expect(k?.note).toContain('자동 제거 대상이 아닙니다')
      expect(plan.removable.map((x) => x.path)).not.toContain('CLAUDE.md')
      expect(plan.facts.tool.map((x) => x.path)).not.toContain('CLAUDE.md')
    } finally {
      cleanup(dir)
    }
  })

  it('편집된 CLAUDE.md는 "템플릿과 다름"으로 표기', () => {
    const dir = tmpRepo({ files: { 'CLAUDE.md': '# 내 지침\n' } })
    try {
      install(dir)
      expect(planUninstall({ dir }).keep.find((x) => x.path === 'CLAUDE.md')?.note).toContain('템플릿과 다름')
    } finally {
      cleanup(dir)
    }
  })

  /** 마커 없는 AGENTS.md 경로에서만 설치되는 계약 템플릿 사본. `AGENTS.template.md`가 원본(src≠dest). */
  it('AGENTS.commitgate.md는 설치됐을 때만 tool/identical', () => {
    const withMarkerless = tmpRepo({ files: { 'AGENTS.md': '# 우리 규칙\n' } })
    try {
      install(withMarkerless)
      const plan = planUninstall({ dir: withMarkerless })
      const t = plan.facts.tool.find((x) => x.path === 'AGENTS.commitgate.md')
      expect(t?.present).toBe(true)
      expect(t?.match).toBe('identical')
      expect(plan.removable.map((x) => x.path)).toContain('AGENTS.commitgate.md')
    } finally {
      cleanup(withMarkerless)
    }
  })

  it('사본이 없는 정상 설치에서는 absent — 제거 후보에 안 뜬다', () => {
    const dir = tmpRepo()
    try {
      install(dir)
      const plan = planUninstall({ dir })
      expect(plan.facts.tool.find((x) => x.path === 'AGENTS.commitgate.md')?.present).toBe(false)
      expect(plan.removable.map((x) => x.path)).not.toContain('AGENTS.commitgate.md')
    } finally {
      cleanup(dir)
    }
  })

  it('--no-agent-entrypoints 설치본에서는 진입점이 absent', () => {
    const dir = tmpRepo()
    try {
      runInit({ dir, force: false, dryRun: false, strict: false, noAgentEntrypoints: true })
      const plan = planUninstall({ dir })
      for (const d of DESTS) expect(plan.facts.tool.find((x) => x.path === d)?.present, d).toBe(false)
      expect(plan.keep.map((x) => x.path)).not.toContain('CLAUDE.md')
      // 코어는 그대로 제거 후보.
      expect(plan.removable.map((x) => x.path)).toContain('workflow/machine.schema.json')
    } finally {
      cleanup(dir)
    }
  })
})

/**
 * REQ-2026-010 phase-1a — persona 파일은 init이 깐 **tool** 아티팩트다.
 * 분류에서 빠지면 (a) 제거 계획이 파일을 누락하고 (b) `미분류 파일 보호` 가드가 잔여물로 잡는다.
 */
describe('[uninstall] persona 파일 분류', () => {
  it('바이트 동일한 persona는 tool/identical로 removable', () => {
    const dir = tmpRepo()
    try {
      install(dir)
      const plan = planUninstall({ dir })
      const t = plan.facts.tool.find((x) => x.path === DEFAULT_REVIEW_PERSONA_RELPATH)
      expect(t?.present).toBe(true)
      expect(t?.match).toBe('identical')
      expect(plan.removable.map((x) => x.path)).toContain(DEFAULT_REVIEW_PERSONA_RELPATH)
    } finally {
      cleanup(dir)
    }
  })

  it('편집된 persona는 removable이 아니라 review', () => {
    const dir = tmpRepo()
    try {
      install(dir)
      const p = join(dir, DEFAULT_REVIEW_PERSONA_RELPATH)
      writeFileSync(p, readFileSync(p, 'utf8') + '\n프로젝트 고유 리뷰 지침\n')
      const plan = planUninstall({ dir })
      expect(plan.review.find((x) => x.path === DEFAULT_REVIEW_PERSONA_RELPATH)?.match).toBe('differs')
      expect(plan.removable.map((x) => x.path)).not.toContain(DEFAULT_REVIEW_PERSONA_RELPATH)
    } finally {
      cleanup(dir)
    }
  })
})

describe('[uninstall] 미분류 파일 보호 (phase R1 P1)', () => {
  it('kit 디렉터리 통삭제(rm -rf scripts/req)를 절대 제안하지 않는다', () => {
    const dir = tmpRepo()
    try {
      // vendored 디렉터리 통삭제 금지를 검증한다 → Stage A 픽스처(모든 kit 파일이 원본과 동일한 "가장 깨끗한" 케이스).
      installStageA(dir)
      const text = renderPlan(planUninstall({ dir }))
      expect(text).not.toMatch(/rm\s+-rf\s+scripts\/req/)
      expect(text).not.toMatch(/rm\s+-rf\s+scripts(\s|$)/)
      // 대신 분류된 파일만 파일 단위로 나열한다
      expect(text).toContain('rm -f scripts/req/req-new.ts')
      expect(text).toContain('rm -f workflow/machine.schema.json')
    } finally {
      cleanup(dir)
    }
  })

  it('scripts/req/ 안의 사용자 파일은 제거 후보가 아니고, 통삭제 대상도 아니다', () => {
    const dir = tmpRepo()
    try {
      // vendored 디렉터리 안의 미분류(사용자) 파일 보호를 검증한다 → Stage A 픽스처.
      installStageA(dir)
      const extra = join(dir, 'scripts', 'req', 'local-helper.ts')
      writeFileSync(extra, '// 우리 팀이 넣은 헬퍼\nexport const x = 1\n')
      mkdirSync(join(dir, 'scripts', 'req', 'notes'), { recursive: true })
      writeFileSync(join(dir, 'scripts', 'req', 'notes', 'memo.md'), '# 메모\n')

      const plan = planUninstall({ dir })
      const text = renderPlan(plan)

      expect(plan.facts.unknownKitFiles).toContain('scripts/req/local-helper.ts')
      expect(plan.facts.unknownKitFiles).toContain('scripts/req/notes/memo.md')
      // 제거 후보/검토 목록 어디에도 들어가지 않는다
      expect(plan.removable.map((t) => t.path)).not.toContain('scripts/req/local-helper.ts')
      expect(plan.review.map((t) => t.path)).not.toContain('scripts/req/local-helper.ts')
      // 통삭제 명령이 없어야 사용자 파일이 살아남는다
      expect(text).not.toMatch(/rm\s+-rf\s+scripts\/req/)
      // 사용자 파일을 지우라고 지시하지 않는다
      expect(text).not.toMatch(/rm\s+-f\s+scripts\/req\/local-helper\.ts/)
      expect(text).not.toMatch(/rm\s+-f\s+scripts\/req\/notes\/memo\.md/)
      // 존재를 알린다
      expect(text).toContain('local-helper.ts')
      expect(text).toMatch(/설치하지 않은 파일/)

      // planner는 여전히 아무것도 지우지 않는다
      expect(readFileSync(extra, 'utf8')).toContain('우리 팀이 넣은 헬퍼')
    } finally {
      cleanup(dir)
    }
  })

  it('미분류 파일이 없으면 unknownKitFiles는 비어 있다', () => {
    const dir = tmpRepo()
    try {
      install(dir)
      expect(planUninstall({ dir }).facts.unknownKitFiles).toEqual([])
    } finally {
      cleanup(dir)
    }
  })
})

describe('[uninstall] npx 캐시 안내', () => {
  it('_npx 제거 명령과 npm cache clean --force 경고를 포함', () => {
    const dir = tmpRepo()
    try {
      install(dir)
      const text = renderPlan(planUninstall({ dir }))
      expect(text).toContain('_npx')
      expect(text).toContain('npm cache clean --force')
      expect(text).toMatch(/제거 명령이 아닙니다|지우지 않습니다/)
      expect(text).toContain('npm ls -g commitgate')
    } finally {
      cleanup(dir)
    }
  })

  it('Windows/macOS/Linux 안내가 모두 있다', () => {
    const dir = tmpRepo()
    try {
      install(dir)
      const text = renderPlan(planUninstall({ dir }))
      expect(text).toContain('Windows')
      expect(text).toContain('macOS')
      expect(text).toContain('Linux')
    } finally {
      cleanup(dir)
    }
  })
})

describe('[uninstall] package.json 되돌리기 안내 형태', () => {
  it('git checkout HEAD -- package.json 을 안내하고, 인덱스 기준 형태는 출력하지 않는다', () => {
    const dir = tmpRepo()
    try {
      install(dir)
      const text = renderPlan(planUninstall({ dir }))
      expect(text).toContain('git checkout HEAD -- package.json')
      expect(text).not.toContain('git checkout -- package.json')
    } finally {
      cleanup(dir)
    }
  })

  it('다른 미커밋 편집도 함께 버려진다는 경고를 포함', () => {
    const dir = tmpRepo()
    try {
      install(dir)
      const text = renderPlan(planUninstall({ dir }))
      expect(text).toMatch(/미커밋 편집/)
    } finally {
      cleanup(dir)
    }
  })
})

describe('[uninstall] 잔여물 경고', () => {
  it('빈 디렉터리가 남을 수 있음을 알린다', () => {
    const dir = tmpRepo()
    try {
      install(dir)
      const text = renderPlan(planUninstall({ dir }))
      expect(text).toMatch(/빈 디렉터리/)
    } finally {
      cleanup(dir)
    }
  })
})

describe('[uninstall] CLI', () => {
  it('parseArgs: --dir 해소, 알 수 없는 옵션은 throw', () => {
    expect(parseArgs(['--dir', 'x']).dir).toBe(resolve('x'))
    expect(() => parseArgs(['--force'])).toThrow(/알 수 없는 인자/)
    expect(() => parseArgs(['--run'])).toThrow(/알 수 없는 인자/)
    expect(() => parseArgs(['--dir'])).toThrow(/--dir 값 누락/)
  })

  it('git repo가 아니면 fail-closed throw', () => {
    const dir = mkdtempSync(join(tmpdir(), 'reqwf-uninst-nogit-'))
    try {
      expect(() => planUninstall({ dir })).toThrow(/git repo가 아님/)
    } finally {
      cleanup(dir)
    }
  })
})

describe('[uninstall] 깨진 req.config.json', () => {
  it('loadConfig 실패 시 중단하지 않고 DEFAULTS로 강등하되 그 사실을 알린다', () => {
    const dir = tmpRepo()
    try {
      install(dir)
      writeFileSync(join(dir, 'req.config.json'), '{ this is not json')
      const plan = planUninstall({ dir })
      const text = renderPlan(plan)
      expect(plan.facts.configError).toBeTruthy()
      expect(plan.facts.ticketRoot).toBe('workflow')
      expect(text).toMatch(/기본값|DEFAULTS/)
    } finally {
      cleanup(dir)
    }
  })
})

/**
 * REQ-2026-012 — workflow/.gitignore(kit 파일)는 tool artifact(src≠dest).
 * 템플릿과 identical이면 removable, 사용자가 편집(differs)하면 review(자동 제거 금지).
 */
describe('[uninstall] workflow/.gitignore (REQ-2026-012)', () => {
  const WG = KIT_GITIGNORE.dest

  it('init이 깐 그대로면(identical) removable로 분류', () => {
    const dir = tmpRepo()
    try {
      install(dir)
      const plan = planUninstall({ dir })
      expect(plan.removable.map((t) => t.path)).toContain(WG)
      expect(plan.review.map((t) => t.path)).not.toContain(WG)
    } finally {
      cleanup(dir)
    }
  })

  it('사용자가 편집하면(differs) review로 — 자동 제거하지 않는다', () => {
    const dir = tmpRepo({ files: { [WG]: '# 내 규칙\nmy-pattern\n' } })
    try {
      install(dir) // 기존 파일 보존(D12)
      const plan = planUninstall({ dir })
      expect(plan.removable.map((t) => t.path)).not.toContain(WG)
      expect(plan.review.find((t) => t.path === WG)?.match).toBe('differs')
    } finally {
      cleanup(dir)
    }
  })
})
