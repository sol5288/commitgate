# 00. 문서 관리

## 1. 문서 범위 / 비범위

### 범위(In)
- `npx commitgate` 설치기([bin/init.ts](../../bin/init.ts))·제거 플래너([bin/uninstall.ts](../../bin/uninstall.ts))·런처([bin/commitgate.mjs](../../bin/commitgate.mjs))
- 워크플로 CLI 5종: `req:new`, `req:next`, `req:review-codex`, `req:doctor`, `req:commit`([scripts/req/](../../scripts/req/))
- 공유 라이브러리: `config`, `adapters`, `porcelain`, `scratch`([scripts/req/lib/](../../scripts/req/lib/))
- 데이터 모델: 티켓 `state.json`, Codex 응답 스키마([workflow/machine.schema.json](../../workflow/machine.schema.json)), 설정 스키마([workflow/req.config.schema.json](../../workflow/req.config.schema.json)), 증거 로그(`responses/approvals.jsonl`)
- 계약·템플릿([AGENTS.template.md](../../AGENTS.template.md), [templates/](../../templates/), [workflow/review-persona.md](../../workflow/review-persona.md))
- 테스트([tests/](../../tests/)), CI([.github/workflows/ci.yml](../../.github/workflows/ci.yml)), 릴리즈([docs/RELEASING.md](../../docs/RELEASING.md))

### 비범위(Out)
- 대상(사용자) 프로젝트의 애플리케이션 코드·화면·DB. CommitGate는 이들에 대해 아무 것도 가정하지 않는다(git repo + `package.json`만 요구).
- Codex CLI / OpenAI 모델 내부, npm 레지스트리 내부, GitHub Actions 러너 내부.
- 브라우저 UI / 웹 서버 / REST API — **CommitGate에는 존재하지 않는다.** "인터페이스"는 전부 로컬 CLI다([05-user-flows-and-ui-spec.md](05-user-flows-and-ui-spec.md) 참조).

## 2. 용어집

| 용어 | 정의 | 근거 |
|---|---|---|
| **REQ 티켓** | 하나의 요구사항 단위. `workflow/REQ-YYYY-NNN/` 디렉터리에 상태·설계문서·증거가 모인다. | [scripts/req/req-new.ts](../../scripts/req/req-new.ts) |
| **Builder** | 코드를 만드는 AI 에이전트(Claude 등). `req:new`로 티켓을 열고 `req:next`가 시키는 대로 진행한다. | [AGENTS.template.md](../../AGENTS.template.md) |
| **Reviewer / PM** | 리뷰어 역할. 실제로는 Codex CLI가 구조화 응답으로 승인/차단을 판정한다. | [workflow/review-persona.md](../../workflow/review-persona.md) |
| **phase** | 티켓 내 구현 단위. `02-plan.md`가 phase로 분해하고, phase마다 리뷰·커밋한다. | [scripts/req/req-doctor.ts](../../scripts/req/req-doctor.ts) `D18` |
| **게이트(gate)** | 커밋을 막는 fail-closed 검사. `req:doctor` D-체크 + 승인 바인딩. | 본 문서 §4 |
| **승인 바인딩** | 승인이 특정 staged tree OID(phase) 또는 설계 docs 해시(design)에 묶이는 것. 내용이 바뀌면 승인이 무효(stale). | [07-business-rules-and-state-machines.md](07-business-rules-and-state-machines.md) |
| **finding** | 이 변경을 지금 커밋하면 안 되는 **차단 사유**. 하나라도 있으면 승인 불가. `{severity, detail, file}`. 출력 스키마상 **P1만** 넣을 수 있다(P1 정의 4요소 → [03 §4.2](03-domain-and-data-model.md)). | [workflow/machine.schema.json](../../workflow/machine.schema.json) |
| **P1** | 차단의 유일한 기준. ①카테고리(요구 위반·데이터 손상·보안·금전 오류·fail-closed 우회) ②정상 경로 재현 ③재현 증거 ④배제 규칙(카테고리 밖은 재현돼도 P1 아님)을 **모두** 만족. | [03 §4.2](03-domain-and-data-model.md) |
| **observation** | **비차단** 코멘트(취향·후속 제안). `severity` 없음. 승인 판정에 영향 없음. `{detail, file}`. | [workflow/machine.schema.json](../../workflow/machine.schema.json) |
| **통제점(control point)** | 사람이 승인 문장을 그대로 말해야만 진행하는 지점(`req:commit`, PR/push, 릴리즈). | [04-user-roles-and-permissions.md](04-user-roles-and-permissions.md) |
| **scratch** | clean-tree 검사에서 무시되는 도구 산출물(`state.json`, `codex-response.json`, `.review-preview.txt`). | [scripts/req/lib/scratch.ts](../../scripts/req/lib/scratch.ts) |
| **evidence-finalize** | 소스 커밋 뒤 승인 증거(`approvals.jsonl` + 아카이브)를 별도 chore 커밋으로 고정하는 단계. | [scripts/req/req-commit.ts](../../scripts/req/req-commit.ts) |
| **fail-closed** | 불확실·오류·부재 시 통과가 아니라 **차단/실패**로 처리하는 원칙. | 저장소 전반 |
| **vendored scaffold** | 라이브러리 의존이 아니라 파일 복사로 설치되는 Stage A 모델. | [README.md](../../README.md) 현재 범위 |
| **D-체크** | `req:doctor`의 일관성 검사(D2·D3·D5·D6·D9·D10·D11·D13·D15·D16·D17·D18). | [scripts/req/req-doctor.ts](../../scripts/req/req-doctor.ts) |
| **D9/D10/D11 등(설계 결정 ID)** | `01-design.md`가 부여하는 안정적 설계 결정 식별자. 코드 주석·문서가 이 ID로 상호 참조한다(예: D9 staged-tree 바인딩). | 각 티켓 `01-design.md` |

