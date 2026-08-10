# REQ-2026-127 설계

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

| 사실 | 위치 | 확인 |
|---|---|---|
| 분류는 표시자 매칭(부모 수→trailer 줄→consumed SHA→기타) | `scripts/req/lib/verify-range.ts:89-94` | 읽음 |
| 관대 파싱이 의도(주석) — 심층 검증은 evidence.ts 재사용이 정본 경로 | `lib/verify-range.ts:40-47` | 읽음 |
| `validateManifest(content, {ticketRel, validPhaseIds})`가 행 스키마·confinement·승인본 파일명·중복을 검증 | `lib/evidence.ts:374` | 읽음 |
| manifest 수집이 경로당 `git show` 1프로세스(N+1) | `bin/verify-range.ts:210-217` | 실측 |
| state.json은 스캐폴드·checkpoint로 커밋됨 — head tree에서 phases[] 읽기 가능 | req-commit 흐름 | 읽음 |
| integrate가 verify 코어를 공유(`facts.verify`) | `bin/integrate.ts` | 읽음 |
| `.verify-runs.jsonl` counts 4키 | `bin/verify-range.ts:160-169` | 읽음 |

## 핵심 설계 결정

### DEC-1 · 심층 검증은 코어 확장(같은 모듈) — 입력을 넓히고 분류기를 단계화

`lib/verify-range.ts`의 입력·출력을 additive로 확장:

```ts
VerifyRangeInput {
  commits: CommitMeta[]            // + changedPaths: string[] (non-merge) · ccPaths: string[] (merge --cc 산출)
  manifestContents: ManifestFile[] // {path, content} — 경로 보존(티켓 rel 추출·validateManifest 입력)
  stateFiles: Map<ticketRel, phases[] | null>   // head tree state.json에서 — 없으면 null(검사 축소)
  attestations: AttestationRow[]   // head tree attestations.jsonl 파싱 결과(유효 행만) + treeOf(sha) 대조는 bin이 선계산
  archiveSha256: Map<path, sha256 | null>       // cat-file 배치 산출 — null=blob 읽기 실패(검증 불가)
}
CommitCategory = 'merge' | 'bookkeeping' | 'approved' | 'attested' | 'invalid-evidence' | 'unproven'
VerifyRangeReport { entries, counts(6키), unproven, invalid: {sha, subject, problems[]}[], manifestProblems,
                    verificationNotes: string[] }  // 검증 축소(phases 부재 등)·손상 attestation 카운트 표기
```

분류 순서(첫 일치 유지·단계 심화):

1. `parentCount >= 2` → ccPaths 비어 있으면 `merge`, 아니면 attested 검사 → 아니면 `unproven`
   (사유: conflict resolution 변경 N경로).
2. trailer 줄 존재 → changedPaths 전부 `ticketRoot/` 하위면 `bookkeeping`, 아니면 `invalid-evidence`
   (사유: trailer + 허용 밖 경로 목록 ≤3 표시).
3. 심층 approved: consumed 집합의 SHA면 — 그 행이 속한 manifest의 `validateManifest` 통과 +
   그 행의 response_path가 head tree에 실재 + `archiveSha256[path] === row.response_sha256` +
   같은 SHA 소비 행 유일 → `approved`. 하나라도 실패 → `invalid-evidence`(문제 목록).
   `archiveSha256[path] === null`(읽기 실패) → **`unproven` 강등 + note**(손상 단정 금지 — R4 failure mode).
4. attestation 유효 행(sha 일치 + tree 일치) → `attested`.
5. 그 외 → `unproven`.

- **invalid-evidence는 attestation으로 구제되지 않는다**(순서 3이 4보다 먼저 확정).
- `validPhaseIds`: `stateFiles.get(ticketRel)`이 null이면 manifest 자신의 phase_id 집합을 넘겨
  vacuous + `verificationNotes`에 축소 표기.

### DEC-2 · blob 배치 리더 `lib/git-batch.ts` (REQ-128 재사용 계약)

```ts
readBlobsAtRef(git 실행기, ref, paths[]): Map<path, Buffer | null>
```

`git cat-file --batch`(stdin에 `<ref>:<path>` 줄들) **프로세스 1개**로 전 경로를 읽는다.
missing/오류 경로는 null. spawn은 `cross-spawn` 동기 1회(입력 전체 write → 출력 파싱).
출력 파싱은 `<oid> <type> <size>\n<raw>\n` 프레이밍 기준(순수 함수로 분리해 단위 테스트).

### DEC-3 · attest verb (`bin/attest.ts`)

- `parseArgs`: `<sha> --reason <text> [--dir] [--run]` fail-closed. sha는 `rev-parse --verify <sha>^{commit}`로
  확정(축약 입력 허용 — 기록은 풀 OID). tree는 `rev-parse <sha>^{tree}`.
