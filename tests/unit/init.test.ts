import { describe, it, expect } from 'vitest'
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
  readdirSync,
  symlinkSync,
  readlinkSync,
  lstatSync,
} from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join, resolve, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  runInit,
  detectPackageManager,
  runScriptCmd,
  parseArgs,
  crossSpawnBelowFloor,
  stageList,
  installGuidance,
  quoteForShell,
  pathNeedsManualQuoting,
  classifyPreexistingDirty,
  findIgnoredArtifacts,
  KIT_COPY_RELPATHS,
  KIT_SCHEMA_RELPATHS,
  KIT_AGENT_ENTRYPOINTS,
  KIT_CLAUDE_TEMPLATE_REL,
  KIT_CLAUDE_DEST_REL,
  KIT_AGENTS_CONTRACT_COPY_REL,
  KIT_GITIGNORE,
  KIT_COMPANION_SKILLS,
  applyCopies,
  AGENTS_CONTRACT_MARKER,
  CONTRACT_POINTER_RELPATHS,
  LOCKFILE,
  REQ_SCRIPTS,
  STAGE_B_REQ_SCRIPTS,
  detectStageA,
  commitgateDeclared,
  statWritableDest,
  assertConfinedDest,
  sha256File,
  PACKAGE_ROOT,
  type InitOptions,
} from '../../bin/init'
import { DEFAULT_REVIEW_PERSONA_RELPATH } from '../../scripts/req/lib/config'
import type { StatusEntry } from '../../scripts/req/lib/porcelain'

const PACKAGE_ROOT_FOR_TEST = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** symlink 미지원(권한 없는 Windows 러너 등)만 스킵 사유로 인정 — 그 외 오류는 테스트 실패로 드러낸다. */
function symlinkUnsupported(e: unknown): boolean {
  const code = (e as NodeJS.ErrnoException).code
  return code === 'EPERM' || code === 'ENOSYS' || code === 'EACCES'
}

/** StatusEntry 조립(classifyPreexistingDirty가 이제 parseStatusZ 산출을 받는다). */
const se = (index: string, worktree: string, path: string, origPath?: string): StatusEntry =>
  origPath === undefined ? { index, worktree, path } : { index, worktree, path, origPath }

/** repo 전체(.git 제외)의 `경로 → sha256`. "쓰기 0건"을 전수 검증하는 데 쓴다. */
/**
 * 트리 스냅샷 — **symlink를 따라가지 않는다**(REQ-2026-020 phase-2).
 *
 * ⚠️ 이전 구현은 `readFileSync`로 내용을 읽어 해시했다. 두 가지가 깨진다:
 *   1. **dangling leaf symlink**에서 `readFileSync`가 ENOENT로 throw → 테스트가 "쓰기 0회"가 아니라
 *      스냅샷 함수 자체의 오류로 실패해 **실패 이유를 오인**한다.
 *   2. **디렉터리 symlink**는 링크 너머를 훑어, 링크 자체의 변화(생성·교체)를 못 보고 외부 트리를 섞어 본다.
 *
 * `lstat`+`readlink`로 **링크 자체**를 기록하고 디렉터리 엔트리도 남긴다 —
 * symlink 탈출 fixture에서 대상·외부 양쪽을 정확히 전후 비교하기 위해서다.
 */
function snapshot(dir: string): Map<string, string> {
  const out = new Map<string, string>()
  if (!existsSync(dir)) return out
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === '.git') continue
      const abs = join(d, e.name)
      const rel = relative(dir, abs).replace(/\\/g, '/')
      // Dirent는 lstat 의미다 — symlink-to-dir는 isDirectory()가 false, isSymbolicLink()가 true.
      if (e.isSymbolicLink()) {
        // 링크 대상 문자열만 본다. 링크가 가리키는 곳은 따라가지 않는다(dangling이어도 안전).
        out.set(rel, `symlink:${readlinkSync(abs).replace(/\\/g, '/')}`)
      } else if (e.isDirectory()) {
        out.set(rel, 'dir') // 디렉터리 생성도 변화다 — preflight 실패 시 mkdir조차 없어야 한다.
        walk(abs)
      } else if (e.isFile()) {
        out.set(rel, `file:${createHash('sha256').update(readFileSync(abs)).digest('hex')}`)
      } else {
        out.set(rel, 'special') // FIFO·소켓 등: 내용을 읽지 않는다(읽으면 블로킹될 수 있다).
      }
    }
  }
  walk(dir)
  return out
}

/** 임시 repo에서 git 실행(user 설정 주입 — `git init`만으론 커밋이 안 된다). */
function gitIn(dir: string, args: string[]): string {
  return execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: dir, encoding: 'utf8' })
}

/**
 * Stage B(REQ-2026-014 D14) 픽스처 전제: init은 대상에 `devDependencies.commitgate` **선언**을 요구한다
 * (사용자가 선행 `npm i -D commitgate`를 했다는 의도 표시). 값 형태는 검증하지 않으므로 아무 spec이나 무방하다.
 */
const COMMITGATE_DEP_SPEC = '^0.6.0'

/**
 * 픽스처 package.json에 `devDependencies.commitgate`를 병합한다(D14 통과용). 기존 devDeps는 보존한다.
 *
 * ⚠️ `devDependencies`가 plain object가 **아니면**(모양 검증 테스트의 `[1,2]` 등) 손대지 않는다 —
 *    병합하면 "비객체 → throw" 라는 그 테스트의 의도가 사라진다.
 */
function withCommitgateDep(pkg: object): object {
  const p = pkg as { devDependencies?: unknown }
  const dd = p.devDependencies
  if (dd !== undefined && (typeof dd !== 'object' || dd === null || Array.isArray(dd))) return pkg
  return { ...p, devDependencies: { ...((dd as Record<string, string> | undefined) ?? {}), commitgate: COMMITGATE_DEP_SPEC } }
}

/**
 * 임시 대상 repo 생성.
 * - withGit: 'real'(기본) = 실제 `git init` / 'fake' = 빈 `.git` 마커만 / 'none' = git 없음
 * - withPkg: package.json 작성 여부(기본 true)
 * - noCommitgateDep: `devDependencies.commitgate` 선언을 **넣지 않는다**(D14 fail-closed를 의도적으로 테스트할 때만)
 */
function tmpTarget(opts?: {
  pkg?: object
  lock?: string
  withGit?: 'real' | 'fake' | 'none'
  withPkg?: boolean
  spacedName?: boolean
  pctName?: boolean
  noCommitgateDep?: boolean
}): string {
  const prefix = opts?.pctName === true ? 'reqwf %PCT% ' : opts?.spacedName === true ? 'reqwf init ' : 'reqwf-init-'
  const dir = mkdtempSync(join(tmpdir(), prefix))
  const g = opts?.withGit ?? 'real'
  if (g === 'real') {
    execFileSync('git', ['init', '-q'], { cwd: dir })
    // hermetic: 전역 core.excludesFile·repo-local exclude가 ignore 경계 테스트에 새지 않게 무력화(phase-2 리뷰 P3).
    // 그러지 않으면 개발자 전역 excludes에 codex-response.json 등이 있으면 kit 규칙이 빠져도 positive 단언이 거짓 통과한다.
    const emptyExcludes = join(dir, '.git', 'info', 'empty-excludes')
    writeFileSync(emptyExcludes, '')
    writeFileSync(join(dir, '.git', 'info', 'exclude'), '')
    execFileSync('git', ['config', 'core.excludesFile', emptyExcludes], { cwd: dir })
  } else if (g === 'fake') {
    mkdirSync(join(dir, '.git'))
  }
  if (opts?.withPkg !== false) {
    const base = opts?.pkg ?? { name: 'x', version: '0.0.0' }
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify(opts?.noCommitgateDep === true ? base : withCommitgateDep(base), null, 2),
    )
  }
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

/**
 * REQ-2026-010 phase-3a — 에이전트 진입점 (D7·D8).
 *
 * 본문 SSOT는 `AGENTS.md`다. 여기 깔리는 것은 **얇은 포인터**이며 계약 본문을 복제하지 않는다.
 * `src !== dest`라 기존 `copyInto`(레이아웃 재현)를 쓸 수 없다 — 명시적 매핑 복사기가 필요하다.
 */
/**
 * REQ-2026-011 phase-2 — 진입점 템플릿은 **pm-중립**이어야 한다 (D1 / DEC-011-1·2).
 *
 * 회귀 경위: `e09c2f3`이 init stdout을 pm-aware로 고친 **다음 날** `f66d45c`가 진입점 템플릿에
 * `npm run …` 리터럴을 새로 넣어 같은 결함 클래스를 재도입했다. `runScriptCmd`에는 단위 테스트가
 * 있었지만 **템플릿 본문을 지키는 테스트가 없어** CI가 잡지 못했다. 이 describe가 그 가드다.
 *
 * 왜 치환 렌더링이 아니라 bare 표기인가(DEC-011-2): `bin/uninstall.ts`가 설치본과 패키지 원본의
 * sha256을 비교해 `removable`/`review`를 판정한다. init이 pm별로 렌더하면 두 바이트열이 영원히
 * 달라져 uninstall이 자기가 깐 진입점을 지우지 못한다. 아래 byte-identity 테스트가 그 계약을 고정한다.
 */
describe('[init] 진입점 템플릿 pm-중립 (REQ-2026-011 D1)', () => {
  /** 패키지매니저 실행 형식이 박힌 명령. 어느 pm으로 렌더해도 다른 pm 프로젝트에선 틀린다. */
  const PM_LITERAL = /npm run req|pnpm req:|yarn req:/
  const TEMPLATE_SRCS = [...KIT_AGENT_ENTRYPOINTS.map((e) => e.src), KIT_CLAUDE_TEMPLATE_REL]
  const INSTALLED = [...KIT_AGENT_ENTRYPOINTS.map((e) => e.dest), 'CLAUDE.md']

  it.each(TEMPLATE_SRCS)('템플릿 원본 %s 에 pm 실행 형식이 박혀 있지 않다', (src) => {
    const body = readFileSync(join(PACKAGE_ROOT_FOR_TEST, src), 'utf8')
    expect(body).not.toMatch(PM_LITERAL)
    expect(body, 'bare 표기로 워크플로 명령을 안내해야 함').toMatch(/req:next/)
  })

  it.each(['pnpm-lock.yaml', 'yarn.lock', 'package-lock.json'])(
    '%s 프로젝트에 설치해도 진입점은 pm 실행 형식을 지시하지 않는다',
    (lock) => {
      const dir = tmpTarget({ lock })
      try {
        runInit(OPTS(dir))
        for (const d of INSTALLED) {
          const body = readFileSync(join(dir, d), 'utf8')
          expect(body, d).not.toMatch(PM_LITERAL)
        }
      } finally {
        cleanup(dir)
      }
    },
  )

  /**
   * DEC-011-2의 핵심 계약: 설치본은 패키지 원본과 **바이트가 같다**.
   * 누군가 치환 렌더링을 도입하면 여기서 깨진다 — uninstall의 `match === 'identical'` 판정이 무너지기 전에.
   */
  it('설치본은 패키지 원본과 byte-identical (uninstall의 sha256 비교 계약)', () => {
    const dir = tmpTarget({ lock: 'pnpm-lock.yaml' })
    try {
      runInit(OPTS(dir))
      for (const { src, dest } of KIT_AGENT_ENTRYPOINTS) {
        expect(readFileSync(join(dir, dest)), `${dest} == ${src}`).toEqual(
          readFileSync(join(PACKAGE_ROOT_FOR_TEST, src)),
        )
      }
      expect(readFileSync(join(dir, 'CLAUDE.md'))).toEqual(
        readFileSync(join(PACKAGE_ROOT_FOR_TEST, KIT_CLAUDE_TEMPLATE_REL)),
      )
    } finally {
      cleanup(dir)
    }
  })

  /** 실행 형식을 지시하지 않는 대신, **어디서 정확한 형식을 얻는지**는 알려 줘야 한다. */
  it.each(TEMPLATE_SRCS)('템플릿 %s 는 정확한 실행 형식의 출처를 안내한다', (src) => {
    const body = readFileSync(join(PACKAGE_ROOT_FOR_TEST, src), 'utf8')
    expect(body).toContain('패키지매니저')
  })
})

