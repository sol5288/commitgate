/**
 * **폐기된 주장**(retired claims) 정본 — REQ-2026-112.
 *
 * 한때 참이었으나 동작 변경으로 거짓이 된 서술들이다. 두 소비자가 이 목록 **하나**를 쓴다:
 *
 * | 소비자 | 무엇을 하는가 |
 * |---|---|
 * | `tests/unit/docs-stale-claims.test.ts` | **이 저장소**의 문서·코드 표면에 되살아나지 않았는지 검사 |
 * | `req:doctor`의 D29 | **소비자 저장소**의 계약 파일(`AGENTS.md`)에 남아 있으면 WARN |
 *
 * 🔴 **왜 테스트가 아니라 여기인가**: 목록이 테스트에만 있으면 소비자 쪽 진단이 그것을 볼 수 없다.
 *    두 벌로 두면 한쪽만 갱신되는 순간 진단이 **조용히 거짓**이 된다 — 이 저장소가 자산 skew로
 *    두 번 데인 지점이다(REQ-2026-025·038). `scripts/req`는 배포 대상이라 소비자에게 함께 간다.
 *
 * 🔴 **항목을 추가할 때의 규칙**(REQ-2026-104): 등재할 문자열은 **정정문에도 남기지 않는다.**
 *    부분 문자열 검사기는 "주장"과 "철회를 설명하려고 옛 문구를 인용한 것"을 구별하지 못한다 —
 *    정정문이 옛 표현을 축자 인용하면 그 순간 가드가 스스로 실패한다. 인용부호 구간을 예외 처리하는
 *    파서를 만드는 대신(REQ-2026-044가 오라클을 명세 못 해 폐기한 길이다) **정정문을 풀어 쓴다.**
 *
 * 🔴 **이 검사가 하지 않는 것**: 문서가 코드와 일치하는지 **일반적으로** 판정하지 않는다.
 *    같은 주장을 다른 표현으로 쓰면 통과한다 — 그건 사람 리뷰의 몫이다. 실제로 그 한계가
 *    실현된 적이 있어(`정책과 무관하게 유지`) 변형을 별도 항목으로 등재했다.
 */

export interface RetiredClaim {
  /** 되살아나면 안 되는 **고정 문장**. 부분 문자열로 검사한다(문장부호·줄바꿈에 취약하지 않게). */
  text: string
  /** 왜 거짓이 되었는가. 진단 메시지가 이 문장을 **그대로** 쓴다 — 사유를 두 곳에서 다르게 쓰지 않는다. */
  why: string
}

