# REQ-2026-034 리뷰 요청

## 배경

CommitGate 개선 **REQ-B-2b** — design-delta persona 계약. G-06b(승인 후 편집이 전체 재리뷰를 부르고 리뷰어가
승인 영역 재litigate) delta review의 **행동 계약** 절반.

**토대**: B-1(baseline 저장)·B-2a(REQ-033: `computeDesignDelta` + 문서 태그 + `designDelta` 게이트, **persona
무변경**). B-2b가 그 위에 계약 persona를 얹는다.

**🔴 032 비수렴의 persona 절반을 처음부터 전부 반영**: REQ-032(B-2 통합본)는 persona 증강이 policy_version
배선·null 정책·kind 격리·사용자 문서를 near-e2e 차원으로 폭발시켜 6R 비수렴 → 재분할. B-2a(감지+표시)는 3R
수렴. B-2b는 032의 r01~r06 findings를 **설계에 선반영**한다.

## 변경 요약

- **`DESIGN_DELTA_CONTRACT`**(상수): delta 계약 블록. 태그 문구는 `DELTA_CHANGED_TAG`/`DELTA_BASELINE_TAG`
  **상수 참조**(drift 방지).
- **`applyDeltaPersona(base, deltaActive)`**(순수): deltaActive면 base+계약(base null이면 계약 단독), 아니면 base.
- **`main()` effectivePersona 배선**: `designDelta` 확정 뒤 `effectivePersona = applyDeltaPersona(persona, designDelta!==undefined)`.
  🔴 base persona를 쓰던 **두 지점**(assembleReviewPrompt 인자·`reviewPolicyVersion` 로그 입력)을 **모두**
  effectivePersona로 교체 — 단일 배선(032 r02·r03).
- **사용자 문서**: README·README.en·SSOT의 `reviewPersonaPath:null` 설명에 "delta design 리뷰는 내장 계약 주입" 추가(032 r06-3).

🔴 **kind 격리는 구조적**(032 r06-2): 계약은 `designDelta`에 올라탄다. `designDelta`는 B-2a에서 **design +
baseline**일 때만 설정(phase 구조적 제외). 새 kind 검사 없음 — B-2a 게이트 재사용.

`assembleReviewPrompt`·`computeDesignDelta`·B-2a 태그·바인딩·`processResponse`·`req-commit.ts` **무변경**.

## design-r01 지적 반영 (P1 1건)

1. 🔴 **O1-5(full design base persona)가 non-run이라 로그 policy_version 미검증**: 프롬프트는 base지만 full
   design 로그에 'none'/delta를 쓰는 발산 구현이 O1-3/4/6/7·O1-5를 모두 통과. → **O1-5를 --run으로** 바꿔
   전송 프롬프트 전체 `===` + 로그 `policy_version === reviewPolicyVersion(base)`를 함께 단언(full design도
   로그 배선을 고정).

## design-r02 지적 반영 (P1 1건 + observation)

1. 🔴 **O1-7(phase 격리)이 프롬프트가 실제 base persona를 받았는지 미검증**: 계약 없음·로그 base만 봐서,
   phase에 null을 넘기고 로그엔 base를 쓰는 발산이 통과. → **O1-7을 phase 프롬프트 전체 `===`(base persona
   그대로, 손 조립 expected)로 강화** + 로그 policy(기존).

observation(non-blocking): O1-1 `toContain(태그)`는 상수 보간 vs 같은 값 리터럴을 구분 못 함 → 02-plan
정직성에 한계 명시(drift는 태그 상수 변경 시 드러남, 소스 구조 단언은 과함).

## design-r03 지적 반영 (P1 2건)

1. 🔴 **null persona phase 미검증**: O1-7이 base persona phase만 봐서, phase+null에만 계약 주입하는 오배선을
   놓침(정상 null phase에 계약 새고 policy≠'none'). → **O1-9 추가**: phase+baseline+null --run에서 무-persona
   프롬프트 전체 `===`, `policy_version==='none'`, 계약 부재.
2. 🔴 **O1-8 문서 grep이 파일당 한 곳만 봐서 표(:497) stale 허용**: 본문만 고치고 설정 표를 그대로 두면 통과
   (사용자가 표만 읽고 "null=완전 비활성" 오인). → **O1-8을 touchpoint별로 세분화**: README·README.en의
   **본문(:120)+표(:497) 각각** + SSOT(:132)를 분리 단언.

## design-r04 지적 반영 (P1 2건)

1. 🔴 **O1-6(full+null)이 byte-identity 미검증**: policy='none'·계약 부재만 봐서 persona 뒤 stray 개행/안내문을
   놓침. → **O1-6에 hand-built full expected 전체 `===` 추가**. 이로써 무회귀 4경로(base/null × full/phase)
   전부 byte-identity 완성.
2. 🔴 **O1-8 grep이 'delta' 키워드만 봐서 반대 의미 통과**: "null은 full·delta 모두 비활성" 같은 계약 반대
   문장도 'delta' 포함이라 통과. → **canonical 문구**(KR "delta design 리뷰에는 내장 delta 계약이 주입된다" /
   EN "delta design reviews still inject the built-in delta contract")를 정의하고 5개 touchpoint 각각에서
   그 정확 문구를 grep — 의미(주입)를 고정.

## 리뷰 포인트

리뷰 포인트는 심사 범위의 하한이다.

1. **🔴 단일 effective persona 배선**(R3·D3, 032 r02·r03). 프롬프트와 로그 policy_version이 **같은** effective
   persona를 쓰는가 — 프롬프트엔 계약, 로그엔 base로 발산할 여지가 없는가? O1-3이 프롬프트 전체 `===` + 로그
   hash 둘 다 잡는가?
2. **🔴 null persona 정책**(R4·D2, 032 r01·r06-1). `reviewPersonaPath:null`(지원 설정)에서 delta면 계약 단독,
   full이면 null 그대로('none')인가? O1-4(live 계약+hash)·O1-6(full null 무회귀)가 둘 다 고정하는가? null
   coercion("null\n계약")이 없는가?
3. **🔴 kind 격리**(R5·D4, 032 r06-2). 계약이 `designDelta`에만 올라타 phase·full design엔 안 붙는가? 새 kind
   검사 없이 B-2a 게이트 재사용으로 구조적 격리가 성립하는가? O1-5·O1-7이 잡는가?
4. **🔴 full/phase 무회귀**(R7·D3). `designDelta` undefined면 effectivePersona=base라 프롬프트·policy_version이
   B-2b 이전과 바이트 동일인가? O1-5(full 프롬프트 전체 ===)·O1-6·O1-7이 hand-built 독립 expected로(033 tautology
   교훈) 봉쇄하는가?
5. **계약 내용·drift**(R1·D1). 계약이 재심사 금지·직접 영향·finding을 담고 태그를 **상수 참조**하는가(하드코딩
   시 태그 변경에 계약이 안 따라옴)? O1-1이 잡는가?
6. **사용자 문서 계약**(R6·D5, 032 r06-3). null persona 계약 변경이 README·README.en·SSOT에 반영됐는가? O1-8이
   문서 grep으로 고정하는가?
7. **분할·완전성**. persona 표면만 격리한 게 032 비수렴을 해소하는가? O1-1~O1-8이 032의 6R findings(null 정책·
   로그 배선·프롬프트+로그 동시·null live·kind 격리·문서)를 **처음부터** 덮는가? "순수는 맞고 main 배선만 틀린"
   구현을 near-e2e가 잡는가?
