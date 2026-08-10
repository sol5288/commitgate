# REQ-2026-127 요구사항

verify-range 심층 증거 검증 + attestation — 표시자 매칭을 증거 검증으로

## 배경 (무엇이 문제인가)

0.21의 verify-range 분류는 **표시자 매칭**이다: `consumed_by_commit_sha` 존재(approved) ·
trailer 줄 일치(bookkeeping) · 부모 수(merge). 실수 탐지에는 유용하지만 강한 증명이 아니다:

1. **approved**: manifest 행이 손상됐거나(스키마 위반·해시 형식 오류), 참조하는 응답 아카이브가
   HEAD tree에 없거나, 아카이브 내용의 SHA-256이 manifest와 달라도 — `consumed_by_commit_sha`만
   있으면 approved로 센다. 같은 SHA를 가리키는 모순 행도 걸러지지 않는다.
2. **bookkeeping**: trailer 한 줄만 보고 인정한다. trailer를 붙인 커밋이 **사용자 코드를 함께
   변경**해도 bookkeeping으로 통과한다 — 게이트 우회 경로다.
3. **merge**: 부모 수 ≥ 2면 무조건 신뢰한다. conflict resolution·evil merge로 merge 커밋에
   **부모 어느 쪽에도 없는 변경**이 실려도 드러나지 않는다.
4. **정당한 예외를 표현할 방법이 없다**: release·setup·수동 충돌 정정 커밋은 증거가 없는 것이
   정상인데, 매번 미입증으로 남아 사람이 같은 커밋을 반복 확인한다(0.20→0.21 범위에서 3건 실측).

## 요구

### R1 — 분류를 6범주로 확장·심층 검증

`approved | bookkeeping | merge | attested | invalid-evidence | unproven`

**approved 심층**(기존 evidence 검증 로직 재사용 — 사본 금지):

- manifest 행 전체 스키마: `validateManifest`(evidence.ts 정본)로 검증 — kind·phase_id·
  response_path(confinement·승인본 파일명)·response_sha256(64hex)·review_base_sha·
  consumed_by_commit_sha·approved_tree(phase)/design_hash(design)·approved_at/consumed_at(ISO).
- 참조 응답 아카이브가 head tree에 실재하는지 + **blob 내용의 SHA-256 == manifest 값**.
- 같은 `consumed_by_commit_sha`를 가리키는 행이 2개 이상이면(중복 소비 기록) invalid-evidence.
- kind와 phase_id 정합(validateManifest의 kind 격리·파일명 규칙이 담당).
- `validPhaseIds`는 head tree의 그 티켓 `state.json` phases[]에서 읽는다 — 읽을 수 없으면 그
  검사만 생략(manifest 자신의 phase_id 집합을 넘겨 vacuous)하고 검증 축소를 출력에 표기한다.
- 심층 검증 실패 커밋은 approved가 아니라 **invalid-evidence**다.

**bookkeeping 심층**: trailer + **변경 경로 전부가 허용 경로**일 때만 bookkeeping.
허용 경로 = `ticketRoot` 하위(티켓 문서·state·responses·원장·attestations·delivery 레코드).
trailer가 있는데 허용 밖 경로(사용자 코드)가 섞이면 **invalid-evidence**(trailer 위장 차단).

**merge 심층**: 부모 수 ≥ 2 + **conflict resolution/evil-merge 변경 없음**(`git diff-tree --cc`
산출 없음)일 때만 merge. --cc 산출이 있으면 그 merge는 **unproven**으로 분류하고 사유(수동 해소
포함)를 표기한다 — 정당하면 attestation으로 승인한다. merge의 부모들은 base..head 범위 안이면
각자 검증된다(git log가 도달 가능 커밋 전수를 주는 기존 구조 유지).

### R2 — attestation: 정당한 예외의 명시 승인

`commitgate attest <sha> --reason "..." [--dir] [--run]` (기본 dry-run).

