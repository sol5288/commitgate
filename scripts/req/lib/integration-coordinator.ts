/**
 * IntegrationCoordinator — **검증한 SHA와 실제 병합 SHA의 결속**을 소유한다(0.22.0 RC 보완).
 *
 * ## 고치는 결함
 *
 * 예전 `bin/integrate.ts`는 `collectFacts`에서 feature HEAD **SHA**를 검증해 놓고, 마지막에
 * `git merge --no-ff <featureBranch>`로 **브랜치 이름**을 병합했다. 그 사이에는 CI 대기(최대
 * `timeoutMinutes`분)와 사람의 [y/N] 확인이 있다. 그동안 다른 창에서 커밋 하나가 얹히면
 * **검증하지 않은 커밋이 trunk로 들어간다.** trunk 쪽이 움직이는 경우도 마찬가지로 무방비였다.
 *
 * ## 불변식
 *
 *   > 검증한 feature SHA와 trunk SHA가 병합 직전까지 그대로일 때만, 검증한 feature SHA를 정확히 병합한다.
 *
 * 이것을 병합 직전 `rev-parse` 한 번으로 끝내지 않는다 — 그건 TOCTOU 창을 좁힐 뿐 없애지 못하고,
 * 무엇보다 "그래서 무엇을 병합했는가"를 보장하지 못한다. 대신 **compare-and-swap**으로 짠다:
 *
 *   1. 재검증(`revalidate`) — 현재 브랜치·양쪽 ref SHA·clean·merge/rebase 진행 상태
 *   2. `git checkout --detach <trunkHeadSha>`  ← 브랜치 이름이 아니라 **정확한 SHA**
 *   3. `git merge --no-ff <featureHeadSha>`    ← 여기도 **SHA**
 *   4. 만들어진 merge commit의 부모가 `[trunkHeadSha, featureHeadSha]` 인지 대조
 *   5. `git update-ref refs/heads/<trunk> <mergeSha> <trunkHeadSha>` ← **CAS**
 *      (`<oldvalue>`가 맞지 않으면 git이 거부하고 trunk ref를 건드리지 않는다)
 *   6. `git checkout <trunk>`
 *
 * 2~5 사이에 trunk가 움직이면 5가 실패하고 **trunk는 그대로**다. 어떤 실패에서도 `merge --abort`를
 * 시도하고 원래 feature 브랜치로 돌아간다. 🔴 자동 reset·stash·브랜치 삭제·push는 하지 않는다.
 *
 * ## 왜 별도 모듈인가
 *
 * `bin/integrate.ts`가 수집·판정·CI·질문·실행·감사 로그를 전부 소유하고 있었다. 이 모듈은
 * **준비된 통합 토큰(`PreparedIntegration`)과 그 실행**을 가져간다 — bin에는 인자 파싱·질문·출력만
 * 남는다. 통과만 시키는 껍데기가 아니다: 토큰 생성, 재검증 술어, CAS 실행이 전부 여기 있다.
 */
import { planIntegration, type IntegrationFacts, type IntegrationPlan } from './merge-gate'
import type { GitAdapter } from './adapters'

/** `IntegrationFacts['verify']`와 같은 모양 — 준비 토큰에 결속되는 검증 결과다. */
export type VerifySummary = NonNullable<IntegrationFacts['verify']>

/**
 * 검증이 끝난 **한 번의 통합 계획**. 여기 담긴 SHA만 병합 대상이 된다.
 * 브랜치 **이름**은 재검증·복귀·로그용이고, 병합에 쓰는 것은 언제나 SHA다.
 */
export interface PreparedIntegration {
  featureBranch: string
  featureHeadSha: string
  trunkBranch: string
  trunkHeadSha: string
  mergeBaseSha: string
  /** 이 SHA 쌍에 대해 통과한 strict 심층 검증 결과(감사 로그·출력이 그대로 쓴다). */
  verificationSummary: VerifySummary
}

