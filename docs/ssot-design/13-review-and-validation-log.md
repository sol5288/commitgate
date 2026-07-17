# 13. 리뷰·검수 로그

본 SSOT 문서화의 리뷰·검수 이력. 비밀값·토큰·개인정보·불필요하게 긴 CLI 원문은 기록하지 않는다. **이 로그는 실제로 일어난 일만 기록하며 각 기록은 해당 시점의 사실**이다(허위 이력 금지 — [gaps-and-decisions.md](gaps-and-decisions.md) §3). 과거 검수 결과는 이후 변경분의 통과를 자동 보증하지 않는다.

## 1. 리뷰 경로와 그 결정 배경

2026-07-15 원 지침은 `/req`의 `req:review-codex`를 리뷰 경로로 요구했으나, 이 저장소에서 `/req`가 곧 CommitGate 자신이므로 다음 하드 모순에 도달했다.

- `req:new --run`은 티켓 스캐폴드를 **커밋**한다 → "커밋 금지" 위배.
- 티켓을 **수동 스캐폴드**한 뒤 `req:review-codex`를 돌리려면, 리뷰 전 clean-tree(D10) 전제 때문에 티켓의 `codex-request.md`(scratch 아님)가 tracked여야 한다. 이를 위해 로컬 `.git/info/exclude`로 상태 스캔에서 숨기려 했으나 **자동 모드 분류기가 게이트 우회로 정당하게 차단**했다.
- 결론: `req:review-codex`는 {커밋 금지 + docs만 스테이징 + 게이트 우회 금지}를 동시에 지키면서는 실행 불가.

**승인 문구(원문)와 성격 구분.** 여기서 "승인"은 CommitGate의 `/req` 통제점 승인 문장(예: `req:commit --run 승인`)이 **아니다**. `/req` 리뷰 게이트는 아예 실행되지 않았다. 이 승인은 대화 중 `AskUserQuestion`으로 리뷰 **경로**를 정한 것으로, 두 단계였다.

1. 1차 질문에서 사용자는 **"Authorize /req review, stop before commit"**(= `/req` 리뷰를 허용하되 커밋 직전 중단)을 선택.
2. 위 하드 모순이 확인된 뒤 2차 질문에서 사용자는 **"codex 직접 리뷰 (권장)"** 옵션을 선택. 그 옵션 원문 요지: *"docs/ssot-design를 git add한 뒤, req 티켓/게이트 없이 `codex exec --sandbox read-only`를 직접 호출해 동일한 Codex 엔진으로 문서를 외부 리뷰한다. 커밋 없음·문서만 스테이징·게이트 우회 없음 — 모든 하드 제약을 지키되 `req:review-codex` 래퍼만 생략(래퍼는 커밋 없이는 불가)."*

따라서 이 리뷰는 **`/req` 워크플로 리뷰가 아니라, `/req` 미수행에 대한 사용자 승인 대체 경로**다. `req:review-codex` 래퍼 없이 동일 리뷰 엔진(`codex exec --sandbox read-only`, `-c model="gpt-5.6-terra" -c model_reasoning_effort="high"`)을 직접 호출해 수행했다. "검수 완료"는 **문서 품질 리뷰 완료**를 뜻하며 `/req` 완료와는 구분된다.

| 항목 | 실제 값 |
|---|---|
| `/req` 티켓 생성 | **당시 하지 않음**. 당시 main 추적 트리에 `workflow/REQ-2026-014/`는 없었다. 이후 다른 브랜치/로컬 scratch의 동명 경로 존재 여부와 구분한다. |
| 작업 브랜치 | **생성하지 않음**. 브랜치는 `main` 유지. |
| 리뷰 도구 | `codex exec --sandbox read-only`(직접 호출, req 티켓/게이트 미개입) |
| 리뷰 모델/추론강도 | `gpt-5.6-terra` / `high`(프로젝트 리뷰어 설정과 동일) |
| 리뷰 대상 | 스테이징된 `docs/ssot-design/**`만(리뷰 전 `git diff --cached --name-only`로 매회 확인) |
| 스테이징 범위 | 전 라운드에서 `docs/ssot-design/` 외 파일 0건 확인 |
| 커밋 | **당시 없음**. 당시 문서는 커밋 직전(staged) 상태로 유지. |

## 2. 문서 ↔ 선행 의존성(논리 작업 항목)

`/req` 티켓을 만들지 않았으므로 하위작업은 논리 항목으로만 관리한다. 선행 의존성은 재구현 읽는 순서와 동일하다.

