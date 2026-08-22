/**
 * intake 스캔용 **HEAD blob 배치 뷰** (REQ-2026-169).
 *
 * ## 왜 필요한가
 * `lib/evidence-ports.ts` 의 `head*` 포트는 **호출 1회당 git 프로세스 1개**를 띄운다. `scanIntake` 는 그
 * 포트를 **티켓마다** 만들어 쓰므로 티켓 수에 비례해 프로세스가 는다. 소비자 저장소(티켓 300개) 실측에서
 * `req:new` **dry-run 이 603초**였고, 스폰 약 3,000회 × ~197ms 로 그 값이 설명된다.
 *
 * ## 무엇을 바꾸는가 — **IO 만**
 * 🔴 판정 함수(`classifyIntake`·`deriveBaseState`·`verifyCommittedEvidenceIntegrity`·
 *    `verifyCommittedDesignEvidence`·`verifyPhaseArchives`)는 **한 줄도 바꾸지 않는다**(DEC-1).
 *    그것들은 이미 `EvidencePorts` 를 주입받으므로, 같은 인터페이스의 **다른 구현**을 넣으면 된다.
 *    성능 작업이 판정 코드를 건드리기 시작하면 회귀가 났을 때 "느려서 고친 것"과 "판정이 바뀐 것"을
 *    분리할 수 없다 — 경계를 포트에 둔다.
 *
 * ## 성립 근거 (DEC-3)
 * intake 가 요청할 수 있는 경로는 **전부 `<ticketRoot>/REQ-…` 디렉터리 아래**로 닫혀 있다:
 *   - `headText` → `<ticket>/state.json`, `<ticket>/responses/*.jsonl`
 *   - `headBlobSha256` → 매니페스트의 `response_path`·`archive_inventory[].response_path`.
 *     `validateManifest` 가 **경로 confinement**(`<ticketRel>/responses/` 하위)를 강제한다.
 *   - `headArchivePaths` → `<ticket>/responses/`
 * 그래서 `ls-tree -r` 한 번으로 요청 가능한 경로의 **상위집합**을 미리 알 수 있다.
 *
 * ## leaf 유지
 * 이 모듈은 `evidence`(타입)·`scratch`·`git-batch` 만 의존한다. `review-codex`·`req-commit`·`req-doctor`·
 * `intake` 를 import 하지 않는다.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readBlobsByOid } from './git-batch'
import { isArchiveFileName } from './scratch'
import type { EvidencePorts } from './evidence'

/** `git ls-tree -r -z` 한 항목. */
export interface HeadTreeEntry {
  oid: string
  /** `blob` | `commit`(submodule). `-r`(without `-t`)는 tree 를 내지 않는다. */
  type: string
  /** repo-상대 POSIX 경로(git 원문). */
  path: string
}

/** 티켓 디렉터리 이름 판정 — `listHeadTicketIds` 와 **같은 형식**이어야 한다(DEC-8 동등성). */
const TICKET_DIR_RE = /^REQ-\d{4}-\d+$/

/** 구분자 정규화 + 후행 슬래시 제거. `ticketRoot` 는 config 문자열이라 형태가 일정하지 않다. */
export function normalizeDirRel(dirRel: string): string {
  return dirRel.replace(/\\/g, '/').replace(/\/+$/, '')
}

/**
 * `git ls-tree -r -z` 출력 파싱(순수).
 *
 * 프레임: `<mode> SP <type> SP <oid> TAB <path> NUL`
 * 🔴 경로에 탭이 들어갈 수 있으므로 **첫 탭**에서만 자른다. 공백으로 split 하면 경로가 깨진다.
 */
export function parseLsTreeZ(out: string): HeadTreeEntry[] {
  const entries: HeadTreeEntry[] = []
  for (const rec of out.split('\0')) {
    if (rec === '') continue
    const tab = rec.indexOf('\t')
    if (tab === -1) continue // 형식 밖 — 조용히 버리지 않고 항목으로도 세지 않는다.
    const meta = rec.slice(0, tab).split(' ')
    if (meta.length < 3) continue
    entries.push({ oid: meta[2] as string, type: meta[1] as string, path: rec.slice(tab + 1) })
  }
  return entries
}

/**
 * `<ticketRoot>/` 하위 **전량 재귀 열거**(git 1회). 🔴 `GitAdapter.exec` 를 쓰지 않는다(DEC-5).
 *
 * 그 어댑터는 계약상 결과의 **후행 공백을 제거**한다(`git status --porcelain` 의 선행 공백 보존이 목적).
 * `-z` 출력의 마지막 NUL 이 잘리면 프레이밍이 달라진다. `evidence-ports.ts` 의 `headBlobSha256` 이
 * **같은 이유로** 이미 어댑터를 우회한다 — 우회가 아니라 **다른 계약**이 필요해서다.
 *
 * 🔴 후행 슬래시(`<dir>/`)는 여기서도 의미가 있다: pathspec 이 디렉터리를 가리켜야 그 하위를 연다.
 * HEAD 에 그 경로가 없으면(첫 REQ 등) 빈 배열 — 스캔 대상 없음이다.
 */
