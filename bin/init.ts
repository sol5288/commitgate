#!/usr/bin/env tsx
/**
 * commitgate init — AI REQ workflow(커밋 게이트) kit을 대상 git repo에 설치(**Stage B: 런타임 패키지 모델**, REQ-2026-014).
 *
 * Stage B의 핵심: **실행 코드와 런타임 의존성은 대상에 복사·주입하지 않는다.** 그것들은 설치된 패키지
 * (`node_modules/commitgate`)에만 있고, 대상에는 `req:* = commitgate <verb>` 스크립트와 **거버넌스·감사 데이터**만 남는다.
 * (Stage A = 과거의 vendored 스캐폴딩 모델. `REQ_SCRIPTS`가 그 서명 기록이고 `commitgate migrate`가 전환을 담당한다.)
 *
 * 동작(멱등·비파괴):
 *   1. 대상 repo 감사(git repo·package.json 필수 → 없으면 fail-closed throw)
 *   2. **Stage B 전제(순서가 계약)**: `detectStageA`(D19 — Stage A 설치본이면 migrate로 보냄) →
 *      `commitgateDeclared`(D14 — `devDependencies.commitgate` 키 없으면 선행 설치 안내). 둘 다 preflight = 무쓰기 실패.
 *   3. `KIT_COPY_RELPATHS`(스키마 2종 + review-persona.md) 복사(기존 파일은 --force 없으면 스킵).
 *      **`scripts/req/**` 는 복사하지 않는다**(R3 — 패키지에서 실행).
 *   4. `req.config.json` 시드(부재 시): 감지한 packageManager + handoffPath:null(프로젝트별 값은 코어 DEFAULTS가 아니라 config에서 흡수)
 *   5. 대상 `package.json`에 `req:* = commitgate <verb>` 주입(기존 키 미덮어씀). **devDeps는 주입하지 않는다**(R3).
 *   6. `AGENTS.md` 부재 시 템플릿 생성(있으면 스킵 — Codex 계약 보존)
 *   7. 에이전트 진입점(.claude/skills·.claude/commands·.cursor/rules) 복사 + `CLAUDE.md` 부재 시 생성 (--no-agent-entrypoints로 생략)
 *
 * 코어 승인 바인딩·staged tree 검증은 건드리지 않는다. 프로젝트 차이는 req.config.json에서만 흡수.
 */
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  statSync,
  lstatSync,
  copyFileSync,
  realpathSync,
} from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { resolve, join, dirname, relative, isAbsolute } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { loadConfig, stripBom, DEFAULT_REVIEW_PERSONA_RELPATH, type PackageManager } from '../scripts/req/lib/config'
import { createGitAdapter, type GitRunner } from '../scripts/req/lib/adapters'
import { parseStatusZ, entryPaths, STATUS_Z_ARGS, type StatusEntry } from '../scripts/req/lib/porcelain'
import * as semver from 'semver'

/** 이 패키지 루트(bin/ 기준 1단계 위). 복사 원본. */
export const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** kit 소스 디렉터리(패키지-상대 = 대상-상대). copyInto가 이 레이아웃을 그대로 재현. */
export const KIT_SOURCE_DIR_REL = 'scripts/req'

/**
 * init이 **실제로 복사하는** 스키마 경로(패키지-상대 = 대상-상대). ⚠️ `req.config.json`의 `ticketRoot`/`schemaPath`와 무관하게
 * 언제나 리터럴 `workflow/` 아래다 — `copyInto`가 `relative(PACKAGE_ROOT, src)`로 상대경로를 재현하기 때문.
 * runInit(복사)과 uninstall planner(제거 후보)가 이 상수를 **공유**해야 드리프트가 없다(REQ-2026-007 design R1 P2 / D3b).
 */
export const KIT_SCHEMA_RELPATHS = ['workflow/machine.schema.json', 'workflow/req.config.schema.json'] as const

/**
 * init이 `scripts/req/**` 외에 **실제로 복사하는** 파일 목록(패키지-상대 = 대상-상대). 복사기와 uninstall planner의 SSOT.
 *
 * ⚠️ `KIT_SCHEMA_RELPATHS`와 **의미가 다르다** — 그 상수는 "설정된 `schemaPath`가 init이 깐 스키마인가"를
 * 판정하는 **스키마 축**이고(`bin/uninstall.ts`), 이 상수는 **복사 축**이다. 여기 persona를 넣되 저기엔 넣지 않는다.
 *
 * ⚠️ `package.json`의 `files[]`는 또 다른 축(npm tarball)이다. **셋을 혼동하면**
 * tarball엔 실렸는데 대상 repo엔 안 깔리는 파일이 생기고, phase-1b의 persona fail-closed와 만나
 * 신규 설치본의 모든 리뷰가 멈춘다(REQ-2026-010 design R1 P1).
 */
export const KIT_COPY_RELPATHS = [...KIT_SCHEMA_RELPATHS, DEFAULT_REVIEW_PERSONA_RELPATH] as const

/**
 * 에이전트 진입점 (REQ-2026-010 D7·D8). init 복사기와 uninstall planner가 공유하는 SSOT.
 *
 * ⚠️ `KIT_COPY_RELPATHS`와 달리 **`src !== dest`**다. `copyInto`는 `relative(PACKAGE_ROOT, src)`로 레이아웃을
 * 재현하므로 쓸 수 없고, `uninstall`의 `tool` 분류도 `join(PACKAGE_ROOT, rel)`로 원본을 찾을 수 없다.
 * 두 곳 모두 `src`/`dest`를 분리해 다뤄야 한다.
 *
 * 본문 SSOT는 `AGENTS.md`다. 여기 깔리는 파일은 **얇은 포인터**이며 계약 본문을 복제하지 않는다 — 복제하면 drift 부채가 된다.
 */
export const KIT_AGENT_ENTRYPOINTS = [
  { src: 'templates/claude-skill.md', dest: '.claude/skills/commitgate/SKILL.md' },
  { src: 'templates/claude-command.md', dest: '.claude/commands/req.md' },
  { src: 'templates/cursor-rule.mdc', dest: '.cursor/rules/commitgate.mdc' },
] as const

/** `CLAUDE.md`는 `AGENTS.md`와 같은 취급 — **부재 시에만** 생성하고, uninstall에서 `ambiguous`(자동 제거 금지). */
export const KIT_CLAUDE_TEMPLATE_REL = 'templates/CLAUDE.template.md'
export const KIT_CLAUDE_DEST_REL = 'CLAUDE.md'

/**
 * `workflow/.gitignore` — 티켓 내부 scratch(codex-response.json 등)를 무시하는 **중첩 .gitignore** (REQ-2026-012).
 *
 * ⚠️ 세 가지가 이 파일을 특별하게 만든다:
 *   1. **`src ≠ dest`**(`KIT_AGENT_ENTRYPOINTS`처럼). npm이 tarball에서 `.gitignore` 이름을 제외하므로
 *      패키지엔 `templates/workflow.gitignore`(비-점 이름)로 두고 `workflow/.gitignore`로 복사한다(설계 D5·D11).
 *   2. `.gitignore`는 git 관례상 **사용자 소유**다 → `AGENTS.md`/`CLAUDE.md`와 동일: **부재 시에만** 생성,
 *      `--force`로도 덮지 않는다(설계 D12). `add()`(=`KIT_COPY_RELPATHS`)를 타지 않는다 — 거긴 `--force`가 덮는다.
 *   3. **`--no-agent-entrypoints`와 무관**(설계 D13). 그 옵션은 `.claude/`·`.cursor/`·`CLAUDE.md`만 생략한다.
 */
export const KIT_GITIGNORE = { src: 'templates/workflow.gitignore', dest: 'workflow/.gitignore' } as const

/**
 * companion skills (REQ-2026-020). Builder용 방법론 instruction asset — 실행 코드가 아니다.
 *
 * ⚠️ `CONTRACT_POINTER_RELPATHS`에 **섞지 않는다**(설계 D6). 그 상수는 "계약 포인터"라는 의미를 갖고,
 *    companion skills는 **없어도 핵심 워크플로가 동일하게 동작**한다(R10). 의미가 다르므로 별도 목록이다.
 *    gitignore WARN/`--strict` 동작은 같은 축에서 받되, 기존 계약 포인터 경고를 약화시키지 않는다.
 *
 * ⚠️ `add()`를 타지 않는다(설계 D3). `add()`의 skip은 `existsSync && !force`라 **`--force`가 사용자 수정을 덮는다**.
 *    스킬은 사용자가 고치라고 만든 자산이므로 `workflow/.gitignore`(D12)와 같은 seed-once 축으로 간다.
 */
export const KIT_COMPANION_SKILLS = [
  { src: 'skills/commitgate-discovery/SKILL.md', dest: '.claude/skills/commitgate-discovery/SKILL.md' },
  { src: 'skills/commitgate-tdd/SKILL.md', dest: '.claude/skills/commitgate-tdd/SKILL.md' },
  { src: 'skills/commitgate-diagnosing-bugs/SKILL.md', dest: '.claude/skills/commitgate-diagnosing-bugs/SKILL.md' },
  { src: 'skills/commitgate-research/SKILL.md', dest: '.claude/skills/commitgate-research/SKILL.md' },
] as const

/** `AGENTS.md`가 CommitGate 계약인지 판별하는 마커. 진입점 포인터들이 이 마커로 SSOT를 확인한다. */
export const AGENTS_CONTRACT_MARKER = '<!-- commitgate:contract -->'

/**
 * 기존 `AGENTS.md`에 계약 마커가 없을 때 **대상 repo에 함께 놓는** 계약 템플릿 사본 (phase-3a R1 P2).
 *
 * ⚠️ 이게 없으면 포인터의 복구 지시가 **막다른 길**이 된다. 진입점 파일들은 "마커가 없으면 계약 템플릿을
 * 참조해 병합하라"고 하는데, `AGENTS.template.md`는 **패키지 안에만** 있고 대상 repo에는 복사되지 않는다.
 * `npx commitgate`는 전역/로컬 설치가 아니라 npm 캐시에서 한 번 실행될 뿐이라 `node_modules/commitgate/`도
 * 남지 않는다. 사용자는 참조할 파일을 찾을 수 없다.
 *
 * 그래서 마커가 없을 때만 이 경로로 사본을 놓는다. 마커가 있으면(정상) 이 파일은 만들지 않는다.
 */
export const KIT_AGENTS_CONTRACT_COPY_REL = 'AGENTS.commitgate.md'

/**
 * pm별 lockfile 이름. `detectPackageManager`(아래)와 **같은 축**이다.
 *
 * ⚠️ lockfile을 stage 목록에서 빠뜨리면 설치분을 커밋한 뒤에도 `M pnpm-lock.yaml`이 남아
 * `req:new --run`이 clean-tree 게이트에서 죽는다(REQ-2026-011 design R3 P2).
 *
 * ⚠️ Stage B(REQ-2026-014)에서 근거가 바뀌었다: init은 더 이상 devDeps를 주입하지 않는다. 대신 **선행 `npm i -D commitgate`**
 * 가 `package.json`+lockfile을 이미 바꿔 놓는다(D14가 그 선언을 요구한다). 즉 lockfile은 여전히 설치 커밋에 담겨야 한다 —
 * 갱신 주체가 "init 뒤의 install"에서 "init 앞의 install"로 옮겨졌을 뿐이다.
 */
export const LOCKFILE: Record<PackageManager, string> = {
  npm: 'package-lock.json',
  pnpm: 'pnpm-lock.yaml',
  yarn: 'yarn.lock',
}

/**
 * **계약 포인터** — 이것들이 git에 추적되지 않으면 설치 목적(팀·CI가 계약을 로드)이 조용히 무너진다.
 * 그래서 gitignore에 걸리면 WARN하고 `--strict`에서 중단한다.
 *
 * lockfile 같은 나머지 산출물은 무시되더라도 정당한 repo 정책일 수 있으므로 경고하지 않고
 * stage 목록에서 조용히 뺀다(REQ-2026-011 DEC-011-10).
 */
export const CONTRACT_POINTER_RELPATHS: readonly string[] = [
  ...KIT_AGENT_ENTRYPOINTS.map((e) => e.dest),
  'AGENTS.md',
  KIT_CLAUDE_DEST_REL,
  KIT_AGENTS_CONTRACT_COPY_REL,
]

