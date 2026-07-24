/**
 * 승인 증거(evidence) 정본 — `approvals.jsonl` 매니페스트 모델·검증과 그 보조 술어의 **단일 지점** (REQ-2026-048 DEC-1).
 *
 * **왜 별도 모듈인가**: design 승인 경로(`review-codex`)와 커밋 경로(`req-commit`)가 **같은 증거 내구화 로직**을
 * 써야 하는데, 기존엔 그 로직이 `req-commit`에 있고 `req-commit → review-codex` 방향 import가 이미 있었다.
 * `review-codex`가 `req-commit`을 부르면 **런타임 순환**이 된다. 그래서 공통 부분을 leaf로 내린다.
 *
 * 🔴 **이 파일은 leaf여야 한다.** 런타임 import는 `./scratch`(그 자신도 leaf) 하나뿐이고, `review-codex`에서는
 *    **타입만**(`import type` — 컴파일 시 소거) 가져온다. 여기에 `../review-codex`·`../req-doctor`·`../req-commit`의
 *    **값(런타임) import를 추가하는 순간 순환이 되살아난다** — `tests/unit/evidence-module.test.ts`가 이를 고정한다.
 *
 * ⚠️ 원래 위치에서 **이동**해 온 것들이며 동작은 바뀌지 않았다. 기존 호출부·테스트가 깨지지 않도록
 *    `review-codex`(`archiveBaseName`·`isValidIsoInstant`)·`req-doctor`(`isConfinedArchivePath`)·
 *    `req-commit`(나머지)이 각각 **re-export**한다.
 */
import { isArchiveFileName } from './scratch'
import type { ApprovalEvidence, ReviewKind } from '../review-codex'

// ─────────────────────────────────────────────────────── 공통 형식 술어 ──

const SHA256_RE = /^[0-9a-f]{64}$/i
const GIT_OID_RE = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/i // git OID: 40(SHA-1) 또는 64(SHA-256)
const REVIEW_ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * ISO instant 유효성(REQ-2026-028 D2). **형식 + 달력 유효성 둘 다**(design-r02·r03).
 * `REVIEW_ISO_RE`만으론 `2026-99-99T99:99:99Z`가 통과하므로, 재파싱해 성분(연·월·일·시·분·초)이 보존되는지 확인.
 * 밀리초 표기 차(`08Z` vs `08.000Z`)는 비교에서 무시 — 성분이 맞으면 유효.
 */
export function isValidIsoInstant(s: unknown): boolean {
  if (typeof s !== 'string' || !REVIEW_ISO_RE.test(s)) return false
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return false
  // 재직렬화 후 초까지 성분 비교(밀리초 절단). `2026-99-99...`는 여기서 불일치로 걸린다.
  const canon = (x: string): string => x.replace(/\.\d+Z$/, 'Z').replace(/Z$/, '')
  return canon(d.toISOString()) === canon(s)
}

/** 아카이브 base(round namespace): design은 'design'(phaseId 무시), phase는 phaseId(없으면 'phase'=레거시). */
export function archiveBaseName(kind: ReviewKind, phaseId: string | null): string {
  return kind === 'design' ? 'design' : phaseId && phaseId.length > 0 ? phaseId : 'phase'
}

/**
 * evidence `response_path`가 **현재 티켓 `responses/` 직계 아카이브**인지(D-016 confinement).
 * 절대경로·`..`·다른 티켓·중첩경로·`approvals.jsonl` 등 비아카이브는 거부. ticketRel 미지정 시 false(fail-closed).
 */