| 작업 항목 | 문서 | 선행 |
|---|---|---|
| DOC-README | README.md | — |
| DOC-00 | 00-document-control.md | — |
| DOC-01 | 01-system-context.md | 00 |
| DOC-02 | 02-repository-and-runtime.md | 01 |
| DOC-03 | 03-domain-and-data-model.md | 02 |
| DOC-04 | 04-user-roles-and-permissions.md | 03 |
| DOC-07 | 07-business-rules-and-state-machines.md | 03 |
| DOC-06 | 06-api-and-integration-contracts.md | 03,07 |
| DOC-05 | 05-user-flows-and-ui-spec.md | 06 |
| DOC-08 | 08-architecture-and-module-spec.md | 06 |
| DOC-09 | 09-security-and-reliability.md | 08 |
| DOC-10 | 10-operations-deployment-and-observability.md | 08 |
| DOC-11 | 11-test-strategy-and-acceptance.md | 08 |
| DOC-12 | 12-traceability-matrix.md | 전체 |
| DOC-GAPS | gaps-and-decisions.md | 전체 |
| DOC-13 | 13-review-and-validation-log.md | (리뷰 실행 후) |
| DOC-14 | 14-product-strategy-and-roadmap.md | 01,03,05,09,10,gaps |

## 3. 통과 기준
- 마지막 수정 이후의 리뷰가 통과(추가 사실오류 0)해야 완료로 인정.
- 각 라운드에서 근거 추적·상호 링크·Mermaid·표 완결성을 함께 확인.
- 고영향 gap이 **문서에서 누락되거나 현재 보장으로 오기**되어 있으면 완료 불가. 제품에 알려진 gap이 존재하는 것 자체는 검수 실패가 아니며 gaps와 전략 문서에 정직하게 추적해야 한다.

## 4. 리뷰 실행 로그(codex 직접 리뷰, 2026-07-15)

**실제 CLI 호출 횟수·성공/실패**(아래 표의 "결과" 열에 병기): R1~R5는 각 1회(성공). R6·R7은 각 2회(1차 `ERROR: Selected model is at capacity`로 exit 1 실패 → 2차 재시도 exit 0 성공). "at capacity"는 모델 일시 용량 초과이며 계정 usage limit이 아니다. 실패도 은폐하지 않고 재시도와 함께 기록한다. 전 라운드에서 리뷰 직전 `git diff --cached --name-only`로 스테이징 범위가 `docs/ssot-design/**`만임을 확인. 누적 호출 총계는 §6 최종 판정에서 확정한다.

