# 12. 추적성 매트릭스

모든 최상위 기능과 외부 연동을 행으로 포함한다. 각 행은 흐름·CLI·데이터·규칙·권한·테스트·근거·설계문서로 연결된다. 표가 넓어 기능군별로 분리한다. 열 약어: **흐름**=사용자 흐름, **CLI**=UI/명령, **API/이벤트**=계약, **데이터**=엔터티, **규칙**=업무규칙/게이트, **권한**=역할/통제점, **테스트**=검증, **근거**=소스, **문서**=설계문서.

## A. 설치·제거

| 기능/모듈 | 흐름 | CLI | API/이벤트 | 데이터 | 규칙 | 권한 | 테스트 | 근거 파일 | 문서 |
|---|---|---|---|---|---|---|---|---|---|
| 설치(Stage B) | 화면 A | `npm install -D commitgate` → `commitgate init [--dry-run/--strict/--force/--no-agent-entrypoints]`(2단계) | npm/npx §4 | 관리 자산(스키마 2종·persona)·req.config.json·`req:*`=`commitgate <verb>` — **실행코드 무복사·devDeps 무주입** | 프리플라이트 **D19(Stage A 서명)→D14(선행 설치)** 순서 계약 + git·pkg·cross-spawn·gitignore·dirty | 없음(로컬) | init.test.ts | `planInstall`/`STAGE_B_REQ_SCRIPTS`([bin/init.ts](../../bin/init.ts)) | [05](05-user-flows-and-ui-spec.md)·[06](06-api-and-integration-contracts.md) |
| 마이그레이션 | — | `commitgate migrate [--apply/--dir]`(기본 dry-run) | — | `package.json` 한 파일의 `req:*` | 바이트 정확 일치만 전환, 사용자 값 보존, **비파괴(삭제 0건)**, `--apply` 전 commitgate 선언 확인 | 없음(로컬) | migrate.test.ts | `planMigrate`/`decideScripts`([bin/migrate.ts](../../bin/migrate.ts)) | [05](05-user-flows-and-ui-spec.md)·[11](11-test-strategy-and-acceptance.md) §3 |
| verb dispatch | — | `commitgate <verb>` | — | — | 알려진 verb→패키지 내부 모듈, 옵션·무인자→init, 미지 토큰 fail-closed | — | dispatch.test.ts | `resolveDispatch`/`VERB_MODULES`([bin/dispatch.mjs](../../bin/dispatch.mjs)) | [08](08-architecture-and-module-spec.md)·[11](11-test-strategy-and-acceptance.md) §3 |
| 제거 계획 | 화면 G | `commitgate uninstall` | — | 파일 분류·증거 보호, Stage B 런타임 제거 **안내 문자열**(`npm uninstall -D commitgate` — npm 미spawn) | 읽기 전용(쓰기 API 미포함, `--apply` 없음) | 없음 | uninstall.test.ts | [bin/uninstall.ts](../../bin/uninstall.ts) | [05](05-user-flows-and-ui-spec.md) |
| 진입점 포인터 | — | — | — | `.claude`/`.cursor`/CLAUDE.md/AGENTS.md | 얇은 포인터(계약=AGENTS.md) | 역할 계약 | init.test.ts(pm-중립) | [templates/](../../templates/) | [08](08-architecture-and-module-spec.md) §2.10 |

## B. 티켓·워크플로 진행

