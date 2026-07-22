# REQ-2026-047 리뷰 요청 — review-call 로그 배포 gitignore 누락 수정 (P0)

## 배경

REQ-2026-025가 도입한 측정 로그 `workflow/.review-calls.jsonl`의 ignore 패턴이 **개발 저장소 root `.gitignore:16`에만** 들어가고 **배포 템플릿 `templates/workflow.gitignore`에는 누락**됐다(`git log -S` 실측: 템플릿엔 한 번도 없음). npm이 `.gitignore` 이름을 tarball에서 제외하므로 root ignore는 소비자에 전달되지 않는다.

결과: `commitgate init` 소비자가 리뷰를 1회라도 돌리면 로그가 `??`로 남아 **D10 FAIL → `req:commit`이 doctor를 하드 게이트로 spawn하므로 모든 커밋 차단**. 개발 저장소는 root ignore가 파일을 숨겨 **도그푸딩이 구조적으로 못 본다**. 소비자 hermes(0.9.6)가 수동 보강으로 우회 중. 본 REQ는 **코덱스 판정(확정·P0·즉시 수정+패치 릴리스)과 그 지시**를 설계로 옮긴 것이다.

## 변경 요약

3 phase. 코드 변경은 phase당 ≤8파일.

1. **phase-1** — `templates/workflow.gitignore`에 **앵커형 `/.review-calls.jsonl`** 1행(DEC-1) + `scripts/smoke.mjs` 4b 확장: packed tarball → 실제 `init` → 로그 생성 → `git check-ignore` 단언(DEC-2). 이 phase만으로 신규 init 소비자의 P0 해소.
2. **phase-2** — `commitgate sync --gitignore [--apply]` opt-in 백필(DEC-4). 기본 sync 동작 무변경, 누락 kit 규칙 행만 additive append, 정규화 비교로 멱등, 사용자 행 보존.
3. **phase-3** — doctor **D22 WARN**(DEC-5, FAIL 금지·dev repo skip) + 런타임 생성 파일 인벤토리 표(DEC-6) + CHANGELOG + 0.9.6→0.9.7.

명시적 비변경: **`reviewScratchPaths`/D10 의미론**(DEC-3 — 넣으면 배포 ignore 누락을 D10이 숨긴다), **기본 sync 동작**, **doctor를 FAIL로 만드는 어떤 변경**.

## 리뷰 포인트

1. **DEC-1 패턴 형태** — 중첩 `workflow/.gitignore`에서 `/.review-calls.jsonl`이 정확하고, root 형태 `workflow/.review-calls.jsonl` 복사는 무효라는 판단이 맞는가(`git check-ignore` 실측 근거). 앵커형과 비앵커형(`.review-calls.jsonl`) 중 선택 근거가 충분한가.
2. **DEC-2 회귀 가드의 오라클** — 템플릿 문자열 단언을 배제하고 tarball smoke의 실제 `git check-ignore`로만 고정하는 것이 옳은가. 이 오라클이 "다음에 새 repo-root 런타임 스크래치가 추가될 때"도 결함을 잡는가, 아니면 경로별 수동 추가가 계속 필요한가(후자면 그 한계를 어디에 고정해야 하는가).
3. **DEC-3의 사각** — `reviewScratchPaths`를 건드리지 않기로 한 대가로, gitignore가 없는 소비자는 여전히 D10 FAIL로 커밋이 막힌다. phase-2 백필 + phase-3 WARN이 그 창을 충분히 좁히는가.
4. **DEC-4 백필 안전성** — additive append가 사용자 소유 파일에 대한 개입으로서 적절한 강도인가. 멱등 판정을 트림 정규화로만 하는 것이 충분한가(주석 안에 같은 문자열이 있는 경우·CRLF·후행 공백 등 오탐/미탐 경계).
5. **DEC-5 D22의 판정 조건** — "ignore도 tracked도 아님"을 무엇으로 판정할지(`check-ignore` vs status). dev repo skip 조건(`packageRootDiffers===false`)이 D20/D21과 동형인가. **WARN 상한이 테스트로 고정되는가**.
6. **phase 경계** — phase-1만 릴리스해도 안전한가(기존 소비자는 미구제 상태로 남음). 3 phase 분해가 리뷰 면적 대비 적절한가.
7. **놓친 축** — backfill matrix(신규/업그레이드/사용자 수정/global ignore) 외에 검증해야 할 환경이 있는가. 이미 로그를 커밋해 tracked가 된 소비자 처리(`git rm --cached` 안내)를 문서로만 두는 것이 맞는가.