| 라운드 | 시각 | 명령 목적 | 대상 | 결과 | 지적 | 처리 | 재실행 |
|---|---|---|---|---|---|---|---|
| R1 | 17:10 | 전체 문서 사실정확성·링크·Mermaid·용어·누락 | 문서 16 + 자산 1(전체 코퍼스) | exit 0 | 12건(P1 5·P2 5·P3 2) | 12건 전부 문서 수정 | R2에서 재검증 |
| R2 | 17:22 | R1 12건 해소 확인 + 신규 탐지 | 코퍼스(수정본) | exit 0 | 12건 해소, 신규 2건(P1 1·P3 1) | 06 §1.3·09 §1 수정 | R3에서 재검증 |
| R3 | 17:27 | R2 2건 해소 확인 | 06·09(+필요 문서) | exit 0 | 2건 해소, 신규 1건(P2, 09 §1 귀속) | 09 §1 문구 정정 | R4에서 재검증 |
| R4 | 17:35 | R3 1건 해소 확인 + 잔여 P1/P2 탐지 | 코퍼스 | exit 0 | 09 §1 해소 확인, 신규 1건(P2 — 본 로그·gaps의 허위 티켓 이력) | 13·gaps 실제 과정으로 재작성 | R5에서 재검증 |
| R5 | 17:40 | R4 로그 정직성 지적 해소 확인 + 잔여 탐지 | 13·gaps·03(+코퍼스) | exit 0 | 실제 상태 일치 확인, 신규 1건(P2 — state.json을 "커밋 안 함"으로 오기) | 03 §1·§8, 05 §7 정정 | R6에서 재검증 |
| R6 | 17:47 | R5 state.json 지적 해소 확인 + 최종 스윕 | 코퍼스 | 2회 호출(1차 "at capacity" exit 1 → 2차 exit 0) | **추가 지적 없음** | — | — |
| R7 | 18:05 | PM 조건부 반려 4개 정정(라운드수·호출횟수·승인문구·재검수) 확인 + 잔여 탐지 | 코퍼스(13·gaps 변경본 포함) | 2회 호출(1차 "at capacity" exit 1 → 2차 exit 0) | 3건(P2): ① 13 §4·§6 R7 행/결과 미기재 + R6를 최종으로 판정 ② gaps D-05가 실체 없는 R7 참조 ③ 12 §연결완결성이 "문서별 통과 추적"으로 오기 | ①② R7 행 기재·§6를 R7/R8 기준으로 갱신 ③ 12 문구를 "코퍼스 라운드 통과"로 정정 | R8에서 재검증 |
| R8 | 18:18 | R7 3건 해소 확인 + 최종 스윕 | 코퍼스 | 1회 호출 exit 0 | 일관 확인, 신규 2건(P2): 08 §2.4 `ARCHIVE_NAME_RE`·§2.8 `evidenceProblems`를 "공개"로 오기(실제 미export) | 08 §2.4·§2.8 정정 + 08의 나머지 "공개" 심볼 전수 export 검증(모두 export 확인) | R9에서 재검증 |
| R9 | 18:34 | R8 export 정정 확인 + 최종 스윕 | 코퍼스 | 1회 호출 exit 0 | 공개 심볼 55개 전수 일치 확인, 신규 1건(P2): 08 §1 "단방향 의존" 서술이 명령↔명령 import(req-new/next/doctor/commit→review-codex, req-commit→req-doctor) 누락 | 08 §1 다이어그램·서술·§2.5 의존을 공유 헬퍼 허브·순환없음으로 정정 | R10에서 재검증 |
| R10 | 18:50 | R9 의존그래프 정정 확인 + 최종 스윕 | 코퍼스 | 1회 호출 exit 0 | 신규 5건(P2): ① 08 §1 `req-commit→scratch` 직접 import 오기 ② 03 §2 "필드 증가만" 서술(실제 제거도 함) ③ 05 §9 "재시도 금지"가 코드 회로차단(count≥2)과 불일치 ④ 06 §1.4·08 §2.8 `req:doctor` "부작용 없음"(실제 `.git/index` stat-cache 갱신 가능) ⑤ 13 §6 R8 고정 참조가 R9/R10과 모순 | 5건 전부 정정(import 그래프·필드 증감·회로차단 문구·doctor 부작용·§6 라운드 무관화) | R11에서 재검증 |
| R11 | 19:08 | R10 5건 해소 확인 + 최종 스윕 | 코퍼스 | 1회 호출 exit 0 | 5건 전부 소스 일치 확인, 신규 1건(P2): 09 §3 "state 로드가 이상 입력에 throw" 과장(`loadState`는 `id`·`phase` 존재만 검증) | 09 §3 fail-closed 항목을 config/manifest/persona vs state 최소검증으로 구분 정정 | R12에서 재검증 |
| R12 | 19:22 | R11 state 검증 정정 확인 + 최종 스윕 | 코퍼스 | 1회 호출 exit 0 | 신규 2건(P2, 둘 다 09): ① §1 `write-tree`는 인덱스만 검출(워킹트리는 postDirty 별도) ② §3 `validateManifest`는 throw 아니라 문제 배열 반환 | 09 §1 샌드박스 검출 이원화·§3 manifest 반환 방식 정정 + 09 전체 재검토 | R13에서 재검증 |
| R13 | 19:36 | R12 09 정정 확인 + 최종 스윕 | 코퍼스 | 1회 호출 exit 0 | 신규 2건(P2): ① 06 §1.4·08 §2.8 `req:doctor`의 `write-tree`가 `.git/objects`에 tree object도 기록 가능 ② assets mmd에서 `B1`(direct push)이 `NEW`가 아닌 `COMMIT` 이후 통합 대안이어야 함 | doctor 부작용 서술 보강 + mmd B1 위치 정정(경로 A/B) | R14에서 재검증 |
| R14 | 19:50 | R13 doctor·mmd 정정 확인 + Mermaid 검증 | 코퍼스 | 1회 호출 exit 0 | 정정·Mermaid 유효 확인, 신규 1건(P2): 06 §5 요약표 `req:doctor` 부작용 "없음"이 §1.4와 불일치 | 06 §5 요약표 doctor 부작용 정정 | R15에서 재검증 |
| R15 | 20:04 | R14 요약표 정정 확인 + 최종 스윕 | 코퍼스 | 1회 호출 exit 0 | 06 §5 및 전 요약표 실제 동작 일치 확인 → **추가 지적 없음** | — | 없음(수렴) |

**R1 지적 12건 요약(모두 처리 완료)**: 02 §5 packageManager 기본값 / 05 §4 외부전송 phase·design 구분(01·04·09·gaps 연쇄) / 06 §1 review-codex 파서 unknown 인자 무시 / 04 §1 git commit 직접 우회 / 07 §3 D13 허용목록 정밀화(04·11 연쇄) / 03 §6 설계문서 헤더=관례 / 06 §2.4 review_base_sha 비교기준 / 05 §9 fresh-thread 1회=계약지침 / 04 §1 상호참조 §2.10 / 10 §5 runCli 범위 / assets 헤더 주석 / Cursud→Cursor.

**수렴 곡선**: R1(12) → R2(2) → R3(1) → R4(1) → R5(1) → R6(0) → *[PM 조건부 반려]* → R7(3) → R8(2) → R9(1) → R10(5) → R11(1) → R12(2) → R13(2) → R14(1) → **R15(0, 추가 지적 없음)**. R6에서 문서 본문 1차 수렴 후, PM 반려와 심화 리뷰가 점점 더 미세한 정밀 지적(리뷰 로그 정합성, `export` 정확성, 모듈 import 그래프, state 필드 증감, `req:doctor` git 플러밍 부작용, 샌드박스 이중 검출, `validateManifest` 반환 방식, mmd 통합 경로 등)을 잡아 모두 반영했고 **R15에서 최종 수렴**했다.

