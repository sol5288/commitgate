# REQ-2026-014 리뷰 요청 (design — 축소 재설계)

## 배경

이 티켓의 설계 리뷰는 **r30까지 갔고 수렴하지 않았다**. 측정된 사실:

- **r19에서 findings 0건으로 승인**이 났다(`responses/design-r19-approved.json`). 그 승인으로 Phase 1이 구현·리뷰(0건 승인)·커밋됐다(`95d94b8`).
- 이후 요구가 계속 추가되며 설계 해시가 바뀌어 승인이 무효화되고 전면 재리뷰가 돌았다.
- **r20~r30의 findings 21건은 전부 P2이고 P1은 0건이다.**

즉 이 티켓이 멈춘 원인은 **결함이 아니라 범위 확장**이다. 이 진단은 이미 REQ-2026-018을 낳았고,
그 티켓이 **차단 채널을 P1 전용으로** 배선해 main에 들어갔다. 이 리뷰는 그 정책 하에서 도는 첫 REQ-2026-014 리뷰다.

PM은 범위를 **"Stage B 전환을 증명하는 최소 완결 경로"** 로 확정했다. 이번 재설계는 그 결정을 문서에 반영한 것이다.

## 변경 요약

**요구·설계·계획 3종을 축소했다. 구현 코드 변경은 이 리뷰 대상이 아니다(design 리뷰).**

핵심은 **신규 모듈을 하나로 줄인 것**이다: `bin/migrate.ts`. r19에 있던 아래는 전부 **제거**했다.

| r19 항목 | 조치 | 근거(코드 확인) |
|---|---|---|
| `scripts/req/lib/ownership.ts`(KIT_*/REQ_SCRIPTS 이동) | **제거** | 근거였던 "순환/TDZ 회피"가 이미 해결돼 있다 — `bin/uninstall.ts:26-39`가 `./init`에서 직접 import하고 init은 역방향 import를 하지 않는다. `bin/migrate.ts`도 같은 패턴이면 된다 |
| `.commitgate/manifest.json` + `manifest.ts` + AJV + `.commitgate/` confinement(D8) | **제거** | 자동 삭제가 범위 밖인 이상 진단만을 위해 새 파일·스키마·confinement 축을 도입할 이유가 없다. 설치 모드는 **script 형태**로 판정 가능 |
| best-effort 트랜잭션(D11: snapshot·write-tracking·rollback) | **제거** | **기존 코드에 rollback이 0줄이다**(`bin/` 전체 grep: `rollback\|snapshot\|backup\|restore\|unlinkSync\|rmSync` → uninstall의 git revert **안내 문자열** 2건뿐). D11은 신규 프레임워크였고, 그 gap은 REQ-2026-010에서 이미 질문받고 rollback 없이 shipped됐다(`REQ-2026-010/codex-request.md:184`) |
| D14의 (b)node_modules 존재 + (c)realpath 동일성 | **(a)선언만 남김** | (c)는 `--dir` 정상 경로를 구조적으로 막는다(설계 §5.1-1). r19의 해법인 "자동 재실행"도 PM이 잘랐으므로 r19−재실행 = `--dir` 파손 |
| lockfile 포맷 파서·버전 완전 일치·다중 lockfile 정본 선출 | **제거** | 재현성은 **lockfile 커밋 권고**(문서)로 |
| PnP 완전 지원 / preflight fail-closed | **문서화된 제한**으로 | 자동 설정 변경 금지(PM) |

**남긴 강제 지점은 둘뿐이다**: `devDependencies.commitgate` **키 존재**(D14 축소)와 **Stage A 서명 감지**(D19 — 조용한 혼합 설치 방지).

설계에는 **실측**도 넣었다(격리 npm 캐시): `npm i -D <tgz>`는 `"commitgate": "file:…tgz"`를 쓰므로 **값 형태를 검증하면 안 되고**,
`node_modules/.bin/commitgate`가 생겨 `req:* = "commitgate <verb>"`가 **실제로 해소된다**.

## r20 지적 반영 (이번 라운드에서 고친 것)

r20의 **P1 2건을 모두 수용**했다. 둘 다 코드로 재확인한 뒤 고쳤다.

