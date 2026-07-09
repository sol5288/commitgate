# REQ-2026-008 리뷰 요청

## 리뷰 종류/범위
리뷰 종류는 프롬프트의 **REVIEW_KIND**를 따른다. design=설계문서 00/01/02(구현 diff 없음 정상), phase=staged diff(이번엔 문서 diff). 각 리뷰는 해당 종류의 권위 아티팩트만 심사.

## 배경
REQ-2026-007에서 "main merge + push" 승인을 받은 에이전트가 `git push origin main`을 실행했고, 그 push가 `main`의 branch protection(required status checks)을 bypass 권한으로 우회했다. 우회 사실은 push 응답의 `remote: Bypassed rule violations`로 **사후에야** 드러났다(사후 CI는 green).

현재 repo 계약이 이 오독을 막지 못한다:
- `AGENTS.template.md`의 통제점은 `main merge / push 직전` **한 줄**뿐 — 머지 승인과 보호규칙 우회 승인을 구분하지 않는다.
- `docs/RELEASING.md`의 재배포 레시피는 `git push origin main`을 **기본 경로**로 가르치며 PR·required checks가 등장하지 않는다.
- README 2종의 통제점 목록·예시 응답도 같은 한 줄이다.

## 변경 요약(문서 전용, 코드 무변경)
- 통제점을 **6개로 분리**하고 각각에 **정확한 승인 문장과 시점**을 준다(design R1 P2 반영):
  - `I1` = `feature branch push + PR 생성 승인`
  - `I2` = `required checks green 확인 후 PR merge 승인` — **I1과 별개**. I1 승인만으로 머지하지 않는다. green 전 선승인 금지.
  - `B1` = `branch protection bypass를 사용한 direct push 승인` — I1+I2를 대체하는 예외 경로.
  - `R1`/`R2`/`R3` = `tag 생성·push 승인` / `npm publish 승인` / `GitHub release 생성 승인` — 서로도 독립.
- **승인 범위 해석 규칙** 명문화: 승인은 승인받은 문장 그대로만 유효하다. 한 통제점의 승인은 **다음 통제점으로 이월되지 않는다**. "merge/push 승인" ≠ "required checks bypass 승인". bypass **권한 보유는 승인이 아니다**.
- bypass는 **사전 보고 의무**: `remote: Bypassed rule violations`는 push가 끝난 뒤 나오므로, 계약은 push **전** 확인·정지여야 한다.
- `docs/RELEASING.md` 재배포 레시피를 PR 경유로 재작성. `git push origin main`은 기본 레시피에서 제거하고 "⚠️ 예외 — bypass 명시 승인 필요" 블록으로 강등. tag/publish/release는 레시피에서 분리해 별도 승인 섹션으로.
- README.md / README.en.md의 통제점 목록과 **예시 첫 응답**을 대칭으로 갱신(낡은 예시를 사용자가 복붙하지 않도록).

## 리뷰 포인트
- **AGENTS.template.md는 대상 repo로 복사되는 템플릿**이다(init이 AGENTS.md 부재 시 생성). 이 repo 고유 정보(`sol5288`, remote URL, 특정 CI run id, required check 개수)가 새 문구에 섞여 들어가 모든 대상 repo에 거짓 사실로 배포되지 않는가? `protected branch`/`required status checks`/`PR` 같은 일반 용어만 쓰는가?
- 6개 통제점이 서로 **겹치거나 빠짐 없이** 정의됐는가. 특히 **I1(PR 생성)과 I2(PR 머지)가 분리**되어 "승인 없는 머지" 구멍이 닫혔는가. I2에 `required checks green 확인 후`라는 시점 조건이 붙었는가(선승인 금지). "머지 승인 ≠ bypass 승인"이 오해 없이 읽히는가. 한 통제점 승인이 다음으로 이월되지 않음이 명시됐는가.
- bypass 규칙이 **사후 보고가 아니라 사전 정지**로 서술됐는가. 실행 가능한 확인 방법이 제시됐는가.
- `docs/RELEASING.md`의 새 레시피가 실제로 실행 가능한가(브랜치 → `npm version --no-git-tag-version` → 커밋 → feature branch push → PR → checks green → merge). 기존 "배포 게이트: 전 플랫폼 CI green" 문구가 보존됐는가. tag/publish가 레시피 흐름에서 확실히 분리됐는가.
- README 한/영이 **대칭**인가(항목 수·순서·의미). 예시 응답의 `통제점:` / `Control points:` 줄도 갱신됐는가.
- **범위 준수**: staged diff가 문서 4개뿐인가. 코드·테스트·CI 설정·`package.json`/`package-lock.json` version(0.3.0 유지)이 변경되지 않았는가. tag/publish/release가 수행되지 않았는가.
- 결함 없으면 findings 없이 승인(비차단 의견은 observations).