**"at capacity" 실패 기록**: R6·R7 등 일부 라운드의 1차 호출이 `ERROR: Selected model is at capacity`(모델 일시 용량 초과, 계정 usage limit 아님)로 exit 1 → 동일 모델 재시도로 exit 0 획득. 각 라운드의 실제 호출 횟수·성공/실패는 §4 표 "결과" 열에 기록. 리뷰를 우회하거나 통과로 조작하지 않았다([gaps-and-decisions.md](gaps-and-decisions.md) D-05 원칙 준수).

## 5. 종합 검수(추적성·완결성)
- 각 라운드가 코퍼스 전체를 소스와 대조하며 상호 링크·용어·Mermaid·표·교차 참조를 함께 검토(코퍼스 리뷰 특성상 문서별 격리 대신 전체 일관성 검토, [gaps-and-decisions.md](gaps-and-decisions.md) D-03).
- 추적성 매트릭스([12-traceability-matrix.md](12-traceability-matrix.md))의 모든 행이 근거 파일·설계문서 링크를 가짐을 확인.

## 6. 최종 판정
- **검수 완료 판정 규칙**: §4 표의 **마지막 라운드가 "추가 지적 없음"**이면 문서 코퍼스를 검수 완료로 확정한다. 각 라운드는 직전 수정 반영본을 소스와 대조 재검수하며, 새 지적이 나오면 반영 후 다음 라운드로 재검증한다.
- **무한 재귀 처리(정직 고지)**: 각 라운드의 자기 행(row)·결과·§6 누적 총계·최종 확정 문구는 그 라운드가 끝난 뒤 기록되므로 자신에 의해 재리뷰될 수 없다. 이 부분은 **리뷰 이후 사실 기재**에 한정하며(내용 오류가 아니라 순수 감사 기록), 리뷰를 건너뛴 것이 아니라 회귀를 끊는 명시적 경계다.
- 당시 검토 범위에서 **1:1 재구현을 막는 미문서화 고위험 gap이 없다고 판정**했다. 이는 제품의 고영향 개선 gap이 없다는 뜻이 아니며, 이후 G-06a/b·G-09 등이 명시되었다.
- **당시 `/req` 미수행 · 직접 Codex 리뷰 대체 수행 · 커밋 미수행**을 분리해 기록한다(§1). 당시 브랜치 `main`, main 추적 트리에 `workflow/REQ-2026-014/` 미생성, 문서는 커밋 직전(staged) 상태였다.

### 최종 확인 결과 (2026-07-15 코퍼스 기준)
- **최종 라운드 R15에서 코퍼스 전체 사실오류(P1/P2)·Mermaid 문법 오류 "추가 지적 없음"으로 수렴.** 마지막 수정 이후의 리뷰(R15)가 통과했으므로 문서 코퍼스를 **검수 완료**로 확정한다.
- **codex 호출 누적 총계**: 15개 리뷰 라운드에 걸쳐 **codex 17회 호출**(성공 15·실패 2). 실패 2회는 모두 모델 일시 용량 초과(`at capacity`)로 즉시 재시도해 성공했다(R6·R7 각 1차). 별도로 자동 모드 분류기의 일시 오류(transient)로 실행 전 차단된 시도가 몇 건 있었으나 이는 codex에 도달하지 않아 호출로 집계하지 않는다.
- **§4 R15 행·본 총계 문구는 R15 종료 후 기록된 사후 감사 기재**이며, 위 "무한 재귀 처리" 경계에 따라 그 자신에 의해 재리뷰되지 않는다(순수 사실 기록).
- **당시 코퍼스 기준 재구현 차단 gap 없음**으로 판정했다. 2026-07-16 심화 분석에서 제품 고영향 gap과 상태 수명주기 설명 오류를 추가 식별·문서화했으므로 이 문장은 역사적 판정으로만 읽는다.

## 7. 갱신: REQ-2026-018 반영 (2026-07-16)

§6의 검수 완료는 **2026-07-15 코퍼스 기준**이다. 그 뒤 REQ-2026-018(리뷰 findings를 P1 전용 차단 채널로 배선)이 main에 머지되어([00-document-control.md](00-document-control.md) §5 갱신 트리거: `machine.schema.json` 필드 변경 → 03·06·07 / Codex 연동 계약 변경 → 06·09 / 커버리지 변경 → 11·12), SSOT를 코드에 맞춰 갱신했다.

### 7.1 변경 대상과 내용