| 기능/모듈 | 흐름 | CLI | API/이벤트 | 데이터 | 규칙 | 권한 | 테스트 | 근거 파일 | 문서 |
|---|---|---|---|---|---|---|---|---|---|
| 티켓 생성 | 화면 B | `req:new <slug> --run` | §1.1 | state.json 초기, 00/01/02 | clean-tree, 채번 max+1 | Builder | req-new.test.ts | [scripts/req/req-new.ts](../../scripts/req/req-new.ts) | [03](03-domain-and-data-model.md)·[05](05-user-flows-and-ui-spec.md) |
| 다음 행동 계산 | 화면 E | `req:next <id> [--json]` | §1.2 | state.json(읽기) | 결정 머신 C, G1/G2 | 읽기 전용 | req-next.test.ts | [scripts/req/req-next.ts](../../scripts/req/req-next.ts) | [07](07-business-rules-and-state-machines.md) §6 |
| 일관성 게이트 | 화면 D | `req:doctor <id> [--finalize]` | §1.4 | state·응답·증거 | D2~D19(`D1/D4/D4a/D7/D7b/D8/D12/D14`는 예약 결번) | 게이트 | req-doctor.test.ts | [scripts/req/req-doctor.ts](../../scripts/req/req-doctor.ts) | [07](07-business-rules-and-state-machines.md) §3 |
| 설치 모드 진단(D19) | 화면 D | `req:doctor` | §1.4 | `package.json`의 `req:*` 값 | **값의 형태만**으로 stage-a/stage-b/mixed/none/custom 판정 → **mixed만 WARN·절대 FAIL 아님**. lockfile·`node_modules`·버전 skew 미검증 | 진단(비차단) | req-doctor.test.ts | `classifyInstallMode`([scripts/req/req-doctor.ts](../../scripts/req/req-doctor.ts)) | [07](07-business-rules-and-state-machines.md) §3·[11](11-test-strategy-and-acceptance.md) §2 |
| 논리 수명주기 | 전체 여정 | `req:next` | §1.2 | design_approved·commit_allowed·consumed_approvals+git | 파생 상태, `state.phase` 자동 전이 아님 | — | req-next.test.ts | `resolveNext`/`nextPhaseId` | [03](03-domain-and-data-model.md) §2·[07](07-business-rules-and-state-machines.md) §4 |

## C. 리뷰(Codex 연동)

