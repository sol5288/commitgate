# REQ-2026-121 설계

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

| 사실 | 위치 | 확인 |
|---|---|---|
| design 승인: `writeState`(상태 기록) → `durableDesignEvidence`(responses pathspec 커밋) → `commitStateCheckpoint`(state.json 단독 커밋) | `review-codex.ts:3075` 부근 | 읽음 |
| finalize 가드: stagePaths 전부 `responses/` 하위 아니면 throw | `lib/evidence.ts:828` 부근 | 읽음 |
| checkpoint 검증: 디스크 = 직렬화 바이트 대조 + id 대조, 무변경이면 no-op(false) | `lib/state-checkpoint.ts` | 읽음 |
| DEC-1(REQ-2026-057): "증거 커밋에 상태 미동승" — 근거는 가드 보존 | `state-checkpoint.ts` 헤더 | 읽음 |
| 실측: checkpoint 커밋 1,526건(부기의 ~25%) — design 짝은 design-finalize 626건 규모 | 소비자 3곳 `--grep` | 실측 |
| phase 경로는 "소비는 finalize 성공 뒤" 불변식(B2/B3 복구 전제) | `req-commit.ts:667` 주석·`evidence.ts:523` | 읽음 |
| verify-range·D-체크는 HEAD blob·소비 SHA 기준 — 커밋 경계 무의존 | REQ-2026-116·evidence 검증부 | 읽음 |

## 핵심 설계 결정

### DEC-1 · REQ-2026-057 DEC-1의 **부분 재개정** — 가드는 유지, 허용 목록에 한 경로 추가

원 결정의 목적은 "코드/state **누수** 방지"였다. 이 REQ가 여는 것은 임의 경로가 아니라
**정확히 `<ticketRel>/state.json` 하나**이고, 그 파일도 checkpoint와 **동일한 바이트·id 검증**을
통과한 경우에만 실린다. 즉 방어의 실질(명시 화이트리스트 + 검증)은 그대로고, 커밋 경계만
합쳐진다 — 같은 두 파일 집합이 2커밋 대신 1커밋이 된다(내용 무손실).

### DEC-2 · API — `durableDesignEvidence`에 선택 인자 `companionState`

```
durableDesignEvidence(args: {
  …기존…,
  /** 동승할 소비/승인 상태(검증 완료를 호출부가 보장하지 않는다 — 이 함수가 재검증한다). */
  companionState?: { stateRel: string; serialized: string; ticketId: string }
})
```

- 함수 안에서 checkpoint와 같은 검증을 수행한다: `ports.readText(stateRel) === serialized` +
  역직렬화한 `id === ticketId`. **실패하면 throw가 아니라 동승 생략**(증거가 우선 — R2. 생략 사실을
  반환값 `stateIncluded: boolean`으로 알려 호출부가 폴백 checkpoint를 돌린다).
- 가드: `outside` 판정이 `responses/` 접두 **또는 stateRel 정확 일치**를 허용. 그 외는 기존대로 throw.
- 커밋 메시지: 동승 시 `… approvals.jsonl·state 기록`으로 표기(R4).

### DEC-3 · 호출부(review-codex design 승인 분기)

`durableDesignEvidence`에 `companionState`(방금 `writeState`한 `persistedState`의 직렬화)를 넘기고,
반환 `stateIncluded`가 true면 checkpoint 호출을 **건너뛴다**(어차피 no-op이지만 호출·로그 자체를
생략해 출력도 1줄로). false면 기존 checkpoint 경로 그대로(폴백 — 실패 정책·경고 문구 무회귀).

### DEC-4 · 멱등·복구 경로

- `already-durable`(HEAD에 행·아카이브 전부 존재): 기존대로 커밋 없음. 이때 state가 dirty면?
  → 호출부의 **폴백 checkpoint가 그대로 처리**한다(stateIncluded=false로 반환). 즉 재실행·복구
  경로의 동작은 오늘과 동일하다.
- `recommitted`(부분 복구): 인벤토리 재커밋에 state 동승을 **시도**한다 — 같은 검증·같은 생략 규칙.

### DEC-5 · 하지 않는 것

- **phase 경로 동승 없음** — `finalizeEvidenceAndConsume`은 소비가 finalize **뒤**라는 복구
  불변식(B2/B3) 위에 서 있다. 동승하려면 소비 시점 재설계(디스크 소비 선행 + 재시도 멱등 재정의)가
  필요하고, 그 복잡도는 이 REQ의 절감분과 별개로 검토돼야 한다 — 후속 REQ로 명시.
- 기존 2커밋 이력의 소급 정리 없음. attempt-opened(내구성 목적)·티켓 생성 커밋 무변경.
- checkpoint 모듈 자체는 유지된다(phase 경로·폴백이 계속 쓴다) — DEC-1 헤더 주석만 재개정 사실을
  반영해 갱신한다(옛 결정을 지우지 않고 "REQ-2026-121이 design 경로에 한해 재개정"을 덧붙인다).

## Phase별 구현

**Phase 1 (`phase-1-design-companion`)** — `lib/evidence.ts`(`companionState` 인자·가드 확장·메시지)
+ `review-codex.ts` 호출부(전달·stateIncluded 분기) + `lib/state-checkpoint.ts` 헤더 주석 갱신 +
테스트(near-e2e 커밋 수·파일 목록 / 검증 실패 폴백 / 가드 변이 / 멱등) + CHANGELOG.

단일 phase — 코드 3파일 + 테스트 + CHANGELOG(≈6파일).

## 변경 파일

| 파일 | 변경 |
|---|---|
| `scripts/req/lib/evidence.ts` | `companionState` 동승·가드 허용 목록·메시지·반환 확장 |
| `scripts/req/review-codex.ts` | design 승인 분기 전달 + 폴백 분기 |
| `scripts/req/lib/state-checkpoint.ts` | 헤더 주석에 재개정 기록(동작 무변경) |
| `tests/unit/…`(evidence·wiring 기존 파일 또는 신규) | 완료 기준 1~4 오라클 |
| `CHANGELOG.md` | Unreleased |

## 테스트 oracle (완료 기준 ↔ 검증)

| 완료 기준 | 오라클 | 잡는 결함 |
|---|---|---|
| 1 | near-e2e(fake reviewer) design 승인 → 승인 이후 신규 커밋 수 + HEAD 커밋 파일 목록에 responses/**와 state.json 동시 포함 + "state checkpoint" 커밋 부재 | 동승 미배선·이중 커밋 잔존 |
| 2 | companionState.serialized ≠ 디스크 → 커밋 파일 목록에 state 없음 + 폴백 checkpoint 경로 유지 | 검증 우회·증거 커밋 실패 전파 |
| 3 | stagePaths에 제3 경로 주입 → 여전히 throw(순수 가드 단위 테스트) | 허용 목록 과확장 |
| 4 | already-durable 재실행 → 커밋 수 0 | 멱등 회귀 |
| 5 | 기존 evidence·checkpoint·lifecycle 스위트 그린 | 광역 회귀 |

## 하위호환·안전

- 새 인자는 선택 — 다른 호출부(있다면) 무변경. 폴백이 기존 경로라 실패 모드 무회귀.
- 감사 내용 무손실(같은 파일·같은 바이트, 경계만 통합). 절감은 신규 티켓부터 적용된다(소급 없음).
- 단일 활성 worktree·협조적 작업자 경계 유지.
