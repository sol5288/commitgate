# REQ-2026-018 요구사항 — 리뷰 severity 배선 (findings=P1만 차단)

## 1. 배경 (측정된 사실)

PM 정책은 "P1 = 정상 경로에서 재현되는 요구 위반·데이터 손상·보안·금전 오류만", "P2/P3 때문에 설계 재검수를
반복하지 않는다", "설계 리뷰 상한 2/3/최대 5"를 이미 확정했다. **그러나 이 정책이 강제되는 지점이 코드·스키마·persona
어디에도 없다.**

측정된 배선 공백:

- `workflow/machine.schema.json`: `findings[].severity`는 enum `P1|P2|P3`뿐이고 **description이 없다**.
  같은 스키마의 `commit_approved`에는 승인 규칙이 장문으로 적혀 있는데 severity에는 0줄 → 리뷰어는 P1/P2 정의를 받은 적이 없다.
- `scripts/req/review-codex.ts` `classifyReview()`: **findings가 1건이라도 있으면 severity와 무관하게 `needs-fix`**.
  즉 P2도 P1과 똑같이 커밋을 막는다 → 코드가 정책과 정면 충돌.
- `workflow/review-persona.md`: "findings=차단만, 부채는 observations로"라고 **이미 정확히** 지시하고 있으나,
  위 두 가지 때문에 무력화된다.

실측 피해(REQ-2026-014): 설계 리뷰 **r30까지 진행**. r19에서 findings 0건 승인이 났으나 이후 요구 추가로 승인이 무효화됐고,
**r20~r30의 findings 21건은 전부 P2, P1은 0건**이다. 정책대로면 전원 승인+backlog였어야 한다.
REQ-2026-015(4R)·016(2R)·017(2R)도 같은 원인으로 terminal 폐기됐다.

## 2. 목표(What)

**리뷰어가 P2/P3를 `findings`에 넣는 것을 구조적으로 불가능하게 만든다.** 그러면 비차단 지적은 `observations`로 갈 수밖에 없고,
`classifyReview`의 "findings 있으면 차단"은 **고칠 필요 없이 그대로 옳은 로직**이 된다.

강제 지점은 리뷰어에게 실제로 전달되는 **출력 스키마**(`--output-schema`)다. 검증 스키마는 하위호환을 위해 건드리지 않는다.

## 3. 요구(정규화)

