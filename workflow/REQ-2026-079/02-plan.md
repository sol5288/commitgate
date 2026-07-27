# REQ-2026-079 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

## Phase 1 — `pool: 'threads'` (`phase-1-upgrade`)

범위(DEC-1·DEC-4·DEC-5): `vitest.config.ts` 하나. 🔴 **vitest 버전은 2.1.9 그대로 둔다.**

순서:
1. `vitest.config.ts`에 `pool: 'threads'`를 둔다. 🔴 **변수는 이것 하나다**(DEC-1) —
   업그레이드를 함께 하면 교착이 고쳐져도 어느 쪽이 고쳤는지 알 수 없다.
   주석에 근거를 남긴다: forks에서 워커 **프로세스**가 회전해 교착했다는 REQ-2026-077 관측,
   그리고 threads의 **격리 약화 트레이드오프**(DEC-1b).
2. `testTimeout`·`hookTimeout`을 **30초**로 올린다(DEC-4).
   🔴 이유를 주석에 적는다 — 한 테스트가 **단독 4740ms**로 기본 상한의 95%였다.
   기대값이 아니라 **인프라 값**이고, 단언을 완화하는 것이 아니다.
3. `npx tsc --noEmit` · `npm test` · `npm run docs:lint`.
   🔴 **테스트 기대값을 바꿔 통과시키지 않는다**(DEC-4).
4. 🔴 **소요를 기록한다**(DEC-5). 기준 290초. 1.5배 초과면 적고 판단을 요청한다.
5. `engines`·CI 매트릭스·`package.json` 의존성은 **건드리지 않는다**(수용기준 2).

Exit: typecheck 0 · `npm test` green(**unhandled error 0건** 포함) + 소요 기록 · `docs:lint` green ·
🔴 **CI 9잡 green**(3 OS × node 18·20·22에서 threads 풀이 도는지) · Codex 승인.

## Phase 2 — 프로브 31회 검증 (`phase-2-verify`)

범위(DEC-2·DEC-3): `workflow/REQ-2026-079/03-verification.md` · `CHANGELOG.md`.

순서:
1. phase-1이 main에 반영된 뒤(🔴 `workflow_dispatch`는 기본 브랜치를 요구한다 — REQ-2026-077에서 실측)
   프로브를 `tests/unit/init.test.ts` 대상으로 **네 번 dispatch**한다(10+10+10+1 = 31).

   🔴 **집계 대상 조건을 못박는다 — 이것을 어기면 검증이 성립하지 않는다**(설계 r01 P1):

   | 조건 | 값 | 확인 방법 |
   |---|---|---|
   | 워크플로 | `hang-probe.yml` **한 종류만** | run의 workflow 이름 |
   | OS | **`macos-latest`** | 잡 이름이 `probe N · macos · node 18` |
   | Node | **18** | 같은 잡 이름 |
   | 대상 | `tests/unit/init.test.ts` | dispatch 입력 · artifact `params.txt` |

   🔴 **`ci.yml`의 성공 잡을 섞지 않는다.** 그쪽은 OS·Node가 9조합이라 macOS node 18 표본이
   31건이 되지 않는다 — 섞으면 문제 조건의 교착이 남아 있는데도 "0/31"이 될 수 있다.
   (프로브 워크플로 자체가 `runs-on: macos-latest` · `node-version: 18` 고정이지만,
   **그 사실을 계약으로 적어 둔다** — 파일이 바뀌면 이 검증의 전제가 깨지기 때문이다.)

2. 위 조건을 만족하는 잡만 세어 **합산**한다. 같은 커밋·같은 조건이므로 합산이 타당하다.
   🔴 **dispatch마다 조건 충족 잡 수를 따로 기록**하고, 합이 31 이상인지 확인한다 —
   합계만 적으면 어느 실행이 조건 밖이었는지 나중에 확인할 수 없다.
3. 🔴 **DEC-4b 계약 재검증**: 교착이 관측되면 그 artifact의 `vitest.log`가 이번에도
   **배너 한 줄뿐인지** 확인한다. 배너뿐이면 "테스트 상한은 판정과 무관"이 유지된 것이고,
   테스트 출력이 있으면 **계약이 깨진 것이므로 판정을 보류**하고 그 사실을 적는다.
4. `03-verification.md`에 적는다:
   - **dispatch별** run id · 그 실행의 **조건 충족 잡 수** · 교착 수
   - 총합(조건 충족 잡만) · 교착 총합 · 🔴 **`macos-latest` × `node 18` 고정임을 확인한 근거**
   - 🔴 **판정과 그 근거 확률**(31회 0건이면 우연일 확률 0.099%)
   - ⚠️ 기저율 20%가 10회 관측 2건에서 나온 값이라 **넓은 구간**을 갖는다는 한계
5. 🔴 교착이 **나오면**: "`pool` 변경이 고치지 못했다"를 그대로 적고, 남은 선택지
   (vitest 3 + threads · Node 18 제외 = **지원 범위 축소 = 사용자 결정**)를 정리한다.
   안 고쳐진 것을 고쳐졌다고 하지 않는다.
6. CHANGELOG — 결과를 수치로 적는다. "빨라졌다/고쳤다"가 아니라 **몇 회 중 몇 회**로.

Exit: `03-verification.md`에 **dispatch별 조건 충족 잡 수·교착 수·run id·판정 근거**가 있고,
🔴 집계가 **`macos-latest` × `node 18` 31건 이상**임이 확인된다 ·
`docs:lint` green · Codex 승인.

## 완료
- 게이트 해당분 · 사용자 main 통합(통제점 승인 필요).
- 🔴 교착이 남으면 후속은 **사용자 결정**(Node 18 지원 중단 여부)이며, 도구가 임의로 진행하지 않는다.
