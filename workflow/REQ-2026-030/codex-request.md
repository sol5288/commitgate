# REQ-2026-030 리뷰 요청

## 배경

위생 작업. REQ-2026-028(A-2a)이 `isValidIsoInstant`(형식+달력 유효성)를 도입해 `2026-99-99T99:99:99Z`
같은 달력 불가능 값을 거부한다. 그러나 **기존 `req-commit.ts`의 ISO 검증 3곳은 정규식만 써서 같은 결함**이
있다 — A-2a가 범위 밖으로 남긴 후속 observation이다. 이 REQ가 통일한다.

단일 phase(위생 작업이라 쪼갤 이유 없음).

## 변경 요약

`req-commit.ts` + 테스트만.

- `approved_at`·`consumed_at`(:166-167, 매니페스트 검증) · `confirmed_at`(:231, `userConfirmProblem`)의
  `ISO_RE.test()` → **`isValidIsoInstant()`**(review-codex, 이미 import 방향 단방향·순환 없음).
- orphan이 된 `ISO_RE` 상수(:37) 제거.

**더 엄격해질 뿐 약화 없음**: `isValidIsoInstant`는 `ISO_RE`의 **부분집합**(형식 통과 + 달력 통과만). 도구가
쓰는 `new Date().toISOString()`은 계속 통과하고, 달력 불가능 값만 이제 거부된다.

`isValidIsoInstant` 동작 무변경(A-2a에서 검증됨 — 재사용만). review-codex 무변경.

게이트: typecheck 0, 단위 그린.

## 리뷰 포인트

리뷰 포인트는 심사 범위의 하한이다.

1. **🔴 약화 없음이 실제로 성립하는가**(R2). `isValidIsoInstant`가 `ISO_RE`의 부분집합이 맞는가 — 기존에
   통과하던 정상 값(밀리초 유·무)이 전부 계속 통과하는가? O1-2가 3 필드에서 이를 고정하는가? 도구가 실제로
   생성하는 evidence·손기록 값이 새 검증을 통과하는가?
2. **🔴 달력 결함이 실제로 닫혔는가**(R1). O1-1이 3 필드 각각에서 `2026-99-99...`(+13월·2월 30일) 거부를
   확인하는가? `ISO_RE.test`로 남은 곳이 없는가?
3. **orphan 제거 안전한가**(R3). `ISO_RE`가 정말 다른 사용처가 없는가? 제거로 다른 검증이 깨지지 않는가?
   테스트가 `ISO_RE`를 import하던 게 있으면 정리됐는가?
4. **순환 import 없는가**. req-commit → review-codex 단방향 유지? review-codex→req-commit은 주석뿐인가?
5. **전체 evidence 흐름 무회귀**. 이 변경이 finalize·`req:doctor`·매니페스트 검증을 깨지 않는가? 전체
   테스트 그린으로 충분한가, 놓친 경로가 있는가?
6. **oracle**. O1-1~O1-4가 각 "→ 실패해야 하는 구현"(ISO_RE.test 잔존·밀리초 거부·형식 통과 회귀)을 실제로
   실패시키는가?
