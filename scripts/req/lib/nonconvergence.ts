/**
 * 비수렴 보고(REQ-2026-147) — `hardCap` 에 닿았을 때 **왜 수렴하지 않았는지·다음에 뭘 할지**를 정리한다.
 *
 * 🔴 **이것은 조언이지 증거가 아니다.** 승인·커밋·병합 어느 판정도 이 문자열을 읽지 않는다. 그래서
 *    커밋되지 않은 워킹트리 아카이브를 읽어도 된다 — 애초에 그것 말고는 읽을 것이 없다:
 *    `approvals.jsonl`·`archive_inventory` 는 **승인일 때만** 만들어지므로, 8회 전부 needs-fix 로
 *    hardCap 에 닿은 티켓에는 커밋된 아카이브가 **하나도 없다**(REQ-2026-144 r04 실측).
 *
 * 🔴 **새 리뷰를 부르지 않는다.** "멈췄다"고 알리려고 또 부르는 것은 자기모순이고, 그 호출은
 *    `hardCap` 회계 밖에서 비용을 만든다. 전부 결정론적 문자열 조립이다.
 *
 * 🔴 **leaf 다.** fs·git 을 모른다 — 라운드 자료는 호출부가 읽어 넣는다.
 */

import { PLACEHOLDER_APPROVAL, PLACEHOLDER_WHY_ABANDON, PLACEHOLDER_WHY_REPLACE } from './placeholders'
import { allShellSafe, quoteArg } from './shell-safe'

/** 한 라운드의 관측(호출부가 아카이브를 읽어 만든다). 파손된 라운드는 아예 넣지 않는다. */
export interface RoundObservation {
  round: number
  /** 원장의 판정(`needs-fix`·`invalid` 등). 모르면 null. */
  outcome: string | null
  findings: { severity?: string | null; detail?: string | null; file?: string | null }[]
}

/** 반복해서 걸린 축. 파일 경로이거나, 파일 없는 지적의 본문 앞부분이다. */
export interface RepeatedAxis {
  kind: 'file' | 'topic'
  key: string
  /** 이 축이 등장한 라운드(오름차순·중복 없음). */
  rounds: number[]
}

export interface NonConvergenceInput {
  reqId: string
  /** 열린 series 의 id(`--close-stale`·`--resolve` 대상). 없으면 null. */
  seriesId: string | null
  /** 🔴 열린(닫히지 않은) attempt 가 실제로 있는가. 없으면 `--close-stale` 을 **내지 않는다**. */
  hasOpenAttempt: boolean
  /** 🔴 티켓 디렉터리에 미커밋 변경이 있는가. 있으면 갈래 B 에 파킹 줄이 필요하다. */
  ticketDirty: boolean
  /** 티켓 **밖**의 미커밋 경로(실제 값). 있으면 데이터로 열거한다 — 명령으로 만들지 않는다. */
  outsideDirty: readonly string[]
  /** repo-상대 티켓 디렉터리(파킹 pathspec). */
  ticketRel: string
  /** 대체 REQ 의 slug(호출부가 `successorSlug` 로 산출). */
  successorSlug: string
  rounds: readonly RoundObservation[]
  hardCap: number
  /** 이 다음 회차 번호(차단된 회차). */
  attempt: number
}

/**
 * 라운드를 **번호 오름차순으로 정규화**한다(순수).
 *
 * 🔴 **결정론은 축 추출만으로 성립하지 않는다**(phase-1 r01 P1). `repeatedAxes` 는 Set 으로 정규화하지만
 *    라운드 요약과 "라운드별 지적 수" 나열은 **받은 순서를 그대로** 쓴다 — 호출부가 디렉터리를 어떤
 *    순서로 읽었느냐에 따라 같은 상태에서 다른 보고가 나온다. 조립에 쓰는 모든 자리가 이 함수를 거친다.
 */
export function normalizeRounds(rounds: readonly RoundObservation[]): RoundObservation[] {
  return [...rounds].sort((a, b) => a.round - b.round)
}

