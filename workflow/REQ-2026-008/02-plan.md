# REQ-2026-008 계획 — phase 분해

design-first. **단일 phase**(추적) — 네 문서의 문구가 서로 어긋나면 안 되므로 한 덩어리로 정비한다. 코드 변경 0파일.

## Phase 1 — governance docs (`phase-1-governance-docs`)

범위(문서 4파일):

1. [AGENTS.template.md](../../AGENTS.template.md)
   - `## 사람에게 보고해야 할 때`의 `main merge / push 직전` 한 줄을 **세 통제점으로 분리**(D1): 통합(PR 경유 기본) / bypass(명시 승인) / 릴리즈(tag·publish·release, CI green 이후 별도).
   - `## 승인 범위 해석 규칙`(또는 §3 하위 항목) 추가(D2): 승인은 승인받은 문장 그대로만 유효. "merge/push 승인" ≠ "required checks bypass 승인". 권한 보유는 승인이 아니다.
   - push **전** 보호 규칙 확인·정지 의무(D3).
   - ⚠️ 템플릿이므로 **일반 용어만**(D5): `protected branch`, `required status checks`, `PR`. 이 repo의 구체 수치·run id·remote 이름 금지.

2. [docs/RELEASING.md](../../docs/RELEASING.md)
   - `## 재배포 레시피`를 **PR 경유**로 재작성(D4). `git push origin main`을 기본 레시피에서 제거.
   - tag / `npm publish` / GitHub release를 레시피에서 떼어내 **별도 섹션 + 별도 승인 필요** 명시.
   - direct push는 `⚠️ 예외 — branch protection bypass 명시 승인 필요` 블록으로 강등하고, `remote: Bypassed rule violations`가 우회 신호임을 적는다.
   - 기존 배포 게이트(전 플랫폼 CI green) 문구는 보존.

3. [README.md](../../README.md)
   - `멈춰서 확인받을 때` 목록에서 `main 병합 또는 push 직전` → 통합/bypass/릴리즈 3항목으로 교체.
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
- **음성 확인**: `docs/RELEASING.md`의 재배포 레시피 코드블록에 `git push origin main`이 **기본 단계로 남아 있지 않을 것**(예외 블록 안의 경고 맥락은 허용).
- **템플릿 일반화 확인**(D5): `AGENTS.template.md`에 `sol5288`, `commitgate.git`, 특정 run id, `9 required checks` 같은 repo 고유 정보가 없을 것.
- **범위 확인**: staged diff가 위 4개 문서만. `package.json`·`package-lock.json`·`bin/`·`scripts/`·`tests/`·`.github/` 무변경.
- `npm run typecheck` 0 · `npm test` 그린 · `npm run smoke` 그린 · `req:doctor -- 2026-008` PASS · Codex phase 리뷰 승인(STEP_COMPLETE).

## 완료
- 게이트 해당분(typecheck·unit·smoke) 그린.
- **main 반영은 이번엔 PR 경유**로, 사용자 승인 후 진행(별도 통제점).
- `v0.3.0` tag / tag push / `npm publish` / GitHub release는 **이 티켓 범위 밖**(별도 릴리즈 승인).
