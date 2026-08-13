# REQ-2026-130 요구사항

## 무엇

`commitgate delivery approve` 가 기록하는 통합 승인을 **승인 시점의 delivery 브랜치 HEAD SHA에 결속**하고,
그 뒤 브랜치가 움직이면 게이트가 다시 `await-human`(재승인 필요)을 내게 한다.

## 왜

지금 승인은 `state: 'approved'` **플래그 하나**다(`DeliveryRecord`에 승인 대상 SHA가 없다).
그래서 승인 뒤 delivery 브랜치에 커밋이 더 들어와도 게이트는 계속 조용하다:

```
deliveryGateVerdict: r.state === 'approved' → { kind: 'continue', detail: '이미 통합 승인이 기록됐습니다' }
```

- `req:next` 종단은 `continue`를 `DONE`으로 읽어 **아무 안내도 하지 않는다.**
- 사람은 "승인했다"고 기억하지만 **승인한 것과 다른 내용**이 main으로 간다.

이것은 이 저장소가 phase 승인에서 이미 막아 둔 것과 **같은 종류의 구멍**이다(D9: staged tree ==
approved tree · `unknownApprovedTrees`: 승인 이후 history rewrite 탐지). 묶음 층에만 그 결속이 없다.

## 제약

- 🔴 **범위를 넘기지 않는다.** `commitgate integrate`(feature→trunk)는 이미 검증한 SHA만 CAS로 병합한다
  (REQ-2026-126). 이 REQ는 **delivery 묶음 층의 승인 결속**만 다루고 병합 경로를 재설계하지 않는다.
- 🔴 **하위호환.** 승인 SHA가 없는 기존 레코드(이 기능 이전에 승인된 묶음)는 **현행대로** 통과한다 —
  없는 결속을 소급 요구하면 이미 승인받은 묶음이 영구히 막힌다.
- 🔴 **판정은 한 함수**(`deliveryGateVerdict`)가 계속 소유한다. `seal`·`status`·`req:next`·
  `commitgate integrate`가 같은 답을 봐야 한다(REQ-2026-066 DEC-8a).
- 승인 취소·재승인은 기존 `reopen`/`approve` 경로를 쓴다 — 새 verb를 만들지 않는다.

## 완료 기준

- `delivery approve`가 승인 **직전 delivery 브랜치 tip**(`rev-parse delivery/<slug>` — 실행 위치의 `HEAD`가
  아니다)을 `approval.base_sha`로 레코드에 남긴다.
- 승인 뒤 **delivery 레코드 밖을 건드린 커밋**이 생기면 `deliveryGateVerdict`가 `await-human`(재승인)을 낸다.
  🔴 승인 레코드 커밋 자신은 staleness가 아니다 — 그렇게 두면 승인이 즉시 자기 자신을 무효화한다.
- 그런 커밋이 없으면 현행대로 `continue`.
- `approval`이 없는 옛 레코드는 `continue`(무회귀).
- 같은 판정을 `req:next`·`delivery status`·전이 직후 출력이 **안내로** 공유하고,
  `commitgate integrate`(소스가 `delivery/*`)는 **차단**으로 쓴다.
  🔴 판정은 소스 브랜치 이름으로 한다 — `branchPrefix` 는 임의 문자열을 허용하는 지원 설정이라
  `"delivery/"` 로 두면 delivery 브랜치가 전제를 통과한다. 기본 설정에서 안 걸린다는 사실이
  이 차단을 불필요하게 만들지 않는다.
  🔴 `commitgate delivery integrate`(member→delivery)는 승인 **이전** 단계라 이 판정을 쓰지 않는다.
- **보증 범위**: 도구가 소유한 병합 지점에서는 **막고**, 사람이 `git merge`/PR 로 직접 병합하는
  경로(I1/I2/B1)는 도구 밖이라 **알리기만** 한다. "어떤 방법으로도 병합할 수 없다"고 주장하지 않는다.
