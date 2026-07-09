# REQ-2026-008 계획 — phase 분해

design-first. **단일 phase**(추적) — 네 문서의 문구가 서로 어긋나면 안 되므로 한 덩어리로 정비한다. 코드 변경 0파일.

## Phase 1 — governance docs (`phase-1-governance-docs`)

범위(문서 4파일):

1. [AGENTS.template.md](../../AGENTS.template.md)
   - `## 사람에게 보고해야 할 때`의 `main merge / push 직전` 한 줄을 **D1의 6개 통제점(I1·I2·B1·R1·R2·R3)으로 분리**하고, 각 항목에 **정확한 승인 문장**을 병기한다.
   - 특히 **I1(PR 생성)과 I2(PR 머지)를 분리**한다 — I1 승인은 I2를 포함하지 않는다(design R1 P2).
   - `## 승인 범위 해석 규칙` 추가(D2): 승인은 승인받은 문장 그대로만 유효. 한 통제점의 승인은 다음 통제점으로 **이월되지 않는다**. `merge/push 승인` ≠ `required checks bypass 승인`. 권한 보유는 승인이 아니다.
   - push **전** 보호 규칙 확인·정지 의무(D3). `remote: Bypassed rule violations`는 사후 신호라 계약 근거가 될 수 없음을 적는다.
   - ⚠️ 템플릿이므로 **일반 용어만**(D5): `protected branch`, `required status checks`, `PR`. 이 repo의 구체 수치·run id·remote 이름·계정명 금지.

2. [docs/RELEASING.md](../../docs/RELEASING.md)
   - `## 재배포 레시피`를 **PR 경유**로 재작성하고, 각 단계에 `[I1]`/`[I2]` 표식과 승인 문장을 박아 넣는다(D4).
   - `git push origin main`을 기본 레시피에서 **제거**.
   - tag / `npm publish` / GitHub release를 레시피에서 떼어내 **별도 섹션**으로 옮기고 각각 `[R1]`/`[R2]`/`[R3]` 승인 문장을 명시. R1이 R2를 포함하지 않음을 적는다.
   - direct push는 `⚠️ 예외 — branch protection bypass를 사용한 direct push 승인 필요` 블록으로 강등하고, `remote: Bypassed rule violations`가 **이미 일어난 우회**의 사후 신호임을 적는다.
   - 기존 배포 게이트(전 플랫폼 CI green) 문구는 보존. 그 green이 I2의 전제이기도 함을 명시.

3. [README.md](../../README.md)
   - `멈춰서 확인받을 때` 목록에서 `main 병합 또는 push 직전` → I1/I2/B1/릴리즈(R1·R2·R3) 항목으로 교체.
   - 그 아래 예시 첫 응답의 `통제점:` 줄도 함께 갱신(D6 — 낡은 예시를 복붙하지 않도록).

4. [README.en.md](../../README.en.md)
   - `Stop for human confirmation only` + `Control points:` 를 README.md와 **대칭**으로 갱신(항목 수·순서 일치).

### 검증(Exit)

- **keyword scan**(수동 grep, 증거 기록):
  | 문서 | 있어야 하는 문구 |
  |---|---|
  | `AGENTS.template.md` | `PR` · `direct push` · `branch protection bypass` · `required status checks` · `tag` · `publish` |
  | `README.md` | `PR` · `direct push` · `branch protection bypass` · `required checks` |
  | `README.en.md` | `PR` · `direct push` · `branch protection bypass` · `required status checks` |
  | `docs/RELEASING.md` | `PR` · `direct push` · `branch protection bypass` · `required checks` · `tag` · `publish` |
