# REQ-2026-050 리뷰 요청

## 배경

소비자 저장소(commitgate@0.9.8 설치분) 운영 실측에서 design 리뷰 미수렴으로 티켓 3건이 연속 폐기됐다(리뷰 20회·48.2분·산출물 0). 폐기 사유는 티켓의 `human_resolution`이 명시한다 — *"한 티켓이 네 개의 독립 계약을 동시에 지고 있어 설계 리뷰가 수렴하지 않는다."* 또 완주 티켓 5건 중 4건에서 설계 승인 후 phase 경계가 무너져 재분해됐다.

`02-plan.md`는 이미 design 프롬프트의 권위 아티팩트로 **전문 포함**된다. 따라서 원인은 "계획을 안 읽는 것"이 아니라 **phase 분해 품질을 심사할 기준이 persona에 없는 것**이다.

이 REQ는 개선 6건(A~E) 중 **A**다. 내구성 원장(B1/B2)·리뷰 호출 lifecycle(C)·구조화 예외 사유(D)·lockfile 프롬프트 축소(E)는 각각 별도 REQ이며 이 티켓의 범위가 아니다.

## 변경 요약

**phase-1** — `workflow/review-persona.md` 개정
- `REVIEW_KIND: design` 점검 목록에 phase 분해 3항목 추가(책임 계약·독립 커밋/리뷰 가능성·숨은 결합)
- 그 항목이 **P1 정의를 넓히지 않는다**는 문구 명시
- kit 관리 마커 `<!-- commitgate:persona v1 -->` 도입
- 존재 계약 테스트 신설

**phase-2** — `bin/sync.ts` persona 축 확장
- `AssetStatus`에 `managed-drift` 추가(마커 有·다름). 마커 無·다름은 기존 `preserved-differs` 유지
- **두 status 모두** 기본 미접촉 + 적용 전 **실제 내용 diff 표시** + `--persona-apply`로 교체 가능
- 마커는 **차단 조건이 아니라 경고 강도** — 마커 無면 "사용자 작성분일 수 있음" 경고를 덧붙인다
- diff는 `git diff --no-index --no-color`에 위임(새 의존성 0). exit 0/1 정상·2 이상만 throw
- **백업 실패 또는 diff 생산 실패면 교체 안 함**(이중 fail-closed)

> **r01 반영**: "diff 요약"으로는 정보에 기반한 선택이 안 된다 → D5 신설(생산 방식·표시 시점·출력 상한·실패 시 fail-closed).
> **r02 반영**: 마커 게이팅이 pre-050 설치분 전체의 갱신 경로를 봉쇄해 요구사항 4를 위반한다 → 마커를 경고 강도로 강등하고 두 status 모두에 opt-in 교체 경로를 열었다. oracle 12건.

## phase-2 구현 노트 (이번 staged diff)

- `AssetStatus`에 `managed-drift` 추가. `preserved-differs`는 **식별자를 유지**하고 의미만 "마커 無 · 다름"으로 좁혔다 — 기존 테스트(사용자 편집 persona → `preserved-differs`)가 그대로 통과한다.
- diff 생산은 `safeSpawnSyncStatus`(신규, `adapters.ts`)로 `git diff --no-index --no-color`를 부른다. `safeSpawnSync`는 non-zero를 전부 throw해서 exit 1(=다름)을 오류로 오판하므로 쓸 수 없다. **shell 없는 cross-spawn 단일 경로는 그대로 재사용**하고 exit code 해석만 호출자로 옮겼다.
- `runSync(opts, deps)`에 주입 경계(`diff`·`backup`·`log`)를 뒀다. 테스트는 stub으로 실패 분기와 **호출 순서**를 검증하고, 실 git 경로는 임시 저장소 스모크로 따로 확인했다(dry-run diff 출력 · 미교체 · 교체+백업 · 재실행 멱등 4단계 전부 실동작 확인).
- 백업은 `statWritableDest`를 타서 confinement를 재구현하지 않는다.
- 검증: typecheck 0 · 전체 1401 green(+27) · `docs:lint` 통과.

## 리뷰 포인트

1. **D2의 안전장치가 충분한가.** 분해 관점 추가가 차단 기준 확대로 읽히면 리뷰가 미수렴하고, 그것은 이 REQ가 고치려는 문제의 재생산이다. persona 문구가 "탐색 하한이지 P1 확대가 아님"을 실제로 강제하는가, 아니면 더 강한 표현이 필요한가.

2. **마커 없는 persona의 교체 허용이 과한가.** r02 반영으로 마커 無에도 `--persona-apply` 경로를 열었다. 안전장치는 4중이다 — 기본 미접촉 · 적용 전 실제 diff · 이중 플래그 · 교체 전 백업. "pre-050 사본인지 사용자 작성분인지"의 판정을 도구가 아니라 사용자에게 맡기는 이 구조가 옳은가, 아니면 추가 확인이 필요한가.

3. **diff의 git 위임.** `git diff --no-index`는 exit 1이 "다름"이라 기존 `createGitAdapter().exec`(non-zero throw)를 쓸 수 없어 별도 러너를 둔다. 이 위임이 손수 구현보다 안전한 선택인가. 출력 상한 200행 + 절단 시 shipped 절대경로 안내가 "정보에 기반한 선택"을 충족하는가.

4. **백업 1세대 정책.** `--persona-apply`가 기존 `.bak`을 덮어쓴다. 직전 상태만 보장하는 것이 이 도구의 안전 계약에 맞는가.

5. **phase 경계.** phase-1(자산 본문)과 phase-2(코드 경로)가 실제로 독립 커밋·독립 리뷰 가능한지, phase-1의 인수 기준이 phase-2를 요구하는 숨은 결합이 없는지. 이 계획 자체가 도입하려는 기준의 첫 적용 대상이다.

6. **dogfooding 순서.** phase-1이 이 저장소 자신의 persona를 바꾸므로 phase-2 리뷰는 새 기준으로 심사된다. 이 자기적용이 안전한가, 아니면 순서를 뒤집어야 하는가.

7. **비목표 준수.** 문서 줄 수·prompt 크기·계약 수를 하드 차단 기준으로 만들지 않기로 했다(실측상 초기 프롬프트 크기는 폐기 3건 중 2건만 분리). 설계가 이 비목표를 어기지 않았는가.
