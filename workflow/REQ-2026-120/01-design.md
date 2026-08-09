# REQ-2026-120 설계

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

| 사실 | 위치 | 확인 |
|---|---|---|
| 전송 = 조립 프롬프트를 stdin으로 `codex exec --sandbox read-only` | `lib/adapters.ts:425` 부근 | 읽음 |
| 프롬프트에 staged diff 전문(phase)·설계 문서 전문(design)·persona 포함 | `review-codex.ts` 조립부 | 읽음 |
| 마스킹·스크러빙·길이 상한 없음 — 계약이 명시 | `docs/guarantees.md`·AGENTS §6 | 읽음 |
| `prompt_bytes`는 로그에만 남는다(실행 시점 표면 없음) | `assembledPromptBytes`·로그 행 | 읽음 |
| 원장 `attempt-opened`는 codex 호출 **전** 기록(예산 차감) | `review-codex.ts` pre-call 커밋 | 읽음 |
| untracked는 리뷰에 유입 불가(D10 clean 강제) | `req-doctor.ts` D10 | 읽음 |
| config 선택 키·스키마 확장 선례 | REQ-2026-119 `riskPaths` | 읽음 |
| 실측: 단일 프롬프트 최대 ~721KB(소비자 3곳) | 가설 폴더 집계 | 이월-방향 |

## 핵심 설계 결정

### DEC-1 · 스캔은 **조립 프롬프트 전체**를 한 지점에서 본다 (`lib/secret-scan.ts`)

diff·문서·persona를 따로 스캔하면 조립 경로가 늘 때마다 구멍이 생긴다. 전송 직전의 최종
문자열 하나를 스캔하면 **전송되는 것 = 스캔된 것**이 구조적으로 보장된다.

```
scanSecrets(text: string) → { pattern: string; masked: string; index: number }[]
```

고신뢰 패턴(전부 결정적 정규식 — 오탐 근접 0을 기준으로 선정, 확장은 데이터 후):

| 패턴명 | 정규식(요지) |
|---|---|
| `pem-private-key` | `-----BEGIN [A-Z ]*PRIVATE KEY-----` |
| `aws-access-key` | `\b(AKIA\|ASIA)[0-9A-Z]{16}\b` — **temporary credential(ASIA) 포함**(설계 r01 P1) |
| `github-token` | `\bgh[opsur]_[A-Za-z0-9]{36}\b`(**ghp/gho/ghu/ghs/ghr 전부** — 설계 r01 P1) · `\bgithub_pat_[A-Za-z0-9_]{22,}\b` |
| `slack-token` | `\bxox[baprs]-[A-Za-z0-9-]{10,}\b` · `\bxapp-[0-9]-[A-Za-z0-9-]{10,}\b`(**app-level token 포함** — 설계 r02 P1) |
| `google-api-key` | `\bAIza[0-9A-Za-z_-]{35}\b` |
| `openai-key` | `\bsk-[A-Za-z0-9_-]{32,}\b` |
| `jwt` | `\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\b` |

패턴별 차단 테스트는 **위 표의 모든 접두 변형**(AKIA·ASIA / ghp·gho·ghu·ghs·ghr / xox?·xapp)을 각각 고정한다.

- `masked` = 매치의 **앞 6자 + `…`** — 차단 메시지가 비밀을 재출력하는 표면이 되지 않는다.
- 일반 코드·hex SHA(40/64자)·UUID는 위 패턴에 걸리지 않는다(완료 기준 4를 테스트로 고정).
- 🔴 **본문을 재작성하지 않는다** — 검사는 전송 여부만 정한다. 마스킹 전송은 승인 바인딩
  (리뷰 대상 = 바인딩 대상)을 깨므로 비목표다.

### DEC-2 · 정책 기본은 `block` — warn-first 선례의 적용 경계를 명시한다

`secretScan: 'block' | 'warn' | 'off'`(기본 `block`). 0.13.1의 "기본은 warn" 선례는 **수렴
마찰**(리뷰 라운드 증가)에 대한 것이었다. 여기는 (a) 실패가 비가역(외부 전송)이고 (b) 패턴이
고신뢰라 마찰 비용이 근접 0이다 — 두 조건이 모두 반대라 기본 차단이 비례적이다. 오탐이
실재하면 `warn`/`off`가 탈출구고, 그 사실 자체가 패턴 조정의 데이터가 된다.

### DEC-3 · 배선 순서 — 스캔은 `attempt-opened` **앞**이다 (R3)

조립 → **scanSecrets** → (차단이면 여기서 exit 1 — 원장·codex 미접촉) → attempt-opened →
codex 호출. 현재 코드의 pre-call 원장 커밋 지점 앞에 삽입한다. `warn`이면 경고 출력 후 통과.
차단 exit는 기존 fail-closed 관례(exit 1)를 따르고, BLOCKED(2)·NEEDS_FIX(3)와 혼동되지 않게
메시지에 "리뷰를 실행하지 않았고 예산도 차감되지 않았다"를 명시한다.

### DEC-4 · 크기 표면 — 경고는 분해와 함께, 상한은 opt-in (R4)

