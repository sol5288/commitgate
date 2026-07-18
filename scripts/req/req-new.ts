#!/usr/bin/env tsx
/**
 * req:new — AI REQ 워크플로우 1차 (단계 4A): REQ 티켓 + feat/req-* 브랜치 생성.
 *
 * 설계 근거: DEC-WF-020(D11) — REQ는 main에서 feat/req-* 브랜치로 시작한다.
 *   - state.json은 **BOM 없이** 생성(Node, review-codex의 writeState 재사용).
 *   - 기본 dry-run(계획 출력), `--run` 시 실제 브랜치 생성·티켓 파일·스캐폴드 커밋.
 *   - REQ id 채번은 registry 미사용(1차) — workflow/REQ-* 디렉터리 스캔으로 max+1.
 *
 * 사용: req:new <slug> [--run] [--risk LOW|HIGH] [--title "..."] [--successor-of <REQ-id>]
 *   --successor-of: 대체 REQ. 부모에 replace 종결(human-resolution) 기록이 있어야 하며, 없으면 fail-closed
 *     (티켓 미생성). lineage는 부모 state에서 읽는다(REQ-2026-029 A-2b).
 */
import { mkdirSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'
import { writeState, loadState, resolveSuccessorLineage, type WorkflowState, type SuccessorOf } from './review-codex'
import { loadConfig, packageRoot, buildScriptInvocation, type DesignDocs, type PackageManager } from './lib/config'
import { createGitAdapter, type GitAdapter } from './lib/adapters'
import { parseStatusZ, formatStatusEntry, STATUS_Z_ARGS, type StatusEntry } from './lib/porcelain'
import { isToolOutputScratch } from './lib/scratch'

// 모든 git 호출은 GitAdapter 경유(D-017-3). main()이 loadConfig 후 config.root로 재생성(기본 = packageRoot — 현재 동작 보존).
let gitAdapter: GitAdapter = createGitAdapter(packageRoot())

function git(args: string[]): string {
  return gitAdapter.exec(args)
}

/**
 * `req:new` 전용 clean-tree 위반 목록(REQ-2026-012 D7·D8).
 *
 * 허용하는 것은 기존 티켓 직계의 **untracked 도구 산출물** 두 종류뿐이다. `state.json`, `responses/**`,
 * staged-only 변경, rename/copy 등 그 밖의 모든 상태는 그대로 위반이다. review용
 * `findUnstagedOrUntracked`는 staged-only(`M `)를 통과시키므로 여기서 재사용하지 않는다.
 */
export function findReqNewDirtyEntries(rawStatusZ: string, ticketRoot: string): StatusEntry[] {
  return parseStatusZ(rawStatusZ).filter((entry) => !isToolOutputScratch(entry, ticketRoot))
}

/** slug 검증: kebab-case(a-z0-9, '-' 구분). */
export function validateSlug(slug: string): void {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))
    throw new Error(`slug는 kebab-case(a-z0-9, '-' 구분)여야 함: "${slug}"`)
}

/** REQ id 채번(순수): 같은 연도 기존 id의 max+1, 3자리 zero-pad. */
export function nextReqId(year: number, existingIds: string[]): string {
  const prefix = `REQ-${year}-`
  const maxN = existingIds
    .filter((id) => id.startsWith(prefix))
    .map((id) => Number.parseInt(id.slice(prefix.length), 10))
    .filter((n) => Number.isFinite(n))
    .reduce((a, b) => Math.max(a, b), 0)
  return `${prefix}${String(maxN + 1).padStart(3, '0')}`
}

export function branchName(reqId: string, slug: string, branchPrefix: string): string {
  return `${branchPrefix}${reqId.replace(/^REQ-/, '')}-${slug}`
}

/**
 * `--run` 성공 후 다음 단계 안내(DEC-011-1). **config 로드 이후**이므로 pm별 실행 형식으로 파생한다.
 *
 * ⚠️ `DEFAULTS.packageManager`(= `'pnpm'`)를 폴백으로 쓰지 마라. `bin/init.ts`의 감지 폴백은 `'npm'`이라
 * 두 값이 갈라져 있고, 그걸 문구에 끌어오면 npm 프로젝트가 pnpm 명령을 안내받는다 — 이 REQ가 고치는 결함이다.
 * config가 없는 지점(헤더 주석·early throw)은 pm-중립 bare 표기를 쓴다.
 */
export function nextStepHint(pm: PackageManager, reqId: string): string {
  const id = reqId.replace(/^REQ-/, '')
  return `코드 변경 → git add → ${buildScriptInvocation(pm, 'req:review-codex', [id, '--run']).join(' ')}`
}