describe('[init] 에이전트 진입점 설치', () => {
  const DESTS = ['.claude/skills/commitgate/SKILL.md', '.claude/commands/req.md', '.cursor/rules/commitgate.mdc']

  it('중첩 디렉터리를 만들고 3종 + CLAUDE.md를 설치한다', () => {
    const dir = tmpTarget()
    try {
      const r = runInit(OPTS(dir))
      for (const d of DESTS) {
        expect(r.copied, `copied에 ${d}`).toContain(d)
        expect(existsSync(join(dir, d)), `${d} 실재`).toBe(true)
      }
      expect(r.claudeMdCreated).toBe(true)
      expect(existsSync(join(dir, 'CLAUDE.md'))).toBe(true)
      expect(r.agentEntrypointsSkipped).toBe(false)
    } finally {
      cleanup(dir)
    }
  })

  it('KIT_AGENT_ENTRYPOINTS는 src≠dest이며 src가 패키지에 실재한다', () => {
    for (const { src, dest } of KIT_AGENT_ENTRYPOINTS) {
      expect(src).not.toBe(dest)
      expect(existsSync(join(PACKAGE_ROOT_FOR_TEST, src)), `${src} 실재`).toBe(true)
    }
    expect(existsSync(join(PACKAGE_ROOT_FOR_TEST, KIT_CLAUDE_TEMPLATE_REL))).toBe(true)
  })

  it('포인터는 AGENTS.md를 가리키고 계약 본문을 복제하지 않는다', () => {
    for (const { src } of KIT_AGENT_ENTRYPOINTS) {
      const body = readFileSync(join(PACKAGE_ROOT_FOR_TEST, src), 'utf8')
      expect(body).toContain('AGENTS.md')
      expect(body).toContain(AGENTS_CONTRACT_MARKER)
      // 계약 본문(통제점 표의 승인 문장)은 복제 금지 — drift 부채.
      expect(body).not.toContain('branch protection bypass를 사용한 direct push 승인')
      expect(body).not.toContain('required checks green 확인 후 PR merge 승인')
    }
  })

  /**
   * phase-3a R1 P2 — **복구 지시는 실행 가능해야 한다.**
   *
   * 포인터가 "`AGENTS.template.md`를 참조하라"고 하면 막다른 길이다. 그 파일은 **패키지 안에만** 있고
   * 대상 repo에는 복사되지 않으며, `npx commitgate`는 `node_modules/commitgate/`도 남기지 않는다.
   * 마커가 없을 때 init이 `AGENTS.commitgate.md`를 함께 놓아야 지시가 성립한다.
   */
  it('포인터는 대상 repo에 실재하는 파일(AGENTS.commitgate.md)을 가리킨다', () => {
    const srcs = [...KIT_AGENT_ENTRYPOINTS.map((e) => e.src), KIT_CLAUDE_TEMPLATE_REL]
    for (const src of srcs) {
      const body = readFileSync(join(PACKAGE_ROOT_FOR_TEST, src), 'utf8')
      expect(body, `${src}가 설치되는 사본을 가리켜야 함`).toContain(KIT_AGENTS_CONTRACT_COPY_REL)
      // 대상 repo에 없는 파일을 참조하면 안 된다.
      expect(body, `${src}가 패키지 내부 파일명을 참조하면 안 됨`).not.toContain('AGENTS.template.md')
    }
  })

  it('마커 없는 기존 AGENTS.md → 계약 템플릿 사본을 실제로 설치한다', () => {
    const dir = tmpTarget()
    try {
      writeFileSync(join(dir, 'AGENTS.md'), '# 우리 회사 규칙\n', 'utf8')
      const r = runInit(OPTS(dir))
      expect(r.agentsMarkerMissing).toBe(true)
      expect(r.agentsContractCopyCreated).toBe(true)
      const copyPath = join(dir, KIT_AGENTS_CONTRACT_COPY_REL)
      expect(existsSync(copyPath)).toBe(true)
      // 사본은 패키지의 계약 템플릿과 동일하고 마커를 갖는다.
      expect(readFileSync(copyPath, 'utf8')).toBe(readFileSync(join(PACKAGE_ROOT_FOR_TEST, 'AGENTS.template.md'), 'utf8'))
      expect(readFileSync(copyPath, 'utf8')).toContain(AGENTS_CONTRACT_MARKER)
      // 기존 AGENTS.md는 건드리지 않는다.
      expect(readFileSync(join(dir, 'AGENTS.md'), 'utf8')).toBe('# 우리 회사 규칙\n')
    } finally {
      cleanup(dir)
    }
  })

  it('마커가 있으면 계약 템플릿 사본을 만들지 않는다(잡음 방지)', () => {
    const dir = tmpTarget()
    try {
      writeFileSync(join(dir, 'AGENTS.md'), `${AGENTS_CONTRACT_MARKER}\n# 계약\n`, 'utf8')
      const r = runInit(OPTS(dir))
      expect(r.agentsContractCopyCreated).toBe(false)
      expect(existsSync(join(dir, KIT_AGENTS_CONTRACT_COPY_REL))).toBe(false)
    } finally {
      cleanup(dir)
    }
  })

  it('init이 AGENTS.md를 새로 만들면 사본은 불필요하다', () => {
    const dir = tmpTarget()
    try {
      const r = runInit(OPTS(dir))
      expect(r.agentsCreated).toBe(true)
      expect(r.agentsContractCopyCreated).toBe(false)
      expect(existsSync(join(dir, KIT_AGENTS_CONTRACT_COPY_REL))).toBe(false)
    } finally {
      cleanup(dir)
    }
  })

  it('--no-agent-entrypoints면 마커 경고도 사본도 없다(포인터가 없으므로)', () => {
    const dir = tmpTarget()
    try {
      writeFileSync(join(dir, 'AGENTS.md'), '# 우리 회사 규칙\n', 'utf8')
      const r = runInit(OPTS(dir, { noAgentEntrypoints: true }))
      expect(r.agentsMarkerMissing).toBe(false)
      expect(r.agentsContractCopyCreated).toBe(false)
      expect(existsSync(join(dir, KIT_AGENTS_CONTRACT_COPY_REL))).toBe(false)
    } finally {
      cleanup(dir)
    }
  })

  it('dry-run은 계약 템플릿 사본을 쓰지 않는다', () => {
    const dir = tmpTarget()
    try {
      writeFileSync(join(dir, 'AGENTS.md'), '# 우리 회사 규칙\n', 'utf8')
      const r = runInit(OPTS(dir, { dryRun: true }))
      expect(r.agentsContractCopyCreated).toBe(true) // 계획상 생성
      expect(existsSync(join(dir, KIT_AGENTS_CONTRACT_COPY_REL))).toBe(false) // 실제로는 미기록
    } finally {
      cleanup(dir)
    }
  })

  it('기존 AGENTS.commitgate.md는 --force 없이 덮어쓰지 않는다', () => {
    const dir = tmpTarget()
    try {
      writeFileSync(join(dir, 'AGENTS.md'), '# 우리 회사 규칙\n', 'utf8')
      writeFileSync(join(dir, KIT_AGENTS_CONTRACT_COPY_REL), '내가 편집한 사본\n', 'utf8')
      const r = runInit(OPTS(dir))
      expect(r.agentsContractCopyCreated).toBe(false)
      expect(readFileSync(join(dir, KIT_AGENTS_CONTRACT_COPY_REL), 'utf8')).toBe('내가 편집한 사본\n')
    } finally {
      cleanup(dir)
    }
  })

  it('기존 진입점 파일은 덮어쓰지 않는다(비파괴)', () => {
    const dir = tmpTarget()
    try {
      mkdirSync(join(dir, '.claude', 'commands'), { recursive: true })
      writeFileSync(join(dir, '.claude', 'commands', 'req.md'), '내가 쓴 커맨드\n', 'utf8')
      const r = runInit(OPTS(dir))
      expect(r.skipped).toContain('.claude/commands/req.md')
      expect(readFileSync(join(dir, '.claude', 'commands', 'req.md'), 'utf8')).toBe('내가 쓴 커맨드\n')
    } finally {
      cleanup(dir)
    }
  })

  it('--force면 진입점을 갱신한다', () => {
    const dir = tmpTarget()
    try {
      mkdirSync(join(dir, '.claude', 'commands'), { recursive: true })
      writeFileSync(join(dir, '.claude', 'commands', 'req.md'), 'old\n', 'utf8')
      const r = runInit(OPTS(dir, { force: true }))
      expect(r.copied).toContain('.claude/commands/req.md')
      expect(readFileSync(join(dir, '.claude', 'commands', 'req.md'), 'utf8')).toContain('CommitGate')
    } finally {
      cleanup(dir)
    }
  })

  it('기존 CLAUDE.md는 --force로도 덮어쓰지 않는다(사용자 파일)', () => {
    const dir = tmpTarget()
    try {
      writeFileSync(join(dir, 'CLAUDE.md'), '# 내 프로젝트 지침\n', 'utf8')
      const r = runInit(OPTS(dir, { force: true }))
      expect(r.claudeMdCreated).toBe(false)
      expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf8')).toBe('# 내 프로젝트 지침\n')
    } finally {
      cleanup(dir)
    }
  })

  it('--no-agent-entrypoints면 .claude/·.cursor/·CLAUDE.md를 만들지 않는다', () => {
    const dir = tmpTarget()
    try {
      const r = runInit(OPTS(dir, { noAgentEntrypoints: true }))
      expect(r.agentEntrypointsSkipped).toBe(true)
      expect(r.claudeMdCreated).toBe(false)
      for (const d of [...DESTS, 'CLAUDE.md']) expect(existsSync(join(dir, d)), `${d} 미생성`).toBe(false)
      expect(existsSync(join(dir, '.claude'))).toBe(false)
      expect(existsSync(join(dir, '.cursor'))).toBe(false)
      // 코어 설치는 그대로. (Stage B: 실행코드는 복사되지 않으므로 MANAGED 자산으로 확인한다)
      expect(existsSync(join(dir, 'workflow/machine.schema.json'))).toBe(true)
    } finally {
      cleanup(dir)
    }
  })

  it('dry-run은 진입점을 쓰지 않는다', () => {
    const dir = tmpTarget()
    try {
      const r = runInit(OPTS(dir, { dryRun: true }))
      expect(r.copied).toContain('.cursor/rules/commitgate.mdc')
      for (const d of [...DESTS, 'CLAUDE.md']) expect(existsSync(join(dir, d))).toBe(false)
    } finally {
      cleanup(dir)
    }
  })

  /** design R1 observation — 기존 AGENTS.md가 CommitGate 계약이 아니면 포인터가 엉뚱한 SSOT를 가리킨다. */
  it('기존 AGENTS.md에 마커가 없으면 경고한다(설치는 계속)', () => {
    const dir = tmpTarget()
    try {
      writeFileSync(join(dir, 'AGENTS.md'), '# 우리 회사 규칙\n', 'utf8')
      const r = runInit(OPTS(dir))
      expect(r.agentsCreated).toBe(false)
      expect(r.agentsMarkerMissing).toBe(true)
      expect(existsSync(join(dir, '.claude/commands/req.md'))).toBe(true) // 설치는 계속
      expect(readFileSync(join(dir, 'AGENTS.md'), 'utf8')).toBe('# 우리 회사 규칙\n') // 미변경
    } finally {
      cleanup(dir)
    }
  })

  it('마커가 있는 기존 AGENTS.md면 경고하지 않는다', () => {
    const dir = tmpTarget()
    try {
      writeFileSync(join(dir, 'AGENTS.md'), `${AGENTS_CONTRACT_MARKER}\n# 계약\n`, 'utf8')
      expect(runInit(OPTS(dir)).agentsMarkerMissing).toBe(false)
    } finally {
      cleanup(dir)
    }
  })

  it('init이 만드는 AGENTS.md는 마커를 포함한다', () => {
    const dir = tmpTarget()
    try {
      runInit(OPTS(dir))
      expect(readFileSync(join(dir, 'AGENTS.md'), 'utf8')).toContain(AGENTS_CONTRACT_MARKER)
    } finally {
      cleanup(dir)
    }
  })

  /**
   * preflight→apply 계약: `mkdirSync(recursive)`는 중간 컴포넌트가 파일이면 ENOTDIR로 죽는다.
   * apply 중에 죽으면 앞의 파일들은 이미 복사된 뒤라 **부분 설치**가 된다. 쓰기 전에 막아야 한다.
   */
  it('경로 중간이 파일이면 아무것도 쓰기 전에 throw한다(부분 설치 방지)', () => {
    const dir = tmpTarget()
    try {
      writeFileSync(join(dir, '.claude'), '나는 파일이다\n', 'utf8')
      expect(() => runInit(OPTS(dir))).toThrow(/진입점 설치 불가/)
      // 코어 파일도 쓰이지 않았다(preflight에서 중단).
      expect(existsSync(join(dir, 'scripts/req/req-new.ts'))).toBe(false)
      expect(existsSync(join(dir, 'workflow/machine.schema.json'))).toBe(false)
    } finally {
      cleanup(dir)
    }
  })

  it('--no-agent-entrypoints면 그 preflight를 건너뛴다(.claude가 파일이어도 설치 성공)', () => {
    const dir = tmpTarget()
    try {
      writeFileSync(join(dir, '.claude'), '나는 파일이다\n', 'utf8')
      expect(() => runInit(OPTS(dir, { noAgentEntrypoints: true }))).not.toThrow()
      expect(existsSync(join(dir, 'workflow/machine.schema.json'))).toBe(true)
    } finally {
      cleanup(dir)
    }
  })
})

/**
 * REQ-2026-014 Stage B 전제 — **순서가 계약이다: D19(Stage A 서명) → D14(선행 설치)**.
 *
 * design r20 P1: Stage A 설치본에는 `devDependencies.commitgate`가 **없다**(`REQ_DEV_DEPS`는 ajv·cross-spawn·tsx뿐).
 * 순서가 뒤바뀌면 Stage A 사용자의 `npx commitgate init`이 **항상 D14에서 먼저 죽어** "npm install -D commitgate"라는
 * 엉뚱한 안내를 받고 `commitgate migrate` 안내(R7 인수 기준)에 **영원히 도달하지 못한다**.
 * 아래 마지막 케이스가 그 순서 자체를 고정한다.
 */
describe('[init][Stage B] 전제 검사 — D19(Stage A 서명) → D14(선행 설치)', () => {
  it('D14: devDependencies.commitgate 미선언이면 fail-closed + 선행 설치 안내 (쓰기 0건)', () => {
    const dir = tmpTarget({ noCommitgateDep: true })
    try {
      const before = snapshot(dir)
      expect(() => runInit(OPTS(dir))).toThrow(/devDependencies\.commitgate 선언이 없습니다[\s\S]*npm install -D commitgate/)
      expect(snapshot(dir), 'preflight throw는 어떤 파일도 쓰지 않는다').toEqual(before)
    } finally {
      cleanup(dir)
    }
  })

  it('D14: 값 형태는 검증하지 않는다 — `file:...tgz`(packed tarball 설치)도 통과', () => {
    const dir = tmpTarget({ pkg: { name: 'x', version: '0.0.0', devDependencies: { commitgate: 'file:../commitgate-0.6.0.tgz' } } })
    try {
      // semver range로 검증하면 packed-tarball smoke가 스스로 실패한다 — 키 존재만 본다.
      expect(() => runInit(OPTS(dir))).not.toThrow()
    } finally {
      cleanup(dir)
    }
  })

  it('D19: Stage A req:* 값이 있으면 fail-closed + migrate 안내 (쓰기 0건)', () => {
    const dir = tmpTarget({ pkg: { name: 'x', version: '0.0.0', scripts: { 'req:new': REQ_SCRIPTS['req:new'] } } })
    try {
      const before = snapshot(dir)
      expect(() => runInit(OPTS(dir))).toThrow(/이미 Stage A\(vendored\) 설치본입니다[\s\S]*commitgate migrate/)
      expect(snapshot(dir)).toEqual(before)
    } finally {
      cleanup(dir)
    }
  })

  it('D19: scripts/req/** 가 존재하면 fail-closed + migrate 안내', () => {
    const dir = tmpTarget()
    try {
      mkdirSync(join(dir, 'scripts', 'req'), { recursive: true })
      writeFileSync(join(dir, 'scripts', 'req', 'req-new.ts'), '// vendored\n', 'utf8')
      expect(() => runInit(OPTS(dir))).toThrow(/이미 Stage A\(vendored\) 설치본입니다[\s\S]*commitgate migrate/)
    } finally {
      cleanup(dir)
    }
  })

  it('사용자 정의 req:* 값은 Stage A 서명이 아니다 — 정상 설치되고 그 값은 보존된다', () => {
    const dir = tmpTarget({ pkg: { name: 'x', version: '0.0.0', scripts: { 'req:new': 'node my-own.mjs' } } })
    try {
      expect(() => runInit(OPTS(dir))).not.toThrow()
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
      expect(pkg.scripts['req:new']).toBe('node my-own.mjs') // 미덮어씀
      expect(pkg.scripts['req:next']).toBe('commitgate req:next') // 없던 키만 채움
    } finally {
      cleanup(dir)
    }
  })

  /**
   * 🔴 **순서 회귀(design r20 P1)** — 이 테스트가 D19→D14 순서를 고정한다.
   * 실제 Stage A 프로젝트의 상태(= Stage A 서명 **∧** commitgate 미선언)를 재현한다.
   * 순서가 뒤집히면 "npm install -D commitgate" 안내가 나와 이 단언이 깨진다.
   */
  it('[순서] Stage A 서명 ∧ commitgate 미선언 → migrate 안내가 나온다(설치 선행 안내가 아니라)', () => {
    const dir = tmpTarget({
      noCommitgateDep: true,
      pkg: { name: 'x', version: '0.0.0', scripts: { ...REQ_SCRIPTS } },
    })
    try {
      expect(() => runInit(OPTS(dir))).toThrow(/commitgate migrate/)
      expect(() => runInit(OPTS(dir))).not.toThrow(/npm install -D commitgate/)
    } finally {
      cleanup(dir)
    }
  })
})

describe('[init][Stage B] 순수 함수 — detectStageA / commitgateDeclared', () => {
  it('STAGE_B_REQ_SCRIPTS는 REQ_SCRIPTS와 같은 키에 `commitgate <verb>` 값을 갖는다', () => {
    expect(Object.keys(STAGE_B_REQ_SCRIPTS).sort()).toEqual(Object.keys(REQ_SCRIPTS).sort())
    for (const k of Object.keys(REQ_SCRIPTS)) expect(STAGE_B_REQ_SCRIPTS[k]).toBe(`commitgate ${k}`)
  })

  it('commitgateDeclared: 키 존재만 본다(값 형태 무관), 상속 키는 인정하지 않는다', () => {
    expect(commitgateDeclared({ commitgate: '^0.6.0' })).toBe(true)
    expect(commitgateDeclared({ commitgate: 'file:../x.tgz' })).toBe(true) // packed tarball
    expect(commitgateDeclared({ commitgate: 'workspace:*' })).toBe(true)
    expect(commitgateDeclared({ commitgate: '' })).toBe(true) // 값 검증 안 함
    expect(commitgateDeclared({})).toBe(false)
    expect(commitgateDeclared({ ajv: '^8' })).toBe(false)
    expect(commitgateDeclared(Object.create({ commitgate: '^1' }) as Record<string, string>)).toBe(false) // 프로토타입 오염 방지
  })

  it('detectStageA: Stage A 값이면 근거를 반환, Stage B 값·사용자 값·빈 값이면 null', () => {
    const dir = tmpTarget()
    try {
      expect(detectStageA(dir, { 'req:new': REQ_SCRIPTS['req:new']! })).toBe('package.json#scripts.req:new')
      expect(detectStageA(dir, { 'req:commit': REQ_SCRIPTS['req:commit']! })).toBe('package.json#scripts.req:commit')
      expect(detectStageA(dir, STAGE_B_REQ_SCRIPTS)).toBeNull()
      expect(detectStageA(dir, { 'req:new': 'node custom.mjs' })).toBeNull()
      expect(detectStageA(dir, {})).toBeNull()
    } finally {
      cleanup(dir)
    }
  })

  it('detectStageA: scripts/req/ 존재만으로도 서명이다(스크립트가 비어 있어도)', () => {
    const dir = tmpTarget()
    try {
      expect(detectStageA(dir, {})).toBeNull()
      mkdirSync(join(dir, 'scripts', 'req'), { recursive: true })
      expect(detectStageA(dir, {})).toBe('scripts/req/')
    } finally {
      cleanup(dir)
    }
  })
})

