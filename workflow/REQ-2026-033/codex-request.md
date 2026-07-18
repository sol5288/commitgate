# REQ-2026-033 리뷰 요청

## 배경

CommitGate 개선 **REQ-B-2a** — design delta **감지·표시**(persona 제외). G-06b(승인 후 작은 편집이 전체
재리뷰를 부르고 리뷰어가 승인 영역을 재litigate) 완화의 감지·표시 절반.

**토대(B-1)**: design 승인 시 문서별 blob OID를 `state.design_baseline`에 보존(`hasDesignBaseline` 판별).
B-2a가 처음 읽어 delta를 계산·표시한다.

**🔴 재분할 유래(REQ-2026-032 종료)**: B-2(감지+표시+**persona 계약**)를 한 REQ로 묶었더니 design 리뷰가
6라운드 비수렴했다. 근본 원인은 **persona 증강** — policy_version 로그 배선·null persona 정책·kind 격리·
사용자 문서 계약을 near-e2e 차원으로 폭발시켰다. 감지·표시 자체는 깔끔했다. 사용자 결정으로 **B-2a(감지+
표시)** / B-2b(persona 계약+배선+문서)로 분리. 이 REQ는 REQ-032의 successor(lineage 기록됨).

## 변경 요약

설계 문서 3종만. 단일 phase. **persona 코드 무변경이 핵심.**

- **`computeDesignDelta(baseline, current)`(순수)**: 세 키 OID **키별** 비교 → `{changed, unchanged}`.
- **delta 게이트**(`main()`의 **`opts.kind==='design'` 분기 내부**): `hasDesignBaseline` true면 delta, 아니면
  full. **phase 리뷰는 구조적으로 delta 불가**(kind 격리). 변경 0(baseline==current)이어도 baseline 있으면 delta.
- **delta 표시**(`assembleReviewPrompt`에 optional `designDelta`): 변경 문서 `[변경됨]`·미변경 `[승인 baseline]`
  태그. **세 본문 모두 포함**. 태그 문자열은 코드 상수.

🔴 **핵심 결정 — persona·policy_version·바인딩 무변경**: base persona 로드·`reviewPolicyVersion(persona)`
로그 입력·`captureDesignBinding.designHash`·`processResponse` 승인 판정을 **전혀 안 건드린다**. delta 모드에서도
persona는 base 그대로 — delta 계약(재litigate 금지 지시)을 **안 붙인다**. 그래서 `policy_version`은 delta/full
동일한 게 정당하다(리뷰 계약이 안 바뀜). delta 계약 persona·policy_version 구분·null persona 정책·사용자 문서는
**전부 B-2b**로 분리했다 — 그게 REQ-032 비수렴의 복잡도 근원이었다. B-2a는 문서 **태그**만 바꾼다.

`req-commit.ts`·`machine.schema.json`·매니페스트 **무변경**.

## design-r01 지적 반영 (P1 2건 — 무회귀 경로 전체 바이트 동일)

1. 🔴 **O1-10(phase 격리)이 태그 부재만 검사**: baseline 보유 phase 실행에서 태그 없이 preamble 한 줄을
   추가하면 통과하나 phase 프롬프트가 바뀐다. → **O1-10을 phase 프롬프트 전체 `===`(재조립 expected)로 강화**.
2. 🔴 **O1-11(persona 무변경)이 계약 리터럴 부재만 검사**: 다른 이름의 delta 지시문을 assemble 뒤 덧붙이면
   base policy_version 비교·`DESIGN_DELTA_CONTRACT` 부재 검사를 모두 통과하나 리뷰 계약이 바뀐다. →
   **O1-11을 전송 프롬프트 전체 `===`(base persona + 태그 블록, 그 외 계약 없음)로 강화** + policy_version==base(기존).

두 건 모두 무회귀 경로(phase·delta-persona-불변)에 **전체 바이트 동일**을 적용한 것 — 같은 완전성 원칙.

## design-r02 지적 반영 (P1 2건 — tautology 제거)

🔴 **핵심**: r01에서 강화한 byte-identity expected가 **검증 대상 `assembleReviewPrompt`를 재호출**해 만들어져,
구현이 그 함수에 preamble을 넣으면 실제·expected가 함께 바뀌어 `===`가 무의미하게 통과(SUT로 자기 expected
생성). O1-7·O1-10·O1-11 전부 해당. → **expected를 production assembler와 독립된 고정 fixture로**:
- **순수 O1-4·O1-5**: 고정 입력 + **하드코딩 golden 문자열**(delta·no-delta 각각) 전체 `===`. `assembleReviewPrompt`
  재호출 안 함. delta golden은 "허용 태그 외 계약 블록 없음"까지 담아 계약 삽입을 잡는다.
- **near-e2e O1-7·O1-10·O1-11**: expected를 **테스트가 손으로 조립한 문자열 템플릿**으로(고정값 하드코딩,
  동적값은 HEAD sha·reviewTree만 `git rev-parse`/`git write-tree`로 독립 취득해 보간). `assembleReviewPrompt`를
  안 부르므로, 함수 분기든 main 후처리든 프롬프트가 바뀌면 손 조립 expected와 어긋나 실패.

## 리뷰 포인트

리뷰 포인트는 심사 범위의 하한이다.

1. **🔴 persona·policy_version 무변경이 실제로 성립하는가**(R4·D4). B-2a가 정말 persona 코드를 안 건드리고
   delta 모드에서도 base persona 그대로인가? `policy_version`이 delta/full 동일한 게 맞는가(계약 불변)?
   O1-11이 이를 잡는가(로그 policy_version==base·프롬프트에 계약 없음)? **이 분리가 REQ-032 비수렴을 실제로
   해소하는가** — persona 표면을 뺀 게 리뷰 가능한 크기를 만드는가?
2. **🔴 kind 격리**(R2·D2, REQ-032 r06-2). delta가 **design 프롬프트에만** 적용되고 phase 리뷰엔 안 새는가?
   게이트가 `opts.kind==='design'` 분기 **내부**라 phase는 구조적으로 delta 불가인가? O1-10이 잡는가?
3. **🔴 full 모드·phase 무회귀**(R6·인수기준 4). baseline 없거나 phase면 프롬프트가 B-1 이전과 **전체 바이트
   동일**인가? O1-5(순수 전체 `===`)·O1-7(near-e2e 전체 `===`)가 무표시 preamble·개행까지 봉쇄하는가?
4. **🔴 delta 감지·표시 정확성**(R1·R3). `computeDesignDelta`가 **키별** 비교인가? 부분 변경 시 변경 안 된
   문서에 변경 태그가 안 붙는가(O1-8)? zero-change(baseline==current)도 delta 모드인가(O1-9, 게이트=
   `hasDesignBaseline`이지 changed 수 아님)?
5. **분할이 옳은가**. 감지+표시(B-2a)와 persona 계약(B-2b)을 나눈 게 맞는가? B-2a 태그가 persona 계약 없이도
   additive·안전(문맥 무손실)인가? B-2a 단독 병합이 안전한가(B-1 "저장만" 구조와 같은가)?
6. **oracle 완전성**(REQ-032 교훈). O1-1~O1-11이 각 정상 경로(full/delta × baseline有/無 × 부분/zero-change ×
   design/phase × persona 불변)를 near-e2e로 고정하는가? "순수 조각은 맞고 main 배선만 틀린" 구현을 잡는가?
   REQ-032가 6라운드에 걸쳐 발견한 배선 gap(문서별 태그·kind 격리·full byte-identity·persona 불변)이 처음부터
   덮여 있는가?