export const RETIRED_CLAIMS: readonly RetiredClaim[] = [
  {
    text: '어느 값에서도 매 phase 확인',
    why: 'REQ-071이 제거한 HIGH 백스톱 (configuration.md)',
  },
  {
    text: '정책과 무관하게 매 phase 확인',
    why: 'REQ-071이 제거한 HIGH 백스톱 (workflow.md)',
  },
  {
    text: '기본값은 매 phase 커밋 전에',
    why: 'stopGate 기본값은 이제 req 다 (workflow.md)',
  },
  {
    text: 'HIGH-risk tickets stop at every phase under any value',
    why: 'the HIGH backstop REQ-071 removed (configuration.en.md)',
  },
  {
    text: 'HIGH-risk tickets still stop at every phase',
    why: 'the HIGH backstop REQ-071 removed (workflow.en.md)',
  },
  {
    text: 'By default the loop stops at `AWAIT_HUMAN` before every phase commit',
    why: 'the stopGate default is now req (workflow.en.md)',
  },
  {
    text: 'it would livelock on HIGH',
    why: 'no longer the reason there is no "all" value (configuration.en.md)',
  },
  /**
   * 🔴 이 두 건은 REQ-2026-073이 **쓰다가 리뷰에서 걸린 문장**이다(phase-3 r01 P1).
   *    "커밋·통합되지 않는다"는 커밋 단위 보장으로 읽히는데, 기본값 `req`에서 HIGH 티켓의
   *    중간 phase는 Codex 승인만으로 커밋된다 — 고치려던 것과 **같은 종류의 과잉 약속**이었다.
   */
  {
    text: '사람 확인 없이 커밋·통합되지 않습니다',
    why: '커밋 단위 보장으로 읽히는 과잉 약속 — 확인은 stopGate 지점에서만 요구된다',
  },
  {
    text: 'never committed or integrated without a human confirmation',
    why: 'reads as a per-commit guarantee — confirmation is required only at the stopGate point',
  },
  /**
   * 🔴 REQ-2026-100 — `docs/development.md`가 "전체 스위트를 돌리고 **게이트 판정도 이것을 본다**"고
   *    적고 있었다. 사실이 아니다: `req:doctor`·`req:commit` 어디에도 테스트를 실행하는 코드가 없다.
   */
  {
    text: '게이트 판정도 이것을 봅니다',
    why: '게이트는 테스트를 실행하지 않는다 (development.md · REQ-2026-100)',
  },
  {
    text: 'that is what the gate judges',
    why: 'the gate does not run tests (development.en.md · REQ-2026-100)',
  },
  /**
   * 🔴 REQ-2026-103 — 도달 불가였던 resume 코드를 "향후 opt-in용으로 보존"이라 서술했다.
   *    호출부가 상수라 실행될 수 없는 경로였는데, 문서만 보면 켜기만 하면 되는 기능처럼 읽혔다.
   *    ko 전용 항목이다 — 없던 문장을 영문으로 만들어 등재하면 영원히 발화하지 않는 항목이 는다.
   */
  {
    text: '향후 opt-in용',
    why: 'resume은 도달 불가 코드였다 — "켜면 되는 보존 코드"가 아니다 (ssot-design 06·G-06 · REQ-2026-103)',
  },
  /**
   * 🔴 REQ-2026-112 — **표현 변형**이다. 위의 두 항목과 같은 주장인데 문장이 달라 부분 문자열
   *    검사를 빠져나갔다. `docs/ssot-design/04`는 이미 검사 **범위 안**이었는데도 통과했다 —
   *    **범위를 넓히는 것만으로는 부족하다**는 실증이다.
   */
  {
    text: '정책과 무관하게 유지',
    why: 'REQ-071이 제거한 HIGH 백스톱의 표현 변형 (ssot-design 04 · REQ-2026-112)',
  },
  /**
   * 🔴 0.22.0 RC 보완 — **문서가 코드보다 늦어 있던 6건**이다. 전부 "아직 없다/필수다"라고 적혀
   *    있었지만 실제로는 이미 구현됐거나(앞 4건) 정책과 정반대였다(뒤 2건).
   *
   *    등재 규칙대로 **정정문에도 이 문자열을 남기지 않았다** — 정정을 설명할 때는 풀어 썼다.
   */
  {
    text: '리뷰 전 secret-scan 훅 없음',
    why: 'secretScanGate가 구현·배선돼 있고 config secretScan(기본 block)으로 제어된다 (ssot-design 09)',
  },
  {
    text: '`trunkBranch` 하드코딩',
    why: 'req.config.json 의 trunkBranch 로 설정화됐다 (ssot-design 09·12·14)',
  },
  {
    text: '그 skew를 감지하는 수단은 아직 없다',
    why: 'doctor D20 content-hash 검사 + commitgate sync 로 부분 감지·복구된다 (ssot-design 08·10)',
  },
  {
    text: '자산↔런타임 skew를 감지할 수단이 없다',
    why: 'doctor D20 content-hash 검사 + commitgate sync 로 부분 감지·복구된다 (ssot-design 10)',
  },
  {
    text: '심층 검증·정책 프로필·opt-in 원격 예제 미구현',
    why: '심층 6범주 검증·attest·integrate는 구현됐다 — 남은 것은 정책 프로필과 원격 예제뿐 (ssot-design 12)',
  },
  /**
   * 🔴 정책 위반이었던 서술 2건. `ci.yml`이 실제로 `workflow_dispatch` 전용이 된 지금,
   *    "CI green이 publish/merge의 필수 전제" 또는 "push/tag가 CI를 돌린다"는 서술은 거짓이다.
   */
  {
    text: '전 플랫폼 CI가 green이어야 한다',
    why: 'GitHub CI는 기본 미실행 opt-in이며 publish의 필수 조건이 아니다 (docs/RELEASING.md)',
  },
  {
    text: 'CI는 push 이후에 돈다',
    why: 'CommitGate 는 워크플로를 자동 dispatch 하지 않는다 — 저장소 자체 워크플로의 트리거는 .github/workflows/*.yml 에서 따로 확인할 것',
  },
  /**
   * 🔴 0.22.0 2차 보완 — 승인 문장과 SSOT 트리거 서술.
   *
   *    `I2`의 옛 문장은 CI를 실행하지 않은 **정상 경로에서 사실대로 쓸 수 없었다**
   *    (green을 확인한 적이 없는데 "green 확인 후"라고 말해야 했다). 문장을 바꾸는 것으로 끝내지 않고
   *    옛 문장을 등재해, 다른 문서가 그것을 다시 정본이라 부르지 못하게 한다.
   */
  {
    text: 'required checks green 확인 후 PR merge 승인',
    why: 'I2 정본 문장이 아니다 — CI 미실행이 정상이므로 "검증 결과 확인 후 PR merge 승인"을 쓴다',
  },
  {
    text: '전 플랫폼 CI green이 `npm publish`·PR merge(`I2`)의 선행조건',
    why: 'GitHub CI는 기본 미실행 opt-in이며 publish·merge의 필수 조건이 아니다 (ssot-design 10)',
  },
  {
    text: '`push`(branches: `main`, tags: `v*`), `pull_request`(전체)',
    why: 'CommitGate 저장소의 ci.yml 은 수동 실행 전용이다 — 소비자 저장소의 트리거는 각자 다르므로 워크플로 파일로 확인할 것 (ssot-design 10 §2)',
  },
  {
    text: '반영 이후 CI green 확인 뒤 각각 따로 요청한다',
    why: 'R1/R2/R3의 전제는 verify-range --strict 통과이지 CI green이 아니다 (ssot-design 04)',
  },
  {
    text: '경로 B에서 CI는 사후 검증',
    why: 'CommitGate 는 어느 경로에서도 CI 를 자동 실행하지 않으며 사전 게이트는 로컬이다 — 저장소 자체 워크플로는 별개로 자동 실행될 수 있다 (ssot-design 04)',
  },
  /**
   * 🔴 0.22.0 최종 보완 — `req:next`의 **delivery 경로**에 남아 있던 축약 변형이다.
   *
   *    같은 정책을 말하는데 문자열이 달라(`required checks green 확인 후…` vs 아래) 등재 검사를
   *    그대로 통과했다. 그래서 이 변형을 등재하는 것과 **함께**, 안내를 한 상수에서 파생하도록
   *    코드를 고쳤다(`lib/control-points.ts`) — 문자열 등재만으로는 다음 변형을 못 막는다.
   */
  {
    text: 'checks green 후 merge 승인',
    why: 'I2 정본은 "검증 결과 확인 후 PR merge 승인"이다 — CI 미실행이 정상이라 green을 전제할 수 없다',
  },
  /**
   * 🔴 0.22.0 최종 — 소비자(lean_lms) `AGENTS.md`에서 발견한 **완료 조건**의 CI 전제다.
   *
   *    `I1/I2/B1` 통제점표가 아니라 "완료 정의" 절에 있어서 앞의 항목들에 걸리지 않았다.
   *    CI 실행이 선택인데 완료 조건에 green을 넣으면 **CI를 돌리지 않는 정상 경로에서 티켓을 끝낼 수
   *    없다**는 말이 된다.
   *
   * 🔴 문자열 선택: 일반적인 `CI green` 부정문("CI green은 필수가 아니다" 같은 **정정문**)까지
   *    오탐하지 않도록, 완료 조건 문맥이 붙은 **핵심 구절**만 등재한다. `CI green` 단독은 쓰지 않는다.
   */
  {
    text: '검증 증적(+ 해당 O·CI green) 충족으로 판단',
    why: '완료 조건에 CI green 을 두면 CI 를 실행하지 않는 정상 경로에서 티켓을 끝낼 수 없다 — 완료는 DoD + 필수 로컬 검증 증적으로 판단한다',
  },
  /**
   * 🔴 0.22.0 릴리스 직전 — **전제가 통째로 빠진 R1/R2/R3 문장**이다.
   *
   *    CI green 전제를 걷어내면서 그 자리에 들어갔어야 할 `verify-range --strict` 전제를
   *    배포 템플릿에만 넣지 않아, "반영 이후 각각 따로 요청한다"만 남았다.
   *    CI가 선택인 것과 **로컬 strict 검증이 필수인 것은 다른 축**인데 둘 다 사라진 셈이었다.
   *
   * 🔴 **경계 선택**: 정본 문장은 `… 이후 \`npx commitgate verify-range --strict\` 통과를 확인한 뒤
   *    각각 …` 이므로 `이후`와 `각각` 사이에 전제가 들어간다. 아래 문자열은 그 사이가 **비어 있는**
   *    경우에만 일치한다 — 올바른 새 문장은 이 부분 문자열을 포함하지 않으므로 오탐하지 않는다.
   *    (`tests/unit/check.test.ts`가 정본 문장에서 C5 OK 임을 함께 고정한다.)
   */
  {
    text: '`B1`) 이후 각각 **따로** 요청한다',
    why: 'R1/R2/R3 전제가 빠졌다 — 반영 이후 `npx commitgate verify-range --strict` 통과를 확인한 뒤 각각 따로 요청한다(GitHub CI green 은 전제가 아니다)',
  },
  /**
   * 🔴 옛 승인 명칭 2종. 현재 정본은 I2=`검증 결과 확인 후 PR merge 승인`,
   *    B1=`branch protection bypass를 사용한 direct push 승인` 이다.
   *    `required status checks bypass 승인` 은 통제점표에 존재하지 않는 이름이라,
   *    남아 있으면 사용자가 받아야 할 승인 문장을 잘못 말하게 된다.
   */
  {
    text: '`merge/push 승인`은',
    why: '통제점표에 없는 옛 승인 명칭이다 — I2 는 `검증 결과 확인 후 PR merge 승인`, B1 은 `branch protection bypass를 사용한 direct push 승인`',
  },
  {
    text: 'required status checks bypass 승인',
    why: '통제점표에 없는 옛 승인 명칭이다 — protected branch 우회의 정본은 `branch protection bypass를 사용한 direct push 승인`',
  },
  /**
   * 🔴 REQ-2026-137 — 랜딩 README가 **정지 축을 하나로** 서술하던 문장이다.
   *
   *    `reviewBudget.onSoftLimit`(기본 `ask`)은 소프트 한도를 넘긴 재리뷰 회차마다 사람 예외를
   *    요구하는 **두 번째 정지 축**이다. `stopGate`를 `merge`로 두어도 그 자리에서 멈춘다 —
   *    "값 하나가 단독으로 정한다"고 적으면 사용자는 왜 멈췄는지 설명을 어디서도 찾지 못한다.
   *    `docs/configuration.md`는 이미 두 축으로 서술하고 있었고 랜딩만 뒤처져 있었다.
   */
  {
    text: '이 값 하나가 정지 지점을 단독으로 결정합니다',
    why: '정지 축은 둘이다 — reviewBudget.onSoftLimit 이 소프트 한도 초과 회차에서 따로 멈춘다 (README.md)',
  },
  {
    text: 'decides the stop point on its own',
    why: 'there are two stop axes — reviewBudget.onSoftLimit stops separately past the soft limit (README.en.md)',
  },
  /**
   * 🔴 REQ-2026-137 — `merge`의 **묶음 없는 경우**를 지우던 표 셀이다.
   *
   *    REQ-2026-128 이후 delivery set 이 없으면 `req:next` 가 그 REQ 의 통합 직전에 멈춘다
   *    (`deliveryGate === null` → `terminalIntegrationAction`). 묶음 종료만 적으면 사용자는
   *    `merge` 를 고른 뒤 묶음을 만들기 전까지 정지가 아예 없다고 읽는다 — 실제로는 멈춘다.
   */
  {
    text: '여러 REQ를 묶은 delivery set이 끝날 때',
    why: 'delivery set 이 없으면 그 REQ 의 통합 직전에 멈춘다 — 묶음 종료만 적으면 정지가 없다고 읽힌다 (README.md)',
  },
  {
    text: 'when a delivery set of several REQs is done',
    why: 'with no delivery set the stop happens just before that REQ is integrated — listing only the set case reads as "no stop" (README.en.md)',
  },
  /**
   * 🔴 REQ-2026-138 — 위 항목들이 고친 절보다 **200줄 앞**, 랜딩 첫 소개에 남아 있던 같은 주장이다.
   *
   *    정지 축이 `stopGate` 하나뿐이던 시절엔 참이었다. 축이 둘이 되면서(`reviewBudget.onSoftLimit`)
   *    거짓이 됐는데 소개만 그대로였다 — **바로 아래 줄이 "6~8회는 사람이 예외를 기록해야 한다"고
   *    적고 있어 같은 화면 안에서 앞뒤가 맞지 않았다.**
   *
   * 🔴 지운 것은 "기본값에서 phase 커밋마다 부르지 않는다"는 **사실이 아니라**, 예외를 함께 지우는
   *    배타 표현("중간에는 안 멈춘다"·"그 두 지점에서만")이다. 참인 범위까지만 말하게 한 것이다.
   */
  {
    text: '사람은 중간마다 멈추지 않습니다',
    why: '소프트 한도를 넘긴 재리뷰 회차에서는 기본값(ask)이 사람 예외를 요구한다 (README.md)',
  },
  {
    text: '결과를 합치는 지점에서만 확인합니다',
    why: '그 두 지점이 전부가 아니다 — 리뷰 예산 초과 회차가 별도 정지를 만든다 (README.md)',
  },
  /**
   * 🔴 흐름도 칸의 **표현 변형**이다. `:57` 산문과 같은 배타 주장인데 문장이 달라, 산문만 고치면
   *    그대로 살아남는다 — REQ-2026-112가 `정책과 무관하게 유지`로 실증한 실패 양상이다.
   */
  {
    text: '사람은 여기서만 확인한다',
    why: '흐름도의 배타 표현 — 리뷰 예산 초과 회차에서도 사람이 필요하다 (README.md 흐름도)',
  },
  /**
   * 🔴 **en 은 1건뿐인 것이 정상이다.** 위 뒤 두 ko 문자열에 대응하는 영문 문장은 애초에 없었다
   *    (흐름도는 `this is where you step in`, 산문에 `only` 가 없었다). 없던 문장을 번역해 등재하면
   *    영원히 발화하지 않는 항목이 늘고, 목록을 읽는 사람이 그런 문장이 있었다고 오해한다.
   */
  {
    text: 'you are not stopped in the middle',
    why: 'past the soft limit the default policy (ask) requires a human exception (README.en.md)',
  },
  /**
   * 🔴 REQ-2026-140 — `stopGate: "auto"` 가 **없다고** 적던 서술이다.
   *
   *    그 결정은 옳았고 근거도 그대로다("통합 승인은 공통 불변식" · "도구가 확인 기록을 대신 만들면
   *    시각 날조 표면"). 같은 문서가 **정직한 유일한 형태는 사전 위임 기록**이라고 적어 두었고,
   *    이 REQ 가 정확히 그 형태로 구현했다 — 그래서 "없습니다"만 거짓이 됐다.
   */
  {
    text: '`stopGate: "auto"`(최종 merge까지 무정지)는 없습니다',
    why: 'REQ-2026-140 이 사전 위임 기반으로 구현했다 — 다만 "무정지"가 아니라 위임 범위 안의 검증된 변경만 자동 통합한다 (configuration.md)',
  },
  /**
   * 🔴 **선행 단어를 뺐다** — 매칭은 대소문자를 구별하는데 이 문구는 문장 첫머리(`There is no …`)로도,
   *    문장 중간(`why there is no …`)으로도 쓰였다. 실제로 phase-5 에서 영문 workflow 문서가 후자 형태로
   *    남았고 가드가 **그것을 놓쳤다**(리뷰가 잡았다). 두 항목으로 나누는 대신 공통 부분만 등재한다.
   */
  {
    text: 'is no `stopGate: "auto"`',
    why: 'REQ-2026-140 implemented it on pre-delegation — and it is not "no stop": only verified changes inside the delegated scope integrate automatically (configuration.en.md · workflow.en.md)',
  },
  /**
   * 🔴 함께 등재한다: 이 REQ 가 **가장 오해받기 쉬운 방향**의 문구다. `auto` 를 "무제한 자동"으로
   *    적으면 사용자는 위임·hardCap·HIGH·범위 검사가 전부 사라진다고 읽는다.
   */
  {
    text: 'auto 는 최종 merge 까지 무정지',
    why: '위임이 없으면 merge 처럼 멈추고, hardCap·HIGH·BLOCKED·범위 밖 변경은 위임이 있어도 막는다',
  },
  /**
   * 🔴 REQ-2026-159 — `stopGate: "auto"` 는 유효한 사전 위임이 있으면 통합 승인을 다시 묻지 않는다.
   *    아래 문장들은 **설치 프로젝트로 복사되는 계약**(`AGENTS.md`)에 그대로 남아 있어, 소비자의
   *    에이전트가 위임이 있는데도 통합에서 멈추게 만든다 — 도구가 맞아도 계약이 틀리면 계약이 이긴다.
   *
   * 🔴 **배열 끝에 붙인다.** `RETIRED_CLAIMS[0]` 을 표본으로 쓰는 테스트가 있어서, 앞에 끼워 넣으면
   *    그 표본이 바뀌어 무관한 검사가 깨진다(실제로 밟았다).
   */
  {
    text: '통합(main 병합) 승인은 어느 값에서도 필요하다',
    why: 'stopGate:"auto" 는 유효한 사전 위임이 그 승인을 대신한다 (REQ-2026-159 · AGENTS.md)',
  },
  {
    text: '통합(main 병합) 승인은 어느 값에서나 필요합니다',
    why: 'stopGate:"auto" 는 유효한 사전 위임이 그 승인을 대신한다 (REQ-2026-159 · configuration.md)',
  },
  {
    text: '통합 승인은 stopGate 값(phase/req/merge)과 무관하게 항상 존재',
    why: '열거에 auto 가 빠져 있고, auto 에서는 위임이 그 승인을 대신한다 (REQ-2026-159 · AGENTS.md)',
  },
  {
    text: 'Integration (main merge) approval is required under every value',
    why: 'under stopGate:"auto" a valid advance delegation stands in for it (REQ-2026-159 · configuration.en.md)',
  },
]

