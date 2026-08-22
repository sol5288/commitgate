/**
 * **종결 티켓 재진입 판정 + 입력 획득** (REQ-2026-151 → REQ-2026-175 로 lib 이관).
 *
 * ## 🔴 왜 입력 획득까지 여기 있는가 (REQ-2026-175 DEC-2)
 * `req:commit` 은 이 판정으로 **거부**하고, `req:next` 는 같은 판정으로 **안내**해야 한다.
 * 판정 함수만 공유하고 입력을 각자 모으면 두 곳이 다른 답을 낸다 — 특히 `narrowing`(ignore 범위를
 * 좁힐 수 있는 미커밋 `.gitignore`)이 있으면 안내는 **명령열을 내지 않아야** 하는데, 그 사실을
 * 모르는 쪽은 *"stash 하고 진행하라"* 는 **실행 불가 안내**를 낸다.
 *
 * REQ-2026-094 의 결론 그대로다: **술어뿐 아니라 입력 획득까지 맞춰야 한다.**
 *
 * 🔴 실제로 겪은 결함: `req:next` 가 `RUN` 으로 `req:commit --run` 을 지시했고, 그대로 실행하니
 *    `req:commit` 이 종결 재진입으로 거부했다 — 한 도구가 지시한 명령을 다른 도구가 거부했다.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseStatusZ, STATUS_Z_ARGS } from './porcelain'
import { narrowingPaths } from './gitignore-coverage'
import { scanTicketIntake } from './intake'
import { allShellSafe, quoteArg } from './shell-safe'

/**
 * 종결 티켓 재진입 차단(REQ-2026-151 DEC-1, 순수).
 *
 * 🔴 **source 커밋 前에** 판정해야 한다. 지금까지는 커밋을 만든 **뒤** `emitDevCompleteIfLastPhase`
 *    가 close-proof 자연키 충돌로 throw 했고, 그때는 이미 되돌릴 수 없는 커밋이 생긴 뒤라
 *    `approvals.jsonl` 이 더러워져 D10 이 이후 모든 `req:commit`·`--finalize` 를 막았다.
 *    (이 저장소가 실제로 밟았다 — REQ-2026-149 회귀 수정을 완결 티켓에 덧붙이다가.)
 *
 * 🔴 **`emitDevCompleteIfLastPhase` 를 조용히 멱등으로 만들지 않는다.** 완료된 티켓에 새 작업이
 *    소리 없이 붙어 lifecycle 의미가 흐려진다. 막고, 다음 단계를 알려 준다.
 *
 * @param baseState `scanTicketIntake(...).baseState` — 🔴 술어뿐 아니라 **입력 획득까지** doctor 와
 *   같아야 한다(REQ-2026-094: 같은 술어를 쓰고도 입력이 달라 판독이 갈렸다). 판독 실패는 `null`.
 */