- **R1 출력 스키마 P1-only**: `deriveStrictOutputSchema()`가 파생하는 출력 스키마에서
  `findings[].severity.enum`이 **정확히 `["P1"]`** 이다.
  - 통과/실패: `deriveStrictOutputSchema(readFileSync('workflow/machine.schema.json','utf8'))`의 결과를 파싱해
    `properties.findings.items.properties.severity.enum`이 `["P1"]`이면 통과, 그 외 실패. (Done #1)
- **R2 P1 정의 주입**: `machine.schema.json`의 `findings[].severity`에 **description이 존재**하며, 다음 **4요소를 모두** 명시한다.
  - **(a) 카테고리 한정(핵심)**: P1은 **요구 위반·데이터 손상·보안·금전 오류·fail-closed 우회** 중 하나여야 한다.
  - **(b) 정상 경로**: 정상 사용 경로에서 재현될 것.
  - **(c) 증거**: 재현 경로·실패 시나리오 필수.
  - **(d) 배제 규칙**: (a)에 해당하지 않으면 **정상 경로에서 재현되더라도 P1이 아니며** `observations`로 보낸다
    (예: 포터빌리티·구조·유지보수·가독성 개선, 장래 확장성, 드문 recovery 경합, 분산 정합성).
  - 통과/실패: description이 빈 문자열이 아니고 (a)(b)(c)(d) **각각**에 해당하는 문구를 포함하면 통과. (Done #2)
  - **왜 (a)(d)가 핵심인가**: (b)(c)만으로는 "정상 경로에서 재현되는 구조 개선"을 재현 절차와 함께 P1로 올리는 경로가
    그대로 열려 있어, findings=P1-only가 차단 범위를 실질적으로 좁히지 못한다. 카테고리 한정이 이 REQ의 하중을 받는 부분이다.
- **R3 검증 스키마 불변(하위호환)**: `machine.schema.json`의 `findings[].severity.enum`은 **`P1|P2|P3`를 유지**한다.
  - 통과/실패: P2/P3 severity를 포함한 **기존 아카이브(`workflow/REQ-2026-0*/responses/*.json`)가 전부 검증을 통과**하면 통과.
    하나라도 invalid가 되면 실패. (Done #3)
- **R4 persona 경계 명시**: `workflow/review-persona.md`가 (a) 보장 범위 경계(단일 활성 worktree·협조적 작업자·정상 경로 우선),
  (b) P1 정의, (c) "부채는 findings가 아니라 observations로 기록해 다음 티켓의 입력으로" — 세 가지를 포함한다.
  현재 상단 프레임("하한이지 상한이 아니다"·"부채가 남지 않도록 하라")이 무한 범위를 허가하지 않도록 같은 위치에서 경계를 건다.
  - 통과/실패: 세 항목이 문서에 존재하면 통과. (Done #4)
- **R5 회귀 테스트**: R1·R2·R3를 고정하는 단위 테스트를 추가하고 `npm test`·`npm run typecheck`가 그린이다.
  - 통과/실패: 테스트 그린 + typecheck 0에러. (Done #5)

## 4. 비목표(Non-goals) — 이번 REQ에서 하지 않는다

- **`classifyReview()` 변경 없음.** P2가 findings에 못 들어오면 현 로직이 그대로 옳다. 상태 전이 로직을 건드리지 않는 것이
  이 티켓이 2라운드에 수렴하기 위한 핵심 조건이다(REQ-2026-015/016/017이 정확히 여기서 죽었다).
- **라운드 상한·PM escalation·델타 재리뷰** — 후속 REQ. 표면이 크고 상태·해시 비교 로직을 건드린다.
- **요구 falsifiable화 가이드·`req:doctor` 린트** — 후속 REQ.
- 리뷰 모델·프롬프트 조립·아카이브 포맷 변경. severity를 state.json이나 evidence 포맷에 새로 기록하는 것.

## 5. 제약

- **부트스트랩 함정**: 이 티켓 자신도 지금의 깨진 루프를 통과해야 한다. 그래서 변경은 **파일 3개·선언적**으로 묶는다
  (`adapters.ts` 순수 함수 1개 + 스키마 description·enum + persona 텍스트).
- **MANAGED 스키마**: `machine.schema.json`은 대상 프로젝트에 설치되는 MANAGED 파일이다. 기존 설치본의 아카이브 검증이
  깨지면 안 된다(R3).
- **알려진 리스크 — severity inflation**: P1만 허용하면 리뷰어가 P2를 P1로 올릴 수 있다.
  억제 장치는 R2의 **(a) 카테고리 한정 + (d) 배제 규칙**이며, (c) 재현 경로 필수가 이를 보조한다.
  카테고리 한정 없이 (b)(c)만 두면 "정상 경로에서 재현되는 개선"이 전부 P1이 되어 억제가 성립하지 않는다.
  다만 카테고리 판정 자체는 리뷰어의 재량이므로 이번 REQ는 이 리스크를 **제거하지 않고 완화**한다.
  잔존 시 후속 REQ(라운드 상한·P1 비율 관측)에서 다룬다.

## 6. 인수 기준

1. 출력 스키마의 `findings[].severity.enum` == `["P1"]` (R1).
2. `machine.schema.json`의 severity description에 P1 정의 **4요소**(카테고리 한정·정상 경로·재현 증거·배제 규칙) 존재 (R2).
3. 기존 P2/P3 아카이브 전부 검증 통과 (R3).
4. persona에 경계·P1 정의·부채→observations 존재 (R4).
5. `npm test`·`npm run typecheck` 그린 (R5).
6. `classifyReview()` diff 0줄 (비목표 준수 확인).