export function listHeadTreeEntries(cwd: string, ticketRootRel: string, ref = 'HEAD'): HeadTreeEntry[] {
  const dir = normalizeDirRel(ticketRootRel)
  let out: string
  try {
    out = execFileSync('git', ['ls-tree', '-r', '-z', ref, '--', `${dir}/`], {
      cwd,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'], // 부재가 정상 — stderr 노이즈 억제
    })
  } catch {
    return []
  }
  return parseLsTreeZ(out)
}

/** `<ticketRoot>/<seg>/…` 의 `<seg>` — 티켓 디렉터리가 아니거나 하위 파일이 아니면 `null`(순수). */
function ticketSegOf(path: string, rootPrefix: string): string | null {
  if (!path.startsWith(rootPrefix)) return null
  const rest = path.slice(rootPrefix.length)
  const slash = rest.indexOf('/')
  if (slash <= 0) return null // 티켓 직계 **파일**(하위 파일이 아님) — 티켓 디렉터리가 아니다.
  const seg = rest.slice(0, slash)
  return TICKET_DIR_RE.test(seg) ? seg : null
}

/**
 * 재귀 열거에서 **티켓 id 를 파생**한다(DEC-8, 순수 · git 0회).
 *
 * 🔴 **왜 `ls-tree -d` 를 따로 돌리지 않는가**: 목록 조회를 남기면 정상 경로가
 *    `ls-tree -d` + `ls-tree -r` + `cat-file` = 3 프로세스가 되어 "2개" 계약이 거짓이 된다
 *    (design-r01 P1 이 잡은 결함).
 *
 * 🔴 **동등성 논증**: git 은 **빈 디렉터리를 추적하지 않는다.** 따라서 HEAD 에 존재하는 모든 티켓
 *    디렉터리는 blob 을 최소 1개 담고 있고, `ls-tree -r` 의 경로 접두에 반드시 나타난다 —
 *    `ls-tree -d`(직계 자식 tree 열거)와 **같은 집합**이다. 이 동등성은 산문으로 두지 않고
 *    실 git 테스트가 `listHeadTicketIds` 와 대조해 고정한다.
 */
export function ticketIdsFromEntries(entries: readonly HeadTreeEntry[], ticketRootRel: string): string[] {
  const rootPrefix = `${normalizeDirRel(ticketRootRel)}/`
  const ids = new Set<string>()
  for (const e of entries) {
    const seg = ticketSegOf(e.path, rootPrefix)
    if (seg !== null) ids.add(seg)
  }
  return [...ids].sort()
}

/**
 * 프리페치 대상(DEC-3, 순수). `<ticket>/state.json` ∪ `<ticket>/responses/**`.
 *
 * 🔴 매니페스트를 읽어야 `response_path` 를 알 수 있지만 그러려면 매니페스트를 먼저 읽어야 하는
 *    순환이 생긴다. **경로 confinement 덕분에** 이 두 패턴이 요청 가능한 모든 경로의 상위집합이라
 *    1-pass 로 끝난다.
 * 🔴 `.md` 설계 문서는 프리페치하지 않는다 — intake 가 읽지 않는다(이 저장소 workflow 용량의 대부분).
 */
export function intakePrefetchEntries(
  entries: readonly HeadTreeEntry[],
  ticketRootRel: string,
): HeadTreeEntry[] {
  const rootPrefix = `${normalizeDirRel(ticketRootRel)}/`
  return entries.filter((e) => {
    if (e.type !== 'blob') return false
    const seg = ticketSegOf(e.path, rootPrefix)
    if (seg === null) return false
    const rest = e.path.slice(rootPrefix.length + seg.length + 1)
    return rest === 'state.json' || rest.startsWith('responses/')
  })
}

/** 배치 뷰 — 열거된 경로 집합 + 미리 읽은 blob. */
export interface BatchView {
  /** `<ticketRoot>` 하위인가. */
  underRoot(repoRel: string): boolean
  /** HEAD 열거에 그 경로가 있는가. */
  inTree(repoRel: string): boolean
  /** 프리페치된 원문 바이트(없으면 `undefined` — "부재"와 구분된다). */
  blob(repoRel: string): Buffer | undefined
  /** 그 디렉터리 하위의 아카이브 경로(재귀). */
  archivePathsUnder(dirRel: string): string[]
}

export function createBatchView(
  entries: readonly HeadTreeEntry[],
  blobsByOid: ReadonlyMap<string, Buffer | null>,
  ticketRootRel: string,
): BatchView {
  const rootPrefix = `${normalizeDirRel(ticketRootRel)}/`
  const treePaths = new Set<string>()
  const byPath = new Map<string, Buffer>()
  for (const e of entries) {
    treePaths.add(e.path)
    const b = blobsByOid.get(e.oid)
    if (b != null) byPath.set(e.path, b)
  }
  return {
    underRoot: (p) => p.startsWith(rootPrefix),
    inTree: (p) => treePaths.has(p),
    blob: (p) => byPath.get(p),
    archivePathsUnder(dirRel) {
      const prefix = `${normalizeDirRel(dirRel)}/`
      const out: string[] = []
      for (const p of treePaths)
        if (p.startsWith(prefix) && isArchiveFileName(p.slice(p.lastIndexOf('/') + 1))) out.push(p)
      return out
    },
  }
}