> **주의**: `01-design.md`가 부여하는 설계 결정 ID(D1…D18)와 `req:doctor`의 D-체크 ID는 **번호 공간이 겹치지만 다른 개념**이다. 본 SSOT에서 "D9 체크"는 doctor 검사를, "설계결정 D9"는 설계 문서 결정을 가리킨다. 문맥으로 구분한다.

## 3. 명명 규칙

- 파일: kebab-case 또는 숫자 접두(`req-new.ts`, `00-requirement.md`).
- REQ id: `REQ-<4자리연도>-<0채움3자리>` (예: `REQ-2026-001`). 채번은 연도별 max+1([scripts/req/req-new.ts](../../scripts/req/req-new.ts) `nextReqId`).
- 브랜치: `<branchPrefix><reqId 소문자>-<slug>` (기본 prefix `feat/req-`).
- 아카이브 파일: `<base>-r<NN>-<approved|needs-fix>.json` (`base`=`design` 또는 phase id; `NN`≥2자리 라운드)([scripts/req/lib/scratch.ts](../../scripts/req/lib/scratch.ts) `ARCHIVE_NAME_RE`).
- 코드 식별자: JS/TS 표준 camelCase. 설정 키·스키마 필드는 snake_case(`review_base_sha`)와 camelCase(`branchPrefix`)가 층위별로 다르다 — 상태/응답 필드는 snake_case, 설정 키는 camelCase.

## 4. 사실 / 추론 / 미확인 표기 규칙

| 표기 | 의미 |
|---|---|
| (표기 없음) | 소스/설정/테스트에서 직접 확인한 **사실**. 근거 경로 병기. |
| `추론` | 코드 구조상 합리적으로 도출했으나 단정 근거가 부족한 서술. |
| `확인 불가` | 저장소만으로는 판정할 수 없는 항목. 추가 확인 필요. |
| `해당 없음` | 프로젝트에 그 주제가 존재하지 않음(근거 1~2문장 병기). |

"적절히 처리", "등", "필요 시" 같이 구현 결정을 숨기는 표현은 사용하지 않는다. 실제 조건·한도·분기·오류 결과를 적는다.

## 5. 문서 갱신 트리거와 소유 책임

| 트리거 | 갱신 대상 |
|---|---|
| CLI 인자/플래그 추가·변경 | 05, 06 |
| `state.json`/`machine.schema.json`/`req.config.schema.json` 필드 변경 | 03, (연쇄) 06·07 |
| D-체크 추가/삭제 | 07, 11, 12 |
| Codex 연동 계약 변경(argv, 모델, 샌드박스) | 06, 09 |
| 설치·제거 동작 변경 | 05, 06, 08 |
| CI 매트릭스/릴리즈 절차 변경 | 10 |
| 새 테스트 파일/커버리지 변경 | 11, 12 |
| 미구현 항목 구현/불일치 해소 | gaps-and-decisions, 12 |

- **소유 책임**: 본 SSOT는 코드 저장소와 함께 버전 관리되며, 코드 변경 PR이 관련 문서를 함께 갱신하는 것을 원칙으로 한다(`추론` — 강제 훅은 없음).
- 모든 문서는 최신 변경 이후 [13-review-and-validation-log.md](13-review-and-validation-log.md)의 CLI 리뷰 통과 기록이 있어야 "완료"로 간주한다.