export interface CollectResult {
  facts: IntegrationFacts
  plan: IntegrationPlan
  /** plan.ok일 때만 non-null. 차단이면 병합할 것이 없으므로 토큰도 없다. */
  prepared: PreparedIntegration | null
  /** 감사 로그 호환 필드(예전 행 모양 보존). */
  base: string | null
  head: string | null
}

export interface CoordinatorDeps {
  git: GitAdapter
  /** `.git` 하위 존재 검사(merge/rebase 진행 판정). */
  gitStateExists: (name: string) => boolean
  /**
   * base..head 심층 검증. 계산 불가면 null을 반환한다(추정 금지 — plan이 차단한다).
   * 🔴 `verify-range` CLI와 **같은 수집·분류**를 주입한다 — 수집 분기를 만들지 않기 위해서다.
   */
  verify: (base: string, head: string) => VerifySummary | null
  trunkBranch: string | null
  branchPrefix: string
}

export interface ExecuteResult {
  merged: boolean
  mergeSha: string | null
  /** 실제 merge commit의 부모(첫 부모, 두 번째 부모) — 성공했을 때만 채워진다. */
  mergeParents: [string, string] | null
  detail: string
}

/** 재검증에서 드러난 표류 — 하나라도 있으면 병합하지 않는다. */
export interface DriftProblem {
  what: string
  expected: string
  actual: string
}

export function driftLine(d: DriftProblem): string {
  return `${d.what} — 검증 시점 ${d.expected} · 지금 ${d.actual}`
}

export class IntegrationCoordinator {
  constructor(private readonly deps: CoordinatorDeps) {}

  /** 사실 수집 → 전제·strict 증거 판정 → (통과 시) 준비 토큰 생성. */
  collect(): CollectResult {
    const { git, deps } = { git: this.deps.git, deps: this.deps }
    const currentBranch = git.exec(['rev-parse', '--abbrev-ref', 'HEAD']).trim()

    let trunkExists = false
    let trunkHeadSha: string | null = null
    if (deps.trunkBranch !== null) {
      try {
        trunkHeadSha = git.exec(['rev-parse', '--verify', `refs/heads/${deps.trunkBranch}`]).trim()
        trunkExists = true
      } catch {
        trunkExists = false
      }
    }

    const worktreeClean = git.exec(['status', '--porcelain']).trim() === ''
    const mergeInProgress = deps.gitStateExists('MERGE_HEAD')
    const rebaseInProgress =
      deps.gitStateExists('REBASE_HEAD') || deps.gitStateExists('rebase-merge') || deps.gitStateExists('rebase-apply')

    let verify: VerifySummary | null = null
    let base: string | null = null
    let head: string | null = null
    if (deps.trunkBranch !== null && trunkExists && trunkHeadSha !== null && currentBranch !== deps.trunkBranch) {
      try {
        head = git.exec(['rev-parse', '--verify', 'HEAD^{commit}']).trim()
        // 🔴 merge-base의 입력도 **고정한 SHA**여야 한다. 예전에는 `merge-base <trunkBranch> <head>`로
        //    브랜치 **이름**을 넘겼다 — `trunkHeadSha`를 읽은 직후 trunk가 움직이면 검증 범위가 그
        //    새 위치 기준으로 계산돼, 토큰이 결속한 SHA 쌍과 **다른 범위**를 검증한 셈이 된다.
        //    trunk가 feature를 이미 삼킨 위치로 가 있으면 범위가 빈 집합으로 **축소**되기까지 한다.
        //    아래 네 값은 전부 같은 SHA 쌍(trunkHeadSha, head)에서 파생돼야 한다:
        //    featureHeadSha · trunkHeadSha · mergeBaseSha · verificationSummary.
        base = git.exec(['merge-base', trunkHeadSha, head]).trim()
        verify = deps.verify(base, head)
      } catch {
        verify = null // 계산 불가 — plan이 차단한다(추정 금지)
      }
    }

    const facts: IntegrationFacts = {
      currentBranch,
      trunkBranch: deps.trunkBranch,
      branchPrefix: deps.branchPrefix,
      worktreeClean,
      mergeInProgress,
      rebaseInProgress,
      trunkExists,
      verify,
    }
    const plan = planIntegration(facts)

    let prepared: PreparedIntegration | null = null
    if (plan.ok && head !== null && base !== null && trunkHeadSha !== null && verify !== null && deps.trunkBranch !== null) {
      prepared = {
        featureBranch: currentBranch,
        featureHeadSha: head,
        trunkBranch: deps.trunkBranch,
        trunkHeadSha,
        mergeBaseSha: base,
        verificationSummary: verify,
      }
    }
    return { facts, plan, prepared, base, head }
  }

