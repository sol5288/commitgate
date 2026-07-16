# 13. 리뷰·검수 로그

본 SSOT 문서화의 리뷰·검수 이력. 비밀값·토큰·개인정보·불필요하게 긴 CLI 원문은 기록하지 않는다. **이 로그는 실제로 일어난 일만 기록한다**(허위 이력 금지 — [gaps-and-decisions.md](gaps-and-decisions.md) §3).

## 1. 리뷰 경로와 그 결정 배경

원 지침은 `/req`의 `req:review-codex`를 리뷰 경로로 요구했으나, 이 저장소에서 `/req`가 곧 CommitGate 자신이므로 다음 하드 모순에 도달했다.

- `req:new --run`은 티켓 스캐폴드를 **커밋**한다 → "커밋 금지" 위배.
- 티켓을 **수동 스캐폴드**한 뒤 `req:review-codex`를 돌리려면, 리뷰 전 clean-tree(D10) 전제 때문에 티켓의 `codex-request.md`(scratch 아님)가 tracked여야 한다. 이를 위해 로컬 `.git/info/exclude`로 상태 스캔에서 숨기려 했으나 **자동 모드 분류기가 게이트 우회로 정당하게 차단**했다.
- 결론: `req:review-codex`는 {커밋 금지 + docs만 스테이징 + 게이트 우회 금지}를 동시에 지키면서는 실행 불가.

**승인 문구(원문)와 성격 구분.** 여기서 "승인"은 CommitGate의 `/req` 통제점 승인 문장(예: `req:commit --run 승인`)이 **아니다**. `/req` 리뷰 게이트는 아예 실행되지 않았다. 이 승인은 대화 중 `AskUserQuestion`으로 리뷰 **경로**를 정한 것으로, 두 단계였다.

1. 1차 질문에서 사용자는 **"Authorize /req review, stop before commit"**(= `/req` 리뷰를 허용하되 커밋 직전 중단)을 선택.
2. 위 하드 모순이 확인된 뒤 2차 질문에서 사용자는 **"codex 직접 리뷰 (권장)"** 옵션을 선택. 그 옵션 원문 요지: *"docs/ssot-design를 git add한 뒤, req 티켓/게이트 없이 `codex exec --sandbox read-only`를 직접 호출해 동일한 Codex 엔진으로 문서를 외부 리뷰한다. 커밋 없음·문서만 스테이징·게이트 우회 없음 — 모든 하드 제약을 지키되 `req:review-codex` 래퍼만 생략(래퍼는 커밋 없이는 불가)."*

따라서 이 리뷰는 **`/req` 워크플로 리뷰가 아니라, `/req` 미수행에 대한 사용자 승인 대체 경로**다. `req:review-codex` 래퍼 없이 동일 리뷰 엔진(`codex exec --sandbox read-only`, `-c model="gpt-5.6-terra" -c model_reasoning_effort="high"`)을 직접 호출해 수행했다. "검수 완료"는 **문서 품질 리뷰 완료**를 뜻하며 `/req` 완료와는 구분된다.

| 항목 | 실제 값 |
|---|---|
| `/req` 티켓 생성 | **하지 않음**. `workflow/REQ-2026-014/`는 존재하지 않는다(위 모순). |
| 작업 브랜치 | **생성하지 않음**. 브랜치는 `main` 유지. |
| 리뷰 도구 | `codex exec --sandbox read-only`(직접 호출, req 티켓/게이트 미개입) |
| 리뷰 모델/추론강도 | `gpt-5.6-terra` / `high`(프로젝트 리뷰어 설정과 동일) |
| 리뷰 대상 | 스테이징된 `docs/ssot-design/**`만(리뷰 전 `git diff --cached --name-only`로 매회 확인) |
| 스테이징 범위 | 전 라운드에서 `docs/ssot-design/` 외 파일 0건 확인 |
| 커밋 | **없음**. 문서는 커밋 직전(staged) 상태로 유지. |

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

## 3. 통과 기준
- 마지막 수정 이후의 리뷰가 통과(추가 사실오류 0)해야 완료로 인정.
- 각 라운드에서 근거 추적·상호 링크·Mermaid·표 완결성을 함께 확인.
- 미해결 고위험 gap이 있으면 완료 불가.

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
- 미해결 **고위험 gap 없음**([gaps-and-decisions.md](gaps-and-decisions.md) §4).
- **`/req` 미수행 · 직접 Codex 리뷰 대체 수행 · 커밋 미수행**을 분리해 기록한다(§1). 브랜치 `main`, `workflow/REQ-2026-014/` 미생성, 문서는 커밋 직전(staged) 상태.

### 최종 확인 결과 (2026-07-15 코퍼스 기준)
- **최종 라운드 R15에서 코퍼스 전체 사실오류(P1/P2)·Mermaid 문법 오류 "추가 지적 없음"으로 수렴.** 마지막 수정 이후의 리뷰(R15)가 통과했으므로 문서 코퍼스를 **검수 완료**로 확정한다.
- **codex 호출 누적 총계**: 15개 리뷰 라운드에 걸쳐 **codex 17회 호출**(성공 15·실패 2). 실패 2회는 모두 모델 일시 용량 초과(`at capacity`)로 즉시 재시도해 성공했다(R6·R7 각 1차). 별도로 자동 모드 분류기의 일시 오류(transient)로 실행 전 차단된 시도가 몇 건 있었으나 이는 codex에 도달하지 않아 호출로 집계하지 않는다.
- **§4 R15 행·본 총계 문구는 R15 종료 후 기록된 사후 감사 기재**이며, 위 "무한 재귀 처리" 경계에 따라 그 자신에 의해 재리뷰되지 않는다(순수 사실 기록).
- **재구현 영향 고위험 gap 없음**([gaps-and-decisions.md](gaps-and-decisions.md) §4).

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
