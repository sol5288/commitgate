# REQ-2026-170 리뷰 요청

## 배경

REQ-2026-169 가 만든 `lib/intake-batch.ts` 가 `cross-spawn` 을 직접 import 해
`external-call-boundary.test.ts` 의 스폰 경계 가드가 red 다(전체 스위트 4302건 중 이 1건).

## 변경 요약

등록부(`SPAWNING_FILES`)를 늘리지 않고 `adapters.safeSpawnSyncStatus` 를 경유하도록 돌린다.
그 함수는 exit code 를 보존하고 stdout 을 가공하지 않아, 이 모듈이 필요로 하는 두 계약
(`-z` 프레이밍 보존 · 실패와 "티켓 없음" 구분)을 그대로 만족한다.

## 리뷰 포인트

1. **등록부 추가가 아니라 경계 경유가 맞는 판단인가.** `git-batch.ts` 가 등록부에 남아 있는 사유
   (stdin 스트리밍)와 이 모듈의 1회 왕복 호출이 실제로 다른 부류인지.

2. **계약이 정말 보존되는가.** `safeSpawnSyncStatus` 가 `res.stdout.toString('utf8')` 을 그대로 주므로
   `-z` 프레이밍이 온전한지, `res.error` 분기를 지운 것이 실패 의미를 약화시키지 않는지
   (경계가 spawn 오류를 throw 한다는 전제가 맞는지).

3. **계수 오라클이 죽지 않았는가.** `intake-scan-cost.test.ts` 는 `cross-spawn` 과 `node:child_process` 를
   감싸 실제 git 스폰을 센다. 경유 경로가 `adapters` 로 바뀌어도 그 계수가 유효한지 —
   여기서 틀리면 REQ-2026-169 의 성능 계약이 **관측 불가능해진다**.

4. 이 변경으로 새로 생기는 의존(`intake-batch` → `adapters`)이 leaf 불변식을 깨지 않는지.

5. **옵션 소실이 더 없는지**(design-r01 P1 이 `maxBuffer` 를 잡았다). 경계 함수가 받지 않거나
   기본값으로 덮는 옵션이 그 밖에 남아 있는지 — `encoding`·`stdio`·`input` 을 포함해 훑어 달라.