  /**
   * 병합 직전 재검증(순수 관측 — 아무것도 바꾸지 않는다). 빈 배열이면 결속이 유지된 것이다.
   * 🔴 CI 대기·사람 확인 **이후에** 부르는 것이 요점이다. 준비 시점 한 번으로는 부족하다.
   *
   * 🔴 **private이다.** 공개 표면은 `collect()`와 `merge()` 둘뿐이다 — 재검증은 병합의 일부이지
   *    호출자가 따로 부를 수 있는 단계가 아니다. 공개해 두면 "재검증만 하고 그 결과로 다른 판단을
   *    하는" 호출 방식이 생겨 TOCTOU 창이 다시 열린다. 테스트도 `merge()`의 관측 가능한 결과로 본다.
   */
  private revalidate(p: PreparedIntegration): DriftProblem[] {
    const git = this.deps.git
    const out: DriftProblem[] = []

    const currentBranch = git.exec(['rev-parse', '--abbrev-ref', 'HEAD']).trim()
    if (currentBranch !== p.featureBranch)
      out.push({ what: '현재 브랜치가 바뀌었습니다', expected: p.featureBranch, actual: currentBranch })

    out.push(...this.refDrift(p.featureBranch, p.featureHeadSha, 'feature 브랜치가 이동했습니다'))
    out.push(...this.refDrift(p.trunkBranch, p.trunkHeadSha, 'trunk 브랜치가 이동했습니다'))

    const porcelain = git.exec(['status', '--porcelain']).trim()
    if (porcelain !== '') out.push({ what: '워킹트리가 clean 하지 않습니다', expected: '(clean)', actual: '변경 있음' })

    if (this.deps.gitStateExists('MERGE_HEAD'))
      out.push({ what: '진행 중인 merge가 생겼습니다', expected: '(없음)', actual: 'MERGE_HEAD' })
    if (
      this.deps.gitStateExists('REBASE_HEAD') ||
      this.deps.gitStateExists('rebase-merge') ||
      this.deps.gitStateExists('rebase-apply')
    )
      out.push({ what: '진행 중인 rebase가 생겼습니다', expected: '(없음)', actual: 'rebase 상태' })

    return out
  }

  private refDrift(branch: string, expected: string, what: string): DriftProblem[] {
    let actual: string
    try {
      actual = this.deps.git.exec(['rev-parse', '--verify', `refs/heads/${branch}`]).trim()
    } catch {
      return [{ what: `${what}(ref를 읽을 수 없습니다: ${branch})`, expected: short(expected), actual: '(없음)' }]
    }
    return actual === expected ? [] : [{ what: `${what}: ${branch}`, expected: short(expected), actual: short(actual) }]
  }

  /**
   * 재검증 → CAS 병합. 재검증에서 표류가 발견되면 **아무것도 하지 않고** 사유를 담아 반환한다.
   * 성공 시 trunk 브랜치 위에 선다(push 없음).
   */
  merge(p: PreparedIntegration): ExecuteResult {
    const drift = this.revalidate(p)
    if (drift.length > 0)
      return {
        merged: false,
        mergeSha: null,
        mergeParents: null,
        detail:
          '검증 이후 저장소 상태가 변경돼 병합하지 않았습니다 — `commitgate integrate` 를 다시 실행하세요:\n' +
          drift.map((d) => `    - ${driftLine(d)}`).join('\n'),
      }
    return this.casMerge(p)
  }