export function terminalReentryProblem(
  reqId: string,
  baseState: string | null,
  dirtyGitignores: readonly string[] = [],
  narrowing: readonly string[] = [],
): string | null {
  // 🔴 `series-terminal` 은 차단하지 않는다 — series 종결이지 티켓 완료가 아니고, 대체 REQ 흐름이 그 상태를 지난다.
  if (baseState !== 'dev-complete' && baseState !== 'migrated-complete' && baseState !== 'abandoned') return null
  const slug = `${reqId.toLowerCase()}-followup`
  /**
   * 🔴 REQ-2026-154 DEC-3: ignore 범위가 **좁아질 수 있으면** 자동 명령을 내지 않는다.
   *
   * REQ-2026-152 의 안내는 미커밋 `.gitignore` 를 종류 구분 없이 먼저 커밋하게 했다. 규칙을
   * **삭제·완화**하는 변경이면 그 커밋이 완화를 새 티켓 브랜치에 **영구히** 남기고, 감춰져 있던
   * 파일이 드러나 다음 리뷰가 D10 에서 막힌다(실측 재현). 도구가 사람의 미커밋 결정을 대신
   * 확정하는 셈이다.
   *
   * 🔴 **명령열 전체를 내지 않는다** — 위험한 두 줄만 숨기고 stash·req:new·pop 을 그대로 내면
   *    그 셋만 실행했을 때 같은 노출이 일어난다(REQ-2026-152 phase-1 r03 과 같은 계약).
   */
  if (narrowing.length > 0)
    return (
      `${reqId} 는 이미 ${baseState} 입니다 — 완료된 티켓에는 새 작업을 붙이지 않습니다.
` +
      `  🔴 미커밋 .gitignore 가 ignore 범위를 **좁힐 수 있습니다** — 이 결정을 도구가 대신 커밋하지 않습니다:
${narrowing.map((p) => `       ${p}`).join('\n')}
` +
      `  그대로 커밋하면 그 완화가 새 티켓 브랜치에 영구히 남고, 감춰져 있던 파일이 드러나
     다음 리뷰가 D10 에서 막힙니다. 규칙을 되돌릴지, 드러난 파일을 정리할지 **직접** 정하십시오.
` +
      `  정한 뒤 방금 실행한 req:commit 명령을 다시 실행하면 이어지는 절차를 안내합니다.
` +
      `  🔴 이 티켓에는 아무것도 쓰지 않았습니다 — staged 변경은 그대로 있습니다.`
    )
  /**
   * 🔴 REQ-2026-152 DEC-1a: **stash 는 ignore 규칙 자체를 되돌린다.** 미커밋 `.gitignore` 가 stash 로
   *    들어가면 그 규칙에만 의존해 감춰져 있던 파일이 `??` 로 드러나고, 다음 줄의 `req:new` 가
   *    clean-tree 로 거부한다(실측 재현). 루트뿐 아니라 **중첩** `.gitignore` 도 같다.
   *
   * 🔴 미커밋 `.gitignore` 가 **없으면 이 줄을 내지 않는다** — 내면 "커밋할 것이 없다"로 실패해
   *    "안내가 순서대로 성공한다"는 이 REQ 의 계약을 스스로 깬다.
   *
   * 🔴 경로가 하나라도 셸 안전하지 않으면 **그 갈래 전체를 명령 대신 데이터로** 낸다
   *    (REQ-2026-149: 반쪽 명령열 금지).
   *
   * 🔴 안전 판정을 통과해도 **반드시 인용한다**(phase-1 r02 P1). `SAFE_ARG_RE` 는 `#` 를 허용하지만
   *    그것은 **큰따옴표 안에서** 안전하다는 뜻이다 — 맨몸으로 내면 bash·PowerShell 이 `#…` 를
   *    주석으로 읽어 `git add --` 가 pathspec 없이 실행되고, 이어지는 `commit` 이 staged 전체를
   *    커밋할 위험이 있다.
   */
  const ig = [...dirtyGitignores]
  const header = `${reqId} 는 이미 ${baseState} 입니다 — 완료된 티켓에는 새 작업을 붙이지 않습니다.
`
  /**
   * 🔴 phase-1 r03 P1: 안전하지 않은 경로가 있으면 **명령열 전체**를 내지 않는다. add·commit 만
   *    숨기고 stash·req:new·pop 을 그대로 내면, 그 세 줄만 실행했을 때 stash 가 규칙을 되돌려
   *    이 절이 막으려던 노출이 그대로 일어난다 — 반쪽 명령열의 정확한 정의다.
   *
   * 🔴 대신 **되돌아오는 길**을 준다: 그 파일들을 커밋하고 같은 명령을 다시 실행하면 목록이 비어
   *    실행 가능한 안내가 나온다. 새 명령을 지어내지 않는다.
   */
  if (ig.length > 0 && !allShellSafe(...ig))
    return (
      header +
      `  🔴 먼저 아래 **미커밋 .gitignore 를 커밋**하십시오. 커밋하지 않으면 이어지는 stash 가 이 규칙을
     되돌려 감춰져 있던 파일이 드러나고 req:new 가 거부됩니다:
${ig.map((p) => `       ${p}`).join('\n')}
` +
      `  경로에 셸 특수문자가 있어 **명령을 만들지 않았습니다** — 그대로 실행하면 다른 파일이 커밋됩니다.
` +
      `  커밋한 뒤 방금 실행한 req:commit 명령을 다시 실행하면 이어지는 절차를 안내합니다.
` +
      `  🔴 이 티켓에는 아무것도 쓰지 않았습니다 — staged 변경은 그대로 있습니다.`
    )
  const igLines =
    ig.length === 0
      ? ''
      : `    git add -- ${ig.map(quoteArg).join(' ')}
    git commit -m "chore: .gitignore" -- ${ig.map(quoteArg).join(' ')}
`
  return (
    header +
    `  사후 정정은 **단일 phase micro-REQ** 로 만드십시오(이 저장소 규범). 순서대로 실행하고, 실패하면 멈추십시오:
` +
    igLines +
    /**
     * 🔴 REQ-2026-152 DEC-1: **`--include-untracked` 가 필수다.** `req:new` 는 기존 티켓 직계의
     *    도구 산출물만 예외로 두고 그 밖의 untracked 를 clean-tree 위반으로 거부한다
     *    (`req-new.ts` `findReqNewDirtyEntries`). 보관하지 않으면 **다음 줄이 그 자리에서 거부된다.**
     *
     * 🔴 REQ-2026-151 은 "옛 티켓의 응답 아카이브까지 옮겨 다닌다"를 이유로 `-u` 를 뺐다. 그 부작용은
     *    실재하지만 **안내가 아예 실행되지 않는 것보다 작다** — 아카이브는 `stash pop` 으로 같은 경로에
     *    복원되고, 유실은 없다. 실행 가능성이 먼저다.
     *
     * 🔴 **`--all` 은 쓰지 않는다.** gitignore 대상까지 보관하면 `node_modules`·`.env` 가 stash 로
     *    들어간다. `req:new` 도 ignored 는 위반으로 보지 않으므로 필요가 없다.
     */
    `    git stash push --include-untracked -m "${reqId} follow-up"
` +
    `    npx commitgate req:new ${slug} --run
` +
    `    git stash pop
` +
    `  🔴 이 티켓에는 아무것도 쓰지 않았습니다 — staged 변경은 그대로 있습니다.`
  )
}