| r20 P1 | 확인 | 조치 |
|---|---|---|
| **Stage A 서명 검사(D19)가 D14보다 뒤라 Stage A 사용자가 migrate 안내에 도달 못 함 → R7 미달성** | 맞다. `REQ_DEV_DEPS`(`bin/init.ts:146-150`)는 `ajv`·`cross-spawn`·`tsx`뿐이라 **Stage A 설치본에는 `devDependencies.commitgate`가 없다** → D14가 먼저면 항상 "npm install -D commitgate"에서 죽는다 | **preflight 순서를 D19 → D14로 뒤집고**, 그 순서를 **설계의 명시적 계약**으로 승격(01-design.md §5.1 순서 계약). 요구(R7)에도 "R6보다 먼저"를 인수 기준으로 못박고, **"Stage A 서명 ∧ commitgate 미선언 → migrate 안내로 throw"** 회귀 테스트를 Phase 2 필수 항목으로 추가 |
| **Phase 5 smoke가 티켓 없는 fresh 대상에서 `req:doctor`를 rc=0으로 기대 → 불가능** | 맞다. `req-doctor.ts:393` `throw new Error('REQ id 또는 --ticket <dir> 필요')`. 더 넓게 확인한 결과 **fresh·티켓 없는 대상에서 rc=0으로 끝나는 `req:*` verb는 존재하지 않는다**(new=clean tree, next/doctor=티켓, commit=승인, review-codex=live Codex) | dispatch 증명을 **"성공 종료"에서 "도달 증명"으로 교체**: `npm run req:doctor` → **exit≠0 + req-doctor 자신의 사용법 오류** 단언. 이는 npm script → `.bin/commitgate` 해소 → tsx 등록 → 패키지 내 `scripts/req/req-doctor.ts` 실행까지 **사슬 전체**를 증명하며, launcher의 `알 수 없는 명령`·npm의 `not found`와 **메시지로 구분**된다. 티켓 fixture를 만드는 대안은 비용 대비 이득이 없어 backlog |

## 리뷰 포인트 (하한이지 상한이 아님)

1. **축소된 D14(선언 키 존재만)가 R6를 실제로 달성하는가** — 정상 경로에서 조용한 손상을 만드는 구멍이 남아 있는가?
   설계 §5.1-1a에 (b)·(c) 제거로 **수용하는 위험을 명시적으로 표로 기록**했다. 그 기록이 정직한가, 아니면
   그중 하나가 **정상 경로에서 재현되는 P1**인가?
2. **D19(Stage A 서명 감지)가 혼합 설치를 실제로 막는가** — 기존 주입 규칙이 `if (!(k in scripts))`(미덮어씀)이라
   감지가 없으면 vendored 런타임이 계속 도는데 사용자는 Stage B라 믿는다. 감지 조건(정확한 `REQ_SCRIPTS` 값 **또는** `scripts/req/**` 존재)에
   정상 경로 누락이 있는가?
3. **D11 제거가 안전한가** — 기존 보장은 "쓰기 **전에** 실패"(Preflight→Apply, `bin/init.ts:739-741`)이지 "실패 후 되돌림"이 아니다.
   Stage B는 `scripts/req/**` 복사와 devDeps 주입을 **없애 쓰기 표면을 줄이기만** 한다. 그럼에도 이번 변경이 **새로** 만드는 부분 설치 위험이 있는가?
   (현행에 이미 있던 `--force` 중간 실패 위험은 이 REQ가 만든 것이 아니다 — 후속 backlog로 기록했다.)
4. **doctor D19의 level=WARN 상한이 옳은가** — 설계 §6 D-DOC1. **CommitGate 자신의 `package.json`이 Stage A 형태**이고
   `req:commit`이 doctor를 exit≠0에 throw하는 하드 게이트로 spawn하므로, FAIL이면 이 저장소의 커밋이 영구 차단된다.
   이 판단이 맞는가? Stage A를 OK로 두는 것이 R7(혼합 설치 방지)을 약화시키는가?
5. **테스트 blast radius(설계 §9.1)가 정직한가** — 특히 **vacuity trap**: 부분 설치를
   `existsSync('scripts/req/req-new.ts')===false`로 증명하던 7건은 Stage B에서 **성공 경로에도 참**이라 공허해진다.
   재-앵커 계획이 충분한가, 아니면 검증 소실이 남는가?
6. **phase 경계가 실행 가능한가** — 특히 Phase 2가 `uninstall.test.ts` 픽스처를 포함하는 것(init이 vendoring을 멈추는 순간 같이 깨지므로).
   각 phase가 공통 Exit(`typecheck 0` · `vitest run` 그린)를 **실제로** 만족할 수 있는가?

## 이 리뷰에 요청하는 규율

이 티켓은 **범위 확장으로 30라운드 비수렴한 티켓**이고, 그 축소안이 다시 확장되면 목적을 잃는다.
[00-requirement.md](00-requirement.md) **§4는 비목표를 명시적으로 열거**한다 — manifest·provenance·lockfile 파서·버전 완전 일치·
realpath 동일성·자동 재실행·failure injection·PnP 완전 지원·nested workspace 전 형태.
**비목표로 선언된 것을 이번 범위로 되돌리는 지적은 `observations`로 부탁한다.** 그 부재는 결함이 아니라 명시된 경계다.

또한 이 프로젝트의 보장 범위 경계를 상기한다: **하나의 활성 worktree와 협조적 작업자**만 지원한다.
분산 정합성·비협조적 동시 실행·transactional backend가 있어야만 가능한 절대 보장을 근거로 차단하지 마라.

**차단(`findings`)은 P1 — 정상 사용 경로에서 재현되는 요구 위반·데이터 손상·보안 구멍·fail-closed 우회 — 만.**
각 P1에는 **해당 인수 기준·재현 경로·실패 결과**를 함께 적어 달라.
그 외 개선·부채·범위 인접 제안은 `observations`로 내려 주면 다음 티켓의 입력으로 삼는다.

**이미 승인·커밋된 Phase 1(dispatch/runCli, `95d94b8`, findings 0건 승인)은 재설계 대상이 아니다.**