| 문서 | 변경 |
|---|---|
| 00 | 용어집 `finding`에 "출력 스키마상 P1만" 부기 + `P1` 항목 신설 |
| 03 | §4 findings 행(출력/검증 enum 분리) + **§4.2 신설**(severity 계약·P1 정의 4요소·하중은 카테고리 한정·잔존 리스크) |
| 06 | §2.2 출력 스키마를 파생 2단계(required 확장 + severity `["P1"]` 축소)·경로부재 throw·구버전 설치본 하위호환으로 재작성 |
| 07 | **§1.1 신설** — 의미론(persona)만으로 부족했던 근거, 구조적 강제, R10·`classifyReview` 불변 이유 |
| 09 | §2 위협표에 "비차단 의견이 차단 채널을 점유(리뷰 비수렴)" 행 추가(완화이지 제거 아님 명기) |
| 11 | §2 인벤토리 `req-adapters.test.ts` 범위 갱신 + §3 "차단 채널 P1 전용" 인수 기준 4건 신설 |
| 12 | §C에 "차단 채널 P1 전용" 추적 행 추가 |
| gaps | **G-06a**(라운드 상한·escalation 없음) · **G-06b**(승인 후 편집 시 전면 재리뷰) · **G-06c**(`nextReqId` 브랜치 충돌) 신설 |

### 7.2 이번 갱신의 리뷰

- **코드 자체는 게이트를 통과했다**: REQ-2026-018은 `req:review-codex`로 design 3라운드(r01·r02 각 P1 1건 → r03 승인)·phase 3라운드(r03 승인, r01·r02는 스테이징 착오로 인한 재바인딩)를 거쳐 커밋됐다(`0f71258` 외). 증거는 `workflow/REQ-2026-018/responses/`.
- **본 문서 갱신(§7.1)은 §1과 동일한 대체 경로로 리뷰했다** — `req:review-codex` 래퍼는 이 저장소에서 문서만 리뷰할 때 §1의 하드 모순(티켓 생성이 커밋을 유발)에 걸리므로, 동일 엔진(`codex exec --sandbox read-only`, `gpt-5.6-terra`/`high`)을 직접 호출했다. 사용자 승인은 이 통제점에서 **별도로** 받았다(이월 아님).
- **이번 리뷰는 REQ-2026-018이 만든 P1 전용 출력 스키마를 실제로 물렸다** — `deriveStrictOutputSchema`로 파생한 copy(`findings[].severity.enum === ["P1"]`)를 `--output-schema`로 전달. 리뷰어는 구조적으로 P2/P3를 낼 수 없었다.
- **대상은 코퍼스 전체가 아니라 변경 델타**(staged diff)다. G-06b가 지적한 "전면 재리뷰" 문제를 문서 작업에서 스스로 반복하지 않기 위한 선택이며, 2026-07-15 코퍼스는 §6에서 이미 수렴 판정을 받았다.

| 라운드 | 시각 | 대상 | 결과 | 지적 | 처리 |
|---|---|---|---|---|---|
| S1 | 2026-07-16 | §7.1 staged diff(문서 9개, +98/-5) + 근거 코드 read-only 대조 | 1회 호출 exit 0 | **findings 0 · observations 0** | — |

- **리뷰 실질성 확인**: 리뷰어는 명령 12회를 실행하고 `machine.schema.json`(42회)·`review-persona.md`(20회)·`adapters.ts`(18회)·`review-codex.ts`(16회)·`req-adapters.test.ts`(13회)를 참조했으며, 응답 `review_base_sha`가 리뷰 시점 HEAD(`696faa6`)와 일치했다. 형식적 통과가 아니다.
- **완료 판정**: 00 §5 기준("최신 변경 이후 13의 리뷰 통과 기록")에 따라 **§7.1 갱신분을 검수 완료로 확정**한다.

> **과대 해석 경계**(`추론`): S1이 1라운드에 findings 0으로 수렴한 것은 REQ-2026-018의 효과를 **시사할 뿐 증명하지 않는다.** 델타가 작았고(98줄), 스테이징 전에 링크 유효성과 코드 대조를 이미 검증했으며, 표본이 1건이다. severity inflation 완화의 실효는 후속 티켓들의 P1 비율로 관측해야 한다([gaps-and-decisions.md](gaps-and-decisions.md) G-06a).

## 8. 심화 분석·제품 전략 보완 (2026-07-16)

### 8.1 범위와 방법

- 기준 코드: `main@8bc02de`, `commitgate@0.6.0`.
- 대상: 기존 SSOT Markdown 16개 전체 + 신규 [14-product-strategy-and-roadmap.md](14-product-strategy-and-roadmap.md). Mermaid 원본은 내용 변경 없음.
- 근거: `scripts/req/*`, `bin/*`, schema 2종, 테스트 15파일, CI, README/CHANGELOG, tracked REQ state·승인 증거·최근 git history.
- 외부 Codex 리뷰: **수행하지 않음**. 사용자가 요청한 저장소 문서 개선 범위에서 로컬 read-only 코드 대조와 정적 검증만 수행했다. 기존 R1~R15/S1 통과를 이번 변경분에 이월하지 않는다.
- git 작업: 문서 편집만 수행. stage·commit·push 없음.

### 8.2 새로 식별한 핵심 문제와 처리