export function buildInitialState(reqId: string, branch: string, risk: 'LOW' | 'HIGH', successorOf?: SuccessorOf): WorkflowState {
  return {
    id: reqId,
    branch,
    phase: 'INTAKE',
    risk_level: risk,
    codex_thread_id: null,
    review_base_sha: null,
    review_diff_hash: null,
    approved_diff_hash: null,
    commit_allowed: false,
    // DEC-WF-027 design-first / phase-gated 상태(Phase 2 도입). design 승인·phase 추적은 후속 단계에서 사용.
    design_approved: false,
    design_approved_hash: null,
    current_phase: null,
    phases: [],
    // REQ-016 A1(D-016-6): grandfathering 트리거 — 신규 REQ는 승인 증거를 강제(FAIL), legacy(필드 부재)는 WARN.
    approval_evidence_required: true,
    // REQ-2026-027 D1: review series 모델 버전. 첫 리뷰 전에도 존재해 "새 ticket(레코드 없음)"과
    // "legacy(필드 부재)"를 구분한다. 필드 부재 = legacy → 새 재리뷰 시 AWAIT_HUMAN/throw(자동 초기화 금지).
    review_series_model_version: 1,
    // REQ-2026-029 D3: 대체 REQ면 부모 lineage(--successor-of). 빈 review_series로 새 예산 — 부모 이력만 보존.
    ...(successorOf ? { successor_of: successorOf } : {}),
  } as WorkflowState
}

function listExistingReqIds(workflowDir: string): string[] {
  if (!existsSync(workflowDir)) return []
  return readdirSync(workflowDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^REQ-\d{4}-\d+$/.test(d.name))
    .map((d) => d.name)
}

export interface Opts {
  slug: string | null
  risk: 'LOW' | 'HIGH'
  title: string | null
  run: boolean
  root: string | null
  successorOf: string | null // REQ-2026-029 D3: 부모 REQ id(대체 REQ lineage)
}

/** 인자 파싱(fail-closed): 잘못된 --risk·값 누락·알 수 없는 옵션은 즉시 throw(조용한 fallback 금지). */
export function parseArgs(argv: string[]): Opts {
  const o: Opts = { slug: null, risk: 'LOW', title: null, run: false, root: null, successorOf: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === undefined) continue
    // bare `--`는 POSIX end-of-options 마커(DEC-011-3). pnpm/yarn은 이를 스크립트에 그대로 넘긴다.
    if (a === '--') {
      continue
    } else if (a === '--run') {
      o.run = true
    } else if (a === '--root') {
      const v = argv[++i]
      if (v === undefined) throw new Error('--root 값 필요')
      o.root = v
    } else if (a === '--successor-of') {
      const v = argv[++i]
      if (v === undefined) throw new Error('--successor-of 값 필요(부모 REQ id)')
      o.successorOf = v
    } else if (a === '--risk') {
      const v = argv[++i]
      if (v !== 'LOW' && v !== 'HIGH')
        throw new Error(`--risk 값은 LOW 또는 HIGH여야 함 (받음: ${v ?? '(없음)'})`)
      o.risk = v
    } else if (a === '--title') {
      const v = argv[++i]
      if (v === undefined) throw new Error('--title 값 필요')
      o.title = v
    } else if (a.startsWith('-')) {
      throw new Error(`알 수 없는 옵션: ${a}`)
    } else {
      o.slug = a
    }
  }
  return o
}