/**
 * 검사 전 정규화(0.22.0 2차 보완).
 *
 * 🔴 예전에는 축자 부분 문자열만 봤다. 그래서 **강조 표시나 줄바꿈만 넣어도 통과**했다:
 *      `CI는 push 이후에 돈다`  →  `**CI는 push 이후에** 돈다`  (통과해버림)
 *      한 문장을 두 줄로 접어도 마찬가지였다.
 *    가드를 우회하려는 의도가 없어도, 문서를 다듬다 보면 자연히 그렇게 된다.
 *
 * 그래서 검사 대상과 등재 문자열 **양쪽에** 같은 정규화를 적용한다:
 *   - 마크다운 강조·코드 표시 문자(`*` `_` `` ` `` `~`) 제거
 *   - 연속 공백/줄바꿈을 한 칸으로 압축
 *
 * 🔴 **어미 변형까지 잡지는 못한다**(`돈다` ↔ `돕니다`). 그건 형태소 분석 영역이라 오라클을 명세할 수
 *    없다 — 대신 필요한 변형은 **별도 항목으로 등재**한다(REQ-2026-112가 같은 결론에 도달했다).
 */
export function normalizeForClaimScan(text: string): string {
  return text.replace(/[*_`~]/g, '').replace(/\s+/g, ' ')
}

/**
 * 본문에서 폐기된 주장을 찾는다. **매칭의 정본**이다.
 *
 * 🔴 `req:doctor`는 `RETIRED_CLAIMS` 배열을 import하지 않고 **이 함수만** 가져간다.
 *    배열을 손에 쥐지 않으면 사본을 둘 자리가 없다(설계 DEC-4의 ① 구조 방어).
 */
export function retiredClaimsIn(text: string): RetiredClaim[] {
  const haystack = normalizeForClaimScan(text)
  return RETIRED_CLAIMS.filter((c) => haystack.includes(normalizeForClaimScan(c.text)))
}