| 기능/모듈 | 흐름 | CLI | API/이벤트 | 데이터 | 규칙 | 권한 | 테스트 | 근거 파일 | 문서 |
|---|---|---|---|---|---|---|---|---|---|
| 설계 리뷰 | 화면 C | `review-codex --kind design --run` | Codex §2, 시퀀스 3.1 | design_approved(_hash), design_approval_evidence | designHash 바인딩, 불변식 | 게이트 | req-review-codex.test.ts | [scripts/req/review-codex.ts](../../scripts/req/review-codex.ts) | [06](06-api-and-integration-contracts.md)·[07](07-business-rules-and-state-machines.md) |
| phase 리뷰 | 화면 C | `review-codex --kind phase --phase <p> --run` | Codex §2, 시퀀스 3.2 | approved_diff_hash, approval_evidence | staged tree 바인딩, R10, D10 | 게이트 | req-review-codex.test.ts | [scripts/req/review-codex.ts](../../scripts/req/review-codex.ts) | [06](06-api-and-integration-contracts.md)·[07](07-business-rules-and-state-machines.md) |
| 응답 검증 | — | (내부) | machine.schema §4 | codex-response.json, responses/*.json | AJV+validateVerdict | — | req-review-codex.test.ts, req-adapters.test.ts | `validateVerdict`/`validateResponseStructure` | [03](03-domain-and-data-model.md) §4 |
| 회로차단 | 화면 C | `--fresh-thread` | — | blocked_review | 2회 회로차단 | 사람 회복 | req-review-codex.test.ts | `shouldShortCircuitBlockedReview` | [07](07-business-rules-and-state-machines.md) §7 |
| **차단 채널 P1 전용** | — | (내부, 리뷰 시) | `--output-schema` 파생 copy | machine.schema `findings[].severity` | 출력 enum=`["P1"]` + P1 정의 4요소, 경로부재 throw | Reviewer | req-adapters.test.ts | `deriveStrictOutputSchema`([scripts/req/lib/adapters.ts](../../scripts/req/lib/adapters.ts)) | [03](03-domain-and-data-model.md) §4.2·[06](06-api-and-integration-contracts.md) §2.2·[07](07-business-rules-and-state-machines.md) §1.1 |
| 리뷰어 페르소나 | — | — | 프롬프트 첫 블록 | review-persona.md | fail-closed 로드·심링크 가드 | Reviewer | req-review-codex.test.ts | [workflow/review-persona.md](../../workflow/review-persona.md) | [04](04-user-roles-and-permissions.md)·[09](09-security-and-reliability.md) |

## D. 커밋·증거

| 기능/모듈 | 흐름 | CLI | API/이벤트 | 데이터 | 규칙 | 권한 | 테스트 | 근거 파일 | 문서 |
|---|---|---|---|---|---|---|---|---|---|
| 승인 커밋 | 화면 F | `req:commit --run [-m/--message-file]` | §1.5, 시퀀스 3.2 | 소스 커밋, consumed_approvals | doctor 게이트, stale, leak-guard | 통제점(HIGH 확인) | req-commit.test.ts | [scripts/req/req-commit.ts](../../scripts/req/req-commit.ts) | [05](05-user-flows-and-ui-spec.md)·[04](04-user-roles-and-permissions.md) |
| evidence-finalize | 화면 F | (내부/`--finalize`) | approvals.jsonl append | approval_evidence, approvals.jsonl | validateManifest, 멱등 | — | req-commit.test.ts | `finalizeEvidenceAndConsume` | [03](03-domain-and-data-model.md) §5 |
| HIGH 사람 확인 | 화면 F | — | — | user_commit_confirmed | userConfirmGate | 통제점 | req-commit.test.ts | `userConfirmGate` | [04](04-user-roles-and-permissions.md) §5 |
| 설계 확정 | — | `req:commit --finalize-design` | approvals.jsonl(design) | design_approval_evidence | manifest 검증 | — | req-commit.test.ts | `designFinalize` | [03](03-domain-and-data-model.md) §5 |

## E. 공유 라이브러리·경계

| 기능/모듈 | 흐름 | CLI | API/이벤트 | 데이터 | 규칙 | 권한 | 테스트 | 근거 파일 | 문서 |
|---|---|---|---|---|---|---|---|---|---|
| 설정 로드 | 전역 | 모든 명령 | req.config.schema §3 | req.config.json | confinement, DEFAULTS | — | req-config.test.ts | [scripts/req/lib/config.ts](../../scripts/req/lib/config.ts) | [02](02-repository-and-runtime.md)·[03](03-domain-and-data-model.md) |
| 안전 spawn | 전역 | git/codex 호출 | 프로세스 경계 §2·3 | — | shell-free 주입 차단 | — | req-adapters.test.ts, req-adapters-cmd.test.ts | [scripts/req/lib/adapters.ts](../../scripts/req/lib/adapters.ts) | [09](09-security-and-reliability.md) |
| status 파서 | 전역 | 게이트 | git §3 | status -z | `-z` 형식 고정 | — | porcelain.test.ts | [scripts/req/lib/porcelain.ts](../../scripts/req/lib/porcelain.ts) | [06](06-api-and-integration-contracts.md) §3 |
| scratch 판정 | 전역 | 게이트 | — | scratch 파일 | 증거 변조 차단 | — | scratch.test.ts | [scripts/req/lib/scratch.ts](../../scripts/req/lib/scratch.ts) | [03](03-domain-and-data-model.md) §8 |

## F. 운영·품질

| 기능/모듈 | 흐름 | CLI | API/이벤트 | 데이터 | 규칙 | 권한 | 테스트 | 근거 파일 | 문서 |
|---|---|---|---|---|---|---|---|---|---|
| CI 매트릭스 | — | (Actions) | push/PR/tag | — | 9-leg green 게이트 | — | 전 테스트 | [.github/workflows/ci.yml](../../.github/workflows/ci.yml) | [10](10-operations-deployment-and-observability.md) §2 |
| Stage B 스모크 | — | `npm run smoke` | packed tarball 설치(`npm pack` → `npm i -D <tgz>`) | 임시 target repo | 무복사·무주입·`req:*`=`commitgate <verb>`·**dispatch 도달 증명**(rc≠0 + doctor 자신의 사용법 오류) · uninstall 읽기 전용 · migrate 비파괴. **한계: 트리 비교가 파일 크기 기준** | — | smoke.mjs 자체(vitest 밖) | [scripts/smoke.mjs](../../scripts/smoke.mjs) | [10](10-operations-deployment-and-observability.md) §3·[11](11-test-strategy-and-acceptance.md) §3 |
| override 검증 | — | `npm run verify:overrides` | codex | — | 모델/effort 실효성 | — | (수동) | [scripts/verify-review-overrides.mjs](../../scripts/verify-review-overrides.mjs) | [10](10-operations-deployment-and-observability.md) §3 |
| 릴리즈 통제점 | — | (수동) | I1/I2/B1/R1/R2/R3 | 버전 범프 | 통제점 승인 문장 | 통제점 | — | [docs/RELEASING.md](../../docs/RELEASING.md) | [04](04-user-roles-and-permissions.md)·[10](10-operations-deployment-and-observability.md) |

## 연결 완결성 점검
- 모든 행이 근거 파일 + 설계문서 링크를 가진다(빈 칸 없음).
- 권한이 "없음/읽기전용"인 행은 로컬·읽기전용 특성 때문이며 사유가 명시됨.
- CLI 리뷰는 코퍼스(전체 스테이징) 라운드 방식이므로 문서별 개별 통과가 아니라 **라운드별 코퍼스 통과**로 추적된다([13-review-and-validation-log.md](13-review-and-validation-log.md) §4; 코퍼스 리뷰 사유는 [gaps-and-decisions.md](gaps-and-decisions.md) D-04). 최종 라운드에서 코퍼스 전체 사실오류가 0건이면 전 문서 통과로 간주한다.

## G. 현재 gap → 목표 설계 추적

아래 표는 구현 추적이 아니라 **투자 추적**이다. 구현 전 항목은 위 A~F의 현재 기능 행으로 승격하지 않는다.

| 현재 gap | 사용자 영향 | 목표 설계 | 우선순위 | 완료 후 갱신할 현재 문서 |
|---|---|---|---|---|
| G-05 로컬 게이트 우회·CI evidence 미검증 | 승인 없는 변경 원격 반영 | STR-01 CI verifier·정책 프로필 | P0 | 04·06·09·10·11·12 |
| G-09 scratch state 비내구/재구축 없음 | fresh clone 진행 판정 불가 | STR-02 event log·`req:repair` | P0 | 03·05·07·08·09·11·12 |
| G-02 외부 전송 보호 없음 | 비밀·과대 payload 노출 | STR-03 전송 manifest·scanner·격리 컨텍스트 | P0 | 01·05·06·09·11·12 |
| G-06a/b 비수렴·전면 재리뷰 | 비용 폭증·티켓 중단 | STR-04 상한·delta·escalation | P0 | 03·05·06·07·11·12 |
| G-04/G-06c trunk·ID 충돌 | 팀/병렬 브랜치 오작동 | STR-05 ref scan·trunk 설정·UUID | P1 | 02·03·05·06·07·11·12 |
| G-10 자산↔런타임 version skew·safe upgrade 부재 | repo별 정책 불일치 | STR-06 install manifest·upgrade plan | P1 | 02·05·06·08·10·11·12 |
| G-01/G-03 진단·timeout | 멈춤·원인 유실 | STR-07 구조화 오류·자식 종료 | P1 | 05·06·09·10·11·12 |
| G-11 제품 지표 없음 | 효과·비용 판단 불가 | STR-08 privacy-preserving report | P1 | 01·03·05·10·11·12 |

목표 설계와 우선순위의 정본은 [14-product-strategy-and-roadmap.md](14-product-strategy-and-roadmap.md)다.