/** 상한 — 반복 실행돼도 부담이 없을 만큼 짧으면 억제 상태가 필요 없다(DEC-5). */
export const MAX_AXES = 3
/**
 * 🔴 파킹이 **두 줄**이라 6 이다(phase-2 r02 P1). 한 줄로 잇는 구분자가 **모든 셸에 없다** —
 *    PowerShell 5.1 은 `&&` 를 모르고 cmd.exe 는 `;` 를 명령 구분자로 쓰지 않는다.
 *    "붙여넣으면 실행된다"를 지키려면 줄을 나누는 수밖에 없고, 줄을 줄이려고 단계를 빼면
 *    그 갈래가 실행 불가가 된다.
 */
export const MAX_COMMAND_LINES = 6

const TOPIC_LEN = 60

/** `detail` → 축 키(정규화). 🔴 의미 유사도를 흉내 내지 않는다 — 결정론과 설명 가능성을 잃는다. */
function topicKey(detail: string): string {
  return detail.replace(/\s+/g, ' ').trim().slice(0, TOPIC_LEN).toLowerCase()
}

/**
 * 반복 축 추출(순수·결정론).
 *
 * 🔴 **2라운드 이상** 등장한 것만 담는다 — 1회는 반복이 아니다. 정렬은 등장 라운드 수 내림차순 →
 *    키 오름차순이라 입력 순서에 비의존이다.
 */