- `promptWarnBytes`(기본 262144): 초과 시
  `⚠️ 프롬프트 <N>KB (persona <a>KB · 문서/diff <b>KB · 문맥 <c>KB) — 비용에 유의`
  1줄 경고 후 **진행**. 분해는 조립부가 이미 갖고 있는 블록 문자열들의 byteLength 합산이다.
- `promptMaxBytes`(기본 null): 설정·초과 시 fail-closed — "분할하거나 lockfilePromptFull=false
  (기본 요약) 확인, 문서를 나누라" 안내. **절단은 어떤 경로에도 없다** — 절단은 리뷰어가 못 본
  부분을 승인하는 결과가 된다(조용한 절단 금지·REQ-2026-095 실측 교훈과 같은 계열).
- 검사 지점은 스캔과 같은 곳(전송 직전) — warn/max 판정도 최종 문자열 기준.

### DEC-5 · config·스키마

`secretScan`(enum, 기본 'block') · `promptWarnBytes`(integer ≥1, 기본 262144) ·
`promptMaxBytes`(integer ≥1 | null, 기본 null). REQ-119 `riskPaths` 선례대로
RawConfig·CONFIG_SCHEMA·DEFAULTS·로더·`req.config.schema.json` 다섯 곳.

**두 값은 독립 정책이다 — 교차검증으로 거부하지 않는다**(설계 r01 P1: `max < warn`은 "작은 전송
예산 + 기본 경고" 조합으로 유효하다. 거부하면 낮은 상한 정책 자체를 쓸 수 없다). 판정 순서는
**max 우선**: max 초과면 차단(경고 불요 — 이미 안 나간다), max 이내면 warn 초과 여부만 경고.

### DEC-6 · 문서 (R5)

guarantees 한/영의 해당 불릿을 갱신: "마스킹·스크러빙은 없지만 **고신뢰 secret 패턴은 기본
차단**하며(`secretScan`), 길이는 기본 무제한이되 경고 표면과 opt-in 상한(`promptMaxBytes`)이
있다. 차단 목록은 고신뢰 패턴뿐이므로 육안 확인 의무는 그대로다." — 보호를 과대 서술하지
않는다(스캔이 못 잡는 비밀이 얼마든지 있다).

## Phase별 구현

**Phase 1 (`phase-1-secret-scan`)** — `lib/secret-scan.ts` + config `secretScan` + 배선(조립 직후·
attempt-opened 전) + 테스트(패턴별·마스킹·오탐·순서: 차단 시 원장 미기록·codex 미호출).

**Phase 2 (`phase-2-size-surface`)** — `promptWarnBytes`/`promptMaxBytes` config + 분해 경고·상한
차단 + guarantees 한/영 + CHANGELOG + 테스트(경계값·분해 합·상한 시 미호출·교차검증).

## 변경 파일

| 파일 | 변경 | phase |
|---|---|---|
| `scripts/req/lib/secret-scan.ts` | 신규 — 순수 스캐너 | 1 |
| `tests/unit/secret-scan.test.ts` | 신규 | 1·2 |
| `scripts/req/lib/config.ts` · `workflow/req.config.schema.json` | 키 3종 | 1·2 |
| `scripts/req/review-codex.ts` | 전송 직전 검사 배선 | 1·2 |
| `docs/guarantees.md`/`.en` | 서술 갱신 | 2 |
| `CHANGELOG.md` | Unreleased | 2 |

## 테스트 oracle (완료 기준 ↔ 검증)

| 완료 기준 | 오라클 | 잡는 결함 |
|---|---|---|
| 1 | 패턴별 1케이스 → 차단 + 패턴명 + 마스킹(원문 부재 단언) | 유출·비밀 재출력 |
| 2 | 차단 실행 후 원장 파일에 attempt-opened 부재 + fake codex 미호출 | 예산 낭비·배선 순서 |
| 3 | warn → 경고 + 호출 1회 · off → 스캔 자체 미실행 | 정책 회귀 |
| 4 | 40/64자 hex·UUID·일반 코드 픽스처 → 무탐 | 오탐(경고 피로) |
| 5 | warn 경계(=·+1) + 분해 합 = 전체 바이트 | 크기 표면 회귀 |
| 6 | max 초과 → 미호출 + 안내 문구 · **절단 함수 부재**(truncate 미사용 단언) · **`max < warn` 조합에서 max 차단이 정상 동작**(설정 오류 아님) | 조용한 절단·유효 정책 거부 |
| 7 | docs 가드 그린 + 보호 과대 서술 금지 문구 검사 | 문서-동작 불일치 |

## 하위호환·안전

- 기본 `block`은 **동작 변경**이다 — 고신뢰 패턴만이라 정상 워크플로에는 무영향이고, 걸리는
  경우가 곧 막아야 할 경우다. CHANGELOG에 기본값과 탈출구(`warn`/`off`)를 명시한다.
- 크기 축은 기본 관측(경고)뿐 — 상한은 opt-in이라 무회귀.
- 검사·경고는 프롬프트 내용을 로그·파일에 복제하지 않는다(마스킹 앞 6자만 stdout).
- 단일 활성 worktree·협조적 작업자 경계 유지.