export function isConfinedArchivePath(p: string, ticketRel: string | undefined): boolean {
  if (!ticketRel || typeof p !== 'string' || !p) return false
  const norm = p.replace(/\\/g, '/')
  if (norm.includes('..') || norm.startsWith('/') || /^[a-zA-Z]:\//.test(norm)) return false
  const prefix = `${ticketRel.replace(/\\/g, '/').replace(/\/+$/, '')}/responses/`
  if (!norm.startsWith(prefix)) return false
  const name = norm.slice(prefix.length)
  if (!name || name.includes('/')) return false
  return isArchiveFileName(name)
}

// ───────────────────────────────── approvals.jsonl 매니페스트 모델 (B1) ──

/** HIGH 사람확인 감사 기록(암호학적 증명 아님 — D-016-8). */
export interface UserCommitConfirmed {
  confirmed: boolean
  method: string
  confirmed_at: string
  note?: string
}

/**
 * 이 승인에 이르는 라운드 아카이브 1건(REQ-2026-048 DEC-2).
 *
 * **왜 파일명 sweep이 아니라 목록인가**: 디스크 스캔은 실행 시점 디렉터리 상태에 의존해 **재현 불가**다
 * (나중에 파일이 늘거나 지워지면 결과가 달라진다). 경로+sha로 매니페스트에 박으면 사후 감사에서
 * **재검증**할 수 있고, DONE 게이트가 이 목록을 그대로 오라클로 쓴다.
 */
export interface ArchiveInventoryItem {
  response_path: string
  sha256: string
}

/** approvals.jsonl 한 줄(D-016-3b). kind 격리: phase=approved_tree, design=design_hash. */
export interface ManifestEntry {
  kind: ReviewKind
  phase_id: string | null
  response_path: string
  response_sha256: string
  review_base_sha: string
  approved_tree?: string
  design_hash?: string
  approved_at: string
  consumed_at: string
  consumed_by_commit_sha: string
  user_commit_confirmed: UserCommitConfirmed | null
  /**
   * REQ-2026-048 DEC-2 — 이 승인 시점의 라운드 아카이브 전부(needs-fix 포함, 승인본 자기 자신 포함).
   *
   * **선택 필드**다: 부재해도 매니페스트 검증은 통과한다(기존 행 무회귀). 단 내구성 marker가 켜진 신규
   * 티켓에서는 DONE 게이트가 design 행의 이 필드 부재를 **BLOCKED**로 본다 — 검증의 관대함(legacy 호환)과
   * 완료 판정의 엄격함(신규)을 분리한다.
   *
   * 현재 **design 행만 채운다**. phase 경로는 `expectedArchivePaths`가 이미 needs-fix까지 stage하므로
   * 인벤토리가 필요 없다. 다만 phase 행에서 이 필드를 *금지*하지는 않는다 — 새 금지 규칙은 설계 범위 밖이고,
   * 형식 검증은 kind와 무관하게 동일하게 적용된다.
   */
  archive_inventory?: ArchiveInventoryItem[]
}

/** approvals.jsonl 엔트리 허용 top-level 키(이 외 = 주입/오염 → fail). */
const MANIFEST_KEYS = new Set([
  'kind',
  'phase_id',
  'response_path',
  'response_sha256',
  'review_base_sha',
  'approved_tree',
  'design_hash',
  'approved_at',
  'consumed_at',
  'consumed_by_commit_sha',
  'user_commit_confirmed',
  'archive_inventory', // REQ-2026-048 DEC-2(선택 — 부재해도 유효)
])

/**
 * 이 승인의 아카이브 인벤토리 산출(순수 — sha 계산은 주입).
 *
 * **수집 범위(결정적 정의)**: 현재 티켓 `responses/` **직계**의 `kind` 아카이브 **전부**
 * (`archiveBaseName(kind, phaseId)` 매처 — `-approved`·`-needs-fix` 모두). round(rNN) **오름차순**으로 정렬해
 * 디렉터리 읽기 순서에 비의존하게 만든다(`expectedArchivePaths`와 동일 기법).
 *
 * **재승인 시**: 그 시점의 전부를 다시 담으므로 이전 라운드를 포함한다. 각 행이 "그 승인 시점의 완전한 상태"라는
 * 의미로 일관되고, DONE 게이트는 **가장 마지막 design 행**을 본다. stale 아카이브를 골라내는 휴리스틱은 두지 않는다
 * (재현 불가능해진다).
 *
 * @param shaOf repo-상대 경로 → sha256(hex). 호출부가 파일을 읽어 주입(이 모듈은 fs를 모른다).
 */
export function buildArchiveInventory(
  archiveNames: string[],
  kind: ReviewKind,
  phaseId: string | null,
  ticketRel: string,
  shaOf: (repoRelPath: string) => string,
): ArchiveInventoryItem[] {
  return expectedArchivePaths(archiveNames, kind, phaseId, ticketRel).map((p) => ({
    response_path: p,
    sha256: shaOf(p),
  }))
}

/**
 * design evidence 커밋에 stage할 repo-상대 경로(순수, 결정적).
 *
 * = **인벤토리 전량**(needs-fix 포함) + 승인본 + `approvals.jsonl`. 중복은 제거하고 순서는 입력 순서를 따른다.
 * 승인본은 정상 경로에서 인벤토리에 이미 들어 있지만, 인벤토리가 비는 이례적 상황(디렉터리 조회 실패 등)에서도
 * **최소한 승인 증거는 남도록** 명시적으로 합류시킨다.
 *
 * 🔴 `approvals.jsonl` 외에는 **티켓 `responses/` 밖 경로가 절대 섞이지 않는다** — 호출부의 leak 가드
 * (`responses/` 외 staged 금지)와 이중으로, 무관한 index 변경이 evidence 커밋에 딸려 들어가지 못하게 한다.
 */
export function designEvidenceStagePaths(
  inventory: readonly ArchiveInventoryItem[],
  responsePath: string,
  ticketRel: string,
  /**
   * 리뷰 원장이 디스크에 **존재하는가**(REQ-2026-051 D7). 존재할 때만 pathspec에 합류시킨다 —
   * 없는 경로를 넣으면 `commitPaths`가 실패해 승인 증거 커밋 **전체**가 무산된다(원장 때문에 승인
   * 증거를 잃는 것은 본말전도다).
   * 생략 가능: 기존 3-arg 호출부를 깨지 않는다.
   */
  ledgerExists = false,
): string[] {
  const dir = `${ticketRel.replace(/\\/g, '/').replace(/\/+$/, '')}/responses`
  const archives = [...inventory.map((i) => i.response_path), responsePath].filter(
    (p) => typeof p === 'string' && p.length > 0 && isConfinedArchivePath(p, ticketRel),
  )
  const tail = ledgerExists ? [`${dir}/approvals.jsonl`, `${dir}/review-ledger.jsonl`] : [`${dir}/approvals.jsonl`]
  return [...new Set([...archives, ...tail])]
}

/** 인벤토리 항목의 형식 문제 목록(순수). 빈 배열 = 정상. `line N: ` 접두는 호출부가 붙인다. */
function archiveInventoryProblems(inv: unknown, ticketRel: string): string[] {
  const out: string[] = []
  if (!Array.isArray(inv)) return ['archive_inventory가 배열 아님']
  const seen = new Set<string>()
  for (let i = 0; i < inv.length; i++) {
    const it = inv[i] as { response_path?: unknown; sha256?: unknown } | null
    const at = `archive_inventory[${i}]`
    if (!it || typeof it !== 'object' || Array.isArray(it)) {
      out.push(`${at}: object 아님`)
      continue
    }
    for (const k of Object.keys(it)) if (k !== 'response_path' && k !== 'sha256') out.push(`${at}: 예상 외 필드: ${k}`)
    const p = typeof it.response_path === 'string' ? it.response_path : ''
    // ⚠️ 인벤토리는 **needs-fix 이름을 허용**한다(라운드 전체 보존이 목적). 행 최상위 `response_path`의
    //    "-approved.json만" 규칙과는 의미가 다르다 — 그 규칙은 여기 적용하지 않는다.
    if (!isConfinedArchivePath(p, ticketRel)) out.push(`${at}: response_path 비confined: ${p}`)
    else if (seen.has(p)) out.push(`${at}: 중복 response_path: ${p}`)
    else seen.add(p)
    if (typeof it.sha256 !== 'string' || !SHA256_RE.test(it.sha256)) out.push(`${at}: sha256 형식 오류(64hex)`)
  }
  return out
}

/**
 * user_commit_confirmed 감사 기록 형식 검증(순수). 유효하면 null, 아니면 사유.
 * 요구: confirmed===true · method(공백 아닌 문자열) · confirmed_at(ISO).
 * ⚠️ 위조불가 증명이 아니다 — Claude가 생성 가능한 플래그. 가장 강한 보장 = 사용자가 직접 `req:commit` 실행.
 */
export function userConfirmProblem(ucc: unknown): string | null {
  if (!ucc || typeof ucc !== 'object') return '기록 없음'
  const c = ucc as { confirmed?: unknown; method?: unknown; confirmed_at?: unknown }
  if (c.confirmed !== true) return 'confirmed=true 아님'
  if (typeof c.method !== 'string' || !c.method.trim()) return 'method(공백 아닌 문자열) 필요'
  if (!isValidIsoInstant(c.confirmed_at)) return 'confirmed_at(ISO) 필요'
  return null
}

/**
 * 승인 증거(state pin)와 소비 정보로 매니페스트 엔트리 생성(순수, 고정 필드·키 순서).
 * kind 격리: phase→approved_tree만, design→design_hash만(반대 kind 필드 미포함).
 */
export function buildManifestEntry(
  ev: ApprovalEvidence,
  consume: {
    consumedAt: string
    consumedByCommitSha: string
    userCommitConfirmed: UserCommitConfirmed | null
    /** REQ-2026-048 DEC-2. 지정 시에만 행에 포함(미지정 = 필드 자체 부재 → 기존 행과 바이트 동일). */
    archiveInventory?: ArchiveInventoryItem[]
  },
): ManifestEntry {
  const base: ManifestEntry = {
    kind: ev.review_kind,
    phase_id: ev.phase_id ?? null,
    response_path: ev.response_path,
    response_sha256: ev.response_sha256,
    review_base_sha: ev.review_base_sha,
    approved_at: ev.approved_at,
    consumed_at: consume.consumedAt,
    consumed_by_commit_sha: consume.consumedByCommitSha,
    user_commit_confirmed: consume.userCommitConfirmed,
  }
  // 미지정이면 키 자체를 넣지 않는다 — 기존 행과 바이트 동일(하위호환).
  const inv = consume.archiveInventory ? { archive_inventory: consume.archiveInventory } : {}
  // fail-fast: kind별 필수 바인딩 필드(phase=approved_tree, design=design_hash). 반대 kind 필드는 미포함.
  if (ev.review_kind === 'design') {
    const designHash = ev.design_hash
    if (typeof designHash !== 'string' || !designHash)
      throw new Error('buildManifestEntry: design evidence에 design_hash 누락(fail-fast)')
    return { ...base, phase_id: null, design_hash: designHash, ...inv }
  }
  const approvedTree = ev.approved_tree
  if (typeof approvedTree !== 'string' || !approvedTree)
    throw new Error('buildManifestEntry: phase evidence에 approved_tree 누락(fail-fast)')
  return { ...base, approved_tree: approvedTree, ...inv }
}

/** 매니페스트 한 줄 직렬화(JSONL): JSON + 끝 개행. 고정 키 순서라 deterministic. */
export function serializeManifestLine(entry: ManifestEntry): string {
  return `${JSON.stringify(entry)}\n`
}

/**
 * approvals.jsonl 내용 검증(순수, fail-closed). 문제 목록 반환(빈 배열=정상).
 * 검사: malformed JSONL · response_path confinement(현재 티켓 responses/ 직계) · SHA-256 형식 ·
 *   phase kind의 phase_id 유효성 · (kind,phase_id,sha) 중복/주입.
 */
export function validateManifest(content: string, opts: { ticketRel: string; validPhaseIds: string[] }): string[] {
  const problems: string[] = []
  const seenKey = new Set<string>()
  const seenPath = new Set<string>()
  const lines = content.split('\n').map((l) => l.trim()).filter(Boolean)
  for (let i = 0; i < lines.length; i++) {
    const ln = i + 1
    let e: Record<string, unknown>
    try {
      e = JSON.parse(lines[i] as string) as Record<string, unknown>
    } catch {
      problems.push(`line ${ln}: malformed JSON`)
      continue
    }
    if (!e || typeof e !== 'object' || Array.isArray(e)) {
      problems.push(`line ${ln}: object 아님`)
      continue
    }
    // 예상 외 extra field 금지(주입 차단).
    for (const k of Object.keys(e)) if (!MANIFEST_KEYS.has(k)) problems.push(`line ${ln}: 예상 외 필드: ${k}`)
    const kind = e.kind
    if (kind !== 'phase' && kind !== 'design') problems.push(`line ${ln}: kind 비유효: ${String(kind)}`)
    // 공통: 경로 confinement, sha/OID/ISO 형식.
    const respPath = typeof e.response_path === 'string' ? e.response_path : ''
    if (!isConfinedArchivePath(respPath, opts.ticketRel)) problems.push(`line ${ln}: response_path 비confined: ${respPath}`)
    // B1-P2-1: manifest 행(=소비된 승인)의 response_path basename은 그 행의 kind/phase_id **승인본**(-approved)이어야.
    // (design→phase 아카이브·타 phase·needs-fix 가리키는 주입/변조 차단. expectedArchivePaths[chore 대상]는 needs-fix 포함 별개.)
    if (kind === 'phase' || kind === 'design') {
      const expBase = archiveBaseName(kind, kind === 'phase' && typeof e.phase_id === 'string' ? e.phase_id : null)
      const name = respPath.split('/').pop() ?? ''
      if (!new RegExp(`^${escapeRegExp(expBase)}-r\\d{2,}-approved\\.json$`).test(name))
        problems.push(`line ${ln}: response_path가 ${expBase}-rNN-approved.json 아님: ${name}`)
    }
    if (typeof e.response_sha256 !== 'string' || !SHA256_RE.test(e.response_sha256)) problems.push(`line ${ln}: response_sha256 형식 오류(64hex)`)
    if (typeof e.review_base_sha !== 'string' || !GIT_OID_RE.test(e.review_base_sha)) problems.push(`line ${ln}: review_base_sha 비-OID`)
    if (typeof e.consumed_by_commit_sha !== 'string' || !GIT_OID_RE.test(e.consumed_by_commit_sha)) problems.push(`line ${ln}: consumed_by_commit_sha 비-OID`)
    if (!isValidIsoInstant(e.approved_at)) problems.push(`line ${ln}: approved_at 비-ISO`)
    if (!isValidIsoInstant(e.consumed_at)) problems.push(`line ${ln}: consumed_at 비-ISO`)
    // kind별 strict 바인딩(반대 kind 필드 금지).
    if (kind === 'phase') {
      if (typeof e.phase_id !== 'string' || !e.phase_id || !opts.validPhaseIds.includes(e.phase_id))
        problems.push(`line ${ln}: phase_id 비유효: ${String(e.phase_id)}`)
      if (typeof e.approved_tree !== 'string' || !GIT_OID_RE.test(e.approved_tree)) problems.push(`line ${ln}: approved_tree 비-OID`)
      if ('design_hash' in e) problems.push(`line ${ln}: phase entry에 design_hash 금지`)
    } else if (kind === 'design') {
      if (e.phase_id !== null) problems.push(`line ${ln}: design entry는 phase_id=null이어야`)
      if (typeof e.design_hash !== 'string' || !SHA256_RE.test(e.design_hash)) problems.push(`line ${ln}: design_hash 비-64hex`)
      if ('approved_tree' in e) problems.push(`line ${ln}: design entry에 approved_tree 금지`)
    }
    // archive_inventory(REQ-2026-048 DEC-2): **선택** — 부재는 정상(기존 행 무회귀). 있으면 형식 검증.
    if ('archive_inventory' in e) {
      for (const p of archiveInventoryProblems(e.archive_inventory, opts.ticketRel)) problems.push(`line ${ln}: ${p}`)
    }
    // user_commit_confirmed: null 또는 유효 감사 기록(confirmed=true·method·ISO confirmed_at)만. (B2-block3)
    const ucc = e.user_commit_confirmed
    if (ucc !== null) {
      const p = userConfirmProblem(ucc)
      if (p) problems.push(`line ${ln}: user_commit_confirmed ${p}(null 또는 confirmed=true·method·ISO confirmed_at)`)
    }
    // 중복: (kind/phase/sha) + response_path 두 기준 모두.
    const key = `${String(kind)}:${String(e.phase_id)}:${String(e.response_sha256)}`
    if (seenKey.has(key)) problems.push(`line ${ln}: 중복 entry(kind/phase/sha): ${key}`)
    seenKey.add(key)
    if (respPath) {
      if (seenPath.has(respPath)) problems.push(`line ${ln}: 중복 response_path: ${respPath}`)
      seenPath.add(respPath)
    }
  }
  return problems
}

/**
 * 이번 target(kind/phaseId)의 **예상 응답 아카이브 repo-경로만** 반환(blanket `git add responses/` 금지).
 * archiveNames(responses/ 디렉터리 파일명)에서 해당 base의 rNN 아카이브만 필터 → 현재 티켓 responses/ 경로로.
 * needs-fix + approved 모두 포함(evidence chore는 실패 라운드까지 영속화) — 매니페스트 행 검증(approved만)과 별개.
 */
export function expectedArchivePaths(
  archiveNames: string[],
  kind: ReviewKind,
  phaseId: string | null,
  ticketRel: string,
): string[] {
  const base = archiveBaseName(kind, phaseId)
  const re = new RegExp(`^${escapeRegExp(base)}-r(\\d{2,})-(approved|needs-fix)\\.json$`)
  const dir = `${ticketRel.replace(/\\/g, '/').replace(/\/+$/, '')}/responses`
  // readdir 순서 비의존 — round(rNN) 오름차순 정렬(deterministic).
  return archiveNames
    .map((n) => ({ n, m: isArchiveFileName(n) ? re.exec(n) : null }))
    .filter((x): x is { n: string; m: RegExpExecArray } => x.m !== null)
    .sort((a, b) => Number.parseInt(a.m[1] ?? '0', 10) - Number.parseInt(b.m[1] ?? '0', 10))
    .map((x) => `${dir}/${x.n}`)
}

/** 매니페스트에서 이 evidence identity(kind/phase_id/response_sha256)의 행을 찾는다(순수). 없으면 null. */
export function findEvidenceRow(
  content: string,
  identity: { kind: ReviewKind; phaseId: string | null; responseSha256: string },
): ManifestEntry | null {
  for (const line of content.split('\n').map((l) => l.trim()).filter(Boolean)) {
    try {
      const e = JSON.parse(line) as ManifestEntry
      if (e && typeof e === 'object' && e.kind === identity.kind && (e.phase_id ?? null) === identity.phaseId && e.response_sha256 === identity.responseSha256)
        return e
    } catch {
      // malformed 줄 무시(무결성은 validateManifest 담당)
    }
  }
  return null
}

// ─────────────────────────── design evidence 내구화 (REQ-2026-048 DEC-3) ──

/**
 * 이 모듈이 부수효과를 내기 위해 쓰는 **주입 포트**. `lib/evidence`는 fs·git을 직접 모른다
 * (leaf 불변식 유지 + 실패 주입 테스트 가능).
 */
export interface EvidencePorts {
  /** 온디스크 텍스트(없으면 null). */
  readText(repoRel: string): string | null
  writeText(repoRel: string, content: string): void
  /** 티켓 `responses/` 디렉터리의 아카이브 파일명 목록. */
  listArchiveNames(): string[]
  /** 온디스크 파일 바이트의 sha256(hex). */
  sha256(repoRel: string): string
  /** `HEAD`의 blob 텍스트(없으면 null). JSONL 파싱 전용 — 바이트 정합 비교엔 쓰지 않는다. */
  headText(repoRel: string): string | null
  /**
   * 🔴 `HEAD` blob **바이트**의 sha256(없으면 null).
   * 워킹 파일로 계산하면 `core.autocrlf` 환경에서 CRLF↔LF 차이로 **거짓 불일치**가 난다 —
   * 반드시 blob 바이트로 계산해야 커밋 이력과 기록된 sha가 맞는다.
   */
  headBlobSha256(repoRel: string): string | null
  /**
   * `HEAD`에 존재하는 해당 디렉터리의 아카이브 **repo-상대 경로** 목록(REQ-2026-049 DEC-4).
   *
   * 🔴 **basename이 아니라 전체 경로**를 반환한다 — 인벤토리의 `response_path`와 같은 단위여야 집합 비교가
   *    모호해지지 않는다(하위 디렉터리를 허용하게 되어도 동명 파일 충돌이 생기지 않는다).
   * 🔴 **워킹 디렉터리를 읽지 않는다.** 워킹 트리만 고치고 HEAD는 손상된 경우를 잡는 것이 이 검사의 목적이다.
   */
  headArchivePaths(responsesDirRel: string): string[]
  /** 현재 `HEAD` 커밋 SHA. */
  headCommitSha(): string
  /**
   * 🔴 **지정한 경로만** 커밋한다(pathspec 범위). 나머지 index는 **그대로 보존**된다.
   *
   * 전체 index를 커밋하거나 "staged 전체"를 leak으로 판정하면 안 된다 — design 리뷰는 **index의 설계 문서**를
   * 대상으로 돌 수 있으므로, 설계 문서를 stage한 채 승인하는 것이 정상 경로다. 그 상태에서 index 전체를 보면
   * 자동 내구화가 **항상 실패**하고(호출부가 삼켜 승인만 남음) `--finalize-design`도 같은 가드로 실패해
   * 증거가 영원히 커밋되지 않는다(phase-3 리뷰 P1).
   */
  commitPaths(paths: string[], message: string): void
}

/** 내구화 결과. `already-durable`=진짜 no-op, `committed`=신규 기록, `recommitted`=부분 상태 복구. */
export type DurableOutcome = 'already-durable' | 'committed' | 'recommitted'

/**
 * 승인된 **design evidence를 내구화한다** — 호출자가 아는 것은 이 한 문장뿐이다(DEC-1).
 * 매니페스트 형식·stage 목록·멱등 판정은 전부 이 안에 있고, 정상 승인 경로(`review-codex`)와
 * 복구 경로(`req:commit --finalize-design`)가 **같은 구현**을 부른다 → 동작이 갈라질 수 없다.
 *
 * 🔴 **멱등은 온디스크가 아니라 `HEAD` 기준이다**(DEC-3, design r01 P1-2).
 *
 * | 온디스크 엔트리 | HEAD에 내구화됨 | 동작 |
 * |---|---|---|
 * | 없음 | — | append → stage → commit (`committed`) |
 * | 있음 | 예 | 진짜 no-op (`already-durable`) |
 * | 있음 | 아니오 | **append 없이** stage → commit 재시도 (`recommitted`) |
 *
 * 온디스크 엔트리 존재만으로 skip하면, 매니페스트 append·stage까지 되고 `git commit`만 실패한
 * 부분 상태에서 재시도가 **영구히 skip**되어 HEAD 증거를 결코 복구하지 못한다.
 */
export function durableDesignEvidence(args: {
  ticketId: string
  ticketRel: string
  evidence: ApprovalEvidence
  validPhaseIds: string[]
  nowIso: string
  ports: EvidencePorts
}): { outcome: DurableOutcome; stagePaths: string[] } {
  const { ticketRel, evidence: ev, ports } = args
  if (ev.review_kind !== 'design') throw new Error(`durableDesignEvidence: review_kind != design (${String(ev.review_kind)})`)
  const manifestRel = `${ticketRel.replace(/\\/g, '/').replace(/\/+$/, '')}/responses/approvals.jsonl`
  const opts = { ticketRel, validPhaseIds: args.validPhaseIds }
  const identity = { kind: 'design' as ReviewKind, phaseId: null, responseSha256: ev.response_sha256 }

  const existing = ports.readText(manifestRel) ?? ''
  // 기존 매니페스트 단독 무결성 먼저(오염 위에 덧쓰기 금지 — fail-closed).
  if (existing.trim()) {
    const p = validateManifest(existing, opts)
    if (p.length) throw new Error(`기존 approvals.jsonl 무결성 실패(fail-closed): ${p.join('; ')}`)
  }
  const onDiskRow = findEvidenceRow(existing, identity)

  // HEAD 내구화 판정: 매니페스트 행이 커밋돼 있고, 그 행의 인벤토리 아카이브가 전부 HEAD에 있으며 sha가 일치.
  const headRow = findEvidenceRow(ports.headText(manifestRel) ?? '', identity)
  const headInventory = headRow?.archive_inventory ?? []
  const headDurable =
    headRow !== null &&
    ports.headBlobSha256(ev.response_path) !== null &&
    headInventory.every((i) => ports.headBlobSha256(i.response_path) === i.sha256)

  if (onDiskRow && headDurable) return { outcome: 'already-durable', stagePaths: [] }

  let inventory: ArchiveInventoryItem[]
  if (onDiskRow) {
    // 부분 상태 복구: **append하지 않는다**(중복 행 금지). 기록된 인벤토리를 그대로 stage·commit 재시도.
    inventory = onDiskRow.archive_inventory ?? buildArchiveInventory(ports.listArchiveNames(), 'design', null, ticketRel, ports.sha256)
  } else {
    inventory = buildArchiveInventory(ports.listArchiveNames(), 'design', null, ticketRel, ports.sha256)
    const entry = buildManifestEntry(ev, {
      consumedAt: args.nowIso,
      consumedByCommitSha: ports.headCommitSha(),
      userCommitConfirmed: null,
      archiveInventory: inventory,
    })
    const candidate = existing + serializeManifestLine(entry)
    const problems = validateManifest(candidate, opts)
    if (problems.length) throw new Error(`design evidence 매니페스트 검증 실패: ${problems.join('; ')}`)
    ports.writeText(manifestRel, candidate)
  }

  // REQ-2026-051 D7: 원장이 있으면 같은 커밋에 싣는다. `readText`로 존재를 확인한다 — 포트 경계를
  // 넘지 않고(fs 직접 접근 금지), 없으면 pathspec에 넣지 않아 커밋이 실패하지 않는다.
  const ledgerRel = `${ticketRel.replace(/\\/g, '/').replace(/\/+$/, '')}/responses/review-ledger.jsonl`
  const ledgerExists = ports.readText(ledgerRel) !== null
  const stagePaths = designEvidenceStagePaths(inventory, ev.response_path, ticketRel, ledgerExists)
  // 🔴 가드는 **우리가 커밋할 경로**에만 건다 — index 전체가 아니다(phase-3 리뷰 P1).
  //    index 전체를 보면 설계 문서를 stage한 정상 승인 경로에서 항상 실패한다. pathspec 범위 커밋이라
  //    무관한 staged 변경은 애초에 이 커밋에 들어갈 수 없고, 커밋 후에도 index에 그대로 남는다.
  const prefix = `${ticketRel.replace(/\\/g, '/').replace(/\/+$/, '')}/responses/`
  const outside = stagePaths.filter((p) => !p.replace(/\\/g, '/').startsWith(prefix))
  if (outside.length) throw new Error(`design evidence 커밋 대상이 티켓 responses/ 밖: ${outside.join(', ')}`)
  ports.commitPaths(stagePaths, `chore(${args.ticketId}): design-finalize — design 승인 approvals.jsonl 기록`)
  return { outcome: onDiskRow ? 'recommitted' : 'committed', stagePaths }
}

// ───────────────────── DONE 게이트: 커밋된 증거 검증 (REQ-2026-048 DEC-4) ──

/** 내구성 marker 필드명. `req:new`가 스캐폴드 `state.json`에 심고 그 스캐폴드가 커밋된다. */
export const DURABILITY_MARKER = 'evidence_durability_required'

/**
 * 신규 티켓(엄격 검증 대상)인가 — 🔴 **`HEAD`의 `state.json` blob**으로 판정한다.
 *
 * 워킹 `state.json`은 **커밋되지 않는 캐시**다. 거기서 marker를 읽으면 캐시 재생성·브랜치 전환으로
 * marker가 사라진 신규 티켓이 **legacy로 오인**되어 DONE 게이트가 통째로 우회된다(design r01 P1-1).
 *
 * | HEAD blob | 판정 |
 * |---|---|
 * | 읽힘 · marker=true | **신규 → 엄격** |
 * | 읽힘 · marker 부재/false | legacy → 기존 DONE 호환 |
 * | 읽기 불가·파손 | 🔴 **엄격** — 완료 선언은 검증 가능한 상태에서만 한다(티켓 스캐폴드가 커밋돼 있지 않다는 뜻) |
 */
export function isDurabilityRequired(headStateText: string | null): boolean {
  if (headStateText === null) return true // 스캐폴드가 HEAD에 없다 → 완료 선언 대상 아님(보수적 엄격)
  try {
    const s = JSON.parse(headStateText) as Record<string, unknown>
    if (!s || typeof s !== 'object' || Array.isArray(s)) return true
    return s[DURABILITY_MARKER] === true
  } catch {
    return true // 파손 → 보수적 엄격
  }
}

/**
 * **커밋된** design 증거가 완비됐는지(순수 판정 + 포트 조회). DONE 직전 게이트가 쓴다.
 *
 * 🔴 온디스크가 아니라 **`HEAD` blob**만 본다. D17이 온디스크 아카이브로 통과한다는 사실이 이 갭을
 * 조용하게 만들었다 — 여기서 다시 온디스크를 보면 같은 사각이 재발한다.
 */
export function verifyCommittedDesignEvidence(args: {
  ticketRel: string
  ports: Pick<EvidencePorts, 'headText' | 'headBlobSha256' | 'headArchivePaths'>
}): { durable: boolean; reason: string } {
  const { ticketRel, ports } = args
  const tRel = ticketRel.replace(/\\/g, '/').replace(/\/+$/, '')
  const manifestRel = `${tRel}/responses/approvals.jsonl`
  const responsesRel = `${tRel}/responses`
  const no = (reason: string): { durable: boolean; reason: string } => ({ durable: false, reason })

  // ── 1. HEAD state 해석 가능성 ──
  // 완료 선언은 **해석 가능한 상태**에서만 한다. 파손·부재·`phases` 비배열이면 판단 근거가 없으므로 BLOCKED.
  const headState = ports.headText(`${tRel}/state.json`)
  if (headState === null) return no(`커밋된 ${tRel}/state.json 없음 — 티켓 스캐폴드가 HEAD에 없다`)
  let statePhases: unknown
  try {
    const s = JSON.parse(headState) as Record<string, unknown>
    if (!s || typeof s !== 'object' || Array.isArray(s)) return no('커밋된 state.json이 객체가 아님')
    statePhases = s.phases
  } catch {
    return no('커밋된 state.json 파싱 실패(파손)')
  }
  if (!Array.isArray(statePhases)) return no('커밋된 state.json의 phases가 배열이 아님 — phase 정보를 해석할 수 없다')

  // ── 2. 매니페스트 전체 검증 ──
  const manifest = ports.headText(manifestRel)
  if (manifest === null) return no(`커밋된 ${manifestRel} 없음`)
  /**
   * ⚠️ `validPhaseIds`는 **매니페스트 자신의 phase 행 id**로 만든다 → phase_id **멤버십 검사만** 무효화된다.
   *
   * 이유: `state.json`은 설계상 스캐폴드 이후 **재커밋되지 않으므로**(evidence 커밋은 pathspec으로 `responses/`만
   * 담는다) HEAD의 `phases`는 항상 `[]`다. 그것으로 검사하면 **정상 증거가 전부 차단**된다(실측 확인).
   * phase 행의 phase_id 바인딩은 커밋 시점에 `evidencePreflight`가 이미 강제한다.
   *
   * 🔴 무효화되는 것은 **이 한 가지뿐**이다. 스키마·경로 confinement·`-approved.json` 파일명·SHA 형식·
   *    extra field·중복/주입·design 행 제약(phase_id=null·design_hash·approved_tree 금지)은 전부 그대로 강제된다.
   */
  const manifestPhaseIds: string[] = []
  for (const line of manifest.split('\n').map((l) => l.trim()).filter(Boolean)) {
    try {
      const e = JSON.parse(line) as { kind?: unknown; phase_id?: unknown }
      if (e && e.kind === 'phase' && typeof e.phase_id === 'string') manifestPhaseIds.push(e.phase_id)
    } catch {
      // malformed는 아래 validateManifest가 잡는다
    }
  }
  const problems = validateManifest(manifest, { ticketRel: tRel, validPhaseIds: manifestPhaseIds })
  if (problems.length) return no(`커밋된 approvals.jsonl 무결성 실패: ${problems.join('; ')}`)

  // ── 3. design 행 선택(재승인이 있으면 마지막이 유효 승인) ──
  let row: ManifestEntry | null = null
  for (const line of manifest.split('\n').map((l) => l.trim()).filter(Boolean)) {
    try {
      const e = JSON.parse(line) as ManifestEntry
      if (e && typeof e === 'object' && e.kind === 'design') row = e
    } catch {
      // 위에서 이미 걸러졌다
    }
  }
  if (!row) return no('커밋된 approvals.jsonl에 design 승인 행이 없음')

  // ── 4. top-level SHA 대조 ── 🔴 "존재"가 아니라 "일치"를 본다.
  const approvedHeadSha = ports.headBlobSha256(row.response_path)
  if (approvedHeadSha === null) return no(`승인 아카이브가 HEAD에 없음: ${row.response_path}`)
  if (approvedHeadSha !== row.response_sha256)
    return no(`승인 아카이브 SHA 불일치(HEAD ≠ manifest): ${row.response_path}`)

  // ── 5. inventory 비어있지 않음 ── 🔴 `[]`는 `every()`가 공허 참이라 과거 구현이 통과시켰다.
  const inv = row.archive_inventory
  if (!Array.isArray(inv)) return no('design 행에 archive_inventory 없음(구버전 형식 — 재-finalize 필요)')
  if (inv.length === 0) return no('archive_inventory가 비어 있음 — 라운드 증거가 하나도 기록되지 않았다')

  // ── 6. 승인본이 정확한 SHA로 인벤토리에 포함 ──
  const self = inv.find((i) => i.response_path === row.response_path)
  if (!self) return no(`archive_inventory에 승인 아카이브가 없음: ${row.response_path}`)
  if (self.sha256 !== row.response_sha256)
    return no(`archive_inventory의 승인 아카이브 SHA가 manifest와 불일치: ${row.response_path}`)

  // ── 7. HEAD의 design 아카이브 **전체 집합**과 정확히 일치(빠짐·잉여 모두 거부) ──
  // 🔴 부분집합만 보면 needs-fix 라운드를 빼고도 통과한다 — 완전성이 이 게이트의 목적이다.
  const designBase = archiveBaseName('design', null)
  const headDesign = ports
    .headArchivePaths(responsesRel)
    .filter((p) => new RegExp(`^${escapeRegExp(designBase)}-r\\d{2,}-(approved|needs-fix)\\.json$`).test(p.split('/').pop() ?? ''))
  const invPaths = new Set(inv.map((i) => i.response_path))
  const headSet = new Set(headDesign)
  const missing = [...headSet].filter((p) => !invPaths.has(p)).sort()
  const extra = [...invPaths].filter((p) => !headSet.has(p)).sort()
  if (missing.length) return no(`HEAD의 design 아카이브가 archive_inventory에 빠져 있음: ${missing.join(', ')}`)
  if (extra.length) return no(`archive_inventory에 HEAD에 없는 항목이 있음: ${extra.join(', ')}`)

  // ── 8. 각 인벤토리 항목의 SHA 일치 ──
  for (const item of inv) {
    const actual = ports.headBlobSha256(item.response_path)
    if (actual === null) return no(`인벤토리 아카이브가 HEAD에 없음: ${item.response_path}`)
    if (actual !== item.sha256) return no(`인벤토리 아카이브 SHA 불일치: ${item.response_path}`)
  }
  return { durable: true, reason: 'design 승인 증거가 HEAD에 완비됨' }
}

/**
 * approvals.jsonl에 **이 evidence가** 이미 finalize된 엔트리가 있는지(순수, 멱등 finalize용).
 * ⚠️ B3-R2: consumed_by_commit_sha만으로는 부족 — 같은 source SHA를 쓰는 design-finalize row 등에 오인될 수 있음.
 *   sourceSha **+ evidence identity(kind·phase_id·response_sha256)** 전부 일치해야 동일 엔트리로 판정.
 */
export function manifestHasConsumed(
  content: string,
  sourceSha: string,
  identity: { reviewKind: ReviewKind; phaseId: string | null; responseSha256: string },
): boolean {
  for (const line of content.split('\n').map((l) => l.trim()).filter(Boolean)) {
    try {
      const e = JSON.parse(line) as { consumed_by_commit_sha?: unknown; kind?: unknown; phase_id?: unknown; response_sha256?: unknown }
      if (
        e &&
        typeof e === 'object' &&
        e.consumed_by_commit_sha === sourceSha &&
        e.kind === identity.reviewKind &&
        (e.phase_id ?? null) === identity.phaseId &&
        e.response_sha256 === identity.responseSha256
      )
        return true
    } catch {
      // malformed 줄은 무시(무결성은 validateManifest 담당)
    }
  }
  return false
}