export function repeatedAxes(rounds: readonly RoundObservation[]): RepeatedAxis[] {
  const seen = new Map<string, { kind: 'file' | 'topic'; key: string; rounds: Set<number> }>()
  for (const r of rounds) {
    for (const f of r.findings) {
      const file = typeof f.file === 'string' && f.file.trim() !== '' ? f.file.trim() : null
      const detail = typeof f.detail === 'string' ? f.detail : ''
      const kind: 'file' | 'topic' = file ? 'file' : 'topic'
      const key = file ?? topicKey(detail)
      if (key === '') continue
      const id = `${kind} ${key}`
      const cur = seen.get(id) ?? { kind, key, rounds: new Set<number>() }
      cur.rounds.add(r.round)
      seen.set(id, cur)
    }
  }
  return [...seen.values()]
    .filter((a) => a.rounds.size >= 2)
    .map((a) => ({ kind: a.kind, key: a.key, rounds: [...a.rounds].sort((x, y) => x - y) }))
    .sort((a, b) => b.rounds.length - a.rounds.length || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
}

/**
 * 분해안 문구(순수). 🔴 **네 갈래가 각각 다르다**(DEC-3).
 *
 * 🔴 첫 갈래가 REQ-2026-144 r06 P1 이다: 초안은 "자료 없음"과 "매번 달랐다"를 한 갈래로 묶어,
 *    **아무것도 관측하지 못한 상태에서 "범위가 넓다"고 단정**했다. 관측에서만 나온다는 계약 위반이다.
 */
export function decompositionAdvice(input: readonly RoundObservation[], axes: readonly RepeatedAxis[]): string {
  const rounds = normalizeRounds(input)
  if (rounds.length === 0)
    return '분석할 자료가 없다 — 라운드 아카이브가 없거나 전부 읽을 수 없다. 분해안을 내지 않는다(관측이 없으면 권고도 없다).'
  if (axes.length === 0) {
    const perRound = rounds.map((r) => r.findings.length).join('·')
    return `반복해서 걸린 축이 없다 — 매 라운드 지적이 달랐다(라운드별 지적 수: ${perRound}). 한 곳이 안 풀린 것이 아니라 **범위가 넓다**는 신호다.`
  }
  if (axes.length === 1) {
    const a = axes[0]!
    return `걸린 축이 하나다: ${a.key} (r${a.rounds.map((n) => String(n).padStart(2, '0')).join('·r')}). 나눌 것이 없다 — **그 하나가 미해결**이다. 분할이 아니라 그 축의 결론을 먼저 내야 한다.`
  }
  const list = axes.slice(0, MAX_AXES).map((a) => `${a.key}(r${a.rounds.map((n) => String(n).padStart(2, '0')).join('·r')})`)
  return `서로 다른 축 ${axes.length}개가 반복해서 걸렸다: ${list.join(' · ')}. **축별로 나누면** 각 REQ 의 리뷰 면적이 줄어 수렴한다.`
}

/** 라운드 요약 — **1줄**(DEC-5). */
export function roundSummary(input: readonly RoundObservation[]): string {
  const rounds = normalizeRounds(input)
  if (rounds.length === 0) return '(라운드 자료 없음)'
  return rounds.map((r) => `r${String(r.round).padStart(2, '0')} ${r.outcome ?? '?'}`).join(' · ')
}

/** 안내 한 줄. `commitgate` 는 CommitGate 명령, `shell` 은 정리용(형식 검사 제외 대상). */
export interface CommandLine {
  kind: 'commitgate' | 'shell'
  text: string
}

/**
 * 다음 선택지(순수·상태 기반).
 *
 * 🔴 **지금 이 상태에서 성공하는 명령만** 낸다. `--close-stale` 은 열린 attempt 가 있을 때만,
 *    파킹 줄은 티켓이 더러울 때만 — 없는데 안내하면 그 명령이 실패한다(REQ-2026-144 r03 P1).
 */
export function nextChoices(input: NonConvergenceInput): { pre: CommandLine[]; abandon: CommandLine[]; replace: CommandLine[] } {
  const id = input.reqId
  const series = input.seriesId ?? ''
  // 🔴 REQ-2026-149: 자리표시자는 **등록부를 참조**한다. 문자열을 두 벌 두면 받는 쪽 검증과
  //    갈라지는 순간 고리가 다시 열린다.
  const R = PLACEHOLDER_WHY_ABANDON
  const RR = PLACEHOLDER_WHY_REPLACE
  const C = PLACEHOLDER_APPROVAL
  // 🔴 명령에 박히는 **모든 값**을 렌더링 직전에 검사한다 — 하나라도 안전하지 않으면 그 줄을 내지 않는다.
  const pre: CommandLine[] =
    input.hasOpenAttempt && series && allShellSafe(id, series)
      ? [{ kind: 'commitgate', text: `npx commitgate req:review-exception ${id} --close-stale ${quoteArg(series)} --reason "${R}" --run` }]
      : []
  const abandon: CommandLine[] = allShellSafe(id)
    ? [{ kind: 'commitgate', text: `npx commitgate req:close ${id} --abandon --reason "${R}" --confirm "${C}" --run` }]
    : []
  const replace: CommandLine[] = []
  if (series && allShellSafe(id, series))
    replace.push({
      kind: 'commitgate',
      text: `npx commitgate req:review-exception ${id} --resolve replace --series ${quoteArg(series)} --reason "${RR}" --confirm "${C}" --run`,
    })
  /**
   * 🔴 **갈래는 전부 나오거나 하나도 안 나온다**(phase-1 r02 P1).
   *
   * 파킹만 빼고 `req:new` 를 남기면 **반쪽 명령열**이 된다 — 사용자가 순서대로 실행하면 아직 남은
   * 티켓 변경 때문에 마지막 줄이 거부된다. "지금 이 상태에서 성공하는 명령"이 아니게 된다.
   *
   * 🔴 `git add -A` 가 아니다 — 무엇이 더러운지 모르는 채 전부 담으면 코드·비밀이 딸려 들어간다.
   *    `git commit -m` 만으로도 부족하다: needs-fix 아카이브는 untracked 라 staged 가 아니다.
   * 🔴 `successorSlug` 는 branch **파생값**이라 함께 검사한다(`feat/…-%PATH%` → `%PATH%-successor`).
   */
  const needsPark = input.ticketDirty
  const parkRenderable = !needsPark || allShellSafe(input.ticketRel)
  const branchRenderable = allShellSafe(input.successorSlug, id)
  if (parkRenderable && branchRenderable) {
    if (needsPark)
      replace.push(
        { kind: 'shell', text: `git add -- ${quoteArg(input.ticketRel)}` },
        { kind: 'shell', text: `git commit -m "chore(${id}): 설계 파킹"` },
      )
    replace.push({ kind: 'commitgate', text: `npx commitgate req:new ${input.successorSlug} --successor-of ${id} --run` })
  } else {
    // 안전하게 만들 수 없으면 **아무 줄도 내지 않는다.** 값은 보고 본문이 데이터로 보여 준다.
    replace.length = 0
  }
  return { pre, abandon, replace }
}

/** 보고 조립(순수·결정론). 같은 입력이면 같은 문자열이다. */
export function nonConvergenceReport(input: NonConvergenceInput): string {
  const axes = repeatedAxes(input.rounds)
  const { pre, abandon, replace } = nextChoices(input)
  const out: string[] = []
  // 🔴 이 보고가 무엇인지 먼저 밝힌다 — 증거로 오인되면 안 된다.
  out.push(
    `review 예산 소진 — ${input.attempt}회차는 어떤 경로로도 실행하지 않는다(hardCap=${input.hardCap}).`,
    '',
    '── 왜 수렴하지 않았나 (조언 — 감사 증거 아님) ──',
    `  라운드: ${roundSummary(input.rounds)}`,
    `  ${decompositionAdvice(input.rounds, axes)}`,
    '',
    '── 다음 선택 ──',
    // 🔴 REQ-2026-149 DEC-1: 아래 명령의 따옴표 안 값은 **도구가 만든 자리표시자**다. 그대로 실행하면
    //    거부된다 — 사람이 무엇을 근거로 결정했는지가 기록의 내용이기 때문이다.
    '  ⚠️ 따옴표 안의 값은 자리표시자다 — 실제 사유·승인 문장으로 **바꿔서** 실행한다(그대로면 거부된다).',
  )
  if (pre.length) {
    out.push('  [선행] 열린 회차를 먼저 정리한다')
    for (const c of pre) out.push(`    ${c.text}`)
  }
  out.push('  [A] 이 REQ 를 버린다')
  for (const c of abandon) out.push(`    ${c.text}`)
  out.push('  [B] 범위를 나눠 대체 REQ 로 잇는다 (순서대로)')
  for (const c of replace) out.push(`    ${c.text}`)
  if (input.outsideDirty.length) {
    // 🔴 티켓 밖 변경은 **데이터로만** 준다. 그 파일이 무엇인지 도구는 모르므로 명령으로 만들지 않는다.
    out.push('', '  ⚠️ 티켓 밖에도 미커밋 변경이 있어 req:new 가 거부한다 — 이것들도 먼저 정리한다:')
    for (const p of input.outsideDirty) out.push(`       ${p}`)
  }
  // 🔴 `hardCap` 을 올리라는 선택지는 **넣지 않는다**. 목록에 있으면 그게 기본 답이 된다.
  return out.join('\n')
}

/** 보고에 담긴 명령 줄 전부(형식 검증·상한 검사용). */
export function commandLines(input: NonConvergenceInput): CommandLine[] {
  const { pre, abandon, replace } = nextChoices(input)
  return [...pre, ...abandon, ...replace]
}

/**
 * 대체 REQ 로 잇는 slug 산출(순수·결정론).
 *
 * 🔴 **자리표시자를 내지 않는다.** slug 는 사람의 창의가 필요한 값이 아니라 식별자이고, 안내에
 *    `<slug>` 를 적으면 PowerShell 에서 `<` 가 리디렉션 토큰이라 **명령이 파싱 오류로 죽는다**.
 *    부모 branch 에서 벗겨 내고, 벗길 수 없으면 REQ 번호로 떨어진다 — 어느 경우에도 값이 나온다.
 */
export function successorSlug(branch: unknown, reqId: string): string {
  const b = typeof branch === 'string' ? branch : ''
  const m = /^feat\/req-\d{4}-\d{3,}-(.+)$/.exec(b)
  if (m && m[1]) return `${m[1]}-successor`
  return `${reqId.toLowerCase().replace(/^req-/, 'req-')}-successor`
}
