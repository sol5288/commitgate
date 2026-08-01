# REQ-2026-098 리뷰 요청 — phase-1-warn-message-accuracy

## 배경

**도그푸딩 중 발견**(소비자 리포트 아님). REQ-2026-096의 phase 리뷰가 9파일이라 granularity 임계(8)를
넘겼고, 출력이 이랬다:

```
⚠️ phase 검수 면적 초과: 코드 변경 9파일 > 8(granularityMaxFiles)
   … 리뷰를 실행하지 않았습니다 — 소모된 것이 없습니다.
   (정책 자체를 끄려면 req.config.json에 "granularityGate": "warn" …)
⚠️  codex 실제 호출 (exec) — 호출 1회 발생          ← 실제로는 실행됐고 과금됐다
```

`granularityGate` 기본값은 `warn`(REQ-2026-087)이라 **기본 설정 사용자 전부**가 비용에 관한 거짓
진술과 무의미한 조치 권고를 받았다. 같은 원칙(REQ-2026-086 r01 P1: "문구는 실제 설정에 종속된다")이
이미 `req-doctor.ts`의 `phaseGranularityWarnings`에 있는데, 그때 doctor만 고치고 이 표면을 빠뜨렸다.

설계는 r01 승인(비차단 관찰 1건: phase 요청서에 정확한 검증 명령을 적으라 — 아래 반영).

## 변경 요약 (이번 staged diff)

| 파일 | 변경 |
|---|---|
| `scripts/req/review-codex.ts` | **DEC-1** `phaseAreaMessage(v, phaseId, gate)` — doctor의 `phaseGranularityWarnings`와 같은 시그니처 형태 · **DEC-2** block 문구 유지 · **DEC-3** warn 분기 · 호출부(`:2694`)에서 `cfg.granularityGate` **명시 전달** |
| `tests/unit/req-review-codex.test.ts` | **DEC-4** 순수 6항목(warn 금지 문자열·warn 필수 문자열·block 유지+대칭·교차 검사·공통 유지·기본값=warn) |
| `tests/unit/review-lifecycle-wiring.test.ts` | **DEC-5** 배선 — 실제 `mainImpl`을 warn 설정으로 돌려 `console.warn` 출력을 검사 |
| `CHANGELOG.md` | Unreleased 항목 + 확인할 파일 표 |

**동작 변경 0 — 출력 문자열만 바뀐다.** 차단 여부·임계·기본 모드 전부 그대로다.

### 설계에서 벗어난 판단 1건 (검토 요청)

설계의 변경 파일 표는 DEC-5 배선 테스트도 `req-review-codex.test.ts`에 두는 것으로 적었다.
구현에서는 `review-lifecycle-wiring.test.ts`에 뒀다 — 거기에 이미 `setGate`(config 커밋)·
`setupPhaseRepo`·`stageCode`·`runPhase`(reviewer 주입) 하네스가 **그대로 있다.** 복제보다 재사용이
낫다고 판단했다. 파일 위치만 다르고 DEC-5의 내용(실제 진입점 실행)은 그대로다.

## 실측 검증

**설계 前 실측이 초안을 반증했다.** 처음에는 warn 문구에 "호출 1회가 나갑니다"를 쓰려 했는데,
이 `console.warn`(`:2695`) **뒤에** `gateAndRecordAttempt`가 오고 예산 소진·예외 필요로 `throw`할 수
있다(`:1711-1723`). 그래서 문구를 **"이 검사는 리뷰를 멈추지 않습니다"**로 좁혔다 — 이 검사가
주장할 수 있는 것은 자기 자신에 대한 사실뿐이다.

**전수 확인** — "차단한다·소모되지 않았다"고 주장하는 문구를 전부 훑어 실제 동작과 대조했다:

| 표면 | 실제 | 판정 |
|---|---|---|
| `phaseAreaMessage`(review-codex:1338) | warn이면 실행·과금 | ❌ 결함(이번 수정) |
| `forbiddenStagedMessage`(review-codex:1365) | `:2627`에서 항상 `throw` | ✅ 정확 |
| `phaseGranularityWarnings`(req-doctor:204) | 모드별 분기 | ✅ 정확 |
| `bin/init.ts` "막힙니다" 4곳 | 실제 차단 | ✅ 정확 |

**변이 검사** — 호출부를 `cfg.granularityGate` 대신 상수 `'block'`으로 바꿔 돌렸더니
`req-review-codex.test.ts`의 **순수 테스트는 전부 통과**했고 `review-lifecycle-wiring.test.ts`의
REQ-098 배선 테스트만 실패했다. DEC-5가 필요하다는 근거가 실측으로 확인됐다. 이후 복구했다.

**게이트(실행 명령 — 설계 r01 관찰 반영)**

- `npx tsc --noEmit` → exit 0
- `npm test`(= `vitest run`) → **2450/2450 통과(50파일), exit 0**
- `npm run docs:lint` → 이번 phase는 `docs/` 무변경이라 해당 없음(CHANGELOG는 remark 대상 밖)

## 리뷰 포인트

1. **warn 문구가 정직한가.** "granularityGate="warn"이라 이 검사는 리뷰를 멈추지 않습니다"가
   이 시점에 참인 유일한 진술인지. 더 강하게 말할 수 있는 근거가 있는가, 아니면 이것도 과한가.

2. **block 문구 유지의 대칭.** block 문구는 여전히 `"granularityGate": "warn"`을 권한다 —
   그 모드에서는 정확한 조치다(끄는 법). 테스트가 두 방향을 교차로 고정했는데 충분한가.

3. **DEC-1의 기본값.** `gate: GranularityGate = DEFAULTS.granularityGate`로 뒀고 호출부는 명시
   전달한다. 기본값을 아예 없애 필수 인자로 만드는 편이 배선 누락을 타입으로 막는가 —
   그렇다면 그것이 더 나은가(외부 호출자가 없으므로 파괴적이지 않다).

4. **테스트 위치 변경(위 "설계에서 벗어난 판단")이 타당한가.**

5. **누락된 표면.** 전수 확인 표에서 빠뜨린 축이 있는가 — `req:next`의 안내, 문서(`docs/`),
   companion skills 텍스트 중 granularity 차단을 약속하는 곳.

6. **회귀 위험.** 기존 `review-lifecycle-wiring.test.ts`의 block 테스트들(`granularityGate` 문자열
   포함을 단언하는 `:288` 등)이 이번 분기로 깨지지 않는지 — 전체 스위트로 확인했으나
   문구 단언이 우연히 통과하는 형태는 아닌지 봐달라.