describe('[init] 정상 설치', () => {
  it('[Stage B] kit 파일·config·package.json·AGENTS를 설치 — 실행코드 무복사·devDep 무주입', () => {
    const dir = tmpTarget()
    try {
      const r = runInit(OPTS(dir))
      // ── R3 무복사: 실행 코드는 패키지(node_modules/commitgate)에만 있다.
      expect(existsSync(join(dir, 'scripts/req/req-new.ts'))).toBe(false)
      expect(existsSync(join(dir, 'scripts/req/lib/config.ts'))).toBe(false)
      expect(existsSync(join(dir, 'scripts/req/lib/adapters.ts'))).toBe(false)
      expect(existsSync(join(dir, 'scripts/req'))).toBe(false)
      expect(r.copied.some((f) => f.startsWith('scripts/req/'))).toBe(false)
      // ── MANAGED 자산은 계속 프로젝트에 깔린다(런타임이 읽는 검증 입력 + 재현성).
      expect(existsSync(join(dir, 'workflow/machine.schema.json'))).toBe(true)
      expect(existsSync(join(dir, 'workflow/req.config.schema.json'))).toBe(true)
      // 티켓 디렉터리는 복사 대상 아님(스키마 2종만)
      expect(r.copied.some((f) => f.startsWith('workflow/REQ-'))).toBe(false)
      // config 시드: handoffPath null(비활성을 config에 명시 기록) + 감지 pm
      expect(r.configAction).toBe('created')
      const cfg = JSON.parse(readFileSync(join(dir, 'req.config.json'), 'utf8'))
      expect(cfg.handoffPath).toBeNull()
      expect(cfg.packageManager).toBe('npm')
      // ── R1/R2 package.json 패치: 값이 패키지 bin dispatch를 가리킨다.
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
      expect(pkg.scripts['req:new']).toBe('commitgate req:new')
      expect(pkg.scripts['req:commit']).toBe('commitgate req:commit')
      expect(pkg.scripts['req:next']).toBe('commitgate req:next')
      expect(pkg.scripts['req:doctor']).toBe('commitgate req:doctor')
      expect(pkg.scripts['req:review-codex']).toBe('commitgate req:review-codex')
      expect(Object.keys(pkg.scripts).sort()).toEqual(
        ['req:commit', 'req:doctor', 'req:new', 'req:next', 'req:review-codex'].sort(),
      )
      // ── R3 무주입: tsx·ajv·cross-spawn은 commitgate 패키지의 runtime dependency지 대상의 것이 아니다.
      //    사용자가 넣은 devDependencies.commitgate(픽스처)는 그대로 보존된다 — init은 devDeps를 건드리지 않는다.
      expect(pkg.devDependencies.tsx).toBeUndefined()
      expect(pkg.devDependencies.ajv).toBeUndefined()
      expect(pkg.devDependencies['cross-spawn']).toBeUndefined()
      expect(Object.keys(pkg.devDependencies)).toEqual(['commitgate'])
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
      expect(r2.skipped).toContain('workflow/machine.schema.json')
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
      // Stage B: 실행코드는 복사되지 않으므로 MANAGED 자산(스키마)으로 --force 덮어쓰기를 검증한다.
      writeFileSync(join(dir, 'workflow/machine.schema.json'), '// tampered', 'utf8')
      const r = runInit(OPTS(dir, { force: true }))
      expect(r.copied).toContain('workflow/machine.schema.json')
      expect(readFileSync(join(dir, 'workflow/machine.schema.json'), 'utf8')).not.toBe('// tampered')
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
      // package.json: 기존 키 보존 — **사용자 정의 req:* 는 절대 덮지 않는다**(R5, `if (!(k in scripts))`).
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
      expect(pkg.scripts['req:new']).toBe('custom')
      // Stage B는 devDeps를 아예 건드리지 않으므로 사용자의 ajv 핀이 그대로 남는다(주입 시절에도 미덮어씀이었다).
      expect(pkg.devDependencies.ajv).toBe('^7.0.0')
      // 없던 키만 Stage B 값으로 채운다.
      expect(pkg.scripts['req:commit']).toBe('commitgate req:commit')
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
      // 이 테스트는 package.json을 직접 쓰므로 D14가 요구하는 devDependencies.commitgate 선언을 여기서 넣는다.
      writeFileSync(
        join(dir, 'package.json'),
        '﻿' + JSON.stringify({ name: 'x', version: '0.0.0', devDependencies: { commitgate: COMMITGATE_DEP_SPEC } }),
        'utf8',
      )
      expect(() => runInit(OPTS(dir))).not.toThrow()
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) // init은 BOM 없이 재작성
      expect(pkg.scripts['req:new']).toBe('commitgate req:new')
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
      expect(existsSync(join(dir, 'workflow/machine.schema.json'))).toBe(true) // 비파괴 — 설치 계속
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

/**
 * REQ-2026-011 phase-5 — 설치 산출물 계획(`InstallPlan`)과 gitignore preflight
 * (D5 / DEC-011-5·9·10·11).
 *
 * 세 가지가 한 뿌리에서 나온다:
 *  1. 산출물 목록을 **쓰기 전에** 확정해야 한다. `InitResult.copied`는 Apply에서 채워지므로
 *     preflight의 ignore 검사가 참조할 수 없다(design 리뷰 R4).
 *  2. ignore 검사 대상과 stage 목록은 **같은 목록**이어야 한다. 따로 관리하면 어긋난다
 *     (R2에서 `AGENTS.commitgate.md`, R3에서 lockfile이 빠졌다).
 *  3. `git add <path>`는 ignored **그리고** untracked일 때만 fatal이다. tracked 파일은 add된다.
 */
describe('[init] classifyPreexistingDirty — 설치 전 워킹트리 3분류 (DEC-011-11)', () => {
  const ARTIFACTS = ['package.json', 'req.config.json', 'pnpm-lock.yaml']

  it('staged 변경은 staged로 분류된다 — `git commit`이 인덱스 전체를 담기 때문', () => {
    const d = classifyPreexistingDirty([se('M', ' ', 'src/foo.ts'), se('A', ' ', 'src/bar.ts')], ARTIFACTS)
    expect(d.staged).toEqual(['src/foo.ts', 'src/bar.ts'])
    expect(d.overlapping).toEqual([])
    expect(d.unrelated).toEqual([])
  })

  it('tracked+unstaged 산출물은 overlapping — 사용자 변경과 설치 변경을 사후 분리할 수 없다', () => {
    const d = classifyPreexistingDirty([se(' ', 'M', 'package.json')], ARTIFACTS)
    expect(d.overlapping).toEqual(['package.json'])
    expect(d.unrelated).toEqual([])
  })

  it('untracked 산출물은 무해하다 — 파일 전체가 신규라 분리할 것이 없다', () => {
    const d = classifyPreexistingDirty([se('?', '?', 'package.json'), se('?', '?', 'pnpm-lock.yaml')], ARTIFACTS)
    expect(d.staged).toEqual([])
    expect(d.overlapping).toEqual([])
    expect(d.unrelated).toEqual([])
  })

  it('산출물과 무관한 unstaged/untracked는 unrelated', () => {
    const d = classifyPreexistingDirty([se(' ', 'M', 'src/foo.ts'), se('?', '?', 'notes.txt')], ARTIFACTS)
    expect(d.unrelated).toEqual(['src/foo.ts', 'notes.txt'])
    expect(d.staged).toEqual([])
  })

  it('rename은 새 경로(dest)를 쓴다 — `-z`는 path=NEW, origPath=OLD', () => {
    const d = classifyPreexistingDirty([se('R', ' ', 'new.ts', 'old.ts')], ARTIFACTS)
    expect(d.staged).toEqual(['new.ts'])
  })

  it('빈 입력은 전부 빈 배열', () => {
    const d = classifyPreexistingDirty([], ARTIFACTS)
    expect(d).toEqual({ staged: [], overlapping: [], unrelated: [] })
  })
})

describe('[init] 설치 산출물 목록(InitResult.artifacts) — ignore 검사와 stage 목록의 SSOT', () => {
  it('복사분 + req.config.json + package.json + lockfile 을 담는다', () => {
    const dir = tmpTarget({ lock: 'pnpm-lock.yaml' })
    try {
      const r = runInit(OPTS(dir))
      // Stage B: 실행코드는 산출물이 아니다(복사하지 않는다). MANAGED 자산은 그대로 산출물이다.
      expect(r.artifacts).not.toContain('scripts/req/req-new.ts')
      expect(r.artifacts.some((a) => a.startsWith('scripts/req/'))).toBe(false)
      expect(r.artifacts).toContain('workflow/machine.schema.json')
      expect(r.artifacts).toContain('req.config.json')
      expect(r.artifacts).toContain('package.json')
      // lockfile은 여전히 산출물이다 — 근거만 바뀌었다: Stage B는 devDeps를 주입하지 않지만, D14가 요구하는
      // **선행 `npm i -D commitgate`** 가 package.json+lockfile을 이미 바꿔 놓는다. stage하지 않으면 clean-tree 게이트가 죽는다.
      expect(r.artifacts, 'lockfile 누락 시 req:new --run이 clean-tree에서 실패한다').toContain('pnpm-lock.yaml')
    } finally {
      cleanup(dir)
    }
  })

  it.each(['npm', 'pnpm', 'yarn'] as const)('%s 프로젝트는 그 pm의 lockfile을 담는다', (pm) => {
    const locks = { npm: 'package-lock.json', pnpm: 'pnpm-lock.yaml', yarn: 'yarn.lock' }
    const dir = tmpTarget({ lock: locks[pm] })
    try {
      const r = runInit(OPTS(dir))
      expect(r.packageManager).toBe(pm)
      expect(r.artifacts).toContain(LOCKFILE[pm])
    } finally {
      cleanup(dir)
    }
  })

  it('기존 AGENTS.md에 마커가 없으면 AGENTS.commitgate.md 도 담는다', () => {
    const dir = tmpTarget()
    try {
      writeFileSync(join(dir, 'AGENTS.md'), '# 우리 프로젝트 규칙\n', 'utf8')
      const r = runInit(OPTS(dir))
      expect(r.agentsContractCopyCreated).toBe(true)
      expect(r.artifacts, '누락 시 untracked로 남아 req:new --run이 죽는다').toContain(KIT_AGENTS_CONTRACT_COPY_REL)
    } finally {
      cleanup(dir)
    }
  })

  it('AGENTS.md·CLAUDE.md를 새로 만들면 담고, 기존 파일을 보존했으면 담지 않는다', () => {
    const dir = tmpTarget()
    try {
      const r = runInit(OPTS(dir))
      expect(r.artifacts).toContain('AGENTS.md')
      expect(r.artifacts).toContain('CLAUDE.md')
    } finally {
      cleanup(dir)
    }
    const dir2 = tmpTarget()
    try {
      writeFileSync(join(dir2, 'CLAUDE.md'), '# 기존\n', 'utf8')
      const r = runInit(OPTS(dir2))
      expect(r.claudeMdCreated).toBe(false)
      expect(r.artifacts).not.toContain('CLAUDE.md')
    } finally {
      cleanup(dir2)
    }
  })
})

describe('[init] gitignore preflight (D5)', () => {
  const IGNORED_POINTERS = ['.claude/skills/commitgate/SKILL.md', '.claude/commands/req.md']

  it('CONTRACT_POINTER_RELPATHS는 진입점 3종 + AGENTS/CLAUDE/계약사본을 덮는다', () => {
    for (const { dest } of KIT_AGENT_ENTRYPOINTS) expect(CONTRACT_POINTER_RELPATHS).toContain(dest)
    expect(CONTRACT_POINTER_RELPATHS).toContain('AGENTS.md')
    expect(CONTRACT_POINTER_RELPATHS).toContain('CLAUDE.md')
    expect(CONTRACT_POINTER_RELPATHS).toContain(KIT_AGENTS_CONTRACT_COPY_REL)
  })

  it('`.claude` 통짜 무시: 경고하고 설치는 계속한다(기본 모드)', () => {
    const dir = tmpTarget()
    try {
      writeFileSync(join(dir, '.gitignore'), '.claude\n', 'utf8')
      const r = runInit(OPTS(dir))
      for (const p of IGNORED_POINTERS) expect(r.gitIgnoredArtifacts, p).toContain(p)
      // .cursor는 무시되지 않는다
      expect(r.gitIgnoredArtifacts).not.toContain('.cursor/rules/commitgate.mdc')
      // 비파괴: 설치는 계속된다 (Stage B: 실행코드 대신 MANAGED 자산으로 확인)
      expect(existsSync(join(dir, 'workflow/machine.schema.json'))).toBe(true)
    } finally {
      cleanup(dir)
    }
  })

  /**
   * `--strict`는 **어떤 파일도 쓰기 전에** 멈춰야 한다. `.claude/`·`scripts/req/` 부재만 보면
   * `req.config.json`·`package.json`을 먼저 쓰고 나중에 throw하는 구현을 놓친다(design 리뷰 R1).
   */
  it('`--strict`: throw + 신규 0개·수정 0개(전수 스냅샷)', () => {
    const dir = tmpTarget()
    try {
      writeFileSync(join(dir, '.gitignore'), '.claude\n', 'utf8')
      const before = snapshot(dir)
      expect(() => runInit(OPTS(dir, { strict: true }))).toThrow(/gitignore|무시/)
      expect(snapshot(dir)).toEqual(before)
    } finally {
      cleanup(dir)
    }
  })

  it('lockfile이 무시되면 조용히 제외한다 — 계약 포인터가 아니므로 --strict도 통과', () => {
    const dir = tmpTarget({ lock: 'pnpm-lock.yaml' })
    try {
      writeFileSync(join(dir, '.gitignore'), 'pnpm-lock.yaml\n', 'utf8')
      const r = runInit(OPTS(dir, { strict: true }))
      expect(r.gitIgnoredArtifacts).toContain('pnpm-lock.yaml')
      expect(r.gitIgnoredArtifacts).not.toContain('.claude/commands/req.md')
    } finally {
      cleanup(dir)
    }
  })

  /** DEC-011-10: `git check-ignore`는 인덱스를 보지 않는다. tracked 파일은 ignore 규칙에 걸려도 add된다. */
  it('무시 규칙에 걸려도 이미 tracked면 제외하지 않는다', () => {
    const dir = tmpTarget({ lock: 'pnpm-lock.yaml' })
    try {
      writeFileSync(join(dir, '.gitignore'), 'pnpm-lock.yaml\n', 'utf8')
      gitIn(dir, ['add', '-f', 'pnpm-lock.yaml'])
      gitIn(dir, ['commit', '-q', '-m', 'lock'])
      const r = runInit(OPTS(dir))
      expect(r.gitIgnoredArtifacts).not.toContain('pnpm-lock.yaml')
    } finally {
      cleanup(dir)
    }
  })

  it('findIgnoredArtifacts는 존재하지 않는 경로도 규칙으로 판정한다', () => {
    const dir = tmpTarget()
    try {
      writeFileSync(join(dir, '.gitignore'), '.claude\n', 'utf8')
      expect(findIgnoredArtifacts(dir, ['.claude/commands/req.md', 'package.json'])).toEqual([
        '.claude/commands/req.md',
      ])
    } finally {
      cleanup(dir)
    }
  })
})

describe('[init] 설치 전 dirty 워킹트리 (DEC-011-11)', () => {
  it('staged 변경이 있으면 preexistingDirty.staged에 담고 --strict는 쓰기 0건으로 멈춘다', () => {
    const dir = tmpTarget()
    try {
      writeFileSync(join(dir, 'foo.ts'), 'export const a = 1\n', 'utf8')
      gitIn(dir, ['add', 'foo.ts'])
      const before = snapshot(dir)
      expect(() => runInit(OPTS(dir, { strict: true }))).toThrow(/staged/)
      expect(snapshot(dir)).toEqual(before)

      const r = runInit(OPTS(dir)) // 기본 모드는 설치를 막지 않는다(비-breaking)
      expect(r.preexistingDirty.staged).toContain('foo.ts')
      expect(r.preexistingDirty.overlapping).toEqual([])
    } finally {
      cleanup(dir)
    }
  })

  it('산출물과 겹치는 tracked 변경은 overlapping — 사후 분리 불가', () => {
    const dir = tmpTarget()
    try {
      gitIn(dir, ['add', 'package.json'])
      gitIn(dir, ['commit', '-q', '-m', 'init'])
      // package.json을 직접 덮어쓰므로 D14가 요구하는 devDependencies.commitgate 선언을 유지한다.
      writeFileSync(
        join(dir, 'package.json'),
        JSON.stringify({ name: 'x', version: '0.0.1', devDependencies: { commitgate: COMMITGATE_DEP_SPEC } }, null, 2),
        'utf8',
      )
      const r = runInit(OPTS(dir))
      expect(r.preexistingDirty.overlapping).toContain('package.json')
      expect(r.preexistingDirty.unrelated).not.toContain('package.json')
    } finally {
      cleanup(dir)
    }
  })

  it('무관한 변경은 unrelated에만 담기고 설치를 막지 않는다', () => {
    const dir = tmpTarget()
    try {
      gitIn(dir, ['add', 'package.json'])
      gitIn(dir, ['commit', '-q', '-m', 'init'])
      writeFileSync(join(dir, 'src.ts'), '1\n', 'utf8')
      const r = runInit(OPTS(dir, { strict: true }))
      expect(r.preexistingDirty.unrelated).toContain('src.ts')
      expect(r.preexistingDirty.staged).toEqual([])
    } finally {
      cleanup(dir)
    }
  })

  it('설치 전에 찍는다 — CommitGate 산출물이 섞이지 않는다', () => {
    const dir = tmpTarget()
    try {
      const r = runInit(OPTS(dir))
      for (const set of [r.preexistingDirty.staged, r.preexistingDirty.overlapping, r.preexistingDirty.unrelated])
        expect(set).not.toContain('scripts/req/req-new.ts')
    } finally {
      cleanup(dir)
    }
  })

  /**
   * design 리뷰 R7 정정: **untracked 산출물은 세 목록 어디에도 담기지 않는다.**
   *
   * baseline이 없어 분리할 "사용자 변경"과 "설치 변경"이 존재하지 않는다. 그리고 이것을 차단하면
   * README가 지시하는 첫 흐름(`git init && npm init -y && npx commitgate --strict`)이 **항상** 실패한다 —
   * 그 흐름의 `package.json`은 정의상 untracked이기 때문이다. 거짓 차단은 `--strict`를 피하도록 가르친다.
   */
  it('untracked 산출물(`?? package.json`)은 --strict를 막지 않는다 — README quick start 보호', () => {
    const dir = tmpTarget() // git init 직후 = package.json untracked (npm init -y와 같은 상태)
    try {
      const r = runInit(OPTS(dir, { strict: true }))
      expect(r.artifacts, 'stage 목록에는 들어간다').toContain('package.json')
      expect(r.preexistingDirty.staged).toEqual([])
      expect(r.preexistingDirty.overlapping).toEqual([])
      expect(r.preexistingDirty.unrelated).not.toContain('package.json')
    } finally {
      cleanup(dir)
    }
  })
})

/**
 * REQ-2026-011 phase-6 — 설치 직후 안내 (D4 / DEC-011-7·8·11).
 *
 * `runInit`은 스캐폴드를 만들고 `package.json`을 고치지만 `git add`/`commit`은 하지 않는다.
 * 그래서 설치 직후 워킹트리는 **확정적으로 dirty**한데, 기존 안내의 마지막 줄이
 * `req:new <slug> --run`이었다. 그 명령은 clean 워킹트리를 요구하므로 **100% 실패**했다.
 *
 * 안내에 `git add -A`를 쓰지 않는 이유(DEC-011-7): brownfield repo의 무관한 변경과 `.env`가
 * 함께 커밋되고, 이어지는 `req:review-codex`가 staged diff 전문을 외부로 전송한다.
 * 같은 REQ의 D8-B가 줄이려는 위험을 정확히 증폭시킨다.
 *
 * `&&`를 쓰지 않는 이유(DEC-011-8): Windows PowerShell 5.1과 cmd.exe에 그 연산자가 없다.
 * 이 저장소는 PowerShell 5를 명시 대상으로 인정한다(`scripts/req/lib/config.ts`의 BOM 방어).
 */
describe('[init] stageList — 산출물에서 무시되는 것만 뺀다', () => {
  it('gitIgnoredArtifacts를 제외한다', () => {
    expect(stageList(['a', 'b', 'c'], ['b'])).toEqual(['a', 'c'])
  })
  it('제외할 것이 없으면 그대로', () => {
    expect(stageList(['a'], [])).toEqual(['a'])
  })
})

describe('[init] installGuidance — 안내 문구 (D4)', () => {
  const text = (dir: string, over?: Partial<InitOptions>): string => installGuidance(runInit(OPTS(dir, over))).join('\n')
  /** 실행될 **명령 줄**만 본다 — 산문 경고가 `-A`를 언급하는 것과 실제 명령을 구분한다. */
  const commands = (dir: string, over?: Partial<InitOptions>): string[] =>
    installGuidance(runInit(OPTS(dir, over)))
      .map((l) => l.trim())
      .filter((l) => l.startsWith('git '))

  it('명령으로 `git add -A` 를 내지 않는다 — brownfield의 .env가 외부로 전송된다', () => {
    const dir = tmpTarget()
    try {
      const cmds = commands(dir)
      expect(cmds.some((c) => c.startsWith('git add -A') || c.startsWith('git add .'))).toBe(false)
      expect(
        cmds.some((c) => c.startsWith('git add --')),
        '명시적 경로 목록으로 stage 한다',
      ).toBe(true)
    } finally {
      cleanup(dir)
    }
  })

  it('shell 연산자 `&&` 를 쓰지 않는다 — PowerShell 5.1·cmd 비호환', () => {
    const dir = tmpTarget()
    try {
      expect(text(dir)).not.toContain('&&')
    } finally {
      cleanup(dir)
    }
  })

  it('stage 목록에 설치 산출물이 실제로 들어 있다', () => {
    const dir = tmpTarget({ lock: 'pnpm-lock.yaml' })
    try {
      const g = text(dir)
      // Stage B: 실행코드는 산출물이 아니다. stage 목록에는 MANAGED 자산·config·package.json·lockfile이 든다.
      expect(g).not.toContain('scripts/req')
      expect(g).toContain('workflow/machine.schema.json')
      expect(g).toContain('req.config.json')
      expect(g).toContain('package.json')
      expect(g, 'lockfile — 선행 `npm i -D commitgate`가 갱신한다').toContain('pnpm-lock.yaml')
      expect(g, '눈으로 확인하는 단계').toContain('git status')
    } finally {
      cleanup(dir)
    }
  })

  it('pm-aware 하고, 마지막 단계가 req:new 다', () => {
    const dir = tmpTarget({ lock: 'pnpm-lock.yaml' })
    try {
      const g = text(dir)
      expect(g).toContain('pnpm install')
      expect(g).toContain('pnpm req:new')
      expect(g).not.toContain('npm run req:new')
    } finally {
      cleanup(dir)
    }
  })

  it('gitignore된 진입점은 stage 목록에서 뺀다 — `git add <ignored>` 는 fatal', () => {
    const dir = tmpTarget()
    try {
      writeFileSync(join(dir, '.gitignore'), '.claude\n', 'utf8')
      const g = text(dir)
      expect(g).not.toContain('.claude/commands/req.md')
      expect(g, '무시되지 않은 진입점은 남는다').toContain('.cursor/rules/commitgate.mdc')
    } finally {
      cleanup(dir)
    }
  })

  it('마커 없는 기존 AGENTS.md → AGENTS.commitgate.md 가 stage 목록에 있다', () => {
    const dir = tmpTarget()
    try {
      writeFileSync(join(dir, 'AGENTS.md'), '# 우리 규칙\n', 'utf8')
      expect(text(dir), '빠지면 untracked로 남아 req:new --run이 죽는다').toContain(KIT_AGENTS_CONTRACT_COPY_REL)
    } finally {
      cleanup(dir)
    }
  })

  /** DEC-011-11: 안전한 커밋 안내를 만들 수 없으면 **내지 않는다.** 잘못된 안내보다 안내 없음이 낫다. */
  it('staged 변경이 있으면 `git add` 목록을 내지 않고 이유를 밝힌다', () => {
    const dir = tmpTarget()
    try {
      writeFileSync(join(dir, 'foo.ts'), 'a\n', 'utf8')
      gitIn(dir, ['add', 'foo.ts'])
      const g = text(dir)
      expect(g).not.toContain('git add ')
      expect(g).toContain('foo.ts')
      expect(g).toMatch(/staged/)
    } finally {
      cleanup(dir)
    }
  })

  it('산출물과 겹치는 tracked 변경이 있으면 `git add` 목록을 내지 않는다', () => {
    const dir = tmpTarget()
    try {
      gitIn(dir, ['add', 'package.json'])
      gitIn(dir, ['commit', '-q', '-m', 'init'])
      // package.json을 직접 덮어쓰므로 D14가 요구하는 devDependencies.commitgate 선언을 유지한다.
      writeFileSync(
        join(dir, 'package.json'),
        JSON.stringify({ name: 'x', version: '9.9.9', devDependencies: { commitgate: COMMITGATE_DEP_SPEC } }),
        'utf8',
      )
      const g = text(dir)
      expect(g).not.toContain('git add ')
      expect(g).toContain('package.json')
    } finally {
      cleanup(dir)
    }
  })

  /**
   * `-u` 없는 bare `git stash`는 untracked를 두고 간다 → clean-tree 게이트가 여전히 실패한다(design 리뷰 R5).
   * 반대로 **경로 없는** `git stash -u`는 너무 넓다 — gitignore되지 않은 `node_modules/`까지 쓸어 가
   * 방금 설치한 `tsx`가 사라지고 `req:new`가 죽는다(실측). 그래서 pathspec을 붙인다.
   */
  it('무관한 변경만 있으면 경로를 명시한 `git stash push -u --` 단계를 넣는다', () => {
    const dir = tmpTarget()
    try {
      gitIn(dir, ['add', 'package.json'])
      gitIn(dir, ['commit', '-q', '-m', 'init'])
      writeFileSync(join(dir, 'notes.txt'), 'x\n', 'utf8')
      const cmds = commands(dir)
      expect(cmds.some((c) => c.startsWith('git add --'))).toBe(true)
      const stash = cmds.find((c) => c.startsWith('git stash'))
      expect(stash, 'pathspec 없는 stash는 node_modules를 쓸어 간다').toBe('git stash push -u -- notes.txt')
    } finally {
      cleanup(dir)
    }
  })

  it('워킹트리가 깨끗하면 stash 단계가 없다', () => {
    const dir = tmpTarget()
    try {
      gitIn(dir, ['add', 'package.json'])
      gitIn(dir, ['commit', '-q', '-m', 'init'])
      expect(text(dir)).not.toContain('git stash')
    } finally {
      cleanup(dir)
    }
  })

  /**
   * `<pm> install`이 만드는 `?? node_modules/`가 clean-tree 게이트를 막는다. README가 지시하는
   * `git init && npm init -y`에는 `.gitignore`가 없으므로 **문서화된 첫 흐름이 100% 실패한다**(실측).
   */
  it('node_modules가 무시되지 않으면 .gitignore 추가를 안내하고 그 파일도 stage 목록에 넣는다', () => {
    const dir = tmpTarget()
    try {
      const g = text(dir)
      expect(r0(dir).nodeModulesWillDirty).toBe(true)
      expect(g).toContain('node_modules')
      expect(g).toContain('.gitignore')
      const add = commands(dir).find((c) => c.startsWith('git add --')) ?? ''
      expect(add.split(' ')).toContain('.gitignore')
    } finally {
      cleanup(dir)
    }
  })

  it('node_modules가 이미 무시되면 그 단계가 없고 .gitignore를 stage하지 않는다', () => {
    const dir = tmpTarget()
    try {
      writeFileSync(join(dir, '.gitignore'), 'node_modules/\n', 'utf8')
      gitIn(dir, ['add', '.gitignore', 'package.json'])
      gitIn(dir, ['commit', '-q', '-m', 'init'])
      const r = r0(dir)
      expect(r.nodeModulesWillDirty).toBe(false)
      const add = commands(dir).find((c) => c.startsWith('git add --')) ?? ''
      expect(add.split(' ')).not.toContain('.gitignore')
    } finally {
      cleanup(dir)
    }
  })

  /**
   * phase-6 리뷰 R1: `.gitignore`를 stage 목록에 사후로 밀어 넣으면, tracked `.gitignore`에 이미 있던
   * unstaged 수정이 설치 커밋에 딸려 들어간다 — `git add -A`를 금지한 이유를 정확히 우회한다.
   * 그래서 `.gitignore`를 **산출물**로 만들어 3분류 기계를 그대로 태운다.
   */
  it('tracked `.gitignore` 에 unstaged 수정이 있으면 overlapping으로 잡고 `git add` 목록을 내지 않는다', () => {
    const dir = tmpTarget()
    try {
      writeFileSync(join(dir, '.gitignore'), 'dist\n', 'utf8') // node_modules는 아직 무시 안 함
      gitIn(dir, ['add', '.gitignore', 'package.json'])
      gitIn(dir, ['commit', '-q', '-m', 'init'])
      writeFileSync(join(dir, '.gitignore'), 'dist\ncoverage\n', 'utf8') // 사용자의 무관한 수정

      const r = r0(dir)
      expect(r.nodeModulesWillDirty).toBe(true)
      expect(r.artifacts, '.gitignore가 산출물이어야 3분류가 본다').toContain('.gitignore')
      expect(r.preexistingDirty.overlapping).toContain('.gitignore')

      const cmds = commands(dir)
      expect(cmds.some((c) => c.startsWith('git add'))).toBe(false)
    } finally {
      cleanup(dir)
    }
  })

  it('untracked `.gitignore` 는 무해하다 — stage 목록에 넣고 안내를 낸다', () => {
    const dir = tmpTarget()
    try {
      gitIn(dir, ['add', 'package.json'])
      gitIn(dir, ['commit', '-q', '-m', 'init'])
      writeFileSync(join(dir, '.gitignore'), 'dist\n', 'utf8') // 커밋된 적 없음

      const r = r0(dir)
      expect(r.preexistingDirty.overlapping).toEqual([])
      expect(r.preexistingDirty.unrelated, 'untracked 산출물은 unrelated도 아니다').not.toContain('.gitignore')
      const add = commands(dir).find((c) => c.startsWith('git add --')) ?? ''
      expect(add.split(' ')).toContain('.gitignore')
    } finally {
      cleanup(dir)
    }
  })

  /**
   * phase-6 리뷰 R2: `node_modules` 무시 판정이 **커밋되지 않은** `.gitignore`에 의존하면,
   * 안내가 그 파일을 `git stash push -u` 로 치우는 순간 규칙이 사라져 `?? node_modules/` 가 되살아난다.
   * 그래서 `.gitignore` 가 dirty하면 무조건 산출물로 편입한다.
   */
  it('untracked `.gitignore` 가 node_modules 를 무시해도, 그 파일을 stash 대상으로 두지 않는다', () => {
    const dir = tmpTarget()
    try {
      gitIn(dir, ['add', 'package.json'])
      gitIn(dir, ['commit', '-q', '-m', 'init'])
      writeFileSync(join(dir, '.gitignore'), 'node_modules/\n', 'utf8') // 아직 커밋 안 됨

      const r = r0(dir) // ⚠️ runInit은 한 번만 — 두 번 돌리면 두 번째 계획이 달라진다
      const cmds = cmdsOf(r)
      // R6 정정: 규칙이 있어도 그 `.gitignore`가 tracked가 아니면 clone에 따라오지 않는다 → 보장으로 인정 안 함.
      expect(r.nodeModulesWillDirty, '커밋되지 않은 규칙은 이식되지 않는다').toBe(true)
      expect(r.artifacts, 'stash되면 규칙이 사라진다 → 설치 커밋에 담아야 한다').toContain('.gitignore')
      expect(r.preexistingDirty.unrelated, 'stash 목록에 들어가면 안 된다').not.toContain('.gitignore')

      const add = cmds.find((c) => c.startsWith('git add --')) ?? ''
      expect(add.split(' ')).toContain('.gitignore')
      expect(cmds.some((c) => c.startsWith('git stash'))).toBe(false)
    } finally {
      cleanup(dir)
    }
  })

  it('tracked·unstaged `.gitignore` 의 미커밋 수정에 node_modules 규칙이 있으면 안내를 내지 않는다', () => {
    const dir = tmpTarget()
    try {
      writeFileSync(join(dir, '.gitignore'), 'dist\n', 'utf8')
      gitIn(dir, ['add', '.gitignore', 'package.json'])
      gitIn(dir, ['commit', '-q', '-m', 'init'])
      writeFileSync(join(dir, '.gitignore'), 'dist\nnode_modules/\n', 'utf8') // 커밋되지 않은 규칙

      const r = r0(dir)
      expect(r.nodeModulesWillDirty).toBe(false)
      expect(r.preexistingDirty.overlapping).toContain('.gitignore')
      expect(cmdsOf(r).some((c) => c.startsWith('git add'))).toBe(false)
    } finally {
      cleanup(dir)
    }
  })

  /**
   * init은 멱등하다. 커밋 전에 두 번 실행해도 안내가 **방금 깐 kit을 stash 하라고 말하면 안 된다** —
   * 두 번째 실행에서 kit 파일들은 `skips`가 되므로, 그것이 산출물에서 빠지면 `unrelated`로 분류된다.
   */
  it('커밋 전에 두 번 실행해도 안내가 kit 파일을 stash 대상으로 만들지 않는다', () => {
    const dir = tmpTarget()
    try {
      gitIn(dir, ['add', 'package.json'])
      gitIn(dir, ['commit', '-q', '-m', 'init'])
      runInit(OPTS(dir))
      const r2 = runInit(OPTS(dir)) // 재실행 — 전부 skip

      expect(r2.copied).toEqual([])
      expect(r2.skipped.length).toBeGreaterThan(0)
      // Stage B: 실행코드는 복사되지 않으므로 MANAGED 자산(스키마)으로 같은 성질을 고정한다.
      expect(r2.artifacts, 'skip된 kit 파일도 설치 커밋에 속한다').toContain('workflow/machine.schema.json')
      expect(r2.preexistingDirty.unrelated).not.toContain('workflow/machine.schema.json')
      const add = cmdsOf(r2).find((c) => c.startsWith('git add --')) ?? ''
      expect(add.split(' ')).toContain('workflow/machine.schema.json')
    } finally {
      cleanup(dir)
    }
  })

  /**
   * phase-6 리뷰 R3: `skips`에는 init이 **보존하려던 사용자 파일**도 섞인다.
   * 그것을 산출물로 넣으면 설치 커밋이 사용자 파일을 삼킨다 — `git add -A` 금지의 목적을 우회한다.
   * 소유권 기준은 `bin/uninstall.ts`와 같은 **byte-identity**다.
   */
  it('kit 경로에 있던 사용자 파일(내용이 다름)은 stage 목록에 넣지 않는다', () => {
    const dir = tmpTarget()
    try {
      gitIn(dir, ['add', 'package.json'])
      gitIn(dir, ['commit', '-q', '-m', 'init'])
      mkdirSync(join(dir, '.cursor/rules'), { recursive: true })
      writeFileSync(join(dir, '.cursor/rules/commitgate.mdc'), '# 내가 쓴 규칙\n', 'utf8')

      const r = r0(dir)
      expect(r.skipped, 'init은 보존한다').toContain('.cursor/rules/commitgate.mdc')
      expect(r.artifacts, '사용자 파일은 설치 산출물이 아니다').not.toContain('.cursor/rules/commitgate.mdc')
      const add = cmdsOf(r).find((c) => c.startsWith('git add --')) ?? ''
      expect(add.split(' ')).not.toContain('.cursor/rules/commitgate.mdc')
      // 사용자 파일이므로 무관한 변경으로 분류되어 stash 안내를 받는다.
      expect(r.preexistingDirty.unrelated).toContain('.cursor/rules/commitgate.mdc')
    } finally {
      cleanup(dir)
    }
  })

  it('바이트가 같은 skip(직전 실행이 깐 것)은 stage 목록에 넣는다', () => {
    const dir = tmpTarget()
    try {
      gitIn(dir, ['add', 'package.json'])
      gitIn(dir, ['commit', '-q', '-m', 'init'])
      runInit(OPTS(dir))
      const r2 = runInit(OPTS(dir))
      expect(r2.skipped).toContain('.cursor/rules/commitgate.mdc')
      expect(r2.artifacts).toContain('.cursor/rules/commitgate.mdc')
    } finally {
      cleanup(dir)
    }
  })

  /**
   * phase-6 리뷰 R4: 설치 결과는 **저장소에 이식 가능**해야 한다.
   *
   * `git check-ignore`는 `.git/info/exclude`와 전역 excludesFile도 인정하지만 그 둘은 clone에
   * 따라오지 않는다. 설치한 사람의 로컬 설정 때문에 안내가 `.gitignore` 규칙을 빼먹으면,
   * 팀원의 fresh clone에서 `<pm> install` 후 `?? node_modules/`가 나타나 `req:new`가 막힌다.
   */
  it('`.git/info/exclude` 만으로 무시되는 경우는 인정하지 않는다 — clone에 따라오지 않는다', () => {
    const dir = tmpTarget()
    try {
      gitIn(dir, ['add', 'package.json'])
      gitIn(dir, ['commit', '-q', '-m', 'init'])
      writeFileSync(join(dir, '.git/info/exclude'), 'node_modules/\n', 'utf8')

      const r = r0(dir)
      expect(r.nodeModulesWillDirty, '로컬 exclude는 이식되지 않는다').toBe(true)
      expect(r.artifacts).toContain('.gitignore')
      expect(cmdsOf(r).find((c) => c.startsWith('git add --'))?.split(' ')).toContain('.gitignore')
    } finally {
      cleanup(dir)
    }
  })

  it('저장소 `.gitignore` 에서 온 규칙만 clean-tree 보장으로 인정한다 (tracked여야 한다)', () => {
    const dir = tmpTarget()
    try {
      writeFileSync(join(dir, '.gitignore'), 'node_modules/\n', 'utf8')
      gitIn(dir, ['add', '.gitignore', 'package.json'])
      gitIn(dir, ['commit', '-q', '-m', 'init'])
      expect(r0(dir).nodeModulesWillDirty).toBe(false)
    } finally {
      cleanup(dir)
    }
  })

  /**
   * phase-6 리뷰 R6: `.gitignore` **자신이** 로컬 exclude로 숨겨져 있으면 그 규칙은 커밋되지 않는다.
   * `git add .gitignore` 는 fatal이고, 팀원의 fresh clone에서 `?? node_modules/` 가 되살아난다.
   * 이식 가능한 clean-tree를 보장할 수 없으므로 안내를 내지 않고, `--strict` 는 쓰기 전에 멈춘다.
   */
  it('`.gitignore` 자신이 무시되면 안내를 내지 않는다', () => {
    const dir = tmpTarget()
    try {
      gitIn(dir, ['add', 'package.json'])
      gitIn(dir, ['commit', '-q', '-m', 'init'])
      writeFileSync(join(dir, '.git/info/exclude'), '.gitignore\n', 'utf8')
      writeFileSync(join(dir, '.gitignore'), 'node_modules/\n', 'utf8')

      const r = r0(dir)
      expect(r.nodeModulesWillDirty, '.gitignore가 tracked가 아니다').toBe(true)
      expect(r.artifacts).toContain('.gitignore')
      expect(r.gitIgnoredArtifacts, 'git add 가 fatal이다').toContain('.gitignore')
      expect(cmdsOf(r).some((c) => c.startsWith('git add'))).toBe(false)
    } finally {
      cleanup(dir)
    }
  })

  it('`.gitignore` 자신이 무시되면 --strict 는 쓰기 0건으로 멈춘다', () => {
    const dir = tmpTarget()
    try {
      gitIn(dir, ['add', 'package.json'])
      gitIn(dir, ['commit', '-q', '-m', 'init'])
      writeFileSync(join(dir, '.git/info/exclude'), '.gitignore\n', 'utf8')
      writeFileSync(join(dir, '.gitignore'), 'node_modules/\n', 'utf8')
      const before = snapshot(dir)
      expect(() => runInit(OPTS(dir, { strict: true }))).toThrow(/\.gitignore/)
      expect(snapshot(dir)).toEqual(before)
    } finally {
      cleanup(dir)
    }
  })

  /**
   * phase-6 리뷰 R5: 경로를 인용 없이 삽입하면 안내가 깨진다.
   * `cd C:\Work\My Repo` 는 PowerShell 5.1에서 인자 두 개로 쪼개지고,
   * `git stash push -u -- notes today.txt` 는 pathspec 두 개가 되어 그 파일이 dirty로 남는다.
   */
  it('공백이 든 target root 와 파일명을 큰따옴표로 묶는다', () => {
    const dir = tmpTarget({ spacedName: true })
    try {
      gitIn(dir, ['add', 'package.json'])
      gitIn(dir, ['commit', '-q', '-m', 'init'])
      writeFileSync(join(dir, 'notes today.txt'), 'x\n', 'utf8')

      const r = r0(dir)
      const g = installGuidance(r).map((l) => l.trim())
      const cd = g.find((l) => /^\d+\. cd /.test(l)) ?? ''
      expect(cd, 'PowerShell 5.1은 공백에서 인자를 쪼갠다').toBe(`1. cd "${r.targetRoot}"`)
      const stash = g.find((l) => l.startsWith('git stash')) ?? ''
      expect(stash).toBe('git stash push -u -- "notes today.txt"')
    } finally {
      cleanup(dir)
    }
  })

  it('공백 없는 경로는 인용하지 않는다(출력 가독성)', () => {
    expect(quoteForShell('scripts/req/req-new.ts')).toBe('scripts/req/req-new.ts')
    expect(quoteForShell('C:\\Work\\repo')).toBe('C:\\Work\\repo')
    expect(quoteForShell('notes today.txt')).toBe('"notes today.txt"')
  })

  /**
   * cmd.exe는 **큰따옴표 안에서도** `%VAR%`(환경변수)와 `!VAR!`(지연확장)를 치환한다.
   * PowerShell은 큰따옴표 안의 `` ` ``·`$`를 확장한다. 어떤 인용으로도 복붙이 안전하지 않다.
   */
  it('어떤 셸 인용으로도 안전하지 않은 경로를 식별한다', () => {
    expect(pathNeedsManualQuoting('a$b.txt')).toBe(true)
    expect(pathNeedsManualQuoting('a`b.txt')).toBe(true)
    expect(pathNeedsManualQuoting('notes %USERPROFILE%.txt'), 'cmd.exe 환경변수 확장').toBe(true)
    expect(pathNeedsManualQuoting('a!b.txt'), 'cmd.exe 지연확장').toBe(true)
    expect(pathNeedsManualQuoting('a"b.txt')).toBe(true)
    expect(pathNeedsManualQuoting('notes today.txt')).toBe(false)
    expect(pathNeedsManualQuoting('scripts/req/req-new.ts')).toBe(false)
  })

  it('`%VAR%` 가 든 무관한 파일이 있으면 복붙 명령을 내지 않는다', () => {
    const dir = tmpTarget()
    try {
      gitIn(dir, ['add', 'package.json'])
      gitIn(dir, ['commit', '-q', '-m', 'init'])
      writeFileSync(join(dir, '.gitignore'), 'node_modules/\n', 'utf8')
      gitIn(dir, ['add', '.gitignore'])
      gitIn(dir, ['commit', '-q', '-m', 'ignore'])
      writeFileSync(join(dir, 'notes %USERPROFILE%.txt'), 'x\n', 'utf8')

      const r = r0(dir)
      expect(r.preexistingDirty.unrelated).toContain('notes %USERPROFILE%.txt')
      const cmds = cmdsOf(r)
      expect(cmds.some((c) => c.startsWith('git add')), 'cmd.exe가 pathspec을 바꿔치기한다').toBe(false)
      expect(cmds.some((c) => c.startsWith('git stash'))).toBe(false)
      expect(installGuidance(r).join('\n')).toContain('notes %USERPROFILE%.txt')
    } finally {
      cleanup(dir)
    }
  })

  it('target root 에 `%` 가 있으면 `cd` 명령 대신 경로만 알려 준다', () => {
    const dir = tmpTarget({ pctName: true })
    try {
      const g = installGuidance(r0(dir)).map((l) => l.trim())
      expect(g.some((l) => l.startsWith('1. cd '))).toBe(false)
      expect(g.some((l) => l.startsWith('1. 저장소 루트로 이동:'))).toBe(true)
    } finally {
      cleanup(dir)
    }
  })

  /**
   * REQ-2026-012: `-z`는 공백이 든 경로를 **인용하지 않는다**(parseStatusZ가 원문을 그대로 준다).
   * 옛 `unquoteGitPath`는 `--porcelain`의 C-인용을 되돌리려는 것이었으나, `-z` 전환으로 인용 자체가 사라져 삭제됐다.
   */
  it('공백이 든 경로가 3분류에서 올바로 매칭된다', () => {
    const d = classifyPreexistingDirty([se('?', '?', 'notes today.txt'), se(' ', 'M', 'my pkg.json')], ['my pkg.json'])
    expect(d.unrelated).toEqual(['notes today.txt'])
    expect(d.overlapping).toEqual(['my pkg.json'])
  })

  /** `runInit`을 한 번만 돌리는 헬퍼(위 테스트들이 결과 필드를 직접 본다). */
  function r0(dir: string) {
    return runInit(OPTS(dir))
  }
  /** 이미 얻은 결과에서 명령 줄만 추출(runInit 재호출 금지). */
  function cmdsOf(r: ReturnType<typeof runInit>): string[] {
    return installGuidance(r)
      .map((l) => l.trim())
      .filter((l) => l.startsWith('git '))
  }
})

/**
 * 완료 기준 그 자체: **안내를 순서대로 따르면 `req:new --run` 의 clean-tree 게이트를 통과한다.**
 * lockfile·`AGENTS.commitgate.md` 중 하나라도 stage 목록에서 빠지면 여기서 잡힌다.
 */
describe('[init] 통합 — 안내대로 커밋하면 워킹트리가 clean해진다', () => {
  it('마커 없는 AGENTS.md + tracked lockfile 이 있는 brownfield repo', () => {
    const dir = tmpTarget({ lock: 'pnpm-lock.yaml' })
    try {
      writeFileSync(join(dir, 'AGENTS.md'), '# 우리 규칙\n', 'utf8')
      writeFileSync(join(dir, '.gitignore'), 'node_modules/\n', 'utf8') // 현실적인 brownfield 상태
      gitIn(dir, ['add', '.gitignore', 'package.json', 'pnpm-lock.yaml', 'AGENTS.md'])
      gitIn(dir, ['commit', '-q', '-m', 'baseline'])

      const r = runInit(OPTS(dir))
      expect(r.agentsContractCopyCreated).toBe(true)

      // `<pm> install`이 lockfile을 갱신하는 것을 모사(네트워크 install 없이).
      writeFileSync(join(dir, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n', 'utf8')

      gitIn(dir, ['add', '--', ...stageList(r.artifacts, r.gitIgnoredArtifacts)])
      gitIn(dir, ['commit', '-q', '-m', 'chore: install commitgate'])

      expect(gitIn(dir, ['status', '--porcelain', '--untracked-files=all']).trim()).toBe('')
    } finally {
      cleanup(dir)
    }
  })

  it('무관한 변경이 있으면 안내대로 커밋 + `git stash -u` 후 clean해진다', () => {
    const dir = tmpTarget()
    try {
      gitIn(dir, ['add', 'package.json'])
      gitIn(dir, ['commit', '-q', '-m', 'baseline'])
      writeFileSync(join(dir, 'notes.txt'), 'x\n', 'utf8') // untracked — bare stash로는 안 치워진다

      const r = runInit(OPTS(dir))
      // 안내 2단계(`<pm> install`)가 lockfile을 만들고, 5단계가 `.gitignore`에 node_modules/를 넣게 한다.
      // 그 단계들을 건너뛰면 `git add`가 존재하지 않는 경로에서 fatal이 된다 — 안내는 순서대로 따라야 성립한다.
      const lock = r.lockfileRel
      expect(lock).toBe('package-lock.json')
      writeFileSync(join(dir, lock as string), '{}\n', 'utf8')
      expect(r.nodeModulesWillDirty).toBe(true)
      writeFileSync(join(dir, '.gitignore'), 'node_modules/\n', 'utf8')

      gitIn(dir, ['add', '--', ...stageList(r.artifacts, r.gitIgnoredArtifacts)])
      gitIn(dir, ['commit', '-q', '-m', 'chore: install commitgate'])
      // 안내가 내는 것과 동일한 pathspec 형태. 경로 없이 stash하면 node_modules까지 딸려 간다.
      gitIn(dir, ['stash', 'push', '-u', '-q', '--', ...r.preexistingDirty.unrelated])

      expect(gitIn(dir, ['status', '--porcelain', '--untracked-files=all']).trim()).toBe('')
    } finally {
      cleanup(dir)
    }
  })
})

/**
 * REQ-2026-012 phase-2 — `workflow/.gitignore`(kit 파일). 티켓 scratch를 무시하는 중첩 .gitignore.
 * 정책: 부재 시에만 생성(D12) · --force로도 안 덮음 · --no-agent-entrypoints와 무관(D13) · 멱등.
 */
describe('[init] workflow/.gitignore (REQ-2026-012)', () => {
  const WG = KIT_GITIGNORE.dest // 'workflow/.gitignore'

  /** 대상 repo에서 경로가 무시되는가(설치된 workflow/.gitignore 효과 실측). */
  const isIgnored = (dir: string, p: string): boolean => {
    try {
      execFileSync('git', ['check-ignore', '-q', '--', p], { cwd: dir })
      return true
    } catch {
      return false
    }
  }

  it('부재 시 생성하고 산출물에 편입한다', () => {
    const dir = tmpTarget()
    try {
      const r = runInit(OPTS(dir))
      expect(r.workflowGitignoreCreated).toBe(true)
      expect(existsSync(join(dir, WG))).toBe(true)
      expect(r.artifacts, '설치 커밋에 담겨 팀·CI에 전파돼야 한다').toContain(WG)
    } finally {
      cleanup(dir)
    }
  })

  /**
   * kit 템플릿 규칙은 **중첩 .gitignore 기준 상대**(앵커드 REQ 패턴)여야 한다(설계 D5-1). `workflow/`로 시작하는
   * 루트용 규칙이 섞이면 하위 workflow 를 찾아 조용히 무효가 된다 — 정적으로 고정한다(phase-2 리뷰 관찰).
   */
  it('kit 템플릿 규칙은 루트용 workflow/ 경로로 시작하지 않는다(중첩 상대 경로)', () => {
    const rules = readFileSync(join(PACKAGE_ROOT_FOR_TEST, 'templates', 'workflow.gitignore'), 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l !== '' && !l.startsWith('#'))
    expect(rules.length).toBeGreaterThan(0)
    for (const r of rules) expect(/^\/?workflow\//.test(r), `루트용 규칙 혼입: ${r}`).toBe(false)
  })

  /**
   * phase-2 리뷰 R4 — ignore 경계를 positive·negative 양쪽으로 고정.
   * 규칙이 빠지거나(under-match) 과도해도(over-match) 여기서 잡힌다.
   */
  it('3종 scratch를 무시하고(positive), state.json·responses·티켓 밖은 무시하지 않는다(negative)', () => {
    const dir = tmpTarget()
    try {
      runInit(OPTS(dir))
      // positive: 티켓 직계 3종
      for (const p of [
        'workflow/REQ-2026-001/codex-response.json',
        'workflow/REQ-2026-001/.review-preview.txt',
        'workflow/REQ-2026-001/.codex-abc.tmp',
      ])
        expect(isIgnored(dir, p), `positive: ${p}`).toBe(true)
      // negative: 승인 증거·메타데이터·티켓 밖은 무시하면 안 된다(증거 변조·오버매치 방지)
      for (const p of [
        'workflow/REQ-2026-001/state.json',
        'workflow/REQ-2026-001/responses/design-r01-approved.json',
        'workflow/notes/codex-response.json', // REQ-* 디렉터리가 아님
        'workflow/codex-response.json', // 티켓 하위가 아님(루트 직계)
      ])
        expect(isIgnored(dir, p), `negative: ${p}`).toBe(false)
    } finally {
      cleanup(dir)
    }
  })

  it('바이트 동일 재실행분은 산출물(ownedSkip)로 편입 — stageList에서 빠지지 않는다 (phase-2 R1)', () => {
    const dir = tmpTarget()
    try {
      runInit(OPTS(dir)) // 1차 생성
      const r2 = runInit(OPTS(dir)) // 2차: 존재하지만 바이트 동일
      expect(r2.workflowGitignoreCreated).toBe(false)
      expect(r2.artifacts, '커밋 전 재실행 시에도 stage 목록에 남아야 한다').toContain(WG)
      expect(r2.preexistingDirty.unrelated).not.toContain(WG)
    } finally {
      cleanup(dir)
    }
  })

  it('목적지가 디렉터리면 fail-closed로 throw (phase-2 P1)', () => {
    const dir = tmpTarget()
    try {
      mkdirSync(join(dir, 'workflow', '.gitignore'), { recursive: true }) // 디렉터리로 선점
      expect(() => runInit(OPTS(dir))).toThrow(/일반 파일이 아닙니다/)
    } finally {
      cleanup(dir)
    }
  })

  it('목적지가 symlink면 fail-closed로 throw — confinement escape 차단 (phase-2 P1)', () => {
    const dir = tmpTarget()
    try {
      const outside = mkdtempSync(join(tmpdir(), 'wg-outside-'))
      try {
        mkdirSync(join(dir, 'workflow'), { recursive: true })
        try {
          symlinkSync(join(outside, 'escape.txt'), join(dir, WG)) // dangling symlink(대상 부재)
        } catch (e) {
          if (symlinkUnsupported(e)) return // symlink 권한 없는 환경(Windows CI 일부)
          throw e
        }
        expect(() => runInit(OPTS(dir))).toThrow(/일반 파일이 아닙니다|symlink/)
        // confinement: targetRoot 밖에 아무것도 쓰지 않았다
        expect(existsSync(join(outside, 'escape.txt'))).toBe(false)
      } finally {
        rmSync(outside, { recursive: true, force: true })
      }
    } finally {
      cleanup(dir)
    }
  })

  it('상위 workflow/ 가 저장소 밖 symlink면 confinement로 throw — 밖에 쓰지 않는다 (phase-2 P1)', () => {
    const dir = tmpTarget()
    const outside = mkdtempSync(join(tmpdir(), 'wg-parent-'))
    try {
      try {
        symlinkSync(outside, join(dir, 'workflow'), 'dir')
      } catch (e) {
        if (symlinkUnsupported(e)) return // symlink 권한 없음 — 스킵
        throw e
      }
      expect(() => runInit(OPTS(dir))).toThrow(/confinement|symlink/)
      // 외부 디렉터리에 아무것도 쓰지 않았다(스키마 파일 포함 — preflight가 apply보다 먼저 막았다)
      expect(readdirSync(outside)).toEqual([])
    } finally {
      rmSync(outside, { recursive: true, force: true })
      cleanup(dir)
    }
  })

  it('상위 workflow/ 가 dangling symlink여도 fail-closed로 throw — 부분 설치 없음 (phase-2 R5)', () => {
    const dir = tmpTarget()
    try {
      try {
        symlinkSync(join(dir, 'no-such-target'), join(dir, 'workflow'), 'dir') // 대상 부재(dangling)
      } catch (e) {
        if (symlinkUnsupported(e)) return
        throw e
      }
      expect(() => runInit(OPTS(dir))).toThrow(/symlink|confinement/)
      // apply가 preflight보다 뒤라 아무 산출물도 쓰지 않았다(부분 설치 없음).
      expect(existsSync(join(dir, 'scripts', 'req')), 'scripts/req 미생성').toBe(false)
      expect(existsSync(join(dir, 'no-such-target')), 'dangling 대상 미생성').toBe(false)
    } finally {
      cleanup(dir)
    }
  })

  it('상위 workflow/ 가 저장소 **내부**를 가리키는 symlink여도 거부한다 (git이 정상 stage 못함, phase-2 R5)', () => {
    const dir = tmpTarget()
    try {
      mkdirSync(join(dir, 'real-workflow'), { recursive: true })
      try {
        symlinkSync(join(dir, 'real-workflow'), join(dir, 'workflow'), 'dir') // 내부 대상
      } catch (e) {
        if (symlinkUnsupported(e)) return
        throw e
      }
      // realpath는 내부라 통과시키지만, lstat 기반 검사는 symlink 자체를 거부한다.
      expect(() => runInit(OPTS(dir))).toThrow(/symlink|confinement/)
      expect(readdirSync(join(dir, 'real-workflow')), '내부 대상에도 안 씀').toEqual([])
    } finally {
      cleanup(dir)
    }
  })

  it('workflow/.gitignore 가 ignored∧untracked면 policyAtRisk → unsafe 안내(정상 git add 명령 없음) (phase-2 P2)', () => {
    const dir = tmpTarget()
    try {
      gitIn(dir, ['add', 'package.json'])
      gitIn(dir, ['commit', '-q', '-m', 'base'])
      // 루트 규칙이 workflow/.gitignore 자신을 무시 → 설치 커밋에 못 담김.
      writeFileSync(join(dir, '.gitignore'), 'workflow/.gitignore\n', 'utf8')
      gitIn(dir, ['add', '.gitignore'])
      gitIn(dir, ['commit', '-q', '-m', 'ignore wg'])
      const r = runInit(OPTS(dir))
      expect(r.workflowGitignorePolicyAtRisk).toBe(true)
      const g = installGuidance(r)
      expect(g.some((l) => l.trim().startsWith('git add --')), 'unsafe라 정상 stage 명령 없음').toBe(false)
      expect(g.join('\n')).toMatch(/scratch 정책이 없|안전한 커밋 안내를 만들 수 없/)
    } finally {
      cleanup(dir)
    }
  })

  /**
   * phase-2 리뷰 R6: 사용자 소유(differs) 파일은 artifacts와 porcelain 양쪽에서 빠질 수 있다.
   * 그래도 ignored∧untracked면 정책을 설치 커밋에 담을 수 없으므로 --strict가 apply 전에 멈춰야 한다.
   */
  it('--strict: ignored∧untracked인 user-different workflow/.gitignore면 쓰기 0건으로 중단한다 (phase-2 R6)', () => {
    const dir = tmpTarget()
    try {
      gitIn(dir, ['add', 'package.json'])
      gitIn(dir, ['commit', '-q', '-m', 'base'])
      writeFileSync(join(dir, '.gitignore'), 'workflow/.gitignore\n', 'utf8')
      gitIn(dir, ['add', '.gitignore'])
      gitIn(dir, ['commit', '-q', '-m', 'ignore wg'])
      mkdirSync(join(dir, 'workflow'), { recursive: true })
      writeFileSync(join(dir, WG), '# user policy\n/REQ-*/codex-response.json\n', 'utf8')

      const before = snapshot(dir)
      expect(() => runInit(OPTS(dir, { strict: true }))).toThrow(/workflow\/\.gitignore.*무시|scratch.*fresh clone/s)
      expect(snapshot(dir), 'strict preflight 뒤 신규·수정 파일이 없어야 한다').toEqual(before)
    } finally {
      cleanup(dir)
    }
  })

  it('kit과 다르면(differs) 보존하고 workflowGitignoreUserDiffers=true (효과 판정 안 함, phase-2 P2·P3)', () => {
    const dir = tmpTarget()
    try {
      mkdirSync(join(dir, 'workflow'), { recursive: true })
      // 세 규칙 다 있어도 scoped negation이 있으면 효과 검증은 놓친다 — 그래서 "다르면 무조건" 보수적 처리.
      writeFileSync(join(dir, WG), '/REQ-*/codex-response.json\n!/REQ-2026-001/codex-response.json\n', 'utf8')
      const r = runInit(OPTS(dir))
      expect(r.workflowGitignoreCreated).toBe(false)
      expect(r.workflowGitignoreUserDiffers).toBe(true)
      expect(readFileSync(join(dir, WG), 'utf8')).toContain('!/REQ-2026-001') // 보존
      expect(r.artifacts, '사용자 파일이므로 산출물 아님').not.toContain(WG)
    } finally {
      cleanup(dir)
    }
  })

  it('이미 존재하면 보존한다 — 내용을 덮지 않는다', () => {
    const dir = tmpTarget()
    try {
      mkdirSync(join(dir, 'workflow'), { recursive: true })
      writeFileSync(join(dir, WG), '# 내가 쓴 규칙\nmy-own-pattern\n', 'utf8')
      const r = runInit(OPTS(dir))
      expect(r.workflowGitignoreCreated).toBe(false)
      expect(readFileSync(join(dir, WG), 'utf8')).toBe('# 내가 쓴 규칙\nmy-own-pattern\n')
      expect(r.artifacts, '보존 시엔 산출물이 아니다(AGENTS.md 모델)').not.toContain(WG)
    } finally {
      cleanup(dir)
    }
  })

  /** phase-2 P4 — 사용자 소유 dirty workflow/.gitignore를 stash로 치우라고 하면 정책 파일이 사라진다. */
  it('사용자 소유 workflow/.gitignore(dirty)는 stash 목록에 넣지 않고 별도 커밋을 안내한다', () => {
    const dir = tmpTarget()
    try {
      // baseline 커밋(clean) 후 사용자가 workflow/.gitignore를 미커밋으로 둔다
      execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'base', '--allow-empty'], { cwd: dir })
      mkdirSync(join(dir, 'workflow'), { recursive: true })
      writeFileSync(join(dir, WG), '# 내 정책\n/REQ-*/codex-response.json\n', 'utf8') // untracked, differs
      const r = runInit(OPTS(dir))
      expect(r.workflowGitignoreUserDiffers).toBe(true)
      const g = installGuidance(r)
      const stash = g.find((l) => l.trim().startsWith('git stash')) ?? ''
      expect(stash, 'stash 대상에서 제외').not.toContain(WG)
      expect(g.join('\n'), '별도 커밋 안내').toMatch(/당신의 파일|직접 커밋/)
    } finally {
      cleanup(dir)
    }
  })

  it('--force로도 덮지 않는다 (D12 — .gitignore는 사용자 소유)', () => {
    const dir = tmpTarget()
    try {
      mkdirSync(join(dir, 'workflow'), { recursive: true })
      writeFileSync(join(dir, WG), 'my-rules\n', 'utf8')
      runInit(OPTS(dir, { force: true }))
      expect(readFileSync(join(dir, WG), 'utf8')).toBe('my-rules\n')
    } finally {
      cleanup(dir)
    }
  })

  it('--no-agent-entrypoints여도 설치·산출물 편입한다 (D13)', () => {
    const dir = tmpTarget()
    try {
      const r = runInit(OPTS(dir, { noAgentEntrypoints: true }))
      expect(r.agentEntrypointsSkipped).toBe(true)
      expect(r.workflowGitignoreCreated, '.claude/·.cursor/만 생략 — workflow/.gitignore는 무관').toBe(true)
      expect(existsSync(join(dir, WG))).toBe(true)
      expect(r.artifacts).toContain(WG)
      // 진입점은 실제로 건너뛴다(대조)
      expect(existsSync(join(dir, '.claude/commands/req.md'))).toBe(false)
    } finally {
      cleanup(dir)
    }
  })

  it('두 번 실행해도 멱등 — 두 번째는 보존', () => {
    const dir = tmpTarget()
    try {
      runInit(OPTS(dir))
      const before = readFileSync(join(dir, WG), 'utf8')
      const r2 = runInit(OPTS(dir))
      expect(r2.workflowGitignoreCreated).toBe(false)
      expect(readFileSync(join(dir, WG), 'utf8')).toBe(before)
    } finally {
      cleanup(dir)
    }
  })
})

// ═════════ REQ-2026-020 phase-2: companion skills 설치·보안 ═════════

/**
 * D1 경로 · D3 seed-once(--force 무시) · D4-1 dest별 상위 confinement · D4-3 leaf lstat(ENOENT만 부재).
 * 보안 fixture는 **대상과 외부 양쪽**을 전후 비교한다 — 대상만 보면 탈출을 못 잡는다.
 */
describe('[init] companion skills (REQ-2026-020)', () => {
  const DESTS = [
    '.claude/skills/commitgate-discovery/SKILL.md',
    '.claude/skills/commitgate-tdd/SKILL.md',
    '.claude/skills/commitgate-diagnosing-bugs/SKILL.md',
    '.claude/skills/commitgate-research/SKILL.md',
  ] as const
  const TDD = DESTS[1]

  const outsideDir = (): string => mkdtempSync(join(tmpdir(), 'reqwf-outside-'))


  /**
   * 보안 fixture 공통 단언 — **throw 여부와 무관하게 양쪽 무변화를 먼저 검사한다.**
   *
   * ⚠️ `expect(() => runInit()).toThrow()`를 먼저 쓰면, 구현이 **throw하지 않고 외부에 쓰는** 회귀에서
   *    toThrow가 먼저 실패해 **외부 snapshot 단언에 도달하지 못한다** — 실패 이유가 "대상 밖에 썼다"로
   *    드러나지 않고, 외부 검사는 사실상 죽은 코드가 된다. 순서를 뒤집어야 oracle이 실제로 일한다.
   *    (실측: root-only confinement 변이에서 runInit이 throw 없이 완료되고 외부에 SKILL.md를 만든다.)
   */
  const expectRejectedWithNoWrites = (dir: string, outside: string, run: () => void): void => {
    const beforeIn = snapshot(dir)
    const beforeOut = snapshot(outside)
    let threw = false
    try {
      run()
    } catch {
      threw = true
    }
    expect(snapshot(outside), '외부 tree 무변화 — 여기서 실패하면 대상 **밖**에 썼다는 뜻이다').toEqual(beforeOut)
    expect(snapshot(dir), '대상 tree 무변화').toEqual(beforeIn)
    expect(threw, 'preflight가 쓰기 전에 거부해야 한다').toBe(true)
  }

  /**
   * symlink fixture 준비 — 권한 없는 러너(Windows CI 일부)에서는 **그 사유로만** skip한다.
   * 다른 오류는 삼키지 않고 throw한다(픽스처 결함을 조용히 통과시키지 않는다).
   * @returns false면 호출부가 즉시 return해 테스트를 건너뛴다.
   */
  const trySymlink = (target: string, path: string, type: 'junction' | 'file'): boolean => {
    try {
      symlinkSync(target, path, type)
      return true
    } catch (e) {
      if (symlinkUnsupported(e)) return false // 권한 미지원 — 설치기 결함이 아니다
      throw e
    }
  }

  it('fresh init에 4종이 정확한 경로에 설치된다 (D1/R3)', () => {
    const dir = tmpTarget()
    try {
      runInit(OPTS(dir))
      for (const d of DESTS) expect(existsSync(join(dir, d)), d).toBe(true)
      // 기존 entrypoint와 공존 — `commitgate-` 접두사라 이름 충돌 없음.
      expect(existsSync(join(dir, '.claude/skills/commitgate/SKILL.md'))).toBe(true)
    } finally {
      cleanup(dir)
    }
  })

  it('설치된 SKILL.md에 MIT permission notice 전문이 동행한다 (R9)', () => {
    const dir = tmpTarget()
    try {
      runInit(OPTS(dir))
      for (const d of DESTS) {
        const t = readFileSync(join(dir, d), 'utf8')
        expect(t, `${d}: 저작권 표기`).toContain('Copyright (c) 2026 Matt Pocock')
        expect(t, `${d}: permission notice 전문(MIT §2)`).toContain(
          'The above copyright notice and this permission notice shall be included in all',
        )
        expect(t, `${d}: baseline SHA`).toContain('d574778f94cf620fcc8ce741584093bc650a61d3')
      }
    } finally {
      cleanup(dir)
    }
  })

  it('재실행이 멱등적이다', () => {
    const dir = tmpTarget()
    try {
      runInit(OPTS(dir))
      const after1 = snapshot(dir)
      runInit(OPTS(dir))
      expect(snapshot(dir)).toEqual(after1)
    } finally {
      cleanup(dir)
    }
  })

  /** D3 핵심 — 스킬은 사용자가 고치라고 만든 자산이다. `--force`가 손수정을 날리면 실질적 데이터 손실. */
  it('사용자가 수정한 skill은 --force에도 보존된다 (D3 seed-once)', () => {
    const dir = tmpTarget()
    try {
      runInit(OPTS(dir))
      const target = join(dir, TDD)
      writeFileSync(target, '# 내가 고친 내용\n', 'utf8')
      runInit(OPTS(dir, { force: true }))
      expect(readFileSync(target, 'utf8'), '--force가 사용자 수정을 덮으면 안 된다').toBe('# 내가 고친 내용\n')
    } finally {
      cleanup(dir)
    }
  })

  it('--no-agent-entrypoints면 설치되지 않는다 (D5/R5)', () => {
    const dir = tmpTarget()
    try {
      runInit(OPTS(dir, { noAgentEntrypoints: true }))
      for (const d of DESTS) expect(existsSync(join(dir, d)), d).toBe(false)
    } finally {
      cleanup(dir)
    }
  })

  /**
   * 🔴 D4-1 — 상위 컴포넌트 symlink 탈출. `assertConfinedDest`에 skills **루트**만 넘기면
   * `segs.length-1` 루프가 `commitgate-tdd`를 검사하지 않아 대상 **밖에** 쓴다.
   */
  it('commitgate-tdd 디렉터리가 외부 symlink면 쓰기 0회로 거부한다 (D4-1)', () => {
    const dir = tmpTarget()
    const outside = outsideDir()
    try {
      mkdirSync(join(dir, '.claude/skills'), { recursive: true })
      if (!trySymlink(outside, join(dir, '.claude/skills/commitgate-tdd'), 'junction')) return
      expectRejectedWithNoWrites(dir, outside, () => runInit(OPTS(dir)))
    } finally {
      cleanup(dir)
      rmSync(outside, { recursive: true, force: true })
    }
  })

  /**
   * 🔴 D4-3 — leaf **dangling** symlink. `existsSync`는 **false**를 주므로 seed-once가 부재로 오판하고
   * `copyFileSync`가 링크를 따라 대상 밖에 쓴다. `lstatSync` + ENOENT-only 구현에서만 통과한다.
   */
  it('SKILL.md leaf가 외부를 가리키는 dangling symlink면 쓰기 0회로 거부한다 (D4-3)', () => {
    const dir = tmpTarget()
    const outside = outsideDir()
    try {
      mkdirSync(join(dir, '.claude/skills/commitgate-tdd'), { recursive: true })
      const escaped = join(outside, 'ESCAPED.md') // 아직 없는 파일 → dangling
      if (!trySymlink(escaped, join(dir, TDD), 'file')) return
      expect(existsSync(join(dir, TDD)), 'dangling이라 existsSync는 false다 — 이게 함정이다').toBe(false)
      expect(lstatSync(join(dir, TDD)).isSymbolicLink(), 'lstat은 링크를 본다').toBe(true)
      expectRejectedWithNoWrites(dir, outside, () => runInit(OPTS(dir)))
      expect(existsSync(escaped), '대상 밖에 파일이 생기면 안 된다').toBe(false)
    } finally {
      cleanup(dir)
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it('SKILL.md leaf가 디렉터리면 거부한다 (D4-3)', () => {
    const dir = tmpTarget()
    try {
      mkdirSync(join(dir, DESTS[3]), { recursive: true })
      const before = snapshot(dir)
      expect(() => runInit(OPTS(dir))).toThrow()
      expect(snapshot(dir)).toEqual(before)
    } finally {
      cleanup(dir)
    }
  })

  it('.claude/skills 자체가 symlink면 거부한다 (D4-1)', () => {
    const dir = tmpTarget()
    const outside = outsideDir()
    try {
      mkdirSync(join(dir, '.claude'), { recursive: true })
      if (!trySymlink(outside, join(dir, '.claude/skills'), 'junction')) return
      expectRejectedWithNoWrites(dir, outside, () => runInit(OPTS(dir)))
    } finally {
      cleanup(dir)
      rmSync(outside, { recursive: true, force: true })
    }
  })

  /** 4개 dest **각각** 검사되는가 — 루트만 검사하는 구현이면 이 케이스가 통과해 버린다(회귀 탐지점). */
  it('commitgate-research만 symlink여도 거부한다 (dest별 검사 회귀)', () => {
    const dir = tmpTarget()
    const outside = outsideDir()
    try {
      mkdirSync(join(dir, '.claude/skills'), { recursive: true })
      if (!trySymlink(outside, join(dir, '.claude/skills/commitgate-research'), 'junction')) return
      // 🔴 dest별 confinement가 빠지면 runInit이 throw 없이 완료되고 **외부에** SKILL.md를 쓴다.
      //    공통 단언이 외부를 먼저 보므로 실패가 "대상 밖에 썼다"로 드러난다.
      expectRejectedWithNoWrites(dir, outside, () => runInit(OPTS(dir)))
    } finally {
      cleanup(dir)
      rmSync(outside, { recursive: true, force: true })
    }
  })

  /** preflight 실패면 **core 자산도** 하나도 안 생겨야 한다 — Apply엔 rollback이 0줄이다. */
  it('preflight 실패 시 core 자산(AGENTS.md·config·schema)도 생성되지 않는다', () => {
    const dir = tmpTarget()
    const outside = outsideDir()
    try {
      mkdirSync(join(dir, '.claude/skills'), { recursive: true })
      if (!trySymlink(outside, join(dir, '.claude/skills/commitgate-tdd'), 'junction')) return
      expect(() => runInit(OPTS(dir))).toThrow()
      expect(existsSync(join(dir, 'AGENTS.md')), 'preflight throw 후 core 자산도 없어야 한다').toBe(false)
      expect(existsSync(join(dir, 'req.config.json'))).toBe(false)
      expect(existsSync(join(dir, 'workflow/machine.schema.json'))).toBe(false)
    } finally {
      cleanup(dir)
      rmSync(outside, { recursive: true, force: true })
    }
  })

  /** `--dry-run`도 **같은 preflight**를 돈다 — 쓰기는 0건이지만 symlink면 실패해야 한다. */
  it('--dry-run도 confinement/leaf preflight를 수행해 symlink면 실패한다', () => {
    const dir = tmpTarget()
    const outside = outsideDir()
    try {
      mkdirSync(join(dir, '.claude/skills'), { recursive: true })
      if (!trySymlink(outside, join(dir, '.claude/skills/commitgate-tdd'), 'junction')) return
      // dry-run도 같은 preflight를 돈다 — 조용히 통과하면 실설치 직전에야 터진다. 양쪽을 봐야 "쓰기 0회"가 증명된다.
      expectRejectedWithNoWrites(dir, outside, () => runInit(OPTS(dir, { dryRun: true })))
    } finally {
      cleanup(dir)
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it('--dry-run은 skill 파일을 쓰지 않는다', () => {
    const dir = tmpTarget()
    try {
      const before = snapshot(dir)
      runInit(OPTS(dir, { dryRun: true }))
      expect(snapshot(dir)).toEqual(before)
      for (const d of DESTS) expect(existsSync(join(dir, d))).toBe(false)
    } finally {
      cleanup(dir)
    }
  })

  /** D6 — companion은 계약 포인터가 **아니다**(없어도 핵심 워크플로가 동일하게 동작한다). 별도 목록으로 관리한다. */
  it('companion skills는 CONTRACT_POINTER_RELPATHS에 섞이지 않는다 (D6)', () => {
    for (const d of DESTS) expect(CONTRACT_POINTER_RELPATHS as readonly string[], d).not.toContain(d)
    expect([...KIT_COMPANION_SKILLS.map((s) => s.dest)].sort()).toEqual([...DESTS].sort())
  })
})

// ═══════ REQ-2026-021 phase-1: companion gitignore 경고 ═══════

/**
 * companion skills가 팀원 clone에 전달되지 못하면(ignored ∧ !tracked) 경고한다.
 *
 * 🔴 **3개 계획 상태(create·ownedSkip·userDiffers)를 각각 격리해 증명한다.**
 *    `create`만 검증하면 나머지 둘의 누락을 못 잡는다 — 특히 `userDiffers`는 `skips`로 가서
 *    `planArtifactPaths`(= copies + ownedSkips)에 **없으므로** artifacts만 보는 구현이 조용히 통과한다.
 *
 * 🔴 **기존 계약 포인터의 strict 경고로 우연히 통과하면 안 된다.** 각 fixture는 나머지 companion과
 *    기존 `.claude` entrypoint를 **강제 추적**해 at-risk 원인에서 제거한 뒤, 대상 skill 하나만 남긴다.
 */
describe('[init] companion gitignore 경고 (REQ-2026-021)', () => {
  const SKILLS = [
    '.claude/skills/commitgate-discovery/SKILL.md',
    '.claude/skills/commitgate-tdd/SKILL.md',
    '.claude/skills/commitgate-diagnosing-bugs/SKILL.md',
    '.claude/skills/commitgate-research/SKILL.md',
  ] as const
  const TDD = SKILLS[1]
  /** `.claude/` 아래의 기존 계약 포인터 — 이들이 at-risk로 남으면 격리가 깨진다. */
  const CLAUDE_POINTERS = ['.claude/skills/commitgate/SKILL.md', '.claude/commands/req.md', 'CLAUDE.md']

  /** WARN을 문자열로 캡처. 원인 경로를 단언해야 "WARN이 났다"가 아니라 "그 경로 때문에 났다"를 증명한다. */
  const captureWarn = (fn: () => void): string => {
    const orig = console.warn
    const lines: string[] = []
    console.warn = (...a: unknown[]): void => {
      lines.push(a.map(String).join(' '))
    }
    try {
      fn()
    } finally {
      console.warn = orig
    }
    return lines.join('\n')
  }


  /** `--strict` throw 메시지가 **그 경로를 포함**하는지. 문자열 포함으로 본다(정규식 이스케이프 불필요). */
  const expectStrictThrowMentioning = (dir: string, path: string): void => {
    let msg = ''
    expect(() => {
      try {
        runInit(OPTS(dir, { strict: true }))
      } catch (e) {
        msg = (e as Error).message
        throw e
      }
    }, '--strict는 설치 전에 멈춰야 한다').toThrow()
    expect(msg, `throw 메시지에 ${path}가 있어야 한다 — 기존 계약 포인터 경고로 우연히 통과하면 안 된다`).toContain(path)
  }

  /** `.claude/`를 ignore한 fixture. */
  const ignoredClaude = (): string => {
    const dir = tmpTarget()
    writeFileSync(join(dir, '.gitignore'), '.claude/\n', 'utf8')
    return dir
  }

  /**
   * 대상 skill **하나만** at-risk로 남긴다 — 나머지 companion과 `.claude` 포인터는 강제 추적으로 원인에서 뺀다.
   * 이 격리가 없으면 init이 생성하는 나머지가 경고를 유발해 **누락 구현도 통과**한다(REQ-020 design-r10 함정).
   */
  const isolateOnly = (dir: string, keep: string): void => {
    const others = [...SKILLS.filter((s) => s !== keep), ...CLAUDE_POINTERS].filter((p) => existsSync(join(dir, p)))
    gitIn(dir, ['add', '-f', ...others])
    gitIn(dir, ['commit', '-q', '-m', 'track everything except the subject'])
  }

  it('create: 첫 init에서 untracked·ignored companion이 WARN 원인이다 (R1)', () => {
    const dir = ignoredClaude()
    try {
      const warn = captureWarn(() => runInit(OPTS(dir)))
      for (const s of SKILLS) expect(warn, `${s}가 경고에 등장해야 한다`).toContain(s)
      expect(existsSync(join(dir, TDD)), '비파괴 — 설치는 계속된다').toBe(true)
    } finally {
      cleanup(dir)
    }
  })

  /**
   * ⚠️ 격리가 **없는** 테스트다 — `.claude/` ignore 시 기존 계약 포인터가 먼저 strict 오류를 내므로
   *    `companionAtRisk`에서 `create`를 빼도 초록이다. R2의 "쓰기 0회"만 지키는 보조 테스트로 남기고,
   *    `create` 항의 증명은 아래 격리 fixture가 담당한다(REQ-2026-021 D7 / phase-1b).
   */
  it('create: --strict는 설치 전 throw + 쓰기 0회 (R2 — 쓰기 축만)', () => {
    const dir = ignoredClaude()
    try {
      const before = snapshot(dir)
      expect(() => runInit(OPTS(dir, { strict: true }))).toThrow()
      expect(snapshot(dir), 'preflight throw는 어떤 파일도 쓰지 않는다').toEqual(before)
    } finally {
      cleanup(dir)
    }
  })

  /**
   * 🔴 `create` **격리** — phase-1이 `ownedSkip`·`userDiffers`만 격리하고 `create`는 비대칭으로 빠뜨렸다(D7).
   *
   * 초기 설치 후 **tdd만 제거**하면 재실행 시 그 경로가 다시 `create` 상태가 되고,
   * 나머지 3종은 byte-identical(`ownedSkip`)이다. 그 3종과 `.claude` 포인터를 강제 추적해
   * at-risk 원인에서 빼면 **`create` 항 하나만** 남는다.
   */
  const createIsolated = (dir: string): void => {
    runInit(OPTS(dir)) // 4종 생성
    rmSync(join(dir, TDD)) // tdd만 제거 → 재실행 시 create 상태
    isolateOnly(dir, TDD) // 나머지 3종 + .claude 포인터 강제 추적
  }

  it('create 격리: tdd만 부재면 그 경로가 WARN 원인이다 (D7)', () => {
    const dir = ignoredClaude()
    try {
      createIsolated(dir)
      const warn = captureWarn(() => runInit(OPTS(dir)))
      expect(warn, 'create 상태의 tdd가 원인으로 등장해야 한다').toContain(TDD)
      for (const s of SKILLS.filter((x) => x !== TDD)) expect(warn, `${s}는 추적돼 원인이 아니다`).not.toContain(s)
    } finally {
      cleanup(dir)
    }
  })

  it('create 격리: --strict throw 메시지에 그 경로가 있고 쓰기 0회다 (D7)', () => {
    const dir = ignoredClaude()
    try {
      createIsolated(dir)
      const before = snapshot(dir)
      // 기존 계약 포인터는 추적됐으므로 이 throw는 **companion 때문**이어야 한다.
      expectStrictThrowMentioning(dir, TDD)
      expect(snapshot(dir), '--strict 전후 대상 snapshot 동일').toEqual(before)
    } finally {
      cleanup(dir)
    }
  })

  /** ownedSkip = 재실행에서 원본과 byte-identical. 산출물이지만 artifacts에는 ownedSkips로 들어간다. */
  it('ownedSkip 격리: byte-identical skill 하나만 남기면 그 경로가 WARN 원인이다 (R3)', () => {
    const dir = ignoredClaude()
    try {
      runInit(OPTS(dir)) // 4종 생성
      isolateOnly(dir, TDD) // tdd만 untracked·ignored로 남긴다 (내용은 원본 그대로 = ownedSkip)
      const warn = captureWarn(() => runInit(OPTS(dir)))
      expect(warn, 'ownedSkip 상태의 tdd가 원인으로 등장해야 한다').toContain(TDD)
      for (const s of SKILLS.filter((x) => x !== TDD)) expect(warn, `${s}는 추적돼 원인이 아니다`).not.toContain(s)
    } finally {
      cleanup(dir)
    }
  })

  it('ownedSkip 격리: --strict throw 메시지에 그 경로가 있고 쓰기 0회다 (R2/R3)', () => {
    const dir = ignoredClaude()
    try {
      runInit(OPTS(dir))
      isolateOnly(dir, TDD)
      const before = snapshot(dir)
      expectStrictThrowMentioning(dir, TDD)
      expect(snapshot(dir), '--strict 전후 대상 snapshot 동일').toEqual(before)
    } finally {
      cleanup(dir)
    }
  })

  /**
   * 🔴 userDiffers = 사용자가 고친 skill. **핵심 함정** — `skips`로 가서 `planArtifactPaths`에 없다.
   * artifacts만 보는 구현은 여기서 경고 없이 통과하고 `--strict`가 뚫린다.
   */
  it('userDiffers 격리: 수정한 skill 하나만 남기면 그 경로가 WARN 원인이다 (R3)', () => {
    const dir = ignoredClaude()
    try {
      runInit(OPTS(dir))
      isolateOnly(dir, TDD)
      writeFileSync(join(dir, TDD), '# 내가 고친 내용\n', 'utf8') // → userDiffers
      const warn = captureWarn(() => runInit(OPTS(dir)))
      expect(warn, 'userDiffers 상태의 tdd가 원인으로 등장해야 한다 — artifacts에 없어도').toContain(TDD)
      for (const s of SKILLS.filter((x) => x !== TDD)) expect(warn, `${s}는 추적돼 원인이 아니다`).not.toContain(s)
    } finally {
      cleanup(dir)
    }
  })

  it('userDiffers 격리: --strict throw 메시지에 그 경로가 있고 쓰기 0회다 (R2/R3)', () => {
    const dir = ignoredClaude()
    try {
      runInit(OPTS(dir))
      isolateOnly(dir, TDD)
      writeFileSync(join(dir, TDD), '# 내가 고친 내용\n', 'utf8')
      const before = snapshot(dir)
      expectStrictThrowMentioning(dir, TDD)
      expect(snapshot(dir), '--strict 전후 대상 snapshot 동일 — 사용자 수정본도 보존').toEqual(before)
    } finally {
      cleanup(dir)
    }
  })

  /** 음성 대조군 — 그 skill까지 추적하면 companion WARN이 사라진다(원인 분리 증명). */
  it('음성 대조군: 4종 전부 추적하면 companion WARN이 없다', () => {
    const dir = ignoredClaude()
    try {
      runInit(OPTS(dir))
      const all = [...SKILLS, ...CLAUDE_POINTERS].filter((p) => existsSync(join(dir, p)))
      gitIn(dir, ['add', '-f', ...all])
      gitIn(dir, ['commit', '-q', '-m', 'track all'])
      const warn = captureWarn(() => runInit(OPTS(dir)))
      for (const s of SKILLS) expect(warn, `${s}: 추적됐으므로 경고 원인이 아니다`).not.toContain(s)
    } finally {
      cleanup(dir)
    }
  })

  it('정상 경로 대조군: .claude/를 ignore하지 않으면 companion 경고가 없다', () => {
    const dir = tmpTarget()
    try {
      const warn = captureWarn(() => runInit(OPTS(dir)))
      for (const s of SKILLS) expect(warn, `${s}: ignore되지 않으므로 경고 없음`).not.toContain(s)
    } finally {
      cleanup(dir)
    }
  })

  it('--no-agent-entrypoints면 companion 미설치이므로 경고가 없다 (R5)', () => {
    const dir = ignoredClaude()
    try {
      const warn = captureWarn(() => runInit(OPTS(dir, { noAgentEntrypoints: true })))
      for (const s of SKILLS) expect(warn, `${s}: 설치되지 않으므로 경고 없음`).not.toContain(s)
    } finally {
      cleanup(dir)
    }
  })
})


// ═══════ REQ-2026-022 phase-1: 타사 skill 공존 ═══════

/**
 * 사용자가 이미 Matt Pocock의 skills를 깔아 뒀을 수 있다 — **타사 파일을 건드리면 안 된다**.
 *
 * 공존은 **경로 격리**로 성립한다: companion은 `.claude/skills/commitgate-<name>/`,
 * 타사는 `.claude/skills/<name>/` — 디렉터리가 달라 `planCompanionSkills`가 타사 경로를 보지 않는다.
 * "충돌을 해결한다"가 아니라 "충돌하지 않는다"이므로 그 성질을 고정만 한다.
 *
 * ⚠️ **Buffer 기준 byte-identical로 단언한다.** 존재 여부만 보면 내용이 덮여도 통과한다.
 */
describe('[init] 타사 skill 공존 (REQ-2026-022)', () => {
  /** 타사 skill — CommitGate가 만들지 않는 이름들. `tdd`는 `commitgate-tdd`와 가장 헷갈리는 케이스다. */
  const THIRD_PARTY: Record<string, string> = {
    '.claude/skills/tdd/SKILL.md': ['---', 'name: tdd', '---', '# Matt의 TDD', ''].join('\n'),
    '.claude/skills/grill-me/SKILL.md': ['---', 'name: grill-me', '---', 'Run a /grilling session.', ''].join('\n'),
  }
  const COMPANIONS = [
    '.claude/skills/commitgate-discovery/SKILL.md',
    '.claude/skills/commitgate-tdd/SKILL.md',
    '.claude/skills/commitgate-diagnosing-bugs/SKILL.md',
    '.claude/skills/commitgate-research/SKILL.md',
  ] as const

  const seedThirdParty = (dir: string): Map<string, Buffer> => {
    const bufs = new Map<string, Buffer>()
    for (const [rel, body] of Object.entries(THIRD_PARTY)) {
      mkdirSync(dirname(join(dir, rel)), { recursive: true })
      writeFileSync(join(dir, rel), body, 'utf8')
      bufs.set(rel, readFileSync(join(dir, rel)))
    }
    return bufs
  }

  /** Buffer 기준 비교 — 인코딩·개행 변환에 속지 않는다. */
  const expectBytesUnchanged = (dir: string, before: Map<string, Buffer>): void => {
    for (const [rel, buf] of before) {
      expect(existsSync(join(dir, rel)), `${rel}: 타사 파일이 사라지면 안 된다`).toBe(true)
      expect(readFileSync(join(dir, rel)).equals(buf), `${rel}: 타사 파일이 byte-identical이어야 한다`).toBe(true)
    }
  }

  it('공존 A(타사 선설치): 타사 skill이 byte-identical로 보존되고 companion은 별도 생성된다 (R1/R2)', () => {
    const dir = tmpTarget()
    try {
      const before = seedThirdParty(dir)
      runInit(OPTS(dir))
      expectBytesUnchanged(dir, before)
      for (const c of COMPANIONS) expect(existsSync(join(dir, c)), `${c}: 별도 생성`).toBe(true)
      // 접두사 격리: 타사 `tdd`와 `commitgate-tdd`는 다른 디렉터리다.
      expect(existsSync(join(dir, '.claude/skills/tdd/SKILL.md'))).toBe(true)
      expect(existsSync(join(dir, '.claude/skills/commitgate-tdd/SKILL.md'))).toBe(true)
    } finally {
      cleanup(dir)
    }
  })

  it('공존 B(CommitGate 선설치): 재-init 후 타사·companion 양쪽 불변 (R1/R2)', () => {
    const dir = tmpTarget()
    try {
      runInit(OPTS(dir)) // companion 먼저
      const companionBefore = new Map(COMPANIONS.map((c) => [c, readFileSync(join(dir, c))]))
      const thirdBefore = seedThirdParty(dir) // 그 뒤 타사 추가
      runInit(OPTS(dir)) // 재-init
      expectBytesUnchanged(dir, thirdBefore)
      // 재-init 전후 companion 4종도 불변이어야 한다(멱등).
      for (const [rel, buf] of companionBefore)
        expect(readFileSync(join(dir, rel)).equals(buf), `${rel}: 재-init 전후 불변`).toBe(true)
    } finally {
      cleanup(dir)
    }
  })

  it('공존 B: --force로 재-init해도 타사·companion 양쪽 불변 (seed-once)', () => {
    const dir = tmpTarget()
    try {
      runInit(OPTS(dir))
      const companionBefore = new Map(COMPANIONS.map((c) => [c, readFileSync(join(dir, c))]))
      const thirdBefore = seedThirdParty(dir)
      runInit(OPTS(dir, { force: true }))
      expectBytesUnchanged(dir, thirdBefore)
      for (const [rel, buf] of companionBefore)
        expect(readFileSync(join(dir, rel)).equals(buf), `${rel}: --force에도 불변`).toBe(true)
    } finally {
      cleanup(dir)
    }
  })
})

/**
 * REQ-2026-024 phase-1 — `add()` 경로(`KIT_COPY_RELPATHS`·`KIT_AGENT_ENTRYPOINTS`)의 confinement.
 *
 * 실측(00-requirement §2)으로 확인된 탈출을 고정한다. v0.7.0에서 `add()`는 `existsSync && !force`라
 * 4가지로 뚫렸다: dangling leaf(A) · ancestor dir symlink(B) · live leaf + `--force`(C) · writeFileSync(D).
 * 이 블록은 **A·B·C**를 다룬다(D는 phase-2의 `req.config.json`·`package.json` 몫).
 */
describe('[init] add() 경로 confinement (REQ-2026-024)', () => {
  const CURSOR_RULE = KIT_AGENT_ENTRYPOINTS.find((e) => e.dest.startsWith('.cursor/'))?.dest as string
  const KIT_FILE = KIT_COPY_RELPATHS[0] as string

  const outsideDir = (): string => mkdtempSync(join(tmpdir(), 'reqwf-outside-'))

  const trySymlink = (target: string, path: string, type: 'junction' | 'file'): boolean => {
    try {
      symlinkSync(target, path, type)
      return true
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code
      if (code === 'EPERM' || code === 'ENOSYS' || code === 'EACCES') return false // 권한 미지원 — 설치기 결함이 아니다
      throw e
    }
  }

  /** 정상 실행: throw 여부와 무관하게 **양쪽 무변화를 먼저** 검사한다(순서를 뒤집으면 외부 검사가 죽은 코드가 된다). */
  const expectRejectedWithNoWrites = (dir: string, outside: string, run: () => void): void => {
    const beforeIn = snapshot(dir)
    const beforeOut = snapshot(outside)
    let threw = false
    try {
      run()
    } catch {
      threw = true
    }
    expect(snapshot(outside), '외부 tree 무변화 — 여기서 실패하면 대상 **밖**에 썼다는 뜻이다').toEqual(beforeOut)
    expect(snapshot(dir), '대상 tree 무변화').toEqual(beforeIn)
    expect(threw, 'preflight가 쓰기 전에 거부해야 한다').toBe(true)
  }

  /**
   * 🔴 **preflight 도달을 분리 관측한다** (design-r01 P1).
   *
   * 정상 실행 단언만 쓰면 **`applyCopies`의 전량 검증(D3 백스톱)이 `add()` 결함을 가린다** —
   * `add()`를 `existsSync`로 되돌려도 백스톱이 쓰기 직전에 거부해 `expectRejectedWithNoWrites`가 계속 초록이다.
   * 그러나 그때 거부는 preflight가 아니라 apply이고, **`--dry-run`은 백스톱에 도달하지 못해 조용히 통과한다**(R5 위반).
   *
   * `applyCopies`는 `if (!opts.dryRun)` **안**에 있으므로 dry-run에는 **preflight throw만** 보인다.
   * 실측으로 이 계측이 양방향으로 작동함을 확인했다: 현행 v0.7.0에서 `.cursor` junction + dry-run은
   * throw하지 않고(→ 변이를 잡는다), 이미 방어된 companion 경로 + dry-run은 throw한다(→ 계측이 눈멀지 않았다).
   */
  const expectPreflightRejects = (dir: string, outside: string, over?: Partial<InitOptions>): void => {
    const beforeIn = snapshot(dir)
    const beforeOut = snapshot(outside)
    expect(
      () => runInit(OPTS(dir, { ...over, dryRun: true })),
      'preflight(--dry-run)에서 거부해야 한다 — 여기가 초록이 아니면 거부가 apply로 밀린 것이다(R5)',
    ).toThrow()
    expect(snapshot(outside), 'dry-run 외부 무변화').toEqual(beforeOut)
    expect(snapshot(dir), 'dry-run 대상 무변화').toEqual(beforeIn)
  }

  /**
   * 🔴 **E7 — 격리의 핵심.** `.cursor/`는 companion(`.claude/**`만)도 `workflow/.gitignore`(`workflow/`만)도
   * 검사하지 않는다 → **`add()`의 검사만이 유일한 방어선**이다.
   * `.claude/`·`workflow/` fixture는 다른 기능이 같은 조상을 **우연히** 검사해서 막히므로
   * (v0.7.0에서도 초록이었다) `add()`의 결함과 구분하지 못한다. 이 fixture만이 구분한다.
   */
  it('.cursor/ 상위가 junction이면 쓰기 0회로 거부한다 (E7, 모드 B)', () => {
    const dir = tmpTarget()
    const outside = outsideDir()
    try {
      mkdirSync(join(outside, 'cursor-dir'))
      if (!trySymlink(join(outside, 'cursor-dir'), join(dir, '.cursor'), 'junction')) return
      expectRejectedWithNoWrites(dir, outside, () => runInit(OPTS(dir)))
    } finally {
      cleanup(dir)
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it('.cursor/ junction을 preflight(--dry-run)에서 거부한다 — 백스톱이 가리지 못하게 (E7-②)', () => {
    const dir = tmpTarget()
    const outside = outsideDir()
    try {
      mkdirSync(join(outside, 'cursor-dir'))
      if (!trySymlink(join(outside, 'cursor-dir'), join(dir, '.cursor'), 'junction')) return
      expectPreflightRejects(dir, outside)
    } finally {
      cleanup(dir)
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it('.cursor/rules/*.mdc leaf가 dangling symlink면 쓰기 0회로 거부한다 (E9, 모드 A)', () => {
    const dir = tmpTarget()
    const outside = outsideDir()
    try {
      mkdirSync(join(dir, dirname(CURSOR_RULE)), { recursive: true })
      const escaped = join(outside, 'ESCAPED.mdc') // 아직 없는 파일 → dangling
      if (!trySymlink(escaped, join(dir, CURSOR_RULE), 'file')) return
      expect(existsSync(join(dir, CURSOR_RULE)), 'dangling이라 existsSync는 false다 — 이게 함정이다').toBe(false)
      expect(lstatSync(join(dir, CURSOR_RULE)).isSymbolicLink(), 'lstat은 링크를 본다').toBe(true)
      expectRejectedWithNoWrites(dir, outside, () => runInit(OPTS(dir)))
      expectPreflightRejects(dir, outside)
    } finally {
      cleanup(dir)
      rmSync(outside, { recursive: true, force: true })
    }
  })

  /**
   * 🔴 **E8 — `--force`가 대상 밖 사용자 파일을 덮어쓴다**(v0.7.0 실측). 가장 무거운 탈출이다:
   * 생성이 아니라 **기존 파일 파괴**다. `existsSync`=true인데도 뚫리므로 dangling(A)만 막으면 남는다.
   *
   * 격리: `workflow/` 상위는 **실제 디렉터리**라 `workflow/.gitignore`의 confinement가 통과한다
   * → leaf 검사만이 방어선이다.
   */
  it('--force가 kit 파일 leaf symlink를 따라 대상 밖을 덮어쓰지 않는다 (E8, 모드 C)', () => {
    const dir = tmpTarget()
    const outside = outsideDir()
    try {
      const real = join(outside, 'user-owned.md')
      writeFileSync(real, '사용자 소유 — 덮이면 안 된다\n')
      mkdirSync(dirname(join(dir, KIT_FILE)), { recursive: true })
      if (!trySymlink(real, join(dir, KIT_FILE), 'file')) return
      expect(existsSync(join(dir, KIT_FILE)), 'live symlink라 existsSync는 true다 — force가 덮으려 든다').toBe(true)
      expectRejectedWithNoWrites(dir, outside, () => runInit(OPTS(dir, { force: true })))
      expectPreflightRejects(dir, outside, { force: true })
    } finally {
      cleanup(dir)
      rmSync(outside, { recursive: true, force: true })
    }
  })

  /**
   * 🔴 **백스톱(D3)은 `applyCopies`를 직접 호출해야만 검증된다.**
   *
   * `runInit` 경유로는 preflight(`add()`)가 **먼저** 터지므로 백스톱을 제거하는 변이가 **그대로 통과한다**
   * — 그 테스트는 공허하다. `plan.copies`는 `add()`만 채우지 않는다(`planCompanionSkills` 결과가 직접
   * 편입된다) → **preflight를 우회하는 경로가 이미 존재한다**. 여기서 그 불변식을 고정한다.
   */
  it('applyCopies가 검사를 안 거친 symlink dest를 쓰기 전에 거부한다 (D3 백스톱)', () => {
    const dir = tmpTarget()
    const outside = outsideDir()
    try {
      const escaped = join(outside, 'ESCAPED-BACKSTOP.md')
      mkdirSync(dirname(join(dir, KIT_FILE)), { recursive: true })
      if (!trySymlink(escaped, join(dir, KIT_FILE), 'file')) return
      const beforeOut = snapshot(outside)
      // add()를 우회해 손으로 만든 plan — 미래에 plan.copies에 직접 push하는 코드를 흉내낸다.
      const plan = {
        copies: [{ srcAbs: join(PACKAGE_ROOT_FOR_TEST, KIT_FILE), destRel: KIT_FILE }],
        skips: [],
        ownedSkips: [],
        configRel: null,
        packageJsonRel: null,
        lockfileRel: null,
        agentsRel: null,
        claudeMdRel: null,
        contractCopyRel: null,
        gitignoreRel: null,
        workflowGitignoreRel: null,
      }
      expect(() => applyCopies(dir, plan), '백스톱이 쓰기 전에 거부해야 한다').toThrow()
      expect(snapshot(outside), '외부 tree 무변화 — 실패하면 백스톱을 통과해 대상 밖에 썼다는 뜻이다').toEqual(beforeOut)
    } finally {
      cleanup(dir)
      rmSync(outside, { recursive: true, force: true })
    }
  })

  /**
   * `applyCopies`의 검증은 **쓰기 전 전량**이어야 한다 — 한 루프에서 섞으면 중간 throw 시 앞 파일이
   * 이미 복사돼 **부분 설치**가 된다(롤백 0줄). 정상 dest를 symlink dest **앞에** 두고, 그 정상 dest가
   * 만들어지지 않았음을 단언한다.
   */
  it('applyCopies가 거부할 때 앞선 정상 dest도 쓰지 않는다 — 부분 설치 없음 (D3 두 루프)', () => {
    const dir = tmpTarget()
    const outside = outsideDir()
    try {
      const good = KIT_COPY_RELPATHS[1] as string
      mkdirSync(dirname(join(dir, KIT_FILE)), { recursive: true })
      if (!trySymlink(join(outside, 'ESCAPED-ORDER.md'), join(dir, KIT_FILE), 'file')) return
      const plan = {
        copies: [
          { srcAbs: join(PACKAGE_ROOT_FOR_TEST, good), destRel: good }, // 정상 — symlink dest보다 앞
          { srcAbs: join(PACKAGE_ROOT_FOR_TEST, KIT_FILE), destRel: KIT_FILE }, // symlink
        ],
        skips: [],
        ownedSkips: [],
        configRel: null,
        packageJsonRel: null,
        lockfileRel: null,
        agentsRel: null,
        claudeMdRel: null,
        contractCopyRel: null,
        gitignoreRel: null,
        workflowGitignoreRel: null,
      }
      expect(() => applyCopies(dir, plan)).toThrow()
      expect(
        existsSync(join(dir, good)),
        '앞선 정상 dest가 만들어졌다 = 검사·쓰기를 한 루프에 섞었다(부분 설치)',
      ).toBe(false)
    } finally {
      cleanup(dir)
      rmSync(outside, { recursive: true, force: true })
    }
  })

  /** 정상 경로 대조군 — symlink가 없으면 헬퍼는 `existsSync`와 같은 답을 준다(위양성 방지). */
  it('symlink가 없으면 kit 파일·진입점 설치가 그대로 동작한다 (R8)', () => {
    const dir = tmpTarget()
    try {
      runInit(OPTS(dir))
      for (const rel of KIT_COPY_RELPATHS) expect(existsSync(join(dir, rel)), rel).toBe(true)
      for (const e of KIT_AGENT_ENTRYPOINTS) expect(existsSync(join(dir, e.dest)), e.dest).toBe(true)
    } finally {
      cleanup(dir)
    }
  })
})

/**
 * REQ-2026-024 phase-2 — 개별 쓰기 경로(`add()`를 타지 않는 5종)의 confinement.
 *
 * `AGENTS.md`·`CLAUDE.md`·`AGENTS.commitgate.md`·`req.config.json`·`package.json`은 seed-once 판정을
 * 각자 `existsSync`로 하고 apply 블록에서 직접 `copyFileSync`/`writeFileSync`했다 → `add()`를 고쳐도
 * 그대로 뚫려 있었다(실측 E1~E6).
 *
 * 🔴 이 5종은 **모드 D**의 유일한 실증 지점이다: `existsSync`=true인 live symlink에서 `writeFileSync`가
 *    링크를 따라 **대상 밖 기존 파일을 수정**한다. dangling(A)만 테스트하면 그 축이 뚫린 채 초록이 된다.
 *
 * ⚠️ `applyCopies` 백스톱(phase-1 D3)은 이 경로들을 **가리지 않는다** — `plan.copies`를 타지 않기 때문이다.
 *    그래서 여기선 정상 실행 단언만으로 변이를 잡을 수 있다(phase-1의 dry-run 이중 단언이 불필요).
 */
describe('[init] 개별 쓰기 경로 confinement (REQ-2026-024 phase-2)', () => {
  const outsideDir = (): string => mkdtempSync(join(tmpdir(), 'reqwf-outside-'))
  /** 계약 마커가 **없는** AGENTS.md — `agentsMarkerMissing`를 참으로 만들어 contract copy 분기를 발동시킨다. */
  const AGENTS_NO_MARKER = '# AGENTS\n사용자가 직접 쓴 파일. 계약 마커 없음.\n'

  const trySymlink = (target: string, path: string, type: 'junction' | 'file'): boolean => {
    try {
      symlinkSync(target, path, type)
      return true
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code
      if (code === 'EPERM' || code === 'ENOSYS' || code === 'EACCES') return false
      throw e
    }
  }

  const expectRejectedWithNoWrites = (dir: string, outside: string, run: () => void): void => {
    const beforeIn = snapshot(dir)
    const beforeOut = snapshot(outside)
    let threw = false
    try {
      run()
    } catch {
      threw = true
    }
    expect(snapshot(outside), '외부 tree 무변화 — 여기서 실패하면 대상 **밖**에 썼다는 뜻이다').toEqual(beforeOut)
    expect(snapshot(dir), '대상 tree 무변화').toEqual(beforeIn)
    expect(threw, 'preflight가 쓰기 전에 거부해야 한다').toBe(true)
  }

  /** 모드 A — dangling leaf. `existsSync`가 false라 seed-once가 부재로 오판하고 링크를 따라 대상 밖에 만든다. */
  const danglingCase = (label: string, destRel: string, seed?: (dir: string) => void): void => {
    it(`${destRel} leaf가 dangling symlink면 쓰기 0회로 거부한다 (${label}, 모드 A)`, () => {
      const dir = tmpTarget()
      const outside = outsideDir()
      try {
        seed?.(dir)
        const escaped = join(outside, `ESCAPED-${destRel.replace(/[./]/g, '_')}`) // 아직 없는 파일 → dangling
        if (!trySymlink(escaped, join(dir, destRel), 'file')) return
        expect(existsSync(join(dir, destRel)), 'dangling이라 existsSync는 false다 — 이게 함정이다').toBe(false)
        expect(lstatSync(join(dir, destRel)).isSymbolicLink(), 'lstat은 링크를 본다').toBe(true)
        expectRejectedWithNoWrites(dir, outside, () => runInit(OPTS(dir)))
      } finally {
        cleanup(dir)
        rmSync(outside, { recursive: true, force: true })
      }
    })
  }

  danglingCase('E1', 'AGENTS.md')
  danglingCase('E2', KIT_CLAUDE_DEST_REL, (dir) => writeFileSync(join(dir, 'AGENTS.md'), AGENTS_NO_MARKER))
  // E3: contract copy는 `agentsMarkerMissing`일 때만 쓰인다 — 마커 없는 실제 AGENTS.md가 전제다.
  //     이 전제가 틀리면 코드가 그 분기에 **도달조차 안 해** 테스트가 공허하게 초록이 된다.
  danglingCase('E3', KIT_AGENTS_CONTRACT_COPY_REL, (dir) => writeFileSync(join(dir, 'AGENTS.md'), AGENTS_NO_MARKER))
  danglingCase('E4', 'req.config.json')

  /**
   * 🔴 모드 D — live symlink. `existsSync`=true라 "기존 파일"로 읽고 병합한 뒤 `writeFileSync`가
   * 링크를 따라 **대상 밖 파일을 수정**한다. A(생성)와 달리 **기존 데이터 파괴**다.
   */
  it('req.config.json이 외부 실파일을 가리키는 symlink면 그 파일을 수정하지 않는다 (E5, 모드 D)', () => {
    const dir = tmpTarget()
    const outside = outsideDir()
    try {
      const real = join(outside, 'real-config.json')
      writeFileSync(real, '{}\n')
      if (!trySymlink(real, join(dir, 'req.config.json'), 'file')) return
      expect(existsSync(join(dir, 'req.config.json')), 'live symlink라 existsSync는 true다').toBe(true)
      expectRejectedWithNoWrites(dir, outside, () => runInit(OPTS(dir)))
      expect(readFileSync(real, 'utf8'), '외부 config 바이트 불변').toBe('{}\n')
    } finally {
      cleanup(dir)
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it('package.json이 외부 실파일을 가리키는 symlink면 그 파일을 수정하지 않는다 (E6, 모드 D)', () => {
    const dir = tmpTarget()
    const outside = outsideDir()
    try {
      const real = join(outside, 'real-package.json')
      const original = JSON.stringify({ name: 'outside', devDependencies: { commitgate: '^0.7.0' } }, null, 2)
      writeFileSync(real, original)
      rmSync(join(dir, 'package.json'))
      if (!trySymlink(real, join(dir, 'package.json'), 'file')) return
      expectRejectedWithNoWrites(dir, outside, () => runInit(OPTS(dir)))
      expect(readFileSync(real, 'utf8'), '외부 package.json 바이트 불변 — req:* 주입이 새어나가면 안 된다').toBe(original)
    } finally {
      cleanup(dir)
      rmSync(outside, { recursive: true, force: true })
    }
  })

  /** 부재 메시지 회귀 — `statWritableDest`가 null을 주므로 기존 분기·문구가 그대로여야 한다(R8). */
  it('package.json이 없으면 기존 에러 메시지를 그대로 낸다 (R8)', () => {
    const dir = tmpTarget({ withPkg: false })
    try {
      expect(() => runInit(OPTS(dir))).toThrow(/package\.json 없음/)
    } finally {
      cleanup(dir)
    }
  })

  /** dry-run 대조군(K1) — 검사는 전부 preflight라 dry-run도 같은 판정을 받고, 쓰기는 여전히 0건이다(R5). */
  it('--dry-run도 같은 판정을 받고 외부·대상 둘 다 불변이다 (K1/R5)', () => {
    const dir = tmpTarget()
    const outside = outsideDir()
    try {
      if (!trySymlink(join(outside, 'ESCAPED-DRY.md'), join(dir, 'AGENTS.md'), 'file')) return
      expectRejectedWithNoWrites(dir, outside, () => runInit(OPTS(dir, { dryRun: true })))
    } finally {
      cleanup(dir)
      rmSync(outside, { recursive: true, force: true })
    }
  })

  /** 정상 경로 대조군 — symlink가 없으면 5종이 그대로 만들어진다(위양성 방지). */
  it('symlink가 없으면 개별 자산이 그대로 생성된다 (R8)', () => {
    const dir = tmpTarget()
    try {
      runInit(OPTS(dir))
      for (const rel of ['AGENTS.md', KIT_CLAUDE_DEST_REL, 'req.config.json'])
        expect(existsSync(join(dir, rel)), rel).toBe(true)
    } finally {
      cleanup(dir)
    }
  })
})

describe('[init] confinement 헬퍼 export (REQ-2026-038 phase-1)', () => {
  // sync(bin/sync.ts)가 confinement를 재구현하지 않고 재사용하도록 export됨(REQ-2026-024 결함 재발 방지). 동작 불변 smoke.
  const mk = () => mkdtempSync(join(tmpdir(), 'cg-export-'))

  it('세 헬퍼 + PACKAGE_ROOT가 export되어 있다', () => {
    expect(typeof statWritableDest).toBe('function')
    expect(typeof assertConfinedDest).toBe('function')
    expect(typeof sha256File).toBe('function')
    expect(typeof PACKAGE_ROOT).toBe('string')
  })

  it('sha256File — 파일 바이트의 sha256과 일치(동작 불변)', () => {
    const dir = mk()
    try {
      const f = join(dir, 'x.txt')
      writeFileSync(f, 'hello commitgate')
      const want = createHash('sha256').update(readFileSync(f)).digest('hex')
      expect(sha256File(f)).toBe(want)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('statWritableDest — 부재 leaf=null · 일반 파일=Stats · 디렉터리 leaf=throw', () => {
    const dir = mk()
    try {
      expect(statWritableDest(dir, 'absent.json')).toBeNull()
      writeFileSync(join(dir, 'f.json'), '{}')
      expect(statWritableDest(dir, 'f.json')?.isFile()).toBe(true)
      mkdirSync(join(dir, 'sub'))
      expect(() => statWritableDest(dir, 'sub')).toThrow()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('assertConfinedDest — 정상 중첩 통과 · symlink 상위 거부(confinement)', () => {
    const dir = mk()
    try {
      expect(() => assertConfinedDest(dir, 'a/b/c.json')).not.toThrow()
      try {
        symlinkSync(tmpdir(), join(dir, 'linkdir'), 'dir')
      } catch {
        return // symlink 권한 없는 환경(Windows) — 이 assert만 skip
      }
      expect(() => assertConfinedDest(dir, 'linkdir/x.json')).toThrow()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('[init] 세 축 정합 — KIT 자산 ⊆ package.json files[] (REQ-2026-038 R9)', () => {
  // 복사 축(KIT_COPY/KIT_SCHEMA)에 있는데 tarball 축(files[])에 없으면, 설치는 시도하나 패키지에 실리지 않아
  // 신규 설치본에서 파일이 없다(REQ-2026-010 P1 재발 방지). init.ts:56-65가 이 혼동을 경고한다.
  const files = (JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')) as { files: string[] }).files
  const norm = (p: string) => p.replace(/\\/g, '/')
  const covered = (rel: string) => files.some((f) => norm(f) === norm(rel))

  for (const rel of KIT_COPY_RELPATHS) {
    it(`${rel} 가 files[]에 실린다(설치=배포 정합)`, () => {
      expect(covered(rel), `${rel} 이 package.json files[]에 없음`).toBe(true)
    })
  }
})
