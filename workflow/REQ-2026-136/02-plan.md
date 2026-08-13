# REQ-2026-136 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님). 큰 phase는 런타임 분할(예: B→B1/B2/B3)로 검수 면적을 줄인다.

> **테스트 실행 계층(REQ-2026-100)**: 게이트는 테스트를 **실행하지 않는다**. 아래는 비용을 줄이기 위한 실행 시점 권고다.
> - **phase 진행 중**: 변경한 소스를 import하는 테스트만(빠른 피드백). 예: `grep -rl "<변경한 모듈>" tests/`
> - **통합(main 병합) 직전 1회**: **전체 스위트**. 범위 한정은 이것을 **대체하지 않는다** — 영향 분석은 놓친 회귀를 통과시킨다.

## Phase 1 — 블록 집합 + 안전 판정 코어 (`phase-1-block-set`)

범위(DEC-1·DEC-4 판정부):
- `bin/quickstart.ts`: `ManagedBlock` · `MANAGED_BLOCKS` · `blockRe(id)`(마커를 id에서 생성).
- 🔴 **마커 스트림 스캐너**: 파일 안 모든 관리 마커를 등장 순서로 훑어 반쪽·중복·**중첩·교차**를
  `unsafe`로 판정한다. 블록별 개수만 세면 교차 중첩을 놓친다.
- `unsafe`는 **파일 단위로 전파**된다 — 그 파일의 계획은 쓰기 0건이 된다.
- 기존 Quick Start 경로가 이 집합의 원소 하나로 동작하도록 내부 재배선(동작 불변).

Exit:
```sh
npm run typecheck
npx vitest run tests/unit/quickstart.test.ts
```
· 스트림 판정 진리표 그린(정상 · 반쪽 · 중복 · **중첩** · **교차**) · 블록별 판정 4상태 ·
`unsafe` 파일 전파 · 기존 Quick Start 테스트 **무회귀** · Codex 승인.

## Phase 2 — 템플릿 마커 + verb 배선 + help/문서 + 보존 회귀 (`phase-2-apply`)

범위(DEC-2·DEC-3·DEC-4a·DEC-6):
- 🔴 **파일당 한 번만 쓴다**(DEC-4a): 블록을 **누적 적용**(앞 결과가 다음 입력)하고 쓰기는 파일별 1회.
  파일 계획은 `blocks: {id, action}[]`을 갖는다 — `action` 하나로 뭉치면 두 블록 상태를 못 담는다.
- 🔴 **help와 최소 사용자 문서를 이 phase에서 함께 갱신**한다(DEC-3): 동작만 넓히고 다음 phase로 미루면
  그 사이 사용자가 `--help`에서 "Quick Start 블록만"이라는 거짓 안내를 읽는다.
- `AGENTS.template.md`: 자율 진행 절을 `<!-- commitgate:autonomy -->` 쌍으로 감싼다(**본문 무수정**).
  🔴 REQ-2026-131 가드가 그 문구를 고정하므로 마커 추가로 깨지지 않는지 함께 확인한다.
- verb/plan이 `MANAGED_BLOCKS`를 순회한다(파일×블록). 부재 시 삽입 위치는 **파일 끝**(DEC-4b) ·
  이미 있으면 **그 자리에서** 치환.
- `unsafe`가 하나라도 있으면 그 파일은 **쓰기 0건** + 구체 안내.
- 🔴 회귀는 **사용자 지침이 있는 실제 `AGENTS.md`**로: ① 계약 삽입됨 ② **블록 밖 바이트 보존**
  ③ 재실행 멱등. 세 가지를 한 테스트 묶음에서 본다.
- 🔴 **교차 중첩 파일에 `--apply` 해도 쓰기 0건**임을 실제 파일로 고정한다(DEC-4의 핵심 경로).
- 🔴 **계약 마커 없는 `AGENTS.md`**: 쓰기 0건이면서 계획 출력이 **사유와 손으로 할 일**을 말한다
  (DEC-4c — 조용한 skip이면 사용자는 "아무 일도 없었다"만 본다). 안내가 가리키는 파일은
  **`AGENTS.commitgate.md`**(사용자 저장소에 실재하는 사본)이고, 사본 부재 시 복구 경로도 말한다.
- 🔴 **두 블록이 모두 없는 실제 `AGENTS.md`**에 적용하면 **둘 다 들어가고** 재실행이 noop이다
  (DEC-4a의 핵심 경로 — 원본 기준으로 각각 계획하면 한 블록을 잃는다).

Exit:
```sh
npx vitest run tests/unit/quickstart.test.ts tests/unit/agent-autonomy-contract.test.ts tests/unit/init.test.ts
```
· 위 회귀 전부 그린 · `--help` 출력이 확장된 범위를 말한다 · Codex 승인.

## Phase 3 — doctor + 문서 (`phase-3-doctor-docs`)

범위(DEC-5): D21 입력을 블록 집합 기준으로 넓히고 메시지에서 **네 사유**(부재 / 드리프트 / 식별 불가 /
**계약 아님**)를 구별한다(**WARN 상한 유지 · 새 D-체크 만들지 않음**).
🔴 `unmanaged`는 **입력 수집부터** 고쳐야 한다 — 현행 수집기가 그 파일을 빼므로 메시지만 늘리면
그 사유는 영원히 발화하지 않는다.
· `docs/*.md`의 `quickstart` 설명 **나머지**(phase-2가 help와 최소 문서를 이미 맞췄으므로 여기서는
`upgrade.md`·`workflow*.md` 등 남은 표면) · `CHANGELOG.md`(REQ-2026-131의 "직접 반영하세요"를 이 경로로 대체).

Exit: `npm run docs:lint` · doctor 테스트 그린(**네 사유 각각 발화**) · 문서 가드 그린 · Codex 승인.

## 완료
- 게이트 해당분(typecheck·해당 시 lint) · **통합 직전 전체 스위트 1회** · 사용자 main 머지(별도 승인).