/**
 * **Stage A**(vendored scaffold)가 주입하던 req:* 스크립트 값 — 이제 **주입하지 않는다**(REQ-2026-014 R3).
 *
 * 이 상수는 **Stage A 서명 SSOT**로 남는다. 세 소비자가 정확한 바이트 일치를 판정한다:
 *  - `detectStageA`(아래 D19) — plain init이 Stage A 프로젝트를 조용히 혼합 설치로 만들지 않게 막는다.
 *  - `bin/uninstall.ts`(`REQ_SCRIPTS` 순회, `cur === injected`) — 기존 Stage A 설치본 분류.
 *  - `bin/migrate.ts`(Phase 3) — **정확히 이 값일 때만** `commitgate <verb>`로 전환(사용자 정의 값 미덮어씀).
 *
 * ⚠️ 값을 바꾸면 기존 Stage A 설치본을 더 이상 인식하지 못한다. 이것은 "우리가 무엇을 주입하는가"가 아니라
 * **"과거에 무엇을 주입했는가"** 의 기록이다.
 */
export const REQ_SCRIPTS: Record<string, string> = {
  'req:new': 'tsx scripts/req/req-new.ts',
  'req:review-codex': 'tsx scripts/req/review-codex.ts',
  'req:doctor': 'tsx scripts/req/req-doctor.ts',
  'req:next': 'tsx scripts/req/req-next.ts',
  'req:commit': 'tsx scripts/req/req-commit.ts',
}

/**
 * **Stage B**가 주입하는 req:* 스크립트 값 — 로컬 패키지 bin을 dispatch한다(REQ-2026-014 R1/R2).
 * 키 집합은 `REQ_SCRIPTS`에서 파생해 SSOT를 하나로 유지한다(값만 다르고 키는 같다).
 *
 * `npm run req:new -- <args>` → `commitgate req:new <args>` → `node_modules/.bin/commitgate`
 * → `bin/commitgate.mjs`가 verb를 `scripts/req/req-new.ts`(**패키지 안**)로 dispatch.
 */
export const STAGE_B_REQ_SCRIPTS: Record<string, string> = Object.fromEntries(
  Object.keys(REQ_SCRIPTS).map((k) => [k, `commitgate ${k}`]),
)

/**
 * **Stage A 서명 감지(D19 — REQ-2026-014 R7)**. 감지된 근거를 반환(없으면 `null`).
 *
 * 왜 필요한가: 스크립트 주입은 `if (!(k in scripts))`라 **기존 값을 덮지 않는다**. 따라서 Stage A 프로젝트에
 * plain init을 돌리면 `req:*`가 vendored `tsx scripts/req/*.ts`인 채로 남아 **런타임은 계속 vendored인데
 * 사용자는 Stage B라 믿는 조용한 혼합 설치**가 된다. 그래서 fail-closed로 막고 `migrate`로 보낸다.
 *
 * 🔴 **호출 순서가 계약이다: 이 검사는 `commitgateDeclared`(D14)보다 반드시 먼저 돌아야 한다.**
 * Stage A 설치본에는 `devDependencies.commitgate`가 **없다** — Stage A는 `npx commitgate`로 설치되고
 * `REQ_DEV_DEPS`는 `ajv`·`cross-spawn`·`tsx`만 주입하지 `commitgate` 자신을 넣지 않는다. 순서를 뒤집으면
 * Stage A 사용자는 **항상 D14에서 먼저 죽어** "npm install -D commitgate"라는 엉뚱한 안내를 받고
 * `commitgate migrate` 안내에 **영원히 도달하지 못한다**(design r20 P1). 회귀 테스트가 이 순서를 고정한다.
 */
export function detectStageA(targetRoot: string, scripts: Record<string, string>): string | null {
  for (const [k, injected] of Object.entries(REQ_SCRIPTS)) if (scripts[k] === injected) return `package.json#scripts.${k}`
  if (existsSync(join(targetRoot, KIT_SOURCE_DIR_REL))) return `${KIT_SOURCE_DIR_REL}/`
  return null
}

/**
 * **선행 설치 확인(D14, 축소 — REQ-2026-014 R6)**. `devDependencies.commitgate` **키 존재만** 본다.
 *
 * 🔴 **값의 형태를 검증하지 않는다.** `npm install -D <packed tarball>`은 `"commitgate": "file:../x.tgz"`를 쓴다 —
 * semver range가 아니다. `link:`·`workspace:`·git URL도 정당한 설치 형태다. 값을 range로 검증하면
 * packed-tarball smoke가 **스스로 실패**한다.
 *
 * 범위 밖(REQ-2026-014 §4 비목표): `node_modules/commitgate` 존재 확인·실행 패키지 realpath 동일성·
 * lockfile 해결 버전 대조. 설치 **완료** 보장은 package manager의 책임이고, 여기 계약은 "설치 의도가 선언됐는가"다.
 */
export function commitgateDeclared(devDeps: Record<string, string>): boolean {
  return Object.prototype.hasOwnProperty.call(devDeps, 'commitgate')
}

/** cross-spawn 주입 spec(= 보안 하한 SSOT). 진단(#1)과 주입이 이 값을 공유. */
const CROSS_SPAWN_SPEC = '^7.0.6'

/** 대상 package.json에 주입할 devDeps(워크플로 실행 전제). cross-spawn = 복사된 adapters.ts의 안전 spawn(P1) 런타임 의존. */
export const REQ_DEV_DEPS: Record<string, string> = {
  ajv: '^8.20.0',
  'cross-spawn': CROSS_SPAWN_SPEC,
  tsx: '^4.19.1',
}

export interface InitOptions {
  dir: string
  force: boolean
  dryRun: boolean
  strict: boolean // cross-spawn 하한 미만이면 WARN 대신 throw(#1)
  /** `.claude/`·`.cursor/`·`CLAUDE.md`를 건너뛴다. 다른 도구가 그 디렉터리를 쓰는 repo를 위한 opt-out(D7). */
  noAgentEntrypoints?: boolean
}

/**
 * 설치 **전** 워킹트리 상태 3분류(DEC-011-11). 쓰기 전에 찍어야 CommitGate 산출물과 섞이지 않는다.
 *
 * - `staged`: 인덱스 ≠ HEAD. `git commit`은 인덱스 **전체**를 담으므로, 안내가 `git add`를 아무리
 *   명시해도 이 변경들이 설치 커밋에 함께 들어간다.
 * - `overlapping`: 설치 산출물과 겹치는 **tracked·unstaged** 변경. init이 같은 파일을 수정하므로
 *   사용자 변경과 설치 변경을 사후 분리할 수 없다(예: 이미 고쳐 둔 `package.json`).
 * - `unrelated`: 나머지 dirty. 인덱스에 없으므로 설치 커밋에 섞이지 않는다 — 커밋 뒤 `git stash -u`로 치우면 된다.
 *
 * untracked 산출물(`?? package.json` 등)은 어디에도 담지 않는다. 파일 전체가 신규라 분리할 것이 없다.
 */
export interface PreexistingDirty {
  staged: string[]
  overlapping: string[]
  unrelated: string[]
}

export interface InitResult {
  targetRoot: string
  copied: string[] // repo-상대 경로(신규 복사)
  skipped: string[] // repo-상대 경로(이미 존재 → 미덮어씀)
  /** init이 만들거나 수정하는 repo-상대 경로 전수. ignore 검사와 설치 후 stage 목록이 **공유**하는 SSOT. */
  artifacts: string[]
  /** `artifacts` 중 gitignore에 걸리고 **untracked**인 것(= `git add`가 fatal인 것). */
  gitIgnoredArtifacts: string[]
  /** devDeps를 주입해 `<pm> install`이 갱신할 lockfile 경로. 주입이 없으면 null. */
  lockfileRel: string | null
  /** `node_modules`가 ignore도 track도 되지 않아 `<pm> install` 후 워킹트리를 dirty하게 만드는가. */
  nodeModulesWillDirty: boolean
  /** 설치 **전** 워킹트리 상태(쓰기 전 스냅샷). */
  preexistingDirty: PreexistingDirty
  configAction: 'created' | 'merged' | 'unchanged' // req.config.json: 신규 생성 / 누락키 병합 / 변경 없음
  configKeysAdded: string[] // 병합 시 추가된 키(handoffPath·packageManager)
  packageJsonAdded: string[] // 추가된 script/devDep 키
  agentsCreated: boolean
  packageManager: PackageManager
  crossSpawnFloorWarned: boolean // 기존 cross-spawn이 보안 하한 미만이라 경고(#1)
  dryRun: boolean
  claudeMdCreated: boolean // CLAUDE.md를 새로 만들었는가(있으면 미덮어씀)
  agentsMarkerMissing: boolean // 기존 AGENTS.md에 commitgate 계약 마커가 없어 경고했는가
  agentsContractCopyCreated: boolean // 마커 부재 시 AGENTS.commitgate.md(계약 템플릿 사본)를 놓았는가
  agentEntrypointsSkipped: boolean // --no-agent-entrypoints
  workflowGitignoreCreated: boolean // workflow/.gitignore를 새로 만들었는가(있으면 보존, --force로도 미덮어씀)
  /** 기존 workflow/.gitignore가 kit과 달라 보존했는가(사용자 정책 파일). stash 안내에서 제외 대상(phase-2 리뷰 P4). */
  workflowGitignoreUserDiffers: boolean
  /** workflow/.gitignore가 ignored∧untracked라 설치 커밋에 못 담기고 fresh clone에 scratch 정책이 없다(phase-2 리뷰 P2). */
  workflowGitignorePolicyAtRisk: boolean
}

/**
 * 대상이 진짜 git work tree인지 실제 git으로 검증(D5, design R1 P2). `.git` 경로 존재만으론 부족(fake 마커 통과).
 * targetRoot가 repo top-level과 일치해야 함(하위 디렉터리에 스캐폴드 방지). git 미설치/비-repo → throw(fail-closed).
 *
 * `run` 주입(REQ-2026-007): uninstall planner가 자신의 감시 runner로 이 검증을 통과시켜
 * **모든 git 호출을 단일 경계에서 관측**할 수 있게 한다. 미지정 시 기존 quiet runner(동작 불변).
 */
export function assertGitWorkTree(targetRoot: string, run?: GitRunner): void {
  // probe 전용 runner: 비-repo일 때 git이 뱉는 `fatal: not a git repository` stderr를 삼킨다.
  // 우리가 더 명확한 조치 메시지로 대체하므로 raw git stderr는 노이즈일 뿐(design 후속 UX).
  // ⚠️ 전역 GitAdapter 기본(stderr 상속)은 그대로 — 다른 git 호출(req:commit 등)의 진단 손실 방지.
  const quietRunner: GitRunner = (file, args, opts) =>
    execFileSync(file, args, { ...opts, stdio: ['ignore', 'pipe', 'ignore'] })
  const git = createGitAdapter(targetRoot, run ?? quietRunner)
  let inside: string
  let topLevel: string
  try {
    inside = git.exec(['rev-parse', '--is-inside-work-tree'])
    topLevel = git.exec(['rev-parse', '--show-toplevel'])
  } catch {
    throw new Error(`대상이 git repo가 아님: ${targetRoot} — 'git init' 후 재시도(워크플로는 git 전제).`)
  }
  if (inside !== 'true') throw new Error(`대상이 git work tree가 아님: ${targetRoot}`)
  // Windows 임시경로(8.3 short name·drive/컴포넌트 case)·symlink 차이 정규화.
  // realpathSync.native = OS API라 컴포넌트 실제 case까지 canonical(WINDOWS/TEMP → Windows/Temp).
  const norm = (p: string): string => resolve(realpathSync.native(p))
  if (norm(topLevel) !== norm(targetRoot))
    throw new Error(`대상이 git repo 최상위가 아님: ${targetRoot} (top-level=${topLevel}) — repo 루트에서 실행.`)
}

/**
 * `git status --porcelain` 한 줄을 `{index, worktree, path}`로 분해. rename(`R  old -> new`)은 새 경로를 쓴다.
 * 파싱 불가면 null(무시) — 진단 목적이라 fail-closed로 만들 이유가 없다.
 */
// unquoteGitPath·parsePorcelainLine은 삭제(REQ-2026-012). `-z`는 인용을 하지 않으므로 되돌릴 게 없다 —
// 파싱은 lib/porcelain의 parseStatusZ 하나로 통일한다.

