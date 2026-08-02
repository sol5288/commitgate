# REQ-2026-108 설계

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

`scripts/req/req-doctor.ts` D5:

```ts
const tid = s.codex_thread_id
if (typeof tid === 'string' && tid.length > 0 && !UUID_RE.test(tid))
  c.push({ id: 'D5', level: 'FAIL', msg: `codex_thread_id 형식 오류: ${tid}` })
else c.push({ id: 'D5', level: 'OK', msg: 'thread_id 형식 OK(또는 미설정)' })
```

`runChecks`는 순수 함수이고 `main()`이 `FAIL ≥ 1 → exit 1`을 판정한다(`:1203-1205`). `req:commit`은 doctor를 하드 게이트로 spawn하므로 **D5 FAIL = 커밋 차단**이다.

## 핵심 설계 결정

### DEC-1 `level`만 `WARN`으로 바꾼다 — 판정 조건은 건드리지 않는다

무엇을 이상으로 볼지(`문자열 && 비어있지 않음 && UUID 아님`)는 그대로 둔다. 이 REQ가 바꾸는 것은 **그 이상이 커밋을 막을 자격이 있는가** 하나다.

- 조건까지 손대면 "무엇이 바뀌었나"가 흐려지고, 회귀 테스트의 오라클도 두 축이 된다.
- 🔴 **메시지 문구도 유지**한다(`codex_thread_id 형식 오류: <값>`). 소비자가 grep으로 잡고 있을 수 있는 문자열을 이유 없이 바꾸지 않는다. 강등 사유는 **주석**에 적는다(출력이 아니라).

### DEC-2 강등 사유를 검사 옆에 **명문화**한다

D19~D27이 WARN 상한인 근거 주석은 이 파일에 여덟 번 복붙돼 있다. D5는 그 원칙보다 먼저 만들어져 밖에 남았다. 같은 근거를 D5 자리에도 적되, **이 검사에만 있는 사실**을 함께 적는다: 이 필드는 **읽는 코드가 D5 자신뿐**이다(REQ-2026-103이 마지막 소비 경로를 제거).

주석이 없으면 다음 사람이 "형식 검사인데 왜 WARN이지" 하고 FAIL로 되돌린다 — 이 저장소에서 실제로 반복된 실패 양식이다(REQ-2026-073·094의 "새 절 추가≠갱신").

### DEC-3 회귀 테스트는 **exit 판정까지** 본다

`runChecks`가 `WARN`을 낸다는 것만 확인하면 부족하다. 이 REQ의 요구는 "커밋이 막히지 않는다"이므로 **FAIL이 0건**임을 함께 단언한다 — `main()`의 exit 규칙이 `FAIL ≥ 1`이기 때문이다.

🔴 `main()`을 돌려 exit code를 직접 보는 near-e2e는 만들지 않는다. `runChecks`가 순수하고 exit 규칙이 `FAIL 개수` 하나로 명시돼 있어, "FAIL 0건"이 곧 "exit 0"이다. 오라클을 두 겹으로 만들 이유가 없다.

## Phase별 구현

| phase | 내용 | 파일 |
|---|---|---|
| `phase-1-d5-warn` | DEC-1~3 + CHANGELOG | 3 |

## 변경 파일

- `scripts/req/req-doctor.ts` · `tests/unit/req-doctor.test.ts` · `CHANGELOG.md`

## 하위호환·안전

| 축 | 영향 |
|---|---|
| **정상 UUID 티켓** | **불변**(OK) — 소비자 대부분이 여기 |
| **형식 이상 티켓** | FAIL → WARN. **막히던 것이 안 막히는 방향** — 새로 막히는 경로는 없다 |
| exit code | 그 상태에서 1 → 0 |
| `D_CHECK_IDS`·정본 표 | **불변**(id 추가·제거 없음 → `docs-stale-claims`의 집합 동일성 검사 무영향) |
| 메시지 문자열 | **불변**(DEC-1) |
| state·아카이브·프롬프트 | 미접촉 |

**되돌리기**: 단일 커밋 revert.
