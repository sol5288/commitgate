# REQ-2026-087 설계

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

| 자리 | 현재 | 비고 |
|---|---|---|
| `lib/config.ts` `DEFAULTS.granularityGate` | `'block'` | **유일한 실질 변경 지점** |
| `review-codex.ts` phase preflight | `gate === 'block'` → throw, 아니면 `console.warn` | 코드 **무변경** — 분기가 이미 있다 |
| `req-doctor.ts` `phaseGranularityWarnings(files, max, gate = DEFAULTS.granularityGate)` | 기본 인자가 DEFAULTS를 따른다 | **자동으로 warn 문구**가 된다 |
| `workflow/req.config.schema.json` | `enum: ["block","warn"]` | **무변경** — 값 집합은 그대로 |

🔴 **스키마가 안 바뀐다** → 이번엔 소비자 `commitgate sync`가 필요 없다(0.13.0과 다른 점).

## 핵심 설계 결정

### DEC-1 — 바꾸는 것은 **기본값 한 줄**뿐

`DEFAULTS.granularityGate: 'block'` → `'warn'`.

차단 경로(`throw`)는 코드로 남는다(R3). 정책을 삭제하는 것이 아니라 **기본을 뒤집는** 것이다.

### DEC-2 — 판정 시점·메시지는 손대지 않는다

리뷰 직전 판정(REQ-2026-086 DEC-1)과 두 탈출구 메시지는 그대로다(R2). 이 REQ가 되돌리는 것은
**강도뿐**이다. 시점이 이 정책의 실제 가치이고, `warn`이어도 그 가치는 유지된다 —
예전 D18은 *커밋 직전*에 *"다음부터 분할 권고"*라는 행동 불가능한 조언을 냈다.

### DEC-3 — D18 문구는 자동으로 정합해진다(그리고 그것을 테스트로 고정한다)

`phaseGranularityWarnings`의 3번째 인자 기본값이 `DEFAULTS.granularityGate`이므로, 기본값을 바꾸면
2-arg 호출의 문구가 자동으로 warn 변형이 된다(R4). **다만 그 정합이 우연이 아님을 테스트로 고정한다** —
기본값과 문구가 갈라지면 REQ-2026-086 phase-2 r01 P1(안내가 실제 동작과 어긋남)이 재발한다.

### DEC-4 — 0.13.0 CHANGELOG 절의 ⚠️ 고지를 **정정한다**

0.13.0 절은 *"이 릴리스는 동작을 좁힙니다 … 되돌리려면 warn 한 줄"*이라고 적혀 있다. 0.13.1 이후
그 문장은 거짓이 된다. **과거 절을 지우지 않고**, 그 자리에 0.13.1이 기본값을 되돌렸다는 포인터를 단다
(릴리스 노트는 그 시점의 사실이므로 이력을 보존하되, 읽는 사람이 현재 동작을 오해하면 안 된다).

## Phase별 구현

### phase-1-default-warn (단일 phase — 완결 REQ의 사후 정정)

- `scripts/req/lib/config.ts` — 기본값 + 주석 근거 교체 (DEC-1)
- `tests/unit/req-doctor.test.ts` — 기본 인자 문구가 warn 변형임을 고정 · `'block'` 명시 시 차단 문구 유지 (DEC-3)
- `tests/unit/review-lifecycle-wiring.test.ts` — 🔴 **기본 설정에서 초과해도 리뷰가 진행된다** ·
  `"granularityGate": "block"` 명시 시 차단이 그대로 동작한다 (R1·R3)
- `docs/workflow.md` · `docs/workflow.en.md` — 기본 동작 서술 반전, `block` opt-in 안내
- `CHANGELOG.md` — 0.13.1 절 + 0.13.0 절 ⚠️ 고지에 정정 포인터 (DEC-4)

회귀 가드: ①기본값이 `'warn'` ②기본 설정에서 20파일 staged여도 phase 리뷰가 면적으로 중단되지 않음
③`block` 명시 시 여전히 throw + 두 탈출구 메시지 ④`phases[].max_files` 계약 불변
⑤D18 문구가 기본 설정에서 "막힙니다"를 말하지 않음 ⑥`req.config.schema.json` 무변경(enum 그대로).

## 변경 파일

| 파일 | 성격 |
|---|---|
| `scripts/req/lib/config.ts` | 기본값(한 줄) + 주석 |
| `tests/unit/req-doctor.test.ts` · `tests/unit/review-lifecycle-wiring.test.ts` | 회귀 가드 |
| `docs/workflow.md` · `docs/workflow.en.md` | 기본 동작 서술 |
| `CHANGELOG.md` | 0.13.1 + 0.13.0 정정 |

## 하위호환·안전

- **동작이 넓어지는 방향**이다 — 0.13.0에서 막히던 것이 통과한다. 업그레이드로 새로 막히는 것은 없다.
- `"granularityGate": "block"`을 이미 명시한 설정은 **아무 영향 없다**(명시값 우선).
- **스키마 무변경** → `commitgate sync` 불요. vendored 자산 skew(D20)가 생기지 않는다.
- 판정 시점·`max_files`·`granularityMaxFiles`·D18 레벨(WARN)은 전부 그대로다.
