# REQ-2026-018 설계 — 리뷰 severity 배선 (findings=P1만 차단)

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 1. 현재 상태(변경 대상)

**리뷰어에게 스키마가 전달되는 경로**(이미 존재, 재사용):

```
workflow/machine.schema.json  ──(검증 SSOT, 불변)──> AJV 응답·아카이브 검증
        │
        └─ readFileSync ─> deriveStrictOutputSchema() ─> temp/output-schema.json ─> codex --output-schema
                           (adapters.ts:123)                                         (리뷰어가 실제로 보는 것)
```

- `deriveStrictOutputSchema()`는 현재 **root `required`를 properties 전체로 확장**하는 일만 한다(OpenAI strict mode 400 방지, REQ-2026-005).
  스키마를 통째로 파싱→수정→직렬화하므로 **description을 포함한 모든 필드가 리뷰어에게 그대로 전달된다.**
  `commit_approved`의 장문 승인 규칙이 지금 리뷰어에게 닿는 경로가 정확히 이것이다.
- `findings[].severity`: `{"type":"string","enum":["P1","P2","P3"]}` — **description 없음**. 리뷰어는 P1/P2 정의를 받은 적이 없다.
- `observations`: 장문 description 있음. severity 필드 **없음**(의도적 — 차단/비차단 경계 보호).
- `classifyReview()`(review-codex.ts:861): `findings.length > 0` → `needs-fix`. **severity를 보지 않는다.**

## 2. 핵심 설계 결정

- **D1 강제 지점 = 출력 스키마(파생 copy)뿐. 검증 SSOT는 불변.**
  리뷰어가 P2를 **낼 수 없게** 만드는 것이 목표이므로, 강제는 리뷰어가 보는 출력 스키마에서 한다.
  `machine.schema.json`의 enum을 P1로 좁히면 기존 P2/P3 아카이브가 전부 invalid가 된다(R3 위반) → **검증 enum은 `P1|P2|P3` 유지**.
  새 서브시스템을 만들지 않고 이미 있는 strict-copy 파생 지점을 재사용한다.

- **D2 `deriveStrictOutputSchema()`가 `findings[].severity.enum`을 `["P1"]`로 축소한다.**
  root `required` 확장과 같은 함수 안에서, 같은 파싱 결과에 대해 수행한다(순수 함수 유지 — 입력 문자열 → 출력 문자열).

- **D3 경로 부재 시 throw(fail-closed).**
  `properties.findings.items.properties.severity.enum`이 없으면 **축소를 조용히 건너뛰지 않고 throw**한다.
  조용히 넘기면 P2가 다시 findings에 들어올 수 있는 **정책 구멍**이 되고, 이 구멍은 스키마가 깨진 순간에만 열리므로 아무도 눈치채지 못한다.
  throw하면 리뷰 자체가 실패 = 승인 불가 = fail-closed. `machine_schema_version`이 `1.1`로 고정된 MANAGED 파일이므로
  정상 경로에서 이 throw는 발생하지 않는다.

- **D4 P1 정의는 `machine.schema.json`의 `severity.description`에 둔다.**
  D1의 파생이 스키마를 통째로 복사하므로 **description은 자동으로 리뷰어에게 전달된다**(별도 배선 불필요).
  검증 스키마에 description을 추가하는 것은 **검증 동작에 영향이 없다**(AJV는 description을 무시) → R3 하위호환 유지.
  즉 "enum은 관대하게(하위호환), description은 정확하게(리뷰어 지시)"가 한 파일에서 양립한다.

- **D4-1 하중을 받는 것은 enum 축소가 아니라 카테고리 한정이다.**
  enum을 `["P1"]`로 좁히는 것만으로는 차단 범위가 좁아지지 않는다 — 리뷰어는 같은 지적을 P1 라벨로 옮겨 달면 그만이다.
  실제로 범위를 좁히는 것은 description의 **카테고리 한정**(요구 위반·데이터 손상·보안·금전 오류·fail-closed 우회)과
  **배제 규칙**(그 외는 정상 경로에서 재현되더라도 P1이 아니며 `observations`로)이다.
  D2(enum 축소)는 "P2 라벨로 비차단 의견을 차단 채널에 넣는" 경로를 없애고, D4-1은 "P1 라벨로 같은 일을 하는" 경로를 좁힌다.
  **둘 다 있어야 목표가 성립한다**(R2의 4요소).