/**
 * 설치 전 워킹트리를 3분류(DEC-011-11). **순수 함수** — status 엔트리와 산출물 목록만 받는다.
 * 입력은 `parseStatusZ`(= `git status --porcelain=v1 -z --untracked-files=all`)의 산출.
 */
export function classifyPreexistingDirty(entries: readonly StatusEntry[], artifacts: readonly string[]): PreexistingDirty {
  const artifactSet = new Set(artifacts)
  const out: PreexistingDirty = { staged: [], overlapping: [], unrelated: [] }
  for (const e of entries) {
    // 인덱스에 올라간 변경(`?`는 untracked 표식이라 staged가 아니다) → 커밋이 삼킨다.
    if (e.index !== ' ' && e.index !== '?') {
      out.staged.push(e.path)
      continue
    }
    if (artifactSet.has(e.path)) {
      // tracked + unstaged 수정만 문제다. untracked 산출물은 파일 전체가 신규라 분리할 것이 없다.
      if (e.index === ' ' && e.worktree !== ' ' && e.worktree !== '?') out.overlapping.push(e.path)
      continue
    }
    out.unrelated.push(e.path)
  }
  return out
}

/**
 * `paths` 중 **gitignore에 걸리고 untracked인** 것(= `git add <path>`가 fatal인 것)만 반환한다.
 *
 * ⚠️ `git check-ignore`만으로 판정하면 안 된다(DEC-011-10). 그 명령은 **인덱스를 보지 않으므로**,
 * ignore 규칙에 걸리지만 이미 tracked인 파일(강제 add된 lockfile 등)까지 "무시됨"으로 보고한다.
 * 그런 파일은 `git add`가 정상 동작하므로 제외 대상이 아니다.
 *
 * exit 코드: `0`=무시됨, `1`=무시 안 됨, `128`=오류. **128은 "무시 안 됨"으로 취급**한다 —
 * git 버전차·비정상 상태 때문에 설치를 막는 오탐을 만들지 않는다.
 * 파일이 없어도 규칙 매칭이므로 **쓰기 전에** 판정할 수 있다(preflight 배치의 전제).
 */