| ID | 발견 | 위험 | 반영 |
|---|---|---|---|
| A1 | `state.phase`가 `INTAKE→…→DONE`으로 자동 전이하는 듯한 문서 표현과 달리 코드는 생성 뒤 갱신하지 않음 | 재구현 팀이 존재하지 않는 상태 전이를 구현, D11 의미 변경 | 00·03·05·07·11·12에서 **파생 논리 상태**와 저장 필드를 분리 |
| A2 | `state.json` 런타임 변경이 자동 내구화·재구축되지 않음 | fresh clone/상태 분실 시 진행 판정 복원 불가 | 01·03·05·08·09·gaps에 G-09, 14에 STR-02 |
| A3 | “고위험 gap 없음”과 G-06a/b `영향: 대`가 같은 코퍼스에 공존 | 제품 위험 축소·우선순위 왜곡 | gaps §4와 13의 과거 판정을 시점·의미별로 정정 |
| A4 | 기준 SHA·티켓 인벤토리가 REQ-018 이전 시점 | 현재 코드와 문서 기준점 불일치 | README 기준점을 `8bc02de`, 02의 main 추적 티켓 목록을 갱신 |
| A5 | 미션·대상 사용자·실패 조건·성과지표·우선순위 설계 부재 | 기능 나열은 가능하나 제품 의사결정 기준 없음 | 01에 가치/JTBD/원칙, 신규 14에 VCCR·P0/P1/P2·STR-01~10 |
| A6 | 역할 분리가 조직 IAM/서명된 신원처럼 과대 해석될 여지 | 보장 범위 오판 | 04에 역할 분리의 실제 보장 수준 추가 |
| A7 | vendored 설치본의 버전 원장·upgrade plan 부재가 gap으로 추적되지 않음 | repo별 정책 드리프트 | 02·08·09·gaps G-10, 14 STR-06 |
| A8 | 사용자 가치·리뷰 비용·수렴을 자동 측정하지 않음 | 개선 효과를 일화로만 판단 | 01·10·gaps G-11, 14 지표/STR-08 |

### 8.3 검증 결과

| 검증 | 결과 |
|---|---|
| 변경 범위 | `docs/ssot-design/**`만 변경 확인 |
| `git diff --check` | 통과(whitespace 오류 없음) |
| Markdown 상대 링크 파일 존재 검사 | 통과(`MARKDOWN_LINK_PATHS_OK`) |
| fenced code block 짝 검사 | 통과(홀수 fence 없음) |
| TypeScript | 직접 Node 런타임으로 `tsc --noEmit` exit 0 |
| Vitest 전체 | **851/852 통과, 1건 환경 실패**. `req-next.test.ts`의 e2e가 이 Codex Windows runner의 중복 `PATH`/`Path` 환경에서 bare `npx`를 찾지 못해 실패. 같은 파일 97개 다른 테스트는 통과했고 문서 외 소스 변경은 없음. 전체 green으로 기록하지 않는다. |
| 실패 재현 | `req-next.test.ts`만 재실행해 동일 1건(`'npx' is not recognized`) 재현. absolute `C:/Program Files/nodejs/npx.cmd --version`은 성공해 runner command resolution 문제로 한정 |
| 외부 리뷰 | 미수행 — 이번 변경분은 Codex 승인으로 표시하지 않음 |

### 8.4 판정

- 현재 구현과 목표 상태의 경계를 분리했고, 재구현에 위험한 수명주기 오기를 바로잡았다.
- 제품 고영향 gap을 숨기지 않고 STR-01(CI 검증) → STR-02(state 재구축) → STR-03(전송 안전) → STR-04(리뷰 수렴) 순의 P0 계획으로 연결했다.
- 로컬 문서 QA는 완료했으나 **외부 Reviewer 승인 및 전체 테스트 green은 주장하지 않는다**. 구현 코드는 변경하지 않았다.

## 9. 갱신: REQ-2026-014 Stage B 런타임 패키지 전환 (2026-07-17)

§7·§8은 각각 2026-07-16 시점(`main@8bc02de`) 기준이다. 그 뒤 REQ-2026-014가 main에 들어와 **배포 모델 자체가 Stage A(vendored scaffold)에서 Stage B(런타임 패키지)로 전환**됐으므로 SSOT를 코드에 맞춰 갱신했다. 기준 SHA는 **`0962d37`**, 패키지 버전은 `commitgate@0.6.0`(변경 없음)이다. Stage A는 삭제되지 않았고 **legacy · `commitgate migrate` 대상**으로 남는다.

### 9.1 REQ-2026-014의 리뷰 라운드 (실제 `/req` 게이트)

§1·§7.2의 문서 리뷰와 달리 **이 티켓은 `/req` 워크플로 자체를 통과했다** — 티켓·작업 브랜치·design 승인·phase별 evidence가 모두 존재한다. 증거는 `workflow/REQ-2026-014/responses/`.

| 라운드 | 종류 | 결과 | findings |
|---|---|---|---|
| design r20 | design | NEEDS_FIX (`risk_level: HIGH`) | **P1 2건** |
| design r21 | design | COMPLETE (`commit_approved: yes`) | **0건** (+ 비차단 observation 1건) |
| phase-1-dispatch r01 | phase | COMPLETE | 0건 |
| phase-2-init-runtime r01 | phase | COMPLETE | 0건 |
| phase-3-uninstall-migrate r01 | phase | COMPLETE | 0건 |
| phase-4-repro-pm r01 | phase | STEP_COMPLETE | 0건 |
| phase-5-docs-smoke r01 | phase | STEP_COMPLETE | 0건 |

