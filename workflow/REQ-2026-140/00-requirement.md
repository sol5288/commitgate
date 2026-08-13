# REQ-2026-140 요구사항

## 무엇을

`stopGate: "auto"`를 **사전 위임(pre-delegation) 기반 자율 통합 모드**로 구현한다.

작업 시작 시점에 사람이 명시적으로 위임을 기록하면, 계획된 LOW phase · 권장안 기반 일반 판단 ·
`onSoftLimit: "auto"` 범위의 재리뷰 · 최종 검증 · main 통합까지 사람 대기 없이 순차 진행한다.

## 왜

REQ-2026-135는 `stopGate: "auto"`를 **두지 않기로** 결정하고 그 근거를 문서화했다. 그 근거의 핵심은
"도구가 사람의 확인 기록을 대신 만드는 방식은 시각 날조 표면을 되살린다(REQ-2026-019)"였고, 같은 문서가
**정직한 유일한 형태는 작업 시작 시점의 사전 위임 기록**이며 그것은 안전 속성 변경이라 별도 논의가
필요하다고 적었다.

이 REQ가 그 논의의 결과다. 사용자가 사전 위임 형태를 명시적으로 채택했다.

🔴 **그러므로 `docs/configuration*.md`의 "`stopGate: "auto"`는 없습니다" 절은 이 REQ와 함께 거짓이 된다.**
새 값을 넣고 그 절을 남기면 문서가 자기모순이 된다 — 같은 phase에서 고친다.

## 실측 전제 (설계 전 확인한 것)

🔴 **`integrate`의 사람 확인은 이미 대화형에서만 걸린다**(`bin/integrate.ts:284` — `if (deps.interactive)`).
비대화형 에이전트 세션에서 `integrate --run`은 **오늘도 질문 없이 로컬 병합한다.** 지금 그것을 막는 것은
`AGENTS.md` 계약(에이전트는 승인 문장을 받아야 한다)이지 도구가 아니다.

→ 따라서 사전 위임은 **도구 게이트를 푸는 것이 아니라, 그 경로에 처음으로 도구 게이트를 거는 것**이다.
`auto`에서 `integrate`는 유효한 위임이 **없으면 거부**한다. 이는 현행보다 **더 잠긴** 상태다.

## 필수 요구 (사용자 명시)

1. `stopGate` enum·schema·setup에 `"auto"`를 추가한다.
2. 사전 위임 레코드: 대상 식별자(ticket 또는 delivery) · 대상 trunk · 허용 source 브랜치 ·
   기준 SHA · **분리된 허용 작업**(local merge / origin push / branch-protection bypass) ·
   만료·철회·소비 상태 · **사람이 명시 승인한 문장**.
3. 위임이 없으면 `integrate`는 기존처럼 `AWAIT_HUMAN`으로 멈춘다.
4. 위임이 있어도 fail-closed로 중단: trunk SHA 변경 · feature/delivery 구성 변경 ·
   승인/검증 증거 불일치 · merge conflict · `hardCap` 도달 · HIGH 위험의 별도 위임 부재 ·
   BLOCKED/불확실한 리뷰 결과.
5. 권한은 **정확한 검증 SHA에만 한 번** 소비한다(CAS).
6. bypass·remote push는 **기본 불허**. 위임에서 각각 별도로 허용했을 때만 실행하고, bypass를 썼다면
   결과·근거·소비 사실을 원장과 최종 보고에 남긴다.
7. `onSoftLimit: "auto"`와 `stopGate: "auto"`의 관계를 명확히 한다 — 소프트 한도는 자동 진행,
   `hardCap`은 **항상** 중단, 비용 상한을 무한화하지 않는다.

## 제약

- 🔴 **임의의 설정 변경이나 대화 문장으로 main 병합 권한이 생기면 안 된다.** `stopGate: "auto"`로 바꾸는
  것만으로는 아무 권한도 생기지 않는다 — 권한은 **레코드**에서만 나온다.
- `auto`는 명시적 opt-in이며 `phase`·`req`·`merge` 동작을 **바꾸지 않는다**(무회귀).
- 시각은 **도구가 실제 시계에서 읽는다.** 사람이 손으로 적은 시각을 신뢰하지 않는다(REQ-2026-019).
- 위임 레코드는 **커밋되는 append-only 원장**이다. gitignore 대상이 아니다 — 권한 근거가
  워킹트리에만 있으면 감사되지 않는다.

## 완료 기준

사용자가 명시한 8종 테스트 전부 + 문서(README·configuration·workflow) + `typecheck`·`docs:lint`·
`npm test`·`verify-range --strict`.