function gitIsIgnored(targetRoot: string, p: string): boolean {
  try {
    execFileSync('git', ['check-ignore', '-q', '--', p], { cwd: targetRoot, stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function gitIsTracked(targetRoot: string, p: string): boolean {
  try {
    const out = execFileSync('git', ['ls-files', '--', p], {
      cwd: targetRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return out.trim().length > 0
  } catch {
    return false
  }
}

export function findIgnoredArtifacts(targetRoot: string, paths: readonly string[]): string[] {
  return paths.filter((p) => gitIsIgnored(targetRoot, p) && !gitIsTracked(targetRoot, p))
}

/**
 * `destRel`의 **모든 상위 컴포넌트**를 `lstat`으로 검사해 symlink·비-디렉터리를 거부한다(phase-2 리뷰 P1).
 *
 * ⚠️ `realpath`는 링크를 **따라가므로** 저장소 **내부**를 가리키는 symlink를 통과시키고(git이 그 아래를
 *    정상 stage하지 못한다), dangling symlink는 ENOENT라 "부재"로 오인한다. 그래서 컴포넌트별 `lstat`으로:
 *      - 실제 부재(ENOENT) → 그 하위는 targetRoot 안에 새로 생성됨(안전) → 통과.
 *      - symlink/junction → 목적지(내부·외부·dangling) **무관하게 거부**. `copyFileSync`가 밖에 쓰거나 git이 못 읽는다.
 *      - 디렉터리 아님(파일·특수) → 하위를 만들 수 없다 → 거부.
 *      - 그 밖의 오류(EACCES 등) → fail-closed throw.
 *    `workflow/.gitignore`로 preflight에서 돌리면 같은 `workflow/`를 쓰는 스키마 복사도 함께 보호된다.
 */
function assertConfinedDest(targetRoot: string, destRel: string): void {
  const segs = destRel.split('/')
  let cur = targetRoot
  for (let i = 0; i < segs.length - 1; i++) {
    // 마지막(파일명) 제외한 상위 컴포넌트만
    cur = join(cur, segs[i] as string)
    let st: ReturnType<typeof lstatSync>
    try {
      st = lstatSync(cur)
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return // 실제 부재 → 하위를 targetRoot 안에 새로 만든다(안전)
      throw new Error(`${destRel} 상위 경로 확인 실패(${(e as Error).message}) — fail-closed.`)
    }
    if (st.isSymbolicLink())
      throw new Error(`${destRel} 의 상위 '${segs[i]}' 가 symlink/junction 입니다 — confinement 위반(밖에 쓰거나 git이 못 읽음).`)
    if (!st.isDirectory()) throw new Error(`${destRel} 의 상위 '${segs[i]}' 가 디렉터리가 아닙니다 — confinement 위반.`)
  }
}

/** companion skills 계획 결과(순수 판정 — 쓰기 없음). */
export interface CompanionSkillsPlan {
  /** 부재(lstat ENOENT)라 새로 만들 것. */
  create: { srcAbs: string; destRel: string }[]
  /** 이미 있고 **바이트 동일** = 직전 실행이 깐 것 → 설치 커밋 stage 목록에 편입. */
  ownedSkips: string[]
  /** 이미 있고 다름 = 사용자가 고친 것 → 보존(`--force`로도 안 덮음). */
  userDiffers: string[]
}

/**
 * companion skills seed-once 판정 + confinement preflight (설계 D3·D4).
 * **순수 판정이라 아무것도 쓰지 않는다** — `--dry-run`도 이 검사를 그대로 받는다(쓰기 0건, 그러나 symlink면 실패).
 *
 * `workflow/.gitignore`(D12)와 같은 축이고, 다른 점은 **dest가 4개**라는 것뿐이다:
 *
 * 🔴 **각 최종 `SKILL.md` dest를 개별로 넘긴다.** skills 루트(`.claude/skills`)만 넘기면
 *    `assertConfinedDest`의 `i < segs.length - 1` 루프가 **마지막 컴포넌트를 검사하지 않아**
 *    `commitgate-<name>`이 외부 symlink여도 통과하고, `copyFileSync`가 대상 **밖에** 쓴다.
 *
 * 🔴 **leaf는 `lstatSync`로 본다. `existsSync`를 부재 판정에 쓰면 안 된다** —
 *    대상 밖의 아직 없는 파일을 가리키는 **dangling symlink**에서 `existsSync`는 **false**를 주고,
 *    그걸 부재로 오판하면 `copyFileSync`가 링크를 따라 대상 밖에 파일을 만든다(실측 확인).
 *    **ENOENT만** 부재로 인정한다 — EACCES·ELOOP를 부재로 삼키면 Apply에서 늦게 실패한다(rollback 0줄).
 */
export function planCompanionSkills(targetRoot: string): CompanionSkillsPlan {
  const create: { srcAbs: string; destRel: string }[] = []
  const ownedSkips: string[] = []
  const userDiffers: string[] = []
  for (const { src, dest } of KIT_COMPANION_SKILLS) {
    // 상위 컴포넌트 전부(.claude → .claude/skills → .claude/skills/commitgate-<name>)를 lstat으로 검사.
    assertConfinedDest(targetRoot, dest)
    const destAbs = join(targetRoot, dest)
    const srcAbs = join(PACKAGE_ROOT, src)
    let st: ReturnType<typeof lstatSync> | null = null
    try {
      st = lstatSync(destAbs)
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error(`${dest} 상태 확인 실패(${(e as Error).message}) — fail-closed.`)
      st = null
    }
    if (st !== null && !st.isFile())
      throw new Error(`${dest} 가 일반 파일이 아닙니다(symlink·디렉터리·특수파일) — 그 경로를 옮기고 재시도하십시오.`)
    if (st === null) create.push({ srcAbs, destRel: dest })
    else if (sha256File(destAbs) === sha256File(srcAbs)) ownedSkips.push(dest)
    else userDiffers.push(dest) // 사용자가 고친 것 — `--force`도 보지 않는다(D3).
  }
  return { create, ownedSkips, userDiffers }
}

/**
 * `<pm> install`이 만드는 `node_modules/`가 **워킹트리를 dirty하게 만드는가**.
 * ignore되지도 tracked되지도 않으면 `?? node_modules/`로 나타나 `req:new --run`의 clean-tree 게이트를 막는다.
 *
 * README가 지시하는 `git init && npm init -y`에는 `.gitignore`가 없다 — 그 경로는 **100% 재현된다.**
 * 안내가 이 사실을 짚어 주지 않으면 사용자는 설치분을 다 커밋하고도 첫 명령에서 막힌다(실측).
 */
/**
 * `node_modules/`를 무시하는 규칙이 **저장소에 커밋되는 `.gitignore`**에서 왔는가.
 *
 * ⚠️ `git check-ignore`는 `.git/info/exclude`와 전역 `core.excludesFile`도 인정한다. 그 둘은
 * **clone에 따라오지 않는다.** 설치한 사람의 로컬 설정 때문에 `nodeModulesWillDirty=false`가 되면,
 * 팀원의 fresh clone에서 `<pm> install` 후 `?? node_modules/`가 나타나 `req:new --run`이 막힌다.
 * 설치 결과는 **저장소에 이식 가능**해야 한다(phase-6 리뷰 R4).
 *
 * `check-ignore -v` 출력은 `<source>:<line>:<pattern>\t<pathname>`이다. source가 repo 내부의
 * `.gitignore`(상대경로)일 때만 인정한다 — `.git/info/exclude`는 basename이 다르고, 전역 파일은 절대경로다.
 *
 * ⚠️ 조회 경로에 후행 슬래시가 필요하다. 가장 흔한 패턴 `node_modules/`는 **디렉터리 전용**이라
 * `node_modules`(슬래시 없음)로는 매칭되지 않는다 — 경로가 없으면 git이 디렉터리인지 알 수 없기 때문.
 */
function nodeModulesIgnoredByRepoGitignore(targetRoot: string): boolean {
  try {
    const out = execFileSync('git', ['check-ignore', '-v', '--', 'node_modules/'], {
      cwd: targetRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const source = (out.split('\t')[0] ?? '').split(':')[0]?.replace(/\\/g, '/') ?? ''
    if (source === '' || isAbsolute(source) || source.startsWith('.git/')) return false
    if (source !== '.gitignore' && !source.endsWith('/.gitignore')) return false
    // ⚠️ 파일이 있는 것만으론 부족하다 — **tracked**여야 clone에 따라온다.
    // `.gitignore`가 아직 커밋되지 않았거나(혹은 `.git/info/exclude`로 자신이 숨겨져 있어도)
    // 그 규칙은 팀원의 fresh clone에 없다(phase-6 리뷰 R6).
    return gitIsTracked(targetRoot, source)
  } catch {
    return false // exit 1 = 무시 안 됨, 128 = 오류(오탐 방지 위해 "무시 안 됨"으로)
  }
}

function nodeModulesWillDirty(targetRoot: string): boolean {
  return !nodeModulesIgnoredByRepoGitignore(targetRoot) && !gitIsTracked(targetRoot, 'node_modules/')
}

/**
 * `.gitignore`가 설치 커밋에 합류해야 하는가 (phase-6 리뷰 R1·R2).
 *
 * 두 경우다:
 *  1. `node_modules`가 아직 무시되지 않는다 → 사용자가 규칙을 추가해야 하고, 그 수정은 설치 커밋에 담긴다.
 *  2. **`.gitignore`가 dirty하다** → `node_modules`가 이미 무시되더라도 그 규칙이 **커밋되지 않은**
 *     `.gitignore`에서 왔을 수 있다. 안내가 그 파일을 `git stash push -u`로 치우는 순간 규칙이 사라져
 *     `?? node_modules/`가 되살아나고 clean-tree 게이트가 다시 깨진다.
 *
 * 산출물로 편입하면 나머지는 기존 3분류가 처리한다 — untracked면 무해(그대로 stage), tracked·unstaged면
 * overlapping(안내를 내지 않음). dirty `.gitignore`에 무관한 수정만 있는 경우도 보수적으로 막히지만,
 * `package.json`이 dirty할 때와 같은 정책이라 일관된다: **잘못된 안내보다 안내 없음이 낫다.**
 */
function gitignoreJoinsInstall(nodeModulesDirty: boolean, entries: readonly StatusEntry[]): boolean {
  if (nodeModulesDirty) return true
  // rename의 src·dest 어느 쪽이 `.gitignore`여도 그 파일은 dirty다(entryPaths로 둘 다 본다).
  return entries.some((e) => entryPaths(e).includes('.gitignore'))
}

function sha256File(abs: string): string {
  return createHash('sha256').update(readFileSync(abs)).digest('hex')
}

/** kit `workflow/.gitignore` 템플릿의 규칙 라인(주석·빈 줄 제외). differs WARN에서 사용자가 병합할 실제 규칙을 보여 준다. */
function kitGitignoreRules(): string[] {
  return readFileSync(join(PACKAGE_ROOT, KIT_GITIGNORE.src), 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('#'))
}

/** 설치 전 워킹트리 상태(쓰기 전). git 실패 시 빈 목록 — 진단이지 게이트가 아니다. */
function gitStatusEntries(targetRoot: string): StatusEntry[] {
  try {
    const raw = execFileSync('git', [...STATUS_Z_ARGS], {
      cwd: targetRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return parseStatusZ(raw)
  } catch {
    return []
  }
}

/** lockfile로 대상 패키지매니저 감지(없으면 npm — 가장 보편적 기본). */
export function detectPackageManager(root: string): PackageManager {
  if (existsSync(join(root, 'pnpm-lock.yaml'))) return 'pnpm'
  if (existsSync(join(root, 'yarn.lock'))) return 'yarn'
  if (existsSync(join(root, 'package-lock.json'))) return 'npm'
  return 'npm'
}

/**
 * 대상 pm에 맞는 package.json script 실행 커맨드 문자열.
 * npm은 임의 스크립트를 `npm run <script>`로만 실행하고 인자 전달에 `--` 구분자가 필요하다
 * (`npm req:new …`은 "Unknown command"로 실패). pnpm/yarn은 bare script + 인자 직접 전달을 지원.
 * → 안내 문구가 실제로 복붙 가능한 유효 커맨드가 되도록 pm별로 분기(README 수동 명령과 동일 형태).
 */
export function runScriptCmd(pm: PackageManager, script: string, args: string): string {
  return pm === 'npm' ? `npm run ${script} -- ${args}` : `${pm} ${script} ${args}`
}

/** dir 하위 모든 파일의 절대경로(재귀). */
function walkFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry)
    if (statSync(abs).isDirectory()) out.push(...walkFiles(abs))
    else out.push(abs)
  }
  return out
}

/**
 * init이 만들거나 수정할 것의 **쓰기 전 계획**(REQ-2026-011 DEC-011-9).
 *
 * ⚠️ 왜 `InitResult`가 아니라 별도 계획인가: `InitResult.copied`는 Apply 단계에서 채워진다.
 * preflight의 gitignore 검사가 그것을 볼 수 없고, 검사를 복사 뒤로 옮기면 `--strict`가
 * `scripts/req/**`·`req.config.json`·`package.json`을 이미 쓴 뒤에 throw하게 되어
 * "파일을 하나도 쓰지 않고 throw" 계약이 깨진다(design 리뷰 R4).
 *
 * preflight(ignore 검사)·apply(복사)·설치 후 안내(stage 목록) **셋이 같은 계획을 읽는다.**
 * 목록을 따로 관리하면 어긋난다 — R2에서 `AGENTS.commitgate.md`가, R3에서 lockfile이 빠졌다.
 */
export interface InstallPlan {
  copies: { srcAbs: string; destRel: string }[]
  skips: string[]
  /**
   * `skips` 중 **패키지 원본과 바이트가 같은** 것 = CommitGate가 소유한다고 확인된 파일
   * (커밋 전에 init을 두 번 돌렸을 때 생긴다). 안내의 stage 목록에는 이것만 포함한다.
   *
   * ⚠️ `skips` 전체를 산출물로 넣으면, init이 **보존하려던 사용자 파일**(예: 원래 있던
   * `.cursor/rules/commitgate.mdc`)을 설치 커밋에 담게 되어 `git add -A` 금지의 목적을 우회한다
   * (phase-6 리뷰 R3). 소유권 판정은 `bin/uninstall.ts`의 sha256 비교와 같은 축이다.
   */
  ownedSkips: string[]
  configRel: string | null // req.config.json — 생성·병합 시
  packageJsonRel: string | null // package.json — 주입 시
  lockfileRel: string | null // LOCKFILE[pm] — 주입 시(install이 갱신)
  agentsRel: string | null // AGENTS.md — 부재였을 때
  claudeMdRel: string | null // CLAUDE.md — 부재였을 때
  contractCopyRel: string | null // AGENTS.commitgate.md — 기존 AGENTS.md에 마커 없을 때
  /**
   * `.gitignore` — init이 쓰지는 않지만, `node_modules`가 무시되지 않아 **사용자가 고치도록 안내하고
   * 설치 커밋에 함께 담을** 때만 산출물이 된다.
   *
   * ⚠️ 산출물에 넣어야 `classifyPreexistingDirty`가 이 파일을 본다. 그러지 않으면 tracked `.gitignore`에
   * 이미 있던 unstaged 수정이 안내의 `git add`에 딸려 들어가 설치 커밋을 오염시킨다 — `git add -A`를
   * 금지한 이유(DEC-011-7)를 정확히 우회하게 된다(phase-6 리뷰 R1).
   */
  gitignoreRel: string | null
  /** `workflow/.gitignore` — 부재라 새로 생성할 때(설계 D4). AGENTS.md 모델: 생성 시에만 산출물. */
  workflowGitignoreRel: string | null
}

/** `planInstall`이 preflight에서 이미 계산해 둔 사실들(중복 계산 방지). */
export interface PlanFacts {
  configWillWrite: boolean
  packageJsonWillWrite: boolean
  agentsWillCreate: boolean
  claudeMdWillCreate: boolean
  contractCopyWillCreate: boolean
  agentEntrypointsSkipped: boolean
  /** `node_modules`가 워킹트리를 dirty하게 만들어 (루트) `.gitignore` 수정을 안내해야 하는가. */
  gitignoreWillJoin: boolean
  /** `workflow/.gitignore`(kit 파일)가 부재라 새로 생성하는가. `--no-agent-entrypoints`와 무관(D13). */
  workflowGitignoreWillCreate: boolean
  /** 기존 `workflow/.gitignore`가 템플릿과 바이트 동일(= 직전 실행이 깐 것). ownedSkips에 직접 편입(D4 축). */
  workflowGitignoreOwnedSkip: boolean
  /**
   * companion skills 계획(REQ-2026-020). `add()`를 타지 않으므로(D3 seed-once) 여기로 받아
   * copies/ownedSkips에 **직접** 편입한다 — 그러지 않으면 stageList에서 빠져 unrelated로 오분류된다.
   */
  companionSkills: CompanionSkillsPlan
}

/**
 * 계획이 만들거나 수정할 repo-상대 경로 전수. ignore 검사와 stage 목록이 공유한다.
 *
 * `skips`(이미 존재해 덮어쓰지 않는 kit 파일)도 포함한다. init은 **멱등**하므로 커밋 전에 두 번
 * 실행될 수 있는데, 그때 skip된 kit 파일이 산출물에서 빠지면 `unrelated`로 분류되어 안내가
 * "stash 하십시오"라고 말한다 — 방금 깐 kit을 치우라는 뜻이 된다. 안내도 멱등해야 한다.
 */
export function planArtifactPaths(plan: InstallPlan): string[] {
  const extras = [
    plan.configRel,
    plan.packageJsonRel,
    plan.lockfileRel,
    plan.agentsRel,
    plan.claudeMdRel,
    plan.contractCopyRel,
    plan.gitignoreRel,
    plan.workflowGitignoreRel,
  ]
  return [...plan.copies.map((c) => c.destRel), ...plan.ownedSkips, ...extras.filter((p): p is string => p !== null)]
}

/**
 * 복사 계획 수립(IO는 `existsSync`/`readdirSync`만 — 쓰기 없음). 기존 파일은 `force` 없으면 스킵.
 *
 * `scripts/req/**`와 `KIT_COPY_RELPATHS`는 **패키지-상대 = 대상-상대**(리터럴 `workflow/`).
 * 진입점은 `src !== dest`라 명시적 매핑으로 다룬다.
 */
export function planInstall(targetRoot: string, force: boolean, pm: PackageManager, facts: PlanFacts): InstallPlan {
  const copies: { srcAbs: string; destRel: string }[] = []
  const skips: string[] = []
  const ownedSkips: string[] = []
  const sha = (p: string): string | null => {
    try {
      return createHash('sha256').update(readFileSync(p)).digest('hex')
    } catch {
      return null
    }
  }
  const add = (srcAbs: string, destRel: string): void => {
    const destAbs = join(targetRoot, destRel)
    if (existsSync(destAbs) && !force) {
      skips.push(destRel)
      // 바이트가 같으면 CommitGate 소유(직전 실행이 깐 것). 다르면 사용자 파일 — 설치 커밋에 담지 않는다.
      const a = sha(destAbs)
      if (a !== null && a === sha(srcAbs)) ownedSkips.push(destRel)
      return
    }
    copies.push({ srcAbs, destRel })
  }
  // ⚠️ Stage B(REQ-2026-014 R3): `scripts/req/**` 를 대상에 **복사하지 않는다**. 실행 코드는 패키지
  //    (`node_modules/commitgate/scripts/req/**`)에만 있고, `req:* = commitgate <verb>` 가 그리로 dispatch한다.
  //    `KIT_SOURCE_DIR_REL` 상수는 그대로 남는다 — `detectStageA`(D19)와 `bin/uninstall.ts`(기존 Stage A 설치본 분류)가 쓴다.
  //    ⚠️ `package.json` files[]의 `scripts/req` 항목은 **유지해야 한다** — 패키지 자신의 bin이 그리로 dispatch한다.
  //    복사 축(여기)과 tarball 축(files[])은 서로 다른 축이다.
  for (const rel of KIT_COPY_RELPATHS) add(join(PACKAGE_ROOT, rel), rel)
  if (!facts.agentEntrypointsSkipped)
    for (const { src, dest } of KIT_AGENT_ENTRYPOINTS) add(join(PACKAGE_ROOT, src), dest)
  // workflow/.gitignore는 add()를 타지 않는다(D12: --force가 사용자 파일을 덮으면 안 됨). 바이트 동일 재실행분은
  // 여기서 ownedSkips에 **직접** 편입 — 그러지 않으면 stageList에서 빠져 unrelated로 오분류된다(phase-2 리뷰 R1).
  if (facts.workflowGitignoreOwnedSkip) ownedSkips.push(KIT_GITIGNORE.dest)
  // companion skills도 add()를 타지 않는다(D3). 생성분은 copies로, 바이트 동일분은 ownedSkips로 직접 편입 —
  // 그래야 artifacts·stageList·ignore 검사가 이들을 함께 본다. userDiffers는 사용자 파일이라 설치 커밋에 담지 않는다.
  for (const c of facts.companionSkills.create) copies.push(c)
  for (const d of facts.companionSkills.ownedSkips) ownedSkips.push(d)
  for (const d of facts.companionSkills.userDiffers) skips.push(d)

  return {
    copies,
    skips,
    ownedSkips,
    configRel: facts.configWillWrite ? 'req.config.json' : null,
    packageJsonRel: facts.packageJsonWillWrite ? 'package.json' : null,
    // devDeps를 주입했으면 `<pm> install`이 lockfile을 갱신한다. 안내가 이것을 stage해야 clean-tree가 성립한다.
    lockfileRel: facts.packageJsonWillWrite ? LOCKFILE[pm] : null,
    agentsRel: facts.agentsWillCreate ? 'AGENTS.md' : null,
    claudeMdRel: facts.claudeMdWillCreate ? KIT_CLAUDE_DEST_REL : null,
    contractCopyRel: facts.contractCopyWillCreate ? KIT_AGENTS_CONTRACT_COPY_REL : null,
    gitignoreRel: facts.gitignoreWillJoin ? '.gitignore' : null,
    // D13: --no-agent-entrypoints와 무관하게 산출물에 편입 → stageList가 설치 커밋에 담아 팀·CI에 전파.
    workflowGitignoreRel: facts.workflowGitignoreWillCreate ? KIT_GITIGNORE.dest : null,
  }
}

/**
 * 진입점 dest 경로들이 **실제로 만들어질 수 있는지** preflight에서 확인한다 (D8).
 *
 * `mkdirSync(recursive)`는 경로 중간 컴포넌트가 **파일**이면 ENOTDIR로 죽는다. apply 단계에서 그러면
 * 앞의 파일들은 이미 복사된 뒤라 **부분 설치**가 된다. 쓰기 전에 걸러서 preflight→apply 계약을 지킨다.
 */
function assertEntrypointPathsUsable(targetRoot: string): void {
  const dests = [...KIT_AGENT_ENTRYPOINTS.map((e) => e.dest), KIT_CLAUDE_DEST_REL, KIT_AGENTS_CONTRACT_COPY_REL]
  for (const dest of dests) {
    const parts = dest.split('/')
    // 마지막(파일명) 제외한 각 디렉터리 컴포넌트가 파일로 존재하면 mkdir 불가.
    for (let i = 0; i < parts.length - 1; i++) {
      const sub = join(targetRoot, ...parts.slice(0, i + 1))
      if (existsSync(sub) && !statSync(sub).isDirectory())
        throw new Error(
          `진입점 설치 불가: ${parts.slice(0, i + 1).join('/')} 가 디렉터리가 아니라 파일입니다(${dest} 를 만들 수 없음).\n` +
            `  → 해당 파일을 옮기거나, --no-agent-entrypoints 로 이 계층을 건너뛰세요.`,
        )
    }
    const abs = join(targetRoot, dest)
    if (existsSync(abs) && statSync(abs).isDirectory())
      throw new Error(`진입점 설치 불가: ${dest} 가 디렉터리로 존재합니다(파일이어야 함).`)
  }
}

/** 계획대로 복사(중첩 디렉터리 생성). `--dry-run`이면 아무것도 쓰지 않는다. */
function applyCopies(targetRoot: string, plan: InstallPlan): void {
  for (const { srcAbs, destRel } of plan.copies) {
    const destAbs = join(targetRoot, destRel)
    mkdirSync(dirname(destAbs), { recursive: true })
    copyFileSync(srcAbs, destAbs)
  }
}

/**
 * gitignore된 계약 포인터에 대한 경고 문구. **동작하는 패턴을 제시**해야 한다.
 *
 * git 공식 문서(`gitignore(5)`): *"It is not possible to re-include a file if a parent directory of
 * that file is excluded."* 그래서 `.claude` + `!.claude/skills/**`는 **동작하지 않는다.**
 * 이 함정을 알려 주지 않으면 사용자는 고쳤다고 믿으면서 여전히 추적되지 않는다.
 */
function ignoredPointerMessage(ignored: readonly string[]): string {
  return (
    `다음 계약 포인터가 .gitignore로 무시됩니다 — 팀·CI의 fresh clone에 공유되지 않습니다:\n` +
    ignored.map((p) => `      ${p}`).join('\n') +
    `\n    git은 부모 디렉터리가 제외되면 하위 부정 패턴을 무시합니다(gitignore(5)).\n` +
    `    \`.claude\` 대신 아래처럼 바꾸면 설정 파일은 계속 무시하면서 진입점만 추적할 수 있습니다:\n\n` +
    `      .claude/*\n      !.claude/skills/\n      !.claude/skills/**\n      !.claude/commands/\n      !.claude/commands/**`
  )
}

/** JSON 파일을 객체로 파싱(fail-closed). 파싱 실패·비-객체(배열/원시)면 throw. */
function parseJsonObject(path: string, label: string): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = JSON.parse(stripBom(readFileSync(path, 'utf8')))
  } catch (e) {
    throw new Error(`${label} 파싱 실패(${path}): ${(e as Error).message}`)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
    throw new Error(`${label}이 JSON 객체가 아님(${path})`)
  return parsed as Record<string, unknown>
}

// ─────────────────────────────── cross-spawn 버전 하한 진단 (#1) ──

/** 보안 하한 = 주입 spec의 최소버전(SSOT — 하드코딩 이중화 금지). '^7.0.6' → 7.0.6. */
const CROSS_SPAWN_FLOOR = semver.minVersion(CROSS_SPAWN_SPEC)

/** obj가 plain object일 때 obj[key](문자열). 아니면 undefined. */
function stringField(obj: unknown, key: string): string | undefined {
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    const v = (obj as Record<string, unknown>)[key]
    if (typeof v === 'string') return v
  }
  return undefined
}

/** 대상의 기존 cross-spawn spec(devDeps 우선, 없으면 deps). 없으면 null. */
function existingCrossSpawnSpec(pkg: Record<string, unknown>): string | null {
  return stringField(pkg.devDependencies, 'cross-spawn') ?? stringField(pkg.dependencies, 'cross-spawn') ?? null
}

/** node_modules에 실제 설치된 cross-spawn 버전(valid semver). 없으면 null. */
function installedCrossSpawnVersion(targetRoot: string): string | null {
  const p = join(targetRoot, 'node_modules', 'cross-spawn', 'package.json')
  if (!existsSync(p)) return null
  try {
    const v = (JSON.parse(stripBom(readFileSync(p, 'utf8'))) as { version?: unknown }).version
    return typeof v === 'string' && semver.valid(v) ? v : null
  } catch {
    return null
  }
}

/** lockfile 해소 cross-spawn 버전(package-lock v2/v3 JSON 우선, pnpm/yarn best-effort). 없으면 null. */
function lockedCrossSpawnVersion(targetRoot: string): string | null {
  const pl = join(targetRoot, 'package-lock.json')
  if (existsSync(pl)) {
    try {
      const j = JSON.parse(stripBom(readFileSync(pl, 'utf8'))) as {
        packages?: Record<string, { version?: unknown }>
        dependencies?: Record<string, { version?: unknown }>
      }
      const v = j.packages?.['node_modules/cross-spawn']?.version ?? j.dependencies?.['cross-spawn']?.version
      if (typeof v === 'string' && semver.valid(v)) return v
    } catch {
      /* best-effort */
    }
  }
  for (const [file, re] of [
    ['pnpm-lock.yaml', /cross-spawn@(\d+\.\d+\.\d+)/],
    ['yarn.lock', /(?:^|\n)"?cross-spawn@[^\n]*:[\s\S]*?\n\s+version:?\s+"?(\d+\.\d+\.\d+)"?/],
  ] as const) {
    const fp = join(targetRoot, file)
    if (!existsSync(fp)) continue
    try {
      const m = readFileSync(fp, 'utf8').match(re)
      if (m?.[1] && semver.valid(m[1])) return m[1]
    } catch {
      /* best-effort */
    }
  }
  return null
}

/**
 * 기존 cross-spawn이 보안 하한 미만인지 판정(#1). 우선순위: **설치버전 → lockfile 해소버전 → range**.
 * range fallback은 `>=floor`로 절대 해소 불가한 spec만 below로 본다(‘^7.0.0’·‘~7.0.1’ 오탐 방지 — R1 P2).
 * 기존 cross-spawn 없으면 null(우리가 `^7.0.6` 주입 → 진단 불필요).
 */
export function crossSpawnBelowFloor(
  targetRoot: string,
  pkg: Record<string, unknown>,
): { below: boolean; detail: string } | null {
  if (!CROSS_SPAWN_FLOOR) return null // 이론상 도달 불가(REQ_DEV_DEPS 고정값)
  const floor = CROSS_SPAWN_FLOOR.version
  const spec = existingCrossSpawnSpec(pkg)
  if (!spec) return null

  const installed = installedCrossSpawnVersion(targetRoot)
  if (installed) return { below: semver.lt(installed, floor), detail: `설치버전 ${installed}` }

  const locked = lockedCrossSpawnVersion(targetRoot)
  if (locked) return { below: semver.lt(locked, floor), detail: `lockfile ${locked}` }

  if (semver.validRange(spec)) return { below: !semver.intersects(spec, `>=${floor}`), detail: `범위 ${spec}` }
  return { below: false, detail: `범위 ${spec}(파싱 불가 — 무경고)` }
}

/**
 * 설치 코어. IO는 여기서만(테스트가 임시 repo로 직접 호출).
 * **Preflight(전 검증·파싱) → Apply(쓰기) 2단계** — malformed 입력에 대해 어떤 파일도 복사·수정하기 전에 실패한다(부분 설치 방지, design R2 P2).
 */
export function runInit(opts: InitOptions): InitResult {
  const targetRoot = resolve(opts.dir)

  // ══ Preflight: 모든 검증·파싱을 어떤 쓰기보다 먼저 ═══════════════════
  if (!existsSync(targetRoot) || !statSync(targetRoot).isDirectory())
    throw new Error(`대상 디렉터리가 없음: ${targetRoot}`)
  assertGitWorkTree(targetRoot) // 실제 git probe(fake .git 마커 거부)

  const pkgPath = join(targetRoot, 'package.json')
  if (!existsSync(pkgPath))
    throw new Error(`package.json 없음: ${targetRoot} — 'npm init' 등으로 먼저 생성(req:* 스크립트 주입 대상).`)
  const pkg = parseJsonObject(pkgPath, 'package.json') as {
    scripts?: Record<string, string>
    devDependencies?: Record<string, string>
  }
  // scripts·devDependencies·dependencies가 존재하면 반드시 plain object — 배열/원시면 patch 유실(scripts/devDeps, phase R1 P2)
  // 또는 cross-spawn 진단(dependencies, design R1 P3) 오동작. 읽기 전에 shape 검증(fail-closed).
  for (const field of ['scripts', 'devDependencies', 'dependencies'] as const) {
    const v = (pkg as Record<string, unknown>)[field]
    if (v !== undefined && (typeof v !== 'object' || v === null || Array.isArray(v)))
      throw new Error(`package.json의 ${field} 필드가 객체가 아님(${pkgPath}) — 배열/원시 미지원.`)
  }

  // ══ Stage B 전제(REQ-2026-014). 순서가 계약이다: D19(Stage A 서명) → D14(선행 설치) ══
  // 뒤집으면 Stage A 사용자가 D14에서 먼저 죽어 migrate 안내에 도달하지 못한다 — `detectStageA` 주석 참조(design r20 P1).
  // 둘 다 preflight라 throw 시 어떤 파일도 쓰이지 않는다.
  const stageASignature = detectStageA(targetRoot, pkg.scripts ?? {})
  if (stageASignature !== null)
    throw new Error(
      `이미 Stage A(vendored) 설치본입니다 — 감지: ${stageASignature}. ` +
        `plain init은 기존 req:* 를 덮지 않아 vendored 런타임이 계속 실행되는 혼합 설치가 됩니다. ` +
        `'commitgate migrate' 로 전환하세요(기본 dry-run — 아무것도 삭제하지 않습니다).`,
    )
  if (!commitgateDeclared(pkg.devDependencies ?? {}))
    throw new Error(
      `devDependencies.commitgate 선언이 없습니다 — Stage B는 req:* 를 'commitgate <verb>' 로 심으므로 ` +
        `대상에 commitgate가 devDependency로 있어야 합니다. 먼저 'npm install -D commitgate' 를 실행한 뒤 'commitgate init' 하세요.`,
    )

  // cross-spawn 보안 하한 진단(#1): 기존 cross-spawn이 하한 미만이면 WARN(기본)/throw(--strict). preflight라 strict throw 시 부분 설치 없음.
  // ⚠️ Stage B는 대상의 cross-spawn을 **실행하지 않는다**(safeSpawnSync는 패키지 자신의 dependencies.cross-spawn에서 돈다).
  //    대상에 cross-spawn이 없으면 자동 무동작(existingCrossSpawnSpec→null)이라 신규 Stage B 설치엔 영향이 없다.
  //    Stage B에서의 의미 재검토는 REQ-2026-014 backlog(이번 범위에서 동작 불변).
  let crossSpawnFloorWarned = false
  const floorCheck = crossSpawnBelowFloor(targetRoot, pkg as Record<string, unknown>)
  if (floorCheck?.below) {
    const spec = CROSS_SPAWN_SPEC
    const msg = `기존 cross-spawn(${floorCheck.detail})이 보안 하한 >=${CROSS_SPAWN_FLOOR?.version} 미만 — CommitGate 안전 경계(safeSpawnSync)는 ${spec} 검증분입니다. 'npm i -D cross-spawn@${spec}' 권장.`
    if (opts.strict) throw new Error(`[--strict] ${msg}`)
    console.warn(`⚠️  ${msg} (설치는 계속 — 강제 중단하려면 --strict)`)
    crossSpawnFloorWarned = true
  }

  const cfgPath = join(targetRoot, 'req.config.json')
  const existingCfg = existsSync(cfgPath) ? parseJsonObject(cfgPath, 'req.config.json') : null
  // 기존 config는 워크플로 CONFIG_SCHEMA(additionalProperties·enum·type) + 경로 confinement까지 preflight 검증(phase R2 P2).
  // kit의 loadConfig를 재사용 — schema-invalid(unknown key·bad enum·escaping ticketRoot 등)면 복사 전 throw(첫 req:* 지연 실패 방지).
  // 병합은 유효 키만 추가(handoffPath:null·packageManager)라 "기존 유효 ⇒ 병합 유효".
  loadConfig({ root: targetRoot })
  const packageManager = detectPackageManager(targetRoot)

  // req.config.json 계획(쓰기 없음). handoffPath:null·packageManager를 항상 보장 —
  // handoffPath는 프로젝트별 값이라 코어 기본이 비활성(null)이다 — 그 비활성을 config에 **명시 기록**한다(암묵 < 명시). 기존 키 보존.
  let configAction: 'created' | 'merged' | 'unchanged' = 'unchanged'
  const configKeysAdded: string[] = []
  let configToWrite: Record<string, unknown> | null = null
  if (existingCfg === null) {
    configAction = 'created'
    configKeysAdded.push('packageManager', 'handoffPath')
    configToWrite = { packageManager, handoffPath: null }
  } else {
    const patch: Record<string, unknown> = {}
    if (!('handoffPath' in existingCfg)) {
      patch.handoffPath = null
      configKeysAdded.push('handoffPath')
    }
    if (!('packageManager' in existingCfg)) {
      patch.packageManager = packageManager
      configKeysAdded.push('packageManager')
    }
    if (configKeysAdded.length > 0) {
      configAction = 'merged'
      configToWrite = { ...existingCfg, ...patch }
    }
  }

  // package.json 패치 계획(쓰기 없음, 기존 키 미덮어씀)
  const packageJsonAdded: string[] = []
  const scripts = pkg.scripts ?? {}
  // Stage B: `commitgate <verb>` 를 주입한다(R1/R2). `if (!(k in scripts))` — **기존 키는 절대 덮지 않는다**.
  // 이 미덮어씀 규칙이 곧 "사용자 정의 req:* 보존"이며, Stage A 시절부터의 **기존 동작**이다(회귀 테스트로 고정).
  for (const [k, v] of Object.entries(STAGE_B_REQ_SCRIPTS)) {
    if (!(k in scripts)) {
      scripts[k] = v
      packageJsonAdded.push(`scripts.${k}`)
    }
  }
  // ⚠️ Stage B(R3): devDeps(`tsx`·`ajv`·`cross-spawn`)를 **주입하지 않는다**. 이들은 `commitgate` 패키지의
  //    runtime `dependencies`라 `npm i -D commitgate` 시 전이 설치된다. 대상 package.json의 devDependencies는
  //    **건드리지 않는다**(사용자 소유 — `devDependencies.commitgate`도 사용자가 `npm i -D`로 넣은 것이다).
  //    `REQ_DEV_DEPS` 상수는 남는다 — `bin/uninstall.ts`가 기존 Stage A 설치본의 devDeps를 분류하는 데 쓴다.

  const agentsPath = join(targetRoot, 'AGENTS.md')
  const agentsCreated = !existsSync(agentsPath)

  const agentEntrypointsSkipped = opts.noAgentEntrypoints === true
  if (!agentEntrypointsSkipped) assertEntrypointPathsUsable(targetRoot)

  // 기존 AGENTS.md에 계약 마커가 없으면 진입점 포인터가 **엉뚱한 SSOT**를 가리키게 된다(design R1 observation).
  // 설치는 계속한다(비파괴 원칙) — 사용자가 병합하도록 알릴 뿐.
  const agentsMarkerMissing =
    !agentEntrypointsSkipped && !agentsCreated && !readFileSync(agentsPath, 'utf8').includes(AGENTS_CONTRACT_MARKER)

  const claudeMdPath = join(targetRoot, KIT_CLAUDE_DEST_REL)
  const claudeMdCreated = !agentEntrypointsSkipped && !existsSync(claudeMdPath)

  // 마커가 없으면 포인터가 참조할 계약 템플릿을 **대상 repo에** 놓는다 — 그러지 않으면 복구 지시가 막다른 길이다.
  const contractCopyPath = join(targetRoot, KIT_AGENTS_CONTRACT_COPY_REL)
  const agentsContractCopyCreated = agentsMarkerMissing && (!existsSync(contractCopyPath) || opts.force)

  // workflow/.gitignore(kit 파일, REQ-2026-012). AGENTS.md 정책: **부재 시에만** 생성, --force로도 안 덮음(D12).
  // --no-agent-entrypoints와 무관(D13).
  const workflowGitignorePath = join(targetRoot, KIT_GITIGNORE.dest)
  const workflowGitignoreSrcAbs = join(PACKAGE_ROOT, KIT_GITIGNORE.src)
  // confinement: workflow/(또는 그 상위)가 symlink면 copyFileSync가 밖에 쓰거나 git이 경로를 stage하지 못한다.
  // 상위 컴포넌트를 lstat으로 검사해 내부·외부·dangling 링크를 모두 거부한다(P1).
  // preflight라 스키마 복사(같은 workflow/ 경유)보다 먼저 돌아 함께 보호된다.
  assertConfinedDest(targetRoot, KIT_GITIGNORE.dest)
  // fail-closed: 존재하면 반드시 **일반 파일**이어야 한다(P1). lstat로 symlink를 안 따라간다 —
  //   symlink면 copyFileSync가 링크 대상을 따라 쓰고 git도 링크된 .gitignore를 규칙으로 안 읽는다. 디렉터리·특수파일도 복사 불가.
  //   ⚠️ **ENOENT만** 부재로 인정한다 — EACCES·ELOOP 등을 부재로 삼키면 apply로 넘어가 늦게 실패한다.
  let wgLstat: ReturnType<typeof lstatSync> | null = null
  try {
    wgLstat = lstatSync(workflowGitignorePath)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT')
      throw new Error(`${KIT_GITIGNORE.dest} 상태 확인 실패(${(e as Error).message}) — fail-closed.`)
    wgLstat = null
  }
  if (wgLstat !== null && !wgLstat.isFile())
    throw new Error(`${KIT_GITIGNORE.dest} 가 일반 파일이 아닙니다(symlink·디렉터리·특수파일) — 그 경로를 옮기고 재시도하십시오.`)
  const workflowGitignoreExists = wgLstat !== null // isFile 보장
  const workflowGitignoreCreated = !workflowGitignoreExists
  // 존재 & 바이트 동일 = 직전 실행이 깐 것(소유). ⚠️ add()를 타지 않으므로(D12) ownedSkips를 **직접** 채운다 —
  //   아니면 커밋 전 재실행 시 stageList에서 빠져 unrelated로 오분류된다(설계 D4 축, phase-2 리뷰 R1).
  const workflowGitignoreOwnedSkip = workflowGitignoreExists && sha256File(workflowGitignorePath) === sha256File(workflowGitignoreSrcAbs)
  // 존재하지만 다름 = 사용자 파일(보존). **효과를 판정하지 않고 보수적으로 WARN**한다(phase-2 리뷰 P2·P3):
  //   check-ignore 효과 판정은 로컬 전용 소스(.git/info/exclude·전역)를 이식 가능으로 오인하고,
  //   단일 샘플은 scoped negation(`!/REQ-2026-...`)을 놓친다. 그래서 "다르면 무조건 안내".
  const workflowGitignoreUserDiffers = workflowGitignoreExists && !workflowGitignoreOwnedSkip
  // 정책 파일이 fresh clone·CI에 전달되지 못하는가(설치 커밋에 못 담김) — ignored∧untracked면 `git add`가 fatal이다.
  // 소유(생성/ownedSkip)든 사용자 파일(differs)이든, scratch 정책이 팀에 없으면 안전한 설치 안내를 낼 수 없다(phase-2 리뷰 P2).
  const workflowGitignorePolicyAtRisk =
    (workflowGitignoreCreated || workflowGitignoreOwnedSkip || workflowGitignoreUserDiffers) &&
    gitIsIgnored(targetRoot, KIT_GITIGNORE.dest) &&
    !gitIsTracked(targetRoot, KIT_GITIGNORE.dest)

  // companion skills(REQ-2026-020 D3·D4). **preflight**라 `--dry-run`도 이 검사를 받는다 —
  // dry-run이 조용히 통과하면 실설치 직전에야 터진다. 판정은 순수(쓰기 0건)다.
  // `.claude/` 계층이므로 `--no-agent-entrypoints`면 통째로 건너뛴다(D5/D7 의미 유지).
  const companionSkills: CompanionSkillsPlan = agentEntrypointsSkipped
    ? { create: [], ownedSkips: [], userDiffers: [] }
    : planCompanionSkills(targetRoot)

  // 설치 **전** 워킹트리(쓰기 전 스냅샷). `.gitignore`의 dirty 여부 판정에도 쓰이므로 계획보다 먼저 찍는다.
  const porcelain = gitStatusEntries(targetRoot)
  const nmWillDirty = nodeModulesWillDirty(targetRoot)

  // 산출물 계획을 **쓰기 전에** 확정한다(DEC-011-9). ignore 검사·복사·설치 후 안내가 이 하나를 공유한다.
  const plan = planInstall(targetRoot, opts.force, packageManager, {
    configWillWrite: configToWrite !== null,
    packageJsonWillWrite: packageJsonAdded.length > 0,
    agentsWillCreate: agentsCreated,
    claudeMdWillCreate: claudeMdCreated,
    contractCopyWillCreate: agentsContractCopyCreated,
    agentEntrypointsSkipped,
    gitignoreWillJoin: gitignoreJoinsInstall(nmWillDirty, porcelain),
    workflowGitignoreWillCreate: workflowGitignoreCreated,
    workflowGitignoreOwnedSkip,
    companionSkills,
  })
  const artifacts = planArtifactPaths(plan)

  // gitignore 판정(D5). 계약 포인터가 무시되면 설치 목적(팀·CI 공유)이 조용히 무너진다 → WARN/strict throw.
  // 그 밖의 산출물(lockfile 등)은 무시돼도 정당한 정책일 수 있으므로 stage 목록에서만 조용히 뺀다.
  const gitIgnoredArtifacts = findIgnoredArtifacts(targetRoot, artifacts)
  const ignoredPointers = gitIgnoredArtifacts.filter((p) => CONTRACT_POINTER_RELPATHS.includes(p))

  // 설치 **전** 워킹트리 3분류(DEC-011-11). 쓰기 뒤에 찍으면 CommitGate 산출물과 섞여 구분할 수 없다.
  const preexistingDirty = classifyPreexistingDirty(porcelain, artifacts)

  if (ignoredPointers.length > 0) {
    const msg = ignoredPointerMessage(ignoredPointers)
    if (opts.strict) throw new Error(`[--strict] ${msg}`)
    console.warn(`⚠️  ${msg}\n    (설치는 계속 — 강제 중단하려면 --strict)`)
  }

  // `.gitignore`를 설치 커밋에 담아야 하는데 그 파일 **자신이** 무시된다(로컬 exclude·전역 ignore).
  // `git add`가 fatal이고, 규칙이 커밋되지 않아 팀원의 fresh clone에서 `?? node_modules/`가 되살아난다.
  // 안전한 안내를 만들 수 없으므로 알리고(기본) 중단한다(--strict) — phase-6 리뷰 R6.
  if (plan.gitignoreRel !== null && gitIgnoredArtifacts.includes('.gitignore')) {
    const msg =
      `.gitignore 자체가 무시되고 있어(.git/info/exclude 또는 전역 ignore) 설치 커밋에 담을 수 없습니다.\n` +
      `    node_modules 무시 규칙이 팀원의 fresh clone에 따라가지 않아 그쪽 req:new 가 막힙니다.\n` +
      `    로컬 exclude에서 .gitignore 를 빼고 저장소에 커밋하십시오.`
    if (opts.strict) throw new Error(`[--strict] ${msg}`)
    console.warn(`⚠️  ${msg}\n    (설치는 계속 — 커밋 안내는 생략됩니다)`)
  }

  // workflow/.gitignore가 ignored∧untracked면 설치 커밋에 못 담겨 팀·CI에 scratch 정책이 없다(phase-2 리뷰 R3·R6).
  // ⚠️ `workflowGitignorePolicyAtRisk`로 통합 판정 — created/ownedSkip(산출물)뿐 아니라 **user-differs**(artifacts에 없고
  //    porcelain에도 안 나타나는 사용자 파일)도 포함한다. 이것을 빼면 --strict가 그 상태에서 쓰기 전에 안 막는다(R6 gap).
  if (workflowGitignorePolicyAtRisk) {
    const msg =
      `${KIT_GITIGNORE.dest} 가 무시되고 있어(예: 루트 규칙의 \`**/.gitignore\`) 설치 커밋에 담을 수 없습니다.\n` +
      `    티켓 scratch 무시 규칙이 팀원의 fresh clone·CI에 따라가지 않습니다.\n` +
      `    그 파일을 무시하는 규칙을 걷어내고 저장소에 커밋하십시오.`
    if (opts.strict) throw new Error(`[--strict] ${msg}`)
    console.warn(`⚠️  ${msg}\n    (설치는 계속 — 안전한 커밋 안내는 생략됩니다)`)
  }
  // companion skills가 ignored∧untracked면 설치 커밋에 못 담겨 팀원 fresh clone에 전달되지 않는다(REQ-2026-021 D1).
  //
  // 🔴 **`artifacts`로 판정하면 안 된다.** `userDiffers`는 `skips`로 가서 `planArtifactPaths`
  //    (= `copies + ownedSkips + extras`)에 **없다** → `findIgnoredArtifacts`가 그 파일을 보지 못한다.
  //    그러면 나머지가 전부 추적된 상태에서 사용자가 skill 하나만 고쳤을 때 **경고 없이 `--strict`가 통과**한다.
  //    계획 3분류(create·ownedSkips·userDiffers)를 **전부** 본다 — 소유든 사용자 파일이든, 팀에 전달되지
  //    못하면 안전한 설치 안내를 낼 수 없다. `workflowGitignorePolicyAtRisk`와 같은 축이다(D1).
  //
  // ⚠️ `CONTRACT_POINTER_RELPATHS`에 섞지 않는다(REQ-2026-020 D6) — companion은 계약 포인터가 아니다.
  //    같은 WARN/strict **동작**만 별도 판정으로 준다. 기존 포인터 경고는 손대지 않는다(추가만).
  const companionAtRisk = [
    ...companionSkills.create.map((c) => c.destRel),
    ...companionSkills.ownedSkips,
    ...companionSkills.userDiffers,
  ].filter((p) => gitIsIgnored(targetRoot, p) && !gitIsTracked(targetRoot, p))

  if (companionAtRisk.length > 0) {
    const msg =
      `companion skills가 무시되고 있어 설치 커밋에 담을 수 없습니다:\n` +
      companionAtRisk.map((p) => `      ${p}`).join('\n') +
      `\n    팀원의 fresh clone·CI에는 이 스킬들이 없습니다(그쪽 Builder는 방법론 보조를 못 받습니다).\n` +
      `    추적하려면: git add -f <위 경로>   또는 .gitignore 에서 해당 규칙을 걷어내십시오.`
    if (opts.strict) throw new Error(`[--strict] ${msg}`)
    console.warn(`⚠️  ${msg}\n    (설치는 계속 — 강제 중단하려면 --strict)`)
  }

  // staged·overlapping이 있으면 **안전한 커밋 안내를 만들 수 없다**(커밋이 인덱스 전체를 담고, 겹침은 사후 분리 불가).
  // 기본 모드는 설치를 막지 않는다(비파괴·비-breaking) — 안내를 내지 않을 뿐. `--strict`는 쓰기 전에 중단한다.
  if (opts.strict && (preexistingDirty.staged.length > 0 || preexistingDirty.overlapping.length > 0)) {
    const lines = [
      ...preexistingDirty.staged.map((p) => `      staged      ${p}`),
      ...preexistingDirty.overlapping.map((p) => `      설치분과 겹침 ${p}`),
    ]
    throw new Error(
      `[--strict] 설치 전 워킹트리에 변경이 있어 안전한 설치 커밋을 만들 수 없습니다:\n${lines.join('\n')}\n` +
        `    staged 변경은 설치 커밋에 함께 들어가고, 겹치는 변경은 사후 분리가 불가능합니다. 먼저 커밋하거나 되돌리세요.`,
    )
  }

  // ══ Apply: 여기부터 쓰기(preflight 전부 통과 후에만) ═════════════════
  const copied = plan.copies.map((c) => c.destRel)
  const skipped = plan.skips

  if (!opts.dryRun) {
    applyCopies(targetRoot, plan)
    if (configToWrite) writeFileSync(cfgPath, JSON.stringify(configToWrite, null, 2) + '\n', 'utf8')
    if (packageJsonAdded.length > 0) {
      pkg.scripts = scripts
      // ⚠️ Stage B(R3): `pkg.devDependencies`를 **재대입하지 않는다**. 주입이 없으므로 파싱된 원본이 그대로 직렬화되고,
      //    devDependencies가 없던 package.json에 빈 `{}`를 새로 만들어 넣는 부작용도 없다.
      writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8')
    }
    if (agentsCreated) copyFileSync(join(PACKAGE_ROOT, 'AGENTS.template.md'), agentsPath)
    // CLAUDE.md는 AGENTS.md와 동일 정책: **부재 시에만** 생성(--force로도 덮어쓰지 않는다 — 사용자 파일일 수 있다).
    if (claudeMdCreated) copyFileSync(join(PACKAGE_ROOT, KIT_CLAUDE_TEMPLATE_REL), claudeMdPath)
    if (agentsContractCopyCreated) copyFileSync(join(PACKAGE_ROOT, 'AGENTS.template.md'), contractCopyPath)
    // workflow/.gitignore도 부재 시에만 생성(--force로도 안 덮음, D12). workflow/는 KIT_COPY_RELPATHS 복사로 이미 존재.
    if (workflowGitignoreCreated) {
      mkdirSync(dirname(workflowGitignorePath), { recursive: true })
      copyFileSync(workflowGitignoreSrcAbs, workflowGitignorePath)
    }
  }

  if (workflowGitignoreUserDiffers)
    console.warn(
      `⚠️  기존 ${KIT_GITIGNORE.dest} 가 kit 템플릿과 다릅니다(보존 — --force로도 덮지 않음).\n` +
        `    아래 규칙이 (뒤에 \`!\` 부정 override 없이) 있는지 확인·병합하십시오 — 없으면 티켓 scratch가 git status에 계속 잡힙니다:\n` +
        kitGitignoreRules().map((r) => `      ${r}`).join('\n'),
    )

  if (agentsMarkerMissing) {
    // phase-3a R1 observation: 사본을 **새로 놓았을 때**와 **기존 것을 보존했을 때**의 문구가 달라야 한다.
    // "설치했습니다"가 두 경우 모두에 나오면, 편집된 사본을 그대로 둔 사용자가 새 템플릿을 받았다고 오해한다.
    const copyNote = opts.dryRun
      ? `계약 템플릿을 ${KIT_AGENTS_CONTRACT_COPY_REL} 로 설치할 예정입니다.`
      : agentsContractCopyCreated
        ? `계약 템플릿을 ${KIT_AGENTS_CONTRACT_COPY_REL} 로 함께 설치했습니다.`
        : `${KIT_AGENTS_CONTRACT_COPY_REL} 가 이미 있어 보존했습니다(덮어쓰려면 --force).`
    console.warn(
      `⚠️  기존 AGENTS.md에 ${AGENTS_CONTRACT_MARKER} 마커가 없습니다 — .claude/·.cursor/ 진입점이 가리킬 CommitGate 계약이 그 파일에 없습니다.\n` +
        `   ${copyNote} 그 내용을 AGENTS.md에 병합한 뒤 ${KIT_AGENTS_CONTRACT_COPY_REL} 를 지우세요(설치는 계속됩니다).`,
    )
  }

  return {
    targetRoot,
    copied,
    skipped,
    artifacts,
    gitIgnoredArtifacts,
    lockfileRel: plan.lockfileRel,
    nodeModulesWillDirty: nmWillDirty,
    preexistingDirty,
    configAction,
    configKeysAdded,
    packageJsonAdded,
    agentsCreated,
    packageManager,
    crossSpawnFloorWarned,
    dryRun: opts.dryRun,
    claudeMdCreated,
    agentsMarkerMissing,
    agentsContractCopyCreated,
    agentEntrypointsSkipped,
    workflowGitignoreCreated,
    workflowGitignoreUserDiffers,
    workflowGitignorePolicyAtRisk,
  }
}

/**
 * 설치 후 `git add` 대상. 산출물 전수에서 **무시되고 untracked인 것**만 뺀다 — `git add <ignored>`는 fatal이다.
 * `planArtifactPaths`(preflight)와 같은 목록을 소비하므로 두 축이 갈라질 수 없다(DEC-011-9).
 */
export function stageList(artifacts: readonly string[], gitIgnoredArtifacts: readonly string[]): string[] {
  const ignored = new Set(gitIgnoredArtifacts)
  return artifacts.filter((p) => !ignored.has(p))
}

/** 인용 없이 안전한 경로(영숫자 + 경로 구분자 + 흔한 구두점). */
const SHELL_SAFE_PATH = /^[A-Za-z0-9._+\-/\\:@]+$/

/**
 * 안내에 넣을 경로를 셸에 안전하게 인용한다(phase-6 리뷰 R5).
 *
 * 공백이 든 경로를 그대로 인쇄하면 `cd C:\Work\My Repo`가 PowerShell에서 인자 두 개로 쪼개지고,
 * `git stash push -u -- notes today.txt`는 pathspec 두 개가 되어 그 파일이 dirty로 남는다.
 * 큰따옴표는 sh·PowerShell·cmd가 모두 경로 묶음으로 인정한다.
 *
 * ⚠️ 경로에 `"`·`` ` ``·`$`가 있으면 셸마다 이스케이프 규칙이 달라 **단일 안전 표기가 없다.**
 * 그럴 땐 묶기만 하고 `pathNeedsManualQuoting`이 사용자에게 수동 확인을 지시하게 한다.
 */
export function quoteForShell(p: string): string {
  return SHELL_SAFE_PATH.test(p) ? p : `"${p}"`
}

/**
 * 큰따옴표로도 셸 간 안전을 보장할 수 없는 경로인가.
 *
 * - `"` : 인용을 닫는다.
 * - `` ` ``·`$` : PowerShell이 큰따옴표 **안에서** 확장·이스케이프한다.
 * - `%`·`!` : **cmd.exe가 큰따옴표 안에서도** 환경변수(`%VAR%`)와 지연확장(`!VAR!`)을 치환한다.
 *   `notes %USERPROFILE%.txt` 같은 경로는 다른 pathspec으로 바뀌어 엉뚱한 파일을 stash할 수 있다.
 *
 * 이런 경로가 하나라도 있으면 복붙 명령을 **내지 않는다** — 잘못된 명령보다 명령 없음이 낫다.
 */
export function pathNeedsManualQuoting(p: string): boolean {
  return /["`$%!]/.test(p)
}

/**
 * 설치 직후 "다음:" 안내(D4). **순수 함수** — `InitResult`만 보고 줄 배열을 만든다(테스트 가능).
 *
 * 세 가지 규칙:
 *  1. **`git add -A` 금지**(DEC-011-7). brownfield의 무관한 변경과 `.env`가 함께 커밋되고,
 *     이어지는 `req:review-codex`가 staged diff 전문을 외부로 전송한다.
 *  2. **shell 연산자 금지**(DEC-011-8). `&&`는 Windows PowerShell 5.1·cmd.exe에 없다.
 *  3. **안전한 안내를 만들 수 없으면 내지 않는다**(DEC-011-11). staged 변경은 커밋이 삼키고,
 *     산출물과 겹치는 tracked 변경은 사후 분리가 불가능하다. 잘못된 안내보다 안내 없음이 낫다.
 */
export function installGuidance(r: InitResult): string[] {
  const { staged, overlapping, unrelated } = r.preexistingDirty
  // `.gitignore`를 담아야 하는데 그 파일 자신이 무시되면 `git add`가 fatal이고 규칙이 커밋되지 않는다 →
  // 이식 가능한 clean-tree를 보장할 수 없다. 안내를 내지 않는다(phase-6 리뷰 R6).
  const gitignoreUnstageable = r.artifacts.includes('.gitignore') && r.gitIgnoredArtifacts.includes('.gitignore')
  // 어떤 셸 인용으로도 안전하지 않은 경로 — cmd.exe는 큰따옴표 안에서도 `%VAR%`·`!VAR!`를 치환한다(R7).
  const risky = [r.targetRoot, ...r.artifacts, ...unrelated].filter(pathNeedsManualQuoting)
  const unsafe =
    staged.length > 0 || overlapping.length > 0 || gitignoreUnstageable || risky.length > 0 || r.workflowGitignorePolicyAtRisk

  const cdLine = risky.includes(r.targetRoot) ? `  1. 저장소 루트로 이동: ${r.targetRoot}` : `  1. cd ${quoteForShell(r.targetRoot)}`
  const out: string[] = ['', '다음:', cdLine, `  2. ${r.packageManager} install`]
  out.push(`  3. codex --version   # 리뷰 실호출 전제(미설치면 review-codex --run이 fail-closed)`)
  out.push(`  4. req.config.json 확인(branchPrefix 등)`)

  if (unsafe) {
    out.push('')
    out.push('  ⚠️  안전한 커밋 안내를 만들 수 없습니다.')
    for (const p of staged) out.push(`        staged (커밋에 함께 들어갑니다)      ${p}`)
    for (const p of overlapping) out.push(`        설치분과 겹침 (사후 분리 불가)      ${p}`)
    if (gitignoreUnstageable)
      out.push('        .gitignore 자체가 무시됨 (규칙이 clone에 따라가지 않음)')
    if (r.workflowGitignorePolicyAtRisk)
      out.push(`        ${KIT_GITIGNORE.dest} 가 무시됨 — 설치 커밋에 못 담겨 fresh clone·CI에 scratch 정책이 없습니다`)
    for (const p of risky)
      out.push(`        셸 특수문자(" \` $ % !) 포함 — 어떤 인용으로도 복붙이 안전하지 않음: ${p}`)
    out.push('      위를 커밋하거나 되돌린 뒤, `git status` 로 직접 확인하며 설치분만 커밋하십시오.')
    out.push(`      그다음: ${runScriptCmd(r.packageManager, 'req:new', '<slug> --run')}`)
    return out
  }

  const toStage = stageList(r.artifacts, r.gitIgnoredArtifacts)
  let n = 5
  if (r.nodeModulesWillDirty) {
    // `<pm> install`이 만든 `?? node_modules/`가 clean-tree 게이트를 막는다. README의 `git init && npm init -y`
    // 경로에는 .gitignore가 없어 **반드시** 걸린다. `.gitignore`는 이미 `artifacts`에 들어 있으므로
    // stage 목록에 자동으로 포함되고, tracked인데 이미 dirty하면 위의 unsafe 분기가 먼저 막는다.
    out.push(`  ${n++}. \`node_modules\` 가 .gitignore 되어 있지 않습니다. 2단계 install 이 만든 그 디렉터리가`)
    out.push(`     워킹트리를 dirty 하게 만들어 req:new 가 막힙니다. .gitignore 에 \`node_modules/\` 를 추가하십시오.`)
  }
  out.push(`  ${n++}. 설치분만 stage 하십시오. 전체를 담는 stage(-A / .)는 쓰지 마십시오 — 무관한 변경·.env 가`)
  out.push(`     함께 커밋되고, 이어지는 req:review-codex 가 staged diff 전문을 외부로 전송합니다.`)
  if (r.lockfileRel !== null)
    out.push(`     (2단계 install 을 먼저 실행해야 ${r.lockfileRel} 이 존재합니다. lockfile 을 만들지 않는 설정이라면 그 경로는 빼십시오.)`)
  out.push(`       git add -- ${toStage.map(quoteForShell).join(' ')}`)
  out.push(`       git status                    # 의도한 것만 staged 인지 눈으로 확인`)
  out.push(`       git commit -m "chore: install commitgate"`)

  // ⚠️ 사용자 소유 workflow/.gitignore(differs)는 stash 대상에서 뺀다(phase-2 리뷰 P4). stash하면 그 정책 파일이
  //    사라져 fresh clone에서 scratch가 다시 나타나고 다음 req:new가 막힌다. 별도로 확인·커밋하도록 안내한다.
  const userGitignoreDirty = r.workflowGitignoreUserDiffers && unrelated.includes(KIT_GITIGNORE.dest)
  const stashUnrelated = userGitignoreDirty ? unrelated.filter((p) => p !== KIT_GITIGNORE.dest) : unrelated

  if (userGitignoreDirty) {
    out.push(`  ${n++}. ${KIT_GITIGNORE.dest} 는 당신의 파일입니다(미커밋). stash 하지 말고 —`)
    out.push(`     kit 규칙이 있는지 확인한 뒤 **직접 커밋**하십시오(fresh clone·CI에 scratch 정책이 있어야 합니다).`)
  }
  if (stashUnrelated.length > 0) {
    // ⚠️ bare `git stash -u`는 너무 넓다 — `node_modules/`처럼 gitignore되지 않은 산출물까지 쓸어 가
    //    방금 설치한 tsx가 사라지고 req:new가 죽는다(실측). 경로를 명시한다(DEC-011-7과 같은 원칙).
    //    `-u` 없이는 untracked가 남아 clean-tree 게이트가 여전히 실패한다(design 리뷰 R5).
    out.push(`  ${n++}. 설치 커밋 뒤, 설치 전부터 있던 아래 무관한 변경을 커밋하거나 치우십시오`)
    out.push(`     (req:new 는 clean 워킹트리를 요구합니다):`)
    out.push(`       git stash push -u -- ${stashUnrelated.map(quoteForShell).join(' ')}`)
  }
  out.push(`  ${n}. ${runScriptCmd(r.packageManager, 'req:new', '<slug> --run')}`)
  return out
}

export function parseArgs(argv: string[]): InitOptions {
  let dir = process.cwd()
  let force = false
  let dryRun = false
  let strict = false
  let noAgentEntrypoints = false
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dir') {
      const v = argv[i + 1]
      if (v === undefined) throw new Error('--dir 값 누락')
      dir = v
      i++
    } else if (a === '--force') {
      force = true
    } else if (a === '--dry-run') {
      dryRun = true
    } else if (a === '--strict') {
      strict = true
    } else if (a === '--no-agent-entrypoints') {
      noAgentEntrypoints = true
    } else if (a === '-h' || a === '--help') {
      printHelp()
      process.exit(0)
    } else {
      throw new Error(`알 수 없는 인자: ${a}`)
    }
  }
  return { dir: resolve(dir), force, dryRun, strict, noAgentEntrypoints }
}

function printHelp(): void {
  console.log(`commitgate — AI REQ workflow(커밋 게이트) 설치

⚠️ commitgate 를 **먼저 devDependency 로 설치**해야 합니다:
     npm install -D commitgate
   그다음 이 명령을 실행합니다. 실행 코드는 대상 repo 에 복사되지 않고
   node_modules/commitgate 에서 돕니다(req:* 스크립트가 그리로 dispatch).

사용법:
  npx commitgate [init] [--dir <대상repo>] [--force] [--dry-run] [--strict]
  npx commitgate migrate [--apply] [--dir <대상repo>]   # 예전 vendored 설치본 → 런타임 패키지(기본: 계획만)
  npx commitgate uninstall [--dir <대상repo>]           # 제거 계획만 출력(아무것도 지우지 않음)

옵션:
  --dir <path>   대상 repo 루트(기본: 현재 디렉터리)
  --force        기존 kit 파일 덮어쓰기(기본: 스킵)
  --dry-run      변경 없이 수행 예정 목록만 출력
  --strict       정합성 경고를 설치 실패로 취급(fail-closed)
  --no-agent-entrypoints
                 .claude/·.cursor/·CLAUDE.md 진입점 설치를 건너뛴다
  -h, --help     도움말

설치하는 것: workflow 스키마 2종 · reviewer persona · req.config.json ·
  AGENTS.md/CLAUDE.md·에이전트 진입점 · package.json 의 req:* 스크립트.
설치하지 않는 것: scripts/req/** 실행 코드 · tsx/ajv/cross-spawn devDependency
  (전부 commitgate 패키지에 들어 있습니다).

설치 후:
  1. codex CLI 설치 확인(리뷰 실호출용)
  2. req.config.json 조정(branchPrefix/ticketRoot 등)
  3. 설치분 커밋(안내가 stage 할 경로를 알려 줍니다)
  4. 첫 티켓 생성:
       npm  → npm run req:new -- <slug> --run
       pnpm → pnpm req:new <slug> --run
       yarn → yarn req:new <slug> --run`)
}

export function main(argv: string[]): void {
  const opts = parseArgs(argv)
  const r = runInit(opts)
  const tag = r.dryRun ? '[dry-run] ' : ''
  console.log(`${tag}commitgate 설치: ${r.targetRoot}`)
  console.log(`${tag}  packageManager 감지: ${r.packageManager}`)
  console.log(`${tag}  복사 ${r.copied.length}개 / 스킵(기존) ${r.skipped.length}개`)
  for (const f of r.copied) console.log(`${tag}    + ${f}`)
  for (const f of r.skipped) console.log(`${tag}    = ${f} (이미 존재)`)
  const cfgMsg =
    r.configAction === 'created'
      ? `생성(${r.configKeysAdded.join(', ')})`
      : r.configAction === 'merged'
        ? `누락키 병합(${r.configKeysAdded.join(', ')})`
        : '변경 없음(기존 유지)'
  console.log(`${tag}  req.config.json: ${cfgMsg}`)
  console.log(
    `${tag}  package.json: ${r.packageJsonAdded.length > 0 ? '추가 ' + r.packageJsonAdded.join(', ') : '변경 없음'}`,
  )
  console.log(`${tag}  AGENTS.md: ${r.agentsCreated ? '템플릿 생성' : '이미 존재(유지)'}`)
  if (r.agentEntrypointsSkipped) console.log(`${tag}  에이전트 진입점: 건너뜀(--no-agent-entrypoints)`)
  else {
    console.log(`${tag}  CLAUDE.md: ${r.claudeMdCreated ? '템플릿 생성' : '이미 존재(유지)'}`)
    if (r.agentsContractCopyCreated) console.log(`${tag}  ${KIT_AGENTS_CONTRACT_COPY_REL}: 계약 템플릿 사본 생성(AGENTS.md에 병합 후 삭제)`)
  }
  // workflow/.gitignore는 --no-agent-entrypoints와 무관하게 보고(D13).
  console.log(`${tag}  ${KIT_GITIGNORE.dest}: ${r.workflowGitignoreCreated ? '생성' : '이미 존재(유지)'}`)
  if (r.gitIgnoredArtifacts.length > 0)
    console.log(`${tag}  .gitignore로 제외되는 산출물: ${r.gitIgnoredArtifacts.join(', ')}`)
  const dirtyCount = r.preexistingDirty.staged.length + r.preexistingDirty.overlapping.length + r.preexistingDirty.unrelated.length
  if (dirtyCount > 0)
    console.log(
      `${tag}  설치 전 워킹트리: staged ${r.preexistingDirty.staged.length} / 설치분과 겹침 ${r.preexistingDirty.overlapping.length} / 무관 ${r.preexistingDirty.unrelated.length}`,
    )
  if (r.crossSpawnFloorWarned) console.log(`${tag}  ⚠️ cross-spawn 버전 하한 경고(위 참조) — 강제 중단은 --strict`)
  if (!r.dryRun) for (const line of installGuidance(r)) console.log(line)
}

/**
 * CLI 경계: main을 실행하되 사전조건 미충족 등 예상된 실패(throw)는
 * raw 스택트레이스가 아니라 친절한 한 줄 메시지 + 종료코드 1로 표면화한다.
 * (에러 문구 자체가 이미 조치 안내를 담고 있어 스택트레이스는 노이즈일 뿐 — REQ 후속 UX 개선.)
 * bin/commitgate.mjs 런처와 직접 실행(`tsx bin/init.ts`)이 공유하는 단일 경계.
 */
export function runCli(argv: string[]): void {
  try {
    main(argv)
  } catch (err) {
    console.error(`commitgate: ${err instanceof Error ? err.message : String(err)}`)
    process.exitCode = 1
  }
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href
if (isMain) runCli(process.argv.slice(2))