/** repo-상대 경로 정규화(포트 호출부가 `\` 를 섞어 넘길 수 있다). */
function normPath(repoRel: string): string {
  return repoRel.replace(/\\/g, '/')
}

/**
 * `head*` **3개만** 배치 뷰로 덮어쓴 포트(DEC-2). 나머지 포트는 `base` 그대로다.
 *
 * 🔴 **스텁으로 두지 않는다.** intake 는 나머지를 쓰지 않지만, 스텁이면 나중에 판정이 그 포트를 쓰게
 *    됐을 때 조용히 틀린 값을 받는다. 덮어쓰지 않은 것은 **원래 동작 그대로**라는 것이 이 형태의 요점이다.
 *
 * ## 미스 처리(DEC-6) — 배치는 **캐시**이지 대체가 아니다
 *
 * | 요청 경로 | 처리 | git 호출 |
 * |---|---|---|
 * | 프리페치에 있음 | 캐시된 Buffer | 0 |
 * | 열거에 있으나 프리페치 대상이 아님(`01-design.md` 등) | 🔴 `base` 로 폴백 | 1 |
 * | `<ticketRoot>` 아래인데 열거에 없음 | HEAD 부재 **확정** → `null` | 0 |
 * | `<ticketRoot>` **밖** | 🔴 `base` 로 폴백 | 1 |
 *
 * 마지막 두 줄이 핵심이다. 매니페스트가 confinement 를 어긴 경로를 담고 있으면(`validateManifest` 가
 * corrupt 로 잡을 상태) 무조건 `null` 로 만들면 **옛 구현과 다른 값**을 낸다 — 같은 입력에 같은 결과라는
 * DEC-1 이 깨진다. 그래서 폴백한다. 정상 데이터에서는 폴백이 **한 번도 실행되지 않는다.**
 */
export function withBatchedHeadReads(base: EvidencePorts, view: BatchView): EvidencePorts {
  /** 캐시 적중이면 Buffer, 확정 부재면 `null`, 알 수 없으면 `undefined`(= 폴백하라). */
  const lookup = (repoRel: string): Buffer | null | undefined => {
    const p = normPath(repoRel)
    const hit = view.blob(p)
    if (hit !== undefined) return hit
    if (view.inTree(p)) return undefined // 존재하지만 프리페치 대상이 아니었다 → 폴백
    return view.underRoot(p) ? null : undefined // 루트 아래면 확정 부재, 밖이면 모름 → 폴백
  }
  return {
    ...base,
    headText(repoRel) {
      const r = lookup(repoRel)
      if (r === undefined) return base.headText(repoRel)
      return r === null ? null : r.toString('utf8')
    },
    /**
     * 🔴 **바이트 그대로** 해시한다 — `base` 와 같은 계약이다. `cat-file --batch` 본문은 blob 원문이라
     *    `core.autocrlf` 환경에서도 워킹 파일과 달리 커밋된 바이트 그대로다.
     */
    headBlobSha256(repoRel) {
      const r = lookup(repoRel)
      if (r === undefined) return base.headBlobSha256(repoRel)
      return r === null ? null : createHash('sha256').update(r).digest('hex')
    },
    headArchivePaths(responsesDirRel) {
      const d = normPath(responsesDirRel)
      // 루트 밖이면 뷰가 아무것도 모른다 → 폴백(정상 데이터에서는 발생하지 않는다).
      if (!view.underRoot(d)) return base.headArchivePaths(responsesDirRel)
      return view.archivePathsUnder(d)
    },
  }
}

/**
 * 열거 1회 + 배치 읽기 1회로 뷰를 만든다(git **정확히 2회**).
 *
 * 🔴 **실패는 삼키지 않는다.** 배치 읽기가 실패하면 throw 한다 — 조용히 빈 뷰로 계속하면 모든 티켓이
 *    "HEAD 에 없음 = legacy" 로 보여 **게이트가 통째로 우회된다.** 읽지 못한 것은 "없음"이 아니라
 *    "모름"이고, 모르면 멈춘다.
 */
export function buildIntakeBatchView(
  cwd: string,
  ticketRootRel: string,
  ref = 'HEAD',
): { entries: HeadTreeEntry[]; view: BatchView } {
  const entries = listHeadTreeEntries(cwd, ticketRootRel, ref)
  const prefetch = intakePrefetchEntries(entries, ticketRootRel)
  const blobs = readBlobsByOid(cwd, prefetch.map((e) => e.oid))
  return { entries, view: createBatchView(entries, blobs, ticketRootRel) }
}
