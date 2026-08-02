# REQ-2026-103 요구사항

데드코드 제거 + gitAdapter 복원 누락 수정

## 배경

2026-08-02 v0.18.0 전면 자체감사에서 "수차례 개선을 거듭하며 비대해졌다"는 관찰을 4축(코드중복·review-codex 해부·doctor 인벤토리·npm 페이로드)으로 검증했다. 그 결과 중 **소비자 영향이 0으로 확정된 항목만** 이 REQ가 처리한다.

소비자 실측(2026-08-02): `44_yammy_sales`(티켓 134·`^0.18.0`·REQ-131 작업 중), `45_MBTI_kiosk`(티켓 15·`^0.18.0`·REQ-014/015 진행 중). 업그레이드는 반드시 **진행 중 티켓 위로** 떨어지므로, 판정 기준은 "기존 state·아카이브·원장·프롬프트를 바이트 그대로 읽고 쓸 수 있는가"다.

## 요구

1. **죽은 resume 배선 제거.** `review-codex.ts:2670`의 `const isResume = false`(REQ-2026-013 P4에서 stateless 전환) 때문에 `resumeThreadId`를 타고 흐르는 분기 전체가 영구 도달 불가다. `callReviewer`·`ReviewerAdapter.review`·`createCodexReviewerAdapter`의 resume 분기를 제거한다.
   - 🔴 **`state.codex_thread_id` 필드 자체는 유지한다** — 소비자 state 95개(yammy 81·MBTI 14)에 실재하고 승인 증거 스냅샷에도 들어 있다. 쓰기(저장)는 그대로 두고 **읽어서 분기하는 죽은 경로만** 없앤다.

2. **`withAttemptRecorded` 제거.** 프로덕션 호출자 0(mainImpl은 `gateAndRecordAttempt`를 직접 호출). 이를 쓰는 테스트 3곳은 **삭제가 아니라 `gateAndRecordAttempt` 대상으로 재작성**한다 — 세 테스트가 실제로 검증하는 것은 래퍼가 아니라 게이트 동작이므로 커버리지 손실이 없다(오히려 프로덕션 함수를 직접 겨냥하게 된다).

3. **`gitAdapter` 복원 누락 수정.** `main()`은 `reviewer`를 try/finally로 복원하지만(REQ-2026-027 D3), `mainImpl`이 재할당하는 `gitAdapter`는 복원하지 않는다. 같은 위험(programmatic 다중 호출 시 모듈 전역 오염)이 한쪽에만 막혀 있다.

4. **미참조 심볼 제거.** `QUICKSTART_MARKER_OPEN`/`_CLOSE`(저장소 전역 참조 0) · `committedPlannedPhaseIds`(같은 파일에서 1회 쓰는 별칭 → 원본 직접 호출) · `unclosedAttempts`(어떤 게이트에도 미배선) · DRY-RUN 출력의 `phase=${state.phase}`(deprecated 필드라 항상 `INTAKE`) · 리팩터 때 함수만 옮기고 남은 고아 JSDoc.

## 비요구(명시적 범위 밖)

- **`export` 키워드만 제거하는 모듈 표면 축소**(감사가 지목한 값 47개·타입 111개): 20여 파일에 걸치는데 런타임 효과가 0이라 검수 면적 대비 가치가 낮다. 별도 REQ로 미룬다.
- **`risk_level`·`phaseCommit`·`machine.schema.json`·JSONL 직렬화·Quick Start 블록**: 소비자 영향이 실측으로 확인된 금지 항목. 이 REQ는 손대지 않는다(yammy 아카이브 697파일이 `risk_level`을 포함하고 D6/D16이 커밋마다 재검증한다).
- **`closeSeriesHumanResolution`**: 감사 초안은 "도달 불가 write 경로 → 삭제 후보"로 분류했으나 **오판이었다.** `closed_reason:"human-resolution"`은 사람이 state에 직접 남기는 손기록이고 소비자 state 5곳에 실재하며 `req:new --successor-of`가 그 존재를 fail-closed로 요구한다. 함수는 그 손기록을 대신할 CLI가 없을 뿐이므로 **배선 후보**(별도 UX REQ)이지 삭제 대상이 아니다. 리더 4곳도 유지한다.
- **D18 오탐 수정·doctor 체크 병합·D5 제거·delivery ports 버그픽스**: 전부 소비자 관측(출력·진단 변화)이 있어 별도 트랙.

## 완료 기준

- 위 4개 요구가 반영되고 `npm run typecheck` 0, 전체 스위트 그린.
- **소비자 관측 가능한 변화 0**: CLI 표면·doctor 출력·프롬프트 바이트·state 스키마·원장 형식·아카이브 형식이 전부 불변.