export function main(argv: string[] = process.argv.slice(2)): void {
  const o = parseArgs(argv)
  // ⚠️ loadConfig 이전이라 pm을 모른다 → pm-중립 bare 표기(DEFAULTS 폴백 금지, DEC-011-1).
  if (!o.slug) throw new Error('slug 필요 (예: req:new camera-hardfail --run)')
  validateSlug(o.slug)

  const cfg = loadConfig({ root: o.root })
  gitAdapter = createGitAdapter(cfg.root) // 모든 git 호출 cwd = config.root
  const dd: DesignDocs = cfg.designDocs

  const year = new Date().getFullYear()
  const reqId = nextReqId(year, listExistingReqIds(cfg.workflowDirAbs))
  const branch = branchName(reqId, o.slug, cfg.branchPrefix)
  const ticketDir = join(cfg.workflowDirAbs, reqId)
  // config 문자열이 `.`·`workflow/.`처럼 같은 위치를 다르게 표현해도 Git이 내는 canonical repo-relative 경로와 맞춘다.
  const ticketRootRel = relative(cfg.root, cfg.workflowDirAbs).replace(/\\/g, '/')
  const ticketRel = relative(cfg.root, ticketDir).replace(/\\/g, '/')

  // REQ-2026-029 D3: --successor-of lineage 해소. **branch 생성·mkdir 前**에 검증(design-r01 observation) —
  // 부모 없음·replace 기록 없음·형식 위반이면 여기서 throw해 티켓이 생성되지 않는다(R6 fail-closed).
  let successorOf: SuccessorOf | undefined
  if (o.successorOf !== null) {
    const parentId = o.successorOf.startsWith('REQ-') ? o.successorOf : `REQ-${o.successorOf}`
    const parentDir = join(cfg.workflowDirAbs, parentId)
    let parentState: WorkflowState
    try {
      parentState = loadState(parentDir)
    } catch {
      throw new Error(`--successor-of ${parentId}: 부모 티켓 state를 읽을 수 없다(${parentDir})`)
    }
    // recorded_at은 자식 생성 시각(부모 값 아님). dry-run에선 검증만 하고 값은 버린다.
    successorOf = resolveSuccessorLineage(parentState, parentId, new Date().toISOString())
  }

  if (!o.run) {
    console.log('[req:new] DRY-RUN (--run 시 실제 생성)')
    console.log(`  REQ    : ${reqId}`)
    console.log(`  branch : ${branch}`)
    console.log(`  ticket : ${ticketRel}/ (state.json·${dd.requirement}·${dd.design}·${dd.plan}·codex-request.md)`)
    console.log(`  risk   : ${o.risk}`)
    if (successorOf) console.log(`  successor_of : ${successorOf.req_id} (부모 ${successorOf.parent_attempts_total}회 · replace 승인 확인)`)
    return
  }

  // 클린 트리 요구(새 브랜치 깨끗이 시작 — 의도 변경 섞임 방지).
  // 단, gitignore 규칙이 없는 레거시 설치본도 기존 티켓의 순수 untracked 도구 산출물만 좁게 허용한다(D6·D7).
  const dirtyEntries = findReqNewDirtyEntries(git([...STATUS_Z_ARGS]), ticketRootRel)
  if (dirtyEntries.length > 0) {
    const dirty = dirtyEntries.map(formatStatusEntry).join('\n')
    throw new Error(
      `워킹트리가 clean이어야 req:new --run 가능:\n${dirty}\n` +
        `힌트: 방금 \`npx commitgate\`를 실행했다면 **설치분만** 먼저 커밋하십시오(\`git add -A\` 금지 —\n` +
        `      무관한 변경·.env가 함께 커밋되고, 이어지는 req:review-codex가 그것을 외부로 전송합니다).\n` +
        `      설치 출력의 "다음:" 안내가 stage할 정확한 경로 목록을 알려 줍니다.`,
    )
  }
  const cur = git(['rev-parse', '--abbrev-ref', 'HEAD'])
  if (cur !== 'main') console.warn(`⚠️  현재 브랜치가 main이 아님(${cur}) — REQ는 main에서 시작 권장(DEC-WF-020)`)

  git(['checkout', '-b', branch]) // D11/DEC-WF-020: feat/req-* 생성·체크아웃
  mkdirSync(ticketDir, { recursive: true })
  writeState(ticketDir, buildInitialState(reqId, branch, o.risk, successorOf))
  writeFileSync(join(ticketDir, dd.requirement), `# ${reqId} 요구사항\n\n${o.title ?? '(요구사항 작성)'}\n`, 'utf8')
  // DEC-WF-027 design-first: design·plan 스캐폴드도 함께 생성 — 첫 --kind design 리뷰가 문서 누락으로 fail-closed 되지 않게.
  writeFileSync(
    join(ticketDir, dd.design),
    `# ${reqId} 설계\n\n> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.\n\n## 현재 상태(변경 대상)\n\n## 핵심 설계 결정\n\n## Phase별 구현\n\n## 변경 파일\n\n## 하위호환·안전\n`,
    'utf8',
  )
  writeFileSync(
    join(ticketDir, dd.plan),
    `# ${reqId} 계획 — phase 분해 (DEC-WF-027 §9.0)\n\n설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**\n\n> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 ${cfg.granularityMaxFiles}파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님). 큰 phase는 런타임 분할(예: B→B1/B2/B3)로 검수 면적을 줄인다.\n\n## Phase 1 — (제목) (\`phase-1-...\`)\n범위:\nExit: eslint0·typecheck0 · 단위 그린 · Codex phase 리뷰 승인.\n\n## 완료\n- 게이트 해당분(unit·typecheck·lint) · 사용자 main 머지(별도 승인).\n`,
    'utf8',
  )
  writeFileSync(
    join(ticketDir, 'codex-request.md'),
    `# ${reqId} 리뷰 요청\n\n## 배경\n\n## 변경 요약\n\n## 리뷰 포인트\n`,
    'utf8',
  )
  git(['add', ticketRel])
  git(['commit', '-m', `chore(req): ${reqId} 티켓 생성`])

  console.log(`[req:new] 생성 완료: ${reqId}`)
  console.log(`  branch : ${branch} (체크아웃됨)`)
  console.log(`  ticket : ${ticketRel}/  (스캐폴드 커밋)`)
  console.log(`  다음   : ${nextStepHint(cfg.packageManager, reqId)}`)
}

/** bin dispatch 진입점(친절한 1줄 오류 + exit 1 경계). 직접 `tsx` 실행은 아래 `if (isMain) main()`이 그대로 담당(하위호환). */
export function runCli(argv: string[]): void {
  try {
    main(argv)
  } catch (err) {
    console.error(`commitgate: ${err instanceof Error ? err.message : String(err)}`)
    process.exitCode = 1
  }
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href
if (isMain) main()