- 기록: `<ticketRoot>/attestations.jsonl` — **append-only·커밋되는 감사 기록**. 필수 필드:
  `schema_version(1)` · `sha`(대상 커밋, OID) · `tree`(그 커밋의 tree OID — identity 결속) ·
  `reason`(비어 있지 않은 문자열) · `attested_at`(ISO) · `attested_by`(로컬 git user.name <email> —
  주체의 로컬 식별자).
- `--run`은 행 append 후 그 파일만 담은 **bookkeeping 커밋**(trailer 포함)을 만든다.
- 대상 sha가 존재하지 않으면 실패. reason 없으면 실패. 중복 attest는 append(감사 보존 —
  마지막 행이 아니라 "유효한 행 존재"가 판정 기준).
- verify-range/integrate는 head tree의 attestations.jsonl을 읽어, 미입증·conflict-merge 커밋 중
  **유효한 행(스키마 통과 + tree가 그 커밋의 실제 tree와 일치)** 이 있는 것을 `attested`로 분류한다.
- attestation은 invalid-evidence를 구제하지 않는다 — 손상 증거는 수정이 답이지 면제가 아니다.

### R3 — strict·integrate 결속

- `--strict`: `invalid-evidence > 0 || unproven > 0` → exit 1 (attested는 통과).
- `integrate`: 항상 심층 strict — 같은 조건으로 차단(attested 통과). facts/plan에 새 범주 반영.
- 기존 보고 모드(기본 exit 0) 유지. `VerifyRunRow.counts`에 `attested`·`invalid` 추가(additive).

### R4 — 성능·재사용

- 아카이브 blob 읽기는 **배치**(`git cat-file --batch` 어댑터 1개 — `lib/git-batch.ts` 신설)로
  한다. manifest당 `git show` 프로세스를 늘리지 않는다(REQ-2026-128이 report에서 재사용).

## 완료 기준

1. 심층 approved: 스키마 위반·아카이브 부재·해시 불일치·중복 소비가 각각 invalid-evidence로
   분류된다(fixture 테스트).
2. trailer + 사용자 코드 혼입 커밋이 invalid-evidence로 분류된다.
3. --cc 산출 있는 merge가 unproven으로 분류되고, attest 후 attested가 된다.
4. attest verb: dry-run 무변경 · --run이 행+부기 커밋 생성 · sha 부재/이유 부재 실패 ·
   tree 불일치 행은 무효(실 git 테스트).
5. --strict가 invalid-evidence·unproven에서 실패하고 attested에서 통과한다.
6. integrate가 새 분류를 소비한다(차단·통과 양방향).
7. cat-file --batch 경로로 아카이브를 읽는다(프로세스 수 회귀 테스트 — 벽시계 단언 금지).

## 비목표

- report 표면 갱신(REQ-2026-128) — counts 확장의 소비는 그쪽.
- 유실 증거의 소급 복구·기존 로그 마이그레이션.
- attestation의 원격 서명·다인 승인(로컬 감사 기록으로 한정).
- squash/rebase 재작성 이력의 재결속(있는 그대로 보고 유지).

## Failure mode

- head tree에 state.json이 없거나 phases[]가 없으면 → validPhaseIds 검사만 축소(표기 동반).
  추정으로 invalid를 만들지 않는다(위양성이 도구 신뢰를 깬다).
- attestations.jsonl 손상 행 → 그 행만 무효(카운트 표기), 파일 전체를 죽이지 않는다.
- cat-file 배치 실패 → 해당 검증을 invalid-evidence가 아니라 **검증 불가 표기 + unproven 강등**
  (증거 손상 단정 금지).

## 하위호환

- 기본 exit 계약 유지(보고 모드 exit 0). counts 키 추가는 additive — `.verify-runs.jsonl` 구행과
  공존(report의 관대 파서가 부재 키를 0으로 본다 — REQ-128에서 소비).
- 기존 4범주만 아는 소비 코드(report)는 새 키를 무시해도 동작.

## Rollback

- 신규 verb·모듈·분류 확장 revert로 복구. attestations.jsonl은 append-only 데이터 파일이라
  코드 롤백 후에도 남지만 구버전은 읽지 않는다(무해).