- **D5 `classifyReview()`는 건드리지 않는다.**
  D2가 성립하면 findings에는 P1만 들어온다. 그러면 "findings 있으면 차단"은 **이미 옳은 로직**이다.
  상태 전이·해시 비교 로직에 손대지 않는 것이 이 티켓의 수렴 조건이다(REQ-2026-015/016/017이 그 지점에서 terminal).

- **D6 persona는 상단 프레임에서 경계를 건다.**
  현재 5~7행("리뷰 포인트는 하한이지 상한이 아니다" · "묻지 않은 결함도 스스로 분석해 지적하라" · "개발 부채가 남지 않도록 하라")이
  문서의 **가장 강한 위치**에서 무한 범위를 허가하고, 억제 문장은 27행에 뒤늦게 온다.
  탐색 범위를 넓히라는 지시는 유지하되(그 자체는 옳다), **같은 위치에 보장 범위 경계와 부채 처리 규칙**을 붙여 균형을 맞춘다.
  "부채가 남지 않도록 하라" → "부채는 `observations`에 기록해 다음 티켓의 입력으로 만들라"로 교체.

## 3. Phase별 구현

**Phase 1 — severity 배선 (`phase-1-severity-wiring`)** · 단일 phase (변경 4파일, granularity 상한 8 이내)

1. `scripts/req/lib/adapters.ts` — `deriveStrictOutputSchema()`에 severity 축소 + 경로 부재 throw(D2·D3). 함수 주석 갱신.
2. `workflow/machine.schema.json` — `findings[].severity.description` 추가(D4). **enum은 `P1|P2|P3` 그대로**.
3. `workflow/review-persona.md` — 상단 프레임에 경계·P1 정의·부채→observations(D6).
4. `tests/unit/req-adapters.test.ts` — R1(축소)·**R2(description 3요소 각각 단언)**·R3(하위호환)·D3(throw) 회귀 추가.
   R3는 아카이브 **전체**를 원본 스키마로 검증하고 P2·P3가 실제 존재함을 함께 단언한다(표본 1건은 하위호환을 고정하지 못한다).

Exit: `npm test` 그린 · `npm run typecheck` 0에러 · `classifyReview()` diff 0줄 · Codex phase 리뷰 승인.

## 4. 변경 파일

| 파일 | 변경 | 성격 |
|---|---|---|
| `scripts/req/lib/adapters.ts` | `deriveStrictOutputSchema()` 축소 로직 + throw | 순수 함수, 기존 테스트 있음 |
| `workflow/machine.schema.json` | `severity.description` 추가 (enum 불변) | 선언적 |
| `workflow/review-persona.md` | 상단 프레임 경계 | 텍스트 |
| `tests/unit/req-adapters.test.ts` | 회귀 4건(R1·R2·R3·D3) | 테스트 |

## 5. 하위호환·안전

- **기존 아카이브(P2/P3 포함) 검증 유지**: 검증 enum을 건드리지 않으므로 `workflow/REQ-2026-0*/responses/*.json`은 전부 그대로 통과(R3).
  REQ-2026-014의 design r01~r30, 011~013의 phase 아카이브가 모두 P2/P3를 담고 있다.
- **기존 설치본(MANAGED 스키마)**: `description` 추가는 AJV 검증 동작에 영향이 없다. 구버전 스키마를 가진 설치본은
  severity 축소가 적용되지 않을 뿐 리뷰는 계속 동작한다(하위호환, 강제만 미적용).
- **fail-closed 유지**: D3의 throw는 리뷰 실패 → 승인 불가. 약화 없음.
- **잔존 리스크 — severity inflation**: 리뷰어가 P2를 P1로 올릴 수 있다. D4의 "재현 경로 필수"가 억제 장치이며
  **제거가 아니라 완화**다. 정량 관측(다음 티켓의 P1 비율)은 후속 REQ의 라운드 상한과 함께 다룬다.
  이번 REQ는 이 리스크를 지지 않는 척하지 않는다.