- **I1/I2 분리 확인**(design R1 P2): `AGENTS.template.md`와 `docs/RELEASING.md`에 **PR 생성 승인**과 **PR merge 승인**이 서로 다른 항목·다른 승인 문장으로 존재할 것. 머지 승인은 `required checks green 확인 후`라는 시점 조건을 달고 있을 것.
- **음성 확인**: `docs/RELEASING.md`의 재배포 레시피 코드블록에 `git push origin main`이 **기본 단계로 남아 있지 않을 것**(예외 블록 안의 경고 맥락은 허용).
- **템플릿 일반화 확인**(D5): `AGENTS.template.md`에 `sol5288`, `commitgate.git`, 특정 run id, `9 required checks` 같은 repo 고유 정보가 없을 것.
- **범위 확인**: staged diff가 위 4개 문서만. `package.json`·`package-lock.json`·`bin/`·`scripts/`·`tests/`·`.github/` 무변경.
- `npm run typecheck` 0 · `npm test` 그린 · `npm run smoke` 그린 · `req:doctor -- 2026-008` PASS · Codex phase 리뷰 승인(STEP_COMPLETE).

## Phase 2 — 정책 개정: PR 선택화 (`phase-2-policy-revision`)

**요구사항 변경**(사용자 결정, 2026-07-09). phase-1은 "PR 경유가 기본 필수"로 문서를 썼으나, 이 프로젝트는 1인 개발이므로 그 강제를 없앤다. phase-1 커밋(`3a1199f`)은 그대로 두고, 그 위에서 문구를 개정한다.

범위(문서 4파일 — phase-1과 동일 집합):
1. [AGENTS.template.md](../../AGENTS.template.md) — `B1`을 "예외"가 아니라 **선택 가능한 통합 경로**로 재서술. "기본 통합 경로는 PR 경유다"를 제거. 경로 A/B 병기. 우회 사전 보고 의무(해석 규칙 4)와 **CI 사후성**(해석 규칙 5)을 명시.
2. [docs/RELEASING.md](../../docs/RELEASING.md) — 경로 A와 경로 B를 **나란히** 제시. `git push origin main`을 예외 블록에서 꺼내 경로 B의 정식 명령으로 복귀시키되, `B1` 승인·우회 사실·CI 사후성·`remote: Bypassed rule violations`의 사후 신호성을 함께 적는다. 경로 B에서는 **CI green 확인 전 `R1`로 넘어가지 않는다**를 명시.
3. [README.md](../../README.md) — 통제점 목록·예시 응답·설명 문단에서 "기본 통합 경로는 PR 경유"를 제거하고 경로 선택으로 재서술.
4. [README.en.md](../../README.en.md) — README.md와 대칭.

### 검증(Exit)
- phase-1의 keyword scan·템플릿 일반화·`I1`/`I2` 분리 검증을 **전부 재실행**(회귀 방지).
- **음성 확인(개정)**: 네 문서에 `기본 통합 경로는 PR` / `PR 경유가 기본` / `default integration path is **through a PR**` 같은 **PR 의무화 문구가 남아 있지 않을 것.**
- **양성 확인(개정)**: 네 문서에 `CI는 사후` 또는 `CI runs after` 상당의 **CI 사후성** 문구가 있을 것. `docs/RELEASING.md`에 `git push origin main`이 경로 B 레시피로 존재할 것.
- 범위 확인: staged diff가 governance docs 4개(+REQ 문서)뿐. 코드·CI 설정·`package.json`/`package-lock.json`(0.3.0 동결)·태그 무변경.
- `npm run typecheck` 0 · `npm test` 그린 · `npm run smoke` 그린 · `req:doctor -- 2026-008` PASS · Codex phase 리뷰 승인.

## 완료
- 게이트 해당분(typecheck·unit·smoke) 그린.
- **main 반영은 `B1`(`branch protection bypass를 사용한 direct push 승인`) 하에 direct push**로 진행. push 후 CI green을 확인하고, green 전에는 `R1`로 넘어가지 않는다.
- `v0.3.0` tag / tag push / `npm publish` / GitHub release는 **이 티켓 범위 밖**(각각 `R1`·`R2`·`R3` 별도 승인).