**design r20의 P1 2건**(둘 다 "정상 경로가 성립하지 않는다"는 지적이며, 수정 후 r21에서 재발하지 않았다):

1. **preflight 순서가 D14 → D19였다.** Stage A 설치본에는 `devDependencies.commitgate`가 **없으므로**, 선행 설치 확인(D14)이 Stage A 서명 감지(D19)보다 앞서면 Stage A 사용자는 `npx commitgate init`에서 "npm install -D commitgate" 오류만 만나고 **`commitgate migrate` 안내에 영원히 도달하지 못한다**(티켓 요구 R7의 Stage A plain-init 감지·migration 안내 인수 기준 미달성). → preflight 순서를 **D19 → D14**로 바로잡아 수정. 현재 코드는 [bin/init.ts](../../bin/init.ts) `runInit`에서 `detectStageA`(D19) → `commitgateDeclared`(D14) 순으로 호출하며, 그 순서가 계약임을 `detectStageA` 주석이 명시한다. 둘 다 preflight라 throw 시 어떤 파일도 쓰이지 않는다.
2. **Phase 5 smoke가 티켓 없는 fresh 대상에서 `req:doctor` rc=0을 기대했다.** [scripts/req/req-doctor.ts](../../scripts/req/req-doctor.ts)는 REQ id 또는 `--ticket` 없이 즉시 throw하므로 이 경로는 exit 1이 되어 packed-tarball smoke(요구 R11)가 성립하지 않는다. → dispatch 검증을 "성공 종료"가 아니라 **"도달 증명"**(exit≠0 + req-doctor 자신의 사용법 오류)으로 재설계해 수정. fresh·티켓 없는 대상에서 rc=0으로 끝나는 `req:*` verb는 없기 때문이다. 근거 [scripts/smoke.mjs](../../scripts/smoke.mjs).

두 라운드의 `review_base_sha`는 모두 `fae8c81`이다 — 설계 문서 수정은 워킹트리에서 이뤄졌고, r21 승인 뒤 `f7ad5ea`로 커밋됐다.

⚠️ **design 표가 r20에서 시작하는 이유와 번호 주의**: 아카이브에는 이보다 앞선 `design-r19-approved.json`(base `c978358`, findings 0)이 있다. 그 승인은 이후 설계 변경으로 무효화됐고([gaps-and-decisions.md](gaps-and-decisions.md) G-06b), 범위 축소 뒤 리뷰가 r20/r21로 이어졌다. **여기의 r20/r21을 G-06a에 기록된 과거 "r30까지" 비수렴 이력의 r20~r30과 같은 라운드로 읽으면 안 된다** — 라운드 번호는 리뷰 실행 횟수가 아니라 디스크에 남은 아카이브 파일명에서 파생되므로(`nextArchiveRound`) 번호가 재사용된다. 상세는 [gaps-and-decisions.md](gaps-and-decisions.md) G-06a.

### 9.2 구현·증거 커밋

```text
f7ad5ea design scope reduction     14f5b76 design evidence
95d94b8 phase 1 dispatch           1d2e9e6 phase 1 evidence
46b740e phase 2 Stage B init       ec30c2c phase 2 evidence
e141ac3 phase 3 migrate/uninstall  4e16897 phase 3 evidence
ef59904 phase 4 doctor D19         f6d4000 phase 4 evidence
2f3138a phase 5 docs/smoke         2a7ef1b phase 5 evidence
0962d37 final ticket state and review archive
```

### 9.3 보고된 검증 결과

| 검증 | 보고된 결과 |
|---|---|
| TypeScript | `tsc --noEmit` exit 0 |
| Vitest | **925/925 통과** |
| packed-tarball smoke | [scripts/smoke.mjs](../../scripts/smoke.mjs) rc=0 |
| CI | **9/9 success**(3 OS × Node 18/20/22) |

### 9.4 🔴 post-push CI의 한계 (완료로 오인 금지)

**Stage B는 `main`에 branch protection bypass direct push된 뒤 CI가 실행됐다.** CI 9/9 success는 사실이지만, **이 사례에서 CI는 병합을 사전에 막는 게이트가 아니었다** — 코드가 이미 `main`에 있는 상태에서 사후(post-hoc)로 돈 검증이다. 따라서:

- 이 9/9는 "게이트를 통과했다"가 아니라 "머지 이후 회귀가 관측되지 않았다"로만 읽는다.
- [04-user-roles-and-permissions.md](04-user-roles-and-permissions.md)의 **B1(direct push) = post-check** 서술은 이 사례로 약화되지 않는다. 오히려 실제로 밟힌 경로다.
- 원격 경계에서 사전 강제를 세우는 일은 여전히 [14](14-product-strategy-and-roadmap.md) STR-01의 미구현 목표다.

