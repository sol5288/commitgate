# REQ-2026-109 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님). 큰 phase는 런타임 분할(예: B→B1/B2/B3)로 검수 면적을 줄인다.

> **테스트 실행 계층(REQ-2026-100)**: 게이트는 테스트를 **실행하지 않는다**. 아래는 비용을 줄이기 위한 실행 시점 권고다.
> - **phase 진행 중**: 변경한 소스를 import하는 테스트만(빠른 피드백). 예: `grep -rl "<변경한 모듈>" tests/`
> - **통합(main 병합) 직전 1회**: **전체 스위트**. 범위 한정은 이것을 **대체하지 않는다** — 영향 분석은 놓친 회귀를 통과시킨다.

## Phase 1 — 증거 포트 중복 제거 (`phase-1-ports-dedup`)

**선행 조건: 없음.**

범위(4파일):

- `scripts/req/lib/evidence-ports.ts` — `createEvidencePorts(root, responsesDirRel, ref = 'HEAD')`(DEC-1). `git show`·`cat-file blob`·`ls-tree`의 `HEAD`를 `ref`로. **포트 이름·인터페이스는 유지**
- `bin/delivery.ts` — `refEvidencePorts` **삭제**(DEC-2), `:410`이 정본을 직접 호출. 이제 안 쓰이는 `readAtRef`·`createHash` import 정리
- `tests/unit/evidence-ports-ref.test.ts`(신규) — DEC-3 재현:
  1. **비ASCII 디렉터리**(예: `워크플로/REQ-…/responses`)로 실제 git 저장소를 만들고, 🔴 그 저장소에 **`core.quotePath=true`를 명시적으로 설정**한 뒤 아카이브를 커밋
     - 설계 r01 P1: **공백은 git의 C-style 인용 대상이 아니다**(실측 확인) — 재현 입력이 될 수 없다
     - 설정을 명시하는 이유: 이 개발 머신은 전역 `core.quotepath=false`라 인용이 보이지 않았다. **기본값이 아닌 로컬 설정이 결함을 가린다**
  2. 옛 방식(`ls-tree -r --name-only` + `\n` 분리)을 **테스트 안에서 직접 실행** → 결과가 **인용된 형태**(큰따옴표로 시작)임을 단언(거짓 차단의 원인)
  3. 정본 `headArchivePaths` → **원래 경로**를 낸다
  4. `ref` 인자로 **비-HEAD 커밋**을 지목하면 그 시점 내용을 읽는다(DEC-1이 실제로 작동)
- `CHANGELOG.md` — Unreleased. 🔴 **utf8 축은 "버그 수정"으로 쓰지 않는다**(DEC-4 — 재현 불가)

🔴 **변이검사**: 정본에서 `-z`를 빼면 재현 테스트 3이 실패해야 한다. 편집으로 되돌린다(`git checkout --` 금지).

Exit: typecheck 0 · 신규 + `delivery-verbs`·`evidence-module`·`close-proof` 테스트 그린 · 변이검사 · Codex phase 리뷰 승인.

## 완료
- 게이트 해당분(typecheck·해당 시 lint) · **통합 직전 전체 스위트 1회** · 사용자 main 머지(별도 승인).
