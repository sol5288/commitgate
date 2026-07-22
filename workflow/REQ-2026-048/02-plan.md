# REQ-2026-048 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님).
>
> 게이트 명령은 `typecheck`(`tsc --noEmit`) · `test`(`vitest run`) · `smoke`다. 이 저장소에는 `lint` 스크립트가 없다(스캐폴드 문구의 "eslint0"은 해당 없음). 로컬 전체 스위트가 환경에 따라 장시간 무출력으로 멎으면 **CI 9 job이 정본**이다.

## Phase 1 — 공유 evidence 모듈 추출 (`phase-1-evidence-module`)

범위: 매니페스트 모델·헬퍼(`MANIFEST_KEYS`·`ManifestEntry`·`buildManifestEntry`·`serializeManifestLine`·`validateManifest`·`expectedArchivePaths`·`manifestHasConsumed`)와 **그 런타임 의존**(`archiveBaseName`·`isValidIsoInstant`·`isConfinedArchivePath`·`SHA256_RE`·`GIT_OID_RE`·`escapeRegExp`·`userConfirmProblem`)을 신규 **`scripts/req/lib/evidence.ts`** 로 이동하고, 원래 모듈(`req-commit`·`review-codex`·`req-doctor`)은 **re-export**로 하위호환 유지(DEC-1).

신규 모듈의 **런타임 import는 `lib/scratch.ts`(leaf)뿐**이고 타입만 `import type`으로 가져와 순환을 만들지 않는다. 검증: `lib/evidence.ts`에 `from './review-codex'`·`from './req-doctor'`·`from './req-commit'` **런타임 import가 0건**임을 테스트로 고정한다(타입 전용 import는 허용).

🔴 **동작 변경 0** — 이 phase의 성공 기준은 "기존 테스트가 **한 줄도 고치지 않고** 그대로 그린"이다. 테스트를 고쳐야 한다면 그것은 순수 이동이 아니라는 신호다.

Exit: `tsc --noEmit` 0 · 기존 단위 스위트 **무수정 그린** · `req:doctor` PASS · Codex phase 리뷰 승인.

## Phase 2 — `archive_inventory` (`phase-2-archive-inventory`)

범위: design 매니페스트 행에 선택 필드 `archive_inventory: [{response_path, sha256}]` 추가(DEC-2) — `MANIFEST_KEYS` 등재, 항목별 검증(`response_path`는 현재 티켓 `responses/` 직계 아카이브·`sha256` 64hex, **needs-fix 이름 허용**), 인벤토리 빌더, `designFinalize`가 **인벤토리 전량을 stage**.

단위 테스트: ①필드 부재 = **매니페스트 검증상** 유효(하위호환) ②비-confined 경로·잘못된 sha 거부 ③인벤토리에 needs-fix 허용하되 **행 최상위 `response_path`는 여전히 approved만** ④인벤토리 전량이 stage 목록에 들어감 ⑤중복/주입 거부 ⑥**수집 범위 결정성**: 현재 티켓 responses/ 직계의 design 아카이브 전부를 rNN 오름차순으로 담고 phase 아카이브·타 티켓은 제외(디렉터리 읽기 순서 비의존).

Exit: `tsc --noEmit` 0 · 단위 그린 · `req:doctor` PASS · Codex phase 리뷰 승인.

## Phase 3 — design 승인 경로 흡수 (`phase-3-absorb-approval-path`)

범위: 성공한 `review-codex --kind design --run`이 `durableDesignEvidence(...)`로 아카이브+매니페스트를 자동 evidence commit(DEC-3). 멱등 skip. 🔴 **커밋 실패가 승인 판정·exit code를 바꾸지 않고** 복구 명령을 안내한다. `--finalize-design`은 같은 구현을 호출하는 복구 경로로 유지.

실패 주입 테스트(DEC-5): ①커밋 실패 → 승인 불변·안내 출력 ②🔴 **부분 상태 재시도 복구** — 매니페스트 append·stage 후 commit만 실패한 상태에서 `--finalize-design` 재실행이 **중복 append 없이 stage·commit을 재수행**해 HEAD 증거를 복구한다(온디스크 엔트리 존재를 이유로 skip하면 실패해야 하는 테스트) ③완전히 내구화된 뒤 재실행은 **진짜 no-op**(새 커밋 0건) ④중복 실행 시 매니페스트 중복 행 없음.

Exit: `tsc --noEmit` 0 · 단위 그린 · `req:doctor` PASS · Codex phase 리뷰 승인.

## Phase 4 — `req:next` DONE 게이트 (`phase-4-done-gate`)

범위: `req:new`가 신규 티켓에 marker(`evidence_durability_required: true`)를 심고, `req:next`가 DONE 직전 **`HEAD`의 Git blob**에서 매니페스트 design 행·`response_path`·`archive_inventory` 존재와 SHA 일치를 검증한다(DEC-4). 미충족 → `DONE` 대신 **`BLOCKED` + 복구 명령**.

🔴 **`req:doctor`·일반 `req:commit`에 FAIL 게이트를 추가하지 않는다.** marker 부재(legacy) 티켓은 기존 DONE 그대로.

단위 테스트: ①HEAD blob의 marker 없으면 기존 DONE ②marker + 커밋된 증거 완비 → DONE ③marker + design 행 없음 → BLOCKED + 복구 명령 ④marker + 인벤토리 아카이브 blob 부재/sha 불일치 → BLOCKED ⑤**온디스크에만 있고 HEAD에 없으면 BLOCKED**(이 갭의 핵심 — 온디스크 통과 금지) ⑥🔴 **워킹 `state.json`에서 marker를 지워도 HEAD blob 기준으로 여전히 엄격**(캐시 소실로 게이트 우회 불가 — design r01 P1-1 회귀 고정) ⑦HEAD blob 읽기 불가·파손 → 보수적으로 BLOCKED ⑧marker 켜진 티켓의 design 행에 `archive_inventory` 부재 → BLOCKED ⑨doctor 체크 목록·레벨 무변경.

Exit: `tsc --noEmit` 0 · 단위 그린 · `req:doctor` PASS · Codex phase 리뷰 승인.

## Phase 5 — 문서·릴리스 준비 (`phase-5-docs-release`)

범위: 워크플로/문제해결 문서(한·영)에 design 증거 내구화 동작·복구 절차 반영, `CHANGELOG`, 버전 상향.

> 리뷰 주의: 이 phase는 앞 phase들의 런타임을 문서화하므로 diff-scoped 리뷰에서 "근거 부재" 오탐이 날 수 있다(REQ-2026-037·REQ-2026-047 선례). `codex-request.md`의 phase 경계 절에 **선행 phase 커밋 SHA**를 적어 해소한다.

Exit: `tsc --noEmit` 0 · 전체 스위트 그린 · `docs:lint` 0 · `smoke` 0 · `req:doctor` PASS · Codex phase 리뷰 승인.

## 완료

- 게이트 해당분(typecheck·test·smoke·docs:lint) · **사용자 main 머지(별도 승인)**. 실제 `npm publish`·tag·GH release는 **사용자 직접**.
- 비목표: phase 증거 경로 변경 · 승인 판정 로직 변경 · `state.json` 커밋 승격 · doctor/req:commit FAIL 추가 · **legacy 티켓(hermes REQ-2026-001 등) 소급 복구**(도구 완비 후 별도 판단, 증거 날조 금지) · `main` 하드코드/`trunkBranch` 분리(P2).