  /** 실제 compare-and-swap 실행. `merge()`가 재검증을 마친 뒤에만 부른다. */
  private casMerge(p: PreparedIntegration): ExecuteResult {
    const git = this.deps.git

    // 2) 정확한 trunk SHA로 detach — 브랜치 이름이 아니라 SHA다.
    try {
      git.exec(['checkout', '--detach', p.trunkHeadSha])
    } catch (err) {
      return { merged: false, mergeSha: null, mergeParents: null, detail: `trunk SHA 체크아웃 실패: ${msg(err)}` }
    }

    // 3) 검증한 feature SHA를 병합.
    try {
      git.exec([
        'merge',
        '--no-ff',
        p.featureHeadSha,
        '-m',
        `merge: ${p.featureBranch} → ${p.trunkBranch} (commitgate integrate)`,
      ])
    } catch (err) {
      return this.recover(p, `병합 실패: ${msg(err)}`)
    }

    // 4) 부모 대조 — "무엇을 병합했는가"의 유일한 증거다.
    let mergeSha: string
    let parents: string[]
    try {
      const line = git.exec(['rev-list', '--parents', '-n', '1', 'HEAD']).trim().split(/\s+/)
      mergeSha = line[0] ?? ''
      parents = line.slice(1)
    } catch (err) {
      return this.recover(p, `merge commit 부모 조회 실패: ${msg(err)}`)
    }
    if (parents.length !== 2 || parents[0] !== p.trunkHeadSha || parents[1] !== p.featureHeadSha)
      return this.recover(
        p,
        `merge commit 부모가 준비된 SHA와 다릅니다(부모 ${parents.length}개: ${parents.map(short).join(', ') || '(없음)'} · ` +
          `기대 ${short(p.trunkHeadSha)}, ${short(p.featureHeadSha)}) — trunk를 갱신하지 않았습니다`,
      )

    // 5) CAS — oldvalue가 맞을 때만 trunk ref가 움직인다.
    try {
      git.exec(['update-ref', `refs/heads/${p.trunkBranch}`, mergeSha, p.trunkHeadSha])
    } catch (err) {
      return this.recover(
        p,
        `trunk ref 비교·교환 실패 — 검증 이후 ${p.trunkBranch} 가 움직였습니다. trunk는 변경하지 않았습니다: ${msg(err)}`,
      )
    }

    // 6) 갱신된 trunk 위로 복귀(같은 커밋이므로 clean).
    try {
      git.exec(['checkout', p.trunkBranch])
    } catch (err) {
      return {
        merged: true,
        mergeSha,
        mergeParents: [parents[0] as string, parents[1] as string],
        detail:
          `병합 완료 — ${p.trunkBranch} @ ${short(mergeSha)} (push 없음). ` +
          `다만 ${p.trunkBranch} 체크아웃에 실패해 detached 상태입니다: ${msg(err)}`,
      }
    }
    return {
      merged: true,
      mergeSha,
      mergeParents: [parents[0] as string, parents[1] as string],
      detail: `병합 완료 — ${p.trunkBranch} @ ${short(mergeSha)} · 부모 ${short(p.trunkHeadSha)} + ${short(p.featureHeadSha)} (push는 하지 않았습니다)`,
    }
  }

  /** 실패 복구: `merge --abort` 시도 → 원래 feature 브랜치 복귀 시도. reset/stash는 하지 않는다. */
  private recover(p: PreparedIntegration, failure: string): ExecuteResult {
    const git = this.deps.git
    try {
      git.exec(['merge', '--abort'])
    } catch {
      /* abort 불가(충돌 전 실패 등) — 복귀 시도는 계속한다 */
    }
    try {
      git.exec(['checkout', p.featureBranch])
      return { merged: false, mergeSha: null, mergeParents: null, detail: `${failure} (원상 복구함 — ${p.featureBranch} 로 복귀)` }
    } catch {
      return {
        merged: false,
        mergeSha: null,
        mergeParents: null,
        detail:
          `${failure} + 원래 브랜치 복귀도 실패 — 현재 상태를 그대로 두었습니다(detached 가능). ` +
          `\`git status\` 로 확인 후 \`git checkout ${p.featureBranch}\` 하세요`,
      }
    }
  }
}

function short(sha: string): string {
  return sha.slice(0, 8)
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
