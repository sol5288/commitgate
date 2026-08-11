/**
 * **통합 통제점 승인 문장의 SSOT** — 0.22.0 최종 보완.
 *
 * 🔴 **왜 상수인가**: `req:next`가 통합 안내를 **두 경로**에서 낸다(일반 feature→main, delivery 묶음).
 *    두 곳에 문장을 손으로 적어 두었더니 정책이 바뀔 때 한쪽만 갱신됐다 — delivery 경로에는 CI green을
 *    전제하는 옛 축약형이 남아 있었고, 등재된 폐기 주장과 **표현이 달라** 가드까지 통과했다.
 *    (그 축약형 자체는 `retired-claims.ts`에 등재돼 있다. 여기 다시 적으면 검사 대상이 넓어질 때
 *    이 파일이 스스로 red가 되므로 인용하지 않는다.)
 *    문자열 변형을 계속 등재하는 것으로는 이런 종류를 못 막는다 —
 *    안내를 만드는 자리를 하나로 모아 **갈라질 수 없게** 한다.
 *
 * 🔴 문서(`AGENTS.template.md`·`docs/RELEASING.md`·`ssot-design/04`)는 마크다운이라 이 상수를
 *    import할 수 없다. 대신 `tests/unit/control-points.test.ts`가 **문서가 이 값을 담고 있는지**
 *    검사해 코드와 문서를 같은 원천에 묶는다.
 *
 * 🔴 승인 문장은 **사람이 그대로 말해야 하는 값**이다. 문구를 바꾸면 과거 승인과 대조가 깨지므로,
 *    바꿀 때는 옛 문장을 `retired-claims.ts`에 등재해 되살아나지 못하게 한다.
 */

/** `I1` — feature branch push + PR 생성. */
export const I1_APPROVAL = 'feature branch push + PR 생성 승인'

/**
 * `I2` — PR merge.
 *
 * 🔴 옛 문장은 GitHub 검사 결과가 통과했음을 **전제**했다. 그래서 CI를 실행하지 않은 정상 경로에서는
 *    **사실대로 말할 수 없었다** — 확인한 결과가 없는데 확인했다고 선언해야 했다.
 *    GitHub CI는 기본 미실행 opt-in이므로, "무엇을 확인했는지"를 실행 여부와 무관하게 참이 되도록 적는다.
 *    (옛 문장 자체는 `retired-claims.ts`에 등재돼 있다 — 여기 인용하면 이 파일이 스스로 red가 된다.)
 */
export const I2_APPROVAL = '검증 결과 확인 후 PR merge 승인'

/** `B1` — protected branch direct push. */
export const B1_APPROVAL = 'branch protection bypass를 사용한 direct push 승인'

/**
 * 통합 경로 안내 한 줄. `req:next`의 **모든** 통합 AWAIT_HUMAN 경로가 이것을 쓴다.
 *
 * `short`는 delivery 경로처럼 앞에 다른 지시가 붙는 자리를 위한 축약형이다 —
 * **문장 자체는 같은 상수에서 나온다**(축약이 곧 새 변형이 되지 않게).
 */
export function integrationPathGuidance(opts: { short?: boolean } = {}): string {
  const i1 = opts.short ? 'PR 생성 승인' : I1_APPROVAL
  const b1 = opts.short ? 'branch protection bypass direct push 승인' : B1_APPROVAL
  return `[I1] ${i1} → [I2] ${I2_APPROVAL}, 또는 [B1] ${b1}`
}