- 행: `{schema_version: 1, sha, tree, reason, attested_at, attested_by}` —
  attested_by = `git config user.name` + ` <` + `user.email` + `>`(로컬 식별자 — 서명 아님을 문서 명시).
- `--run`: append 후 `git add <ticketRoot>/attestations.jsonl` + bookkeeping 커밋(trailer —
  `bookkeepingMessage` 재사용). 워킹트리에 그 파일 외 staged 변경이 있으면 거부(오염 방지).
- dry-run: 기록될 행과 커밋 계획만 출력.
- 파서 `parseAttestations(content)`: 스키마 통과 행만 반환 + 손상 행 수. **순수**(lib에 두고
  verify-range·attest가 공유 — `lib/attestations.ts`).

### DEC-4 · 수집(bin) 확장 — 프로세스 수 상한

- changedPaths/ccPaths: `git log --format=…` 기존 1회에 `--name-only` 결합이 merge에서 애매하므로,
  **non-merge 경로는 `git log --name-only` 1회** 추가, **merge ccPaths는 merge 커밋들만
  `git diff-tree --cc <sha>` 커밋당 1회**(범위 내 merge 수는 소수 — 0.20→0.21 실측 7).
- state.json·attestations.jsonl·아카이브 blob: `readBlobsAtRef` **배치 1회**.
- 프로세스 수 회귀 오라클: fake git 호출 기록으로 "manifest 수 N과 무관하게 고정 호출 수"를 단언
  (벽시계 단언 금지).

### DEC-5 · strict·로그·integrate

- `computeExit`: `strict && (unproven + invalid) > 0` → 1 (attested 비계상).
- `VerifyRunRow.counts` 6키(additive). renderHuman/Json에 invalid 목록(문제 요약)·notes 추가.
- `integrate`: facts.verify에 `invalid`·`attested` 추가, planIntegration이 invalid>0도 차단
  (문구: 손상 증거는 attest로 면제 불가·수정 필요).

## Phase별 구현

**Phase 1 (`phase-1-deep-core`)** — `lib/git-batch.ts` + `lib/attestations.ts`(파서) +
`lib/verify-range.ts` 확장(6범주 분류기·notes) + 단위 테스트(분류 표·프레이밍 파서·손상 행).

**Phase 2 (`phase-2-attest-verb`)** — `bin/attest.ts` + dispatch/help + 실 git 테스트
(dry-run 무변경·--run 행+부기 커밋·sha 부재/이유 부재·tree 대조).

**Phase 3 (`phase-3-wire-strict`)** — `bin/verify-range.ts` 수집 확장(name-only·diff-tree --cc·
배치 blob·state phases·attestations)·렌더·VerifyRunRow ·`bin/integrate.ts` facts/plan 결속 ·
`lib/merge-gate.ts` invalid 차단 · 프로세스 수 회귀 테스트 · docs(workflow·upgrade 한/영)·CHANGELOG.

## 변경 파일

| 파일 | 변경 | phase |
|---|---|---|
| `scripts/req/lib/git-batch.ts` + 테스트 | 신규 | 1 |
| `scripts/req/lib/attestations.ts` | 신규 — 행 스키마·파서 | 1 |
| `scripts/req/lib/verify-range.ts` + 테스트 | 6범주 분류기 | 1 |
| `bin/attest.ts` + 테스트 · `dispatch.mjs`·`init.ts` | 신규 verb | 2 |
| `bin/verify-range.ts`·`bin/integrate.ts`·`lib/merge-gate.ts` + 테스트 | 수집·결속 | 3 |
| `docs/workflow.md`/`.en`·`docs/upgrade.md`/`.en`·`CHANGELOG.md` | 문서 | 3 |

## 테스트 oracle (완료 기준 ↔ 검증)

| 완료 기준 | 오라클 | 잡는 결함 |
|---|---|---|
| 1 | 분류 표: 스키마 위반/아카이브 부재/해시 불일치/중복 소비 → invalid-evidence 각 1건 | 표시자만 보고 approved |
| 2 | trailer+`src/` 혼입 → invalid-evidence(경로 표시) | trailer 위장 |
| 3 | ccPaths 비면 merge·있으면 unproven·attest 후 attested | evil merge 통과 |
| 4 | 실 git: attest --run 후 파일 행+trailer 커밋·dry-run 무변경·불량 인자 throw | 감사 기록 누락 |
| 5·6 | computeExit 표 + planIntegration invalid 차단·attested 통과 | strict 구멍 |
| 7 | fake git 호출 기록: manifest 3배 증가에도 호출 수 불변 | N+1 재도입 |
| failure | blob null → unproven+note · state 부재 → note · attestation 손상 행 → 카운트 | 위양성 invalid |

## 하위호환·안전

- counts additive·기본 exit 계약 불변·구 로그 공존. attestations.jsonl은 신규 파일(구버전 무시).
- 전부 revert 가능. 실수 방지: attest --run은 대상 파일 외 staged 존재 시 거부.