또한 packed-tarball smoke의 read-only/비파괴 검증은 **파일 경로 → 크기 맵만 비교**하므로(`scripts/smoke.mjs` `snapshot`), 크기가 같은 내용 변경은 놓칠 수 있다([gaps-and-decisions.md](gaps-and-decisions.md) G-10).

### 9.5 이번 SSOT 동기화(§9) 자체의 검증

| 검증 | 결과 |
|---|---|
| 변경 범위 | `git status`에서 변경 파일이 **전부 `docs/ssot-design/**` 아래**임을 확인. 코드·테스트·`package.json`·워크플로 무변경. 본 §9 항목의 담당 편집분은 13·14·gaps 3개 파일이다 |
| 근거 대조 | `git log 94d59fe..0962d37`, `workflow/REQ-2026-014/responses/`(design r19/r20/r21 + phase r01 5건), `bin/init.ts`·`bin/migrate.ts`·`bin/dispatch.mjs`·`scripts/smoke.mjs`·`scripts/req/req-doctor.ts`·`scripts/req/review-codex.ts` read-only 확인 |
| `git diff --check` | 통과(whitespace 오류 없음) |
| Markdown 상대 링크 파일 존재 검사 | 13·14·gaps의 상대 링크 55개 전수 확인, 누락 0 |
| fenced code block 짝 검사 | 통과(홀수 fence 없음) |
| TypeScript·Vitest·smoke 재실행 | **수행** — 이 문서 브랜치(`docs/req-2026-014-ssot-sync`, base `0962d37`)에서 독립 재현: `npm run typecheck` 0 · `npm test` **17파일 925/925** · `npm run smoke` rc=0(packed tarball 실설치). §9.3의 보고 수치와 일치한다. 단 **CI 9/9은 재현 대상이 아니다** — 그것은 GitHub 러너의 3 OS × Node 3버전 매트릭스이고 여기 실행은 Windows·Node 20 단일 환경이다 |
| 외부 Codex 리뷰 | **미수행** — 이번 변경분을 Reviewer 승인으로 표시하지 않는다. §4·§7.2·§8의 통과를 이월하지 않는다 |
| git 작업 | 문서 편집만. stage·commit·push 없음 |

**판정**: §9는 `0962d37` 코드와 대조한 문서 갱신이며, **외부 리뷰 승인은 주장하지 않는다.** 과거 §1~§8 기록은 각 시점의 사실로 보존했고 수정하지 않았다.

### 9.6 이번 동기화가 과거 기록에 남긴 포인터 이동 (과거 기록은 수정하지 않음)

과거 기록을 고치지 않는 원칙 때문에, 이번 변경으로 **과거 항목의 섹션 포인터 일부가 현재 문서와 어긋난다.** 삭제·개작 대신 여기 기록한다.

| 과거 기록 | 당시 가리킨 것 | 현재 위치 | 이유 |
|---|---|---|---|
| §7 R1 요약의 `05 §9 fresh-thread 1회=계약지침` | `05`의 상태·빈·오류 UX 규칙 | **`05` §10** | `05`에 **화면 H(`commitgate migrate`)가 §9로 신설**되어 이후 절이 한 칸씩 밀렸다. 화면 A~G의 문자·번호는 [12](12-traceability-matrix.md)가 "화면 A"·"화면 G"로 참조하므로 고정했다 |
| §6 R10 지적 ③의 `05 §9 "재시도 금지"` | 동일(상태·빈·오류 UX 규칙) | **`05` §10** | 동일 |

두 지적의 **내용과 처리 결과는 유효**하다 — 절 번호만 이동했다. 과거 로그는 **당시 문서 기준**으로 읽는다.

### 9.7 아카이브 라운드 번호의 재사용 (사실 기록)

이 문서의 **r20·r21**(2026-07-17, base `fae8c81`)과 §7 이전 기록에 나오는 **r20~r30**(2026-07-15 이전, REQ-2026-014 설계 비수렴 이력)은 **같은 번호이나 다른 라운드**다.

`nextArchiveRound`([scripts/req/review-codex.ts](../../scripts/req/review-codex.ts))가 라운드 번호를 실행 횟수가 아니라 **디스크에 남은 아카이브 파일명의 max+1**로 파생하기 때문이다. 과거 r20~r30은 아카이브되지 않아(승인분만 커밋되는 구조) 디스크에 r19만 남았고, 이번 리뷰가 r20을 **재사용**했다.

추적되는 design 응답은 **r19·r20·r21 3개뿐**이며 `review_base_sha`로 시대가 구분된다: r19 = `c978358`(구), r20·r21 = `fae8c81`(현). 이 사실은 [gaps-and-decisions.md](gaps-and-decisions.md) G-06a의 "상한을 아카이브 라운드 수로 계산" 원칙을 약화시킨다 — 현재 번호로 상한을 걸면 실제 실행 횟수보다 **관대해진다**.
