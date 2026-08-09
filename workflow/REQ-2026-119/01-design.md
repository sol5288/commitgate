# REQ-2026-119 설계

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

| 사실 | 위치 | 확인 |
|---|---|---|
| 게이트가 읽는 위험도는 `state.risk_level`(생성 시 입력·기본 LOW)뿐 | `req-new.ts`·`req-commit.ts` | 읽음 |
| 리뷰어 위험 평가는 deprecated — 출력 스키마에서 탈락 | REQ-2026-084 DEC-3 | 읽음 |
| doctor는 staged 목록을 이미 갖고 있다(`statusEntries`·D13/D18 입력) | `req-doctor.ts` `main()` | 읽음 |
| D-체크 등록부·정본 표 일치는 가드가 강제 | `D_CHECK_IDS`·`docs/ssot-design/07` §3·`docs-stale-claims.test.ts` | 읽음 |
| 실행 로그 subjects 허용 목록 = 티켓 id·계약 파일명(경로 금지) | REQ-2026-117 DEC-5 | 읽음 |
| config 확장 선례: 선택 키 + 스키마 갱신 + 기본값 | `lib/config.ts`·`workflow/req.config.schema.json` | 읽음 |

## 핵심 설계 결정

### DEC-1 · 감지는 순수 매처, 기본 패턴은 좁게 시작한다

`scripts/req/lib/effective-risk.ts` 신설:

```
export const DEFAULT_RISK_PATTERNS: readonly string[] = [
  '.env', 'secret', 'credential', 'password', 'private-key',
  'payment', 'webhook', 'migration',
]
effectiveRiskHits(stagedPaths: readonly string[], patterns: readonly string[])
  → { pattern: string; count: number; samples: string[] }[]   // samples ≤ 3
```

- 매치 = **경로 소문자화 후 부분 문자열 포함**. glob·정규식을 쓰지 않는 이유: 패턴 문법 오류가
  침묵 비활성이 되는 표면을 만들지 않기 위해서다(문자열 포함은 오해의 여지가 없고, 오탐은 WARN이라
  비용이 낮다).
- 기본 목록에서 **의도적으로 뺀 것**: `auth`(author·oauth-doc 등 오탐 과다), `token`(tokenizer),
  `deploy`(디렉터리명 일반), `schema`(이 저장소 자신이 상시 오탐). 시작은 좁게 — 늘리는 것은
  발화 데이터를 본 뒤가 싸고, 오탐 수습은 비싸다(D30 경고 피로의 실측 교훈).
- 대표 경로는 패턴당 3개까지(`samples`) — 메시지 폭주 방지.

### DEC-2 · config `riskPaths`는 **대체**다(합집합 아님)

`riskPaths?: string[] | null` — 미지정/null = 기본 목록 · 지정 = 그 목록만 사용 · `[]` = 비활성.
합집합으로 하면 프로젝트가 기본 목록의 오탐 항목을 **제거할 방법이 없다**. 스키마
(`req.config.schema.json`)와 `DEFAULTS`·로더에 선례대로 추가한다.

### DEC-3 · D31 — WARN 전용, staged가 있을 때만 판정

- 입력: `main()`이 이미 계산하는 staged 경로 목록(추가 git 호출 0회)과 config 패턴.
- staged 없음(리뷰 전 단계 등) → OK "점검 불요". 일치 없음 → OK. 일치 → WARN:
  `이 phase의 staged 변경이 민감 경로 패턴 N종에 일치(<pattern>: <sample>, …) — 티켓 위험도(<risk_level>)와 별개로 실효 위험을 확인하세요. 확인을 강제하려면 리뷰·사람 검토를 이 phase에 집중하십시오.`
- 티켓이 이미 HIGH여도 WARN을 낸다(정보는 중복이 아니라 확인이다 — 단 메시지에 현재 risk_level을
  포함해 "이미 HIGH로 취급 중"임이 보이게 한다).
- `level` 도달 가능값은 OK·WARN뿐 — FAIL 경로를 만들지 않는다(테스트로 고정). 실행 로그에는
  기존 규칙대로 id·level만 실리고 **subjects를 내지 않는다**(경로는 허용 목록 밖 — R6).

### DEC-4 · 하지 않는 것 (경계의 명시)

- **확인 강제 없음** — `riskEscalation: 'confirm'` 류 옵션은 이 REQ에 없다. 근거는 00-requirement
  배경(0.13.0 선례·REQ-2026-066 교훈). D31 발화율이 쌓이면 후속 REQ가 (a) 강제 opt-in 도입과
  (b) `stopGate` 단일 지배 원칙(REQ-2026-071)·guarantees 문서와의 조정을 함께 결정한다.
- `state.risk_level` 자동 변경 없음 — 티켓 위험도는 여전히 사람의 선언이다.
- 리뷰 프롬프트 변경 없음.

## Phase별 구현

**Phase 1 (`phase-1-risk-detect`)** — `lib/effective-risk.ts`(매처·기본 목록) + config
`riskPaths`(스키마·로더·기본값) + D31(등록부·판정·수집부) + `docs/ssot-design/07` §3 표 갱신 +
테스트(`tests/unit/effective-risk.test.ts` 신규 + doctor 등록부 가드 갱신분) + CHANGELOG.

단일 phase인 이유: 매처는 D31 없이는 죽은 코드고 D31은 매처 없이 정의가 안 된다 — 나누면
중간 상태가 리뷰 불가능하다. 코드 변경 파일 수는 7±1로 권고 안이다.

## 변경 파일

| 파일 | 변경 |
|---|---|
| `scripts/req/lib/effective-risk.ts` | 신규 — 순수 매처·기본 목록 |
| `tests/unit/effective-risk.test.ts` | 신규 |
| `scripts/req/lib/config.ts` · `workflow/req.config.schema.json` | `riskPaths` 선택 키 |
| `scripts/req/req-doctor.ts` | D31 등록·판정·수집 |
| `tests/unit/req-doctor.test.ts` | D31 케이스·FAIL 부재 고정 |
| `docs/ssot-design/07-business-rules-and-state-machines.md` | §3 표에 D31 |
| `CHANGELOG.md` | Unreleased |

## 테스트 oracle (완료 기준 ↔ 검증)

| 완료 기준 | 오라클 | 잡는 결함 |
|---|---|---|
| 1 | 기본 패턴 일치 staged → WARN + 패턴·샘플 표기 | 감지 누락 |
| 2 | 무일치 → OK · **이 저장소 staged 픽스처(스크립트·문서 경로)로 오탐 0 확인** | 기본 목록 과대 |
| 3 | `riskPaths` 지정 시 기본 무시(기본에만 있는 패턴 미발화)·`[]` → 항상 OK | 대체 의미 회귀 |
| 4 | D31 push 지점의 level 리터럴이 OK/WARN뿐(코드 검사) + 일치 상황 runChecks에 FAIL 없음 | 침묵 게이트화 |
| 5 | 기존 등록부↔정본 표 가드 그린 | 정본 불일치 |
| 6 | D31 Check에 subjects 부재 + 실행 로그 행에 경로 미포함 | 경로 유출 |

## 하위호환·안전

- 기존 게이트·판정 무변경 — 새 진단 1개(WARN 상한). config 신규 키는 선택이라 기존 설정 유효.
- 기본 패턴이 좁아 기존 소비자 워크플로에 새 상시 WARN을 만들지 않는 것을 완료 기준 2가 고정한다.
- 단일 활성 worktree·협조적 작업자 경계 유지.