/** 판정에 필요한 사실을 모을 포트. 🔴 `req:commit`·`req:next` 가 **같은 것을 넘긴다**. */
export interface TerminalReentryPorts {
  root: string
  /** repo-상대 티켓 디렉터리(`workflow/REQ-…`). */
  ticketRel: string
  reqId: string
  git: (args: string[]) => string
}

/**
 * 종결 재진입 안내를 **완성해서** 돌려준다(`null` = 종결이 아니거나 판정 불가).
 *
 * 🔴 세 입력(`baseState`·`dirtyGitignores`·`narrowing`)을 **여기서 모은다** — 호출부가 각자 모으면
 *    같은 함수를 쓰고도 답이 갈라진다(design-r01 P1 이 잡은 결함).
 * 🔴 읽기 실패의 방향은 **원래 동작 그대로**다: baseState 는 `null`(판정 불가 → 안내 없음),
 *    dirtyGitignores 는 `[]`(그 줄을 내지 않음), narrowing 은 **전부 좁힐 수 있다고 본다**(애매하면 멈춘다).
 */
export function computeTerminalReentry(ports: TerminalReentryPorts): string | null {
  let baseState: string | null = null
  try {
    baseState = scanTicketIntake(ports.root, ports.ticketRel, ports.reqId).baseState
  } catch {
    baseState = null
  }
  let dirtyGitignores: string[] = []
  try {
    dirtyGitignores = [
      ...new Set(
        parseStatusZ(ports.git([...STATUS_Z_ARGS]))
          .flatMap((e) => (e.origPath === undefined ? [e.path] : [e.origPath, e.path]))
          // 🔴 **정규화하지 않는다**: `-z` porcelain 이 준 경로가 정본이고, Unix 에서 역슬래시는
          //    파일명의 일부다. 바꾸면 없는 경로를 안내한다.
          .filter((p) => p === '.gitignore' || p.endsWith('/.gitignore')),
      ),
    ].sort()
  } catch {
    dirtyGitignores = []
  }
  let narrowing: string[] = []
  try {
    narrowing = narrowingPaths(
      dirtyGitignores.map((p) => ({
        path: p,
        head: (() => {
          try {
            return ports.git(['show', `HEAD:${p}`])
          } catch {
            return null // HEAD 에 없다 = 신규 파일.
          }
        })(),
        work: (() => {
          try {
            return readFileSync(resolve(ports.root, p), 'utf8')
          } catch {
            return null // 워킹에 없다 = 삭제.
          }
        })(),
      })),
    )
  } catch {
    narrowing = [...dirtyGitignores]
  }
  return terminalReentryProblem(ports.reqId, baseState, dirtyGitignores, narrowing)
}
