# REQ-2026-008 설계 — 통합/릴리즈 통제점 계약화

> 정본 결정은 00-requirement의 "핵심 정책 5개". 본 문서는 그 결정을 현재 문서 구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

| 파일 | 현재 문구 | 문제 |
|---|---|---|
| [AGENTS.template.md](../../AGENTS.template.md) `## 사람에게 보고해야 할 때` | `- main merge / push 직전` | 승인 대상이 "머지"인지 "보호규칙 우회"인지 구분 없음. 릴리즈 단계 언급 없음. |
| [docs/RELEASING.md](../../docs/RELEASING.md) `## 재배포 레시피` | `git push origin main` 이 레시피 4번째 줄 | direct push를 **정상 경로로 교육**. PR·required checks 미등장. tag/publish가 같은 블록에 붙어 있어 한 덩어리로 읽힘. |
| [README.md](../../README.md) `멈춰서 확인받을 때` 목록 + 예시 응답 `통제점:` | `- main 병합 또는 push 직전` | 위와 동일. |
| [README.en.md](../../README.en.md) `Stop for human confirmation only` + `Control points:` | `- Before merging to main or pushing` | 위와 동일. |

## 핵심 설계 결정

### D1. 통제점을 쪼갠다 — 각 통제점에 **정확한 승인 문장과 시점**을 준다 (design R1 P2)

한 줄짜리 "push 직전"을 합쳐 두면 REQ-2026-007식 확대 해석이 다시 발생한다. **분리 자체가 이 티켓의 산출물**이다. 그리고 D2("승인은 승인받은 문장 그대로만 유효")를 적용하면 **PR 생성 승인은 PR 머지 승인을 포함하지 않는다** — 따라서 통합은 반드시 **두 단계**여야 한다. 한 단계로 두면 "승인 없는 머지" 구멍이 남는다.

| # | 통제점 | 트리거(시점) | **승인 문장**(이 문장 그대로여야 승인) |
|---|---|---|---|
| **I1** | 통합 — PR 열기 | feature branch를 origin에 push하고 PR을 생성하기 직전 | `feature branch push + PR 생성 승인` |
| **I2** | 통합 — PR 머지 | **required checks가 전부 green으로 끝난 것을 확인한 뒤**, PR을 protected branch에 머지하기 직전 | `required checks green 확인 후 PR merge 승인` |
| **B1** | bypass(예외) | required checks를 우회해 protected branch에 direct push해야 할 때 | `branch protection bypass를 사용한 direct push 승인` |
| **R1** | 릴리즈 — tag | 버전 tag 생성 및 tag push 직전 | `tag 생성·push 승인` |
| **R2** | 릴리즈 — publish | `npm publish` 직전 | `npm publish 승인` |
| **R3** | 릴리즈 — release | GitHub release 생성 직전 | `GitHub release 생성 승인` |

규칙:
- **I2는 I1과 별개다.** I1 승인만으로 머지하지 않는다. I2는 checks 결과를 본 뒤에만 요청할 수 있다(green 전에 미리 받아두는 "선승인" 금지 — 승인자가 볼 근거가 아직 없다).
- **B1은 I1+I2를 대체하는 예외 경로다.** B1 승인이 있으면 PR 없이 direct push할 수 있고, 없으면 못 한다. `main merge 승인`·`push 승인` 같은 문장은 **B1이 아니다**.
- **R1·R2·R3는 서로도 독립이다.** `tag 생성·push 승인`이 `npm publish 승인`을 포함하지 않는다. 셋 다 I2(머지) 이후, CI green 이후에만 요청한다.
- I2 승인 후 머지 실행 주체는 사용자 또는 에이전트 어느 쪽이어도 된다(승인이 게이트이지 실행자가 게이트가 아니다).

### D2. "승인 범위 해석 규칙"을 명문화한다
AGENTS.template.md에 규칙을 추가한다: **승인은 승인받은 문장 그대로만 유효하다.** "main merge/push 승인"은 required checks bypass 승인이 아니고, PR 생성 승인(I1)은 PR 머지 승인(I2)이 아니며, 통합 승인은 릴리즈 승인이 아니다. 한 통제점의 승인은 **다음 통제점으로 이월되지 않는다.** 모호하면 확대 해석하지 말고 다시 물어본다.

이는 기존 §3(승인 바인딩 fail-closed 우회 금지)의 정신 — *권한이 있다는 사실이 승인이 아니다* — 를 인간 승인 축으로 확장한 것이다. 새 개념이 아니라 같은 원리의 적용 범위 확대로 서술한다.

### D3. bypass는 **사전 보고 의무**로 쓴다(사후 발견 금지)
`remote: Bypassed rule violations`는 push가 **이미 끝난 뒤** 나온다. 따라서 계약은 "push 후 보고"가 아니라 **"push 전에 보호 규칙 적용 여부를 확인하고 정지"**여야 한다. 문구에 확인 수단을 함께 적는다(예: `gh api repos/:owner/:repo/rulesets`, 또는 최소한 "protected branch로 알고 있으면 정지").

### D4. RELEASING.md 레시피를 PR 경유로 재작성하고, direct push는 **예외 블록으로 강등**
주 레시피의 각 단계에 **D1의 통제점 표식을 그대로 박아 넣는다**(문서 사이에 승인 문장이 어긋나지 않도록):

```
릴리즈 브랜치 생성 → npm version <bump> --no-git-tag-version → 커밋
  ── [I1] feature branch push + PR 생성 승인 ──
feature branch push → PR 생성
required checks(전 플랫폼 CI) 실행 → green 확인
  ── [I2] required checks green 확인 후 PR merge 승인 ──
PR merge
  ── [R1] tag 생성·push 승인 ──   git tag v<version> && git push origin v<version>
  ── [R2] npm publish 승인 ──     npm publish   (2FA — 사람 최종 실행)
  ── [R3] GitHub release 생성 승인 ──
```

- tag / publish / release는 **레시피 흐름에서 분리된 별도 섹션**으로 옮기고, 각각 자기 승인 문장을 명시. R1이 R2를 포함하지 않음을 적는다.
- `git push origin main`은 기본 레시피에서 **삭제**하고, "⚠️ 예외 — `branch protection bypass를 사용한 direct push 승인` 필요" 블록에만 남긴다. `remote: Bypassed rule violations`가 우회가 이미 일어났다는 **사후 신호**임을 적는다(D3와 연결).
- 기존 "배포 게이트: `npm publish` 전 전 플랫폼 CI green" 문구는 보존한다. 이제 그 green이 I2의 전제이기도 하다.

### D5. AGENTS.template.md는 **대상 repo로 복사되는 템플릿**이다 → 문구를 일반화한다
`init`이 대상 repo에 `AGENTS.md`가 없을 때 이 파일을 복사한다. 따라서 CommitGate repo의 GitHub 설정에 의존하는 표현(예: "9개의 required checks", 특정 run id, `sol5288/commitgate`)을 넣으면 **모든 대상 repo에 거짓 사실이 배포된다**.
→ `protected branch`, `required status checks`, `PR` 같은 **일반 용어**만 쓴다. 구체 수치·사건 로그는 이 티켓 문서(`00-requirement.md`)에만 남긴다. README/RELEASING은 이 repo 소유 문서이므로 이 repo의 설정을 언급해도 된다.

### D6. README 2종은 **같은 자리**를 대칭으로 고친다
`멈춰서 확인받을 때` / `Stop for human confirmation only` 목록과, 그 아래 예시 첫 응답의 `통제점:` / `Control points:` 줄. 예시가 낡은 문구를 남기면 사용자가 그것을 복붙한다. 한/영 항목 수와 순서를 일치시킨다.

### D7. 비목표(범위 고정)
코드·테스트·버전·CI 설정 무변경. keyword scan 자동화 테스트는 만들지 않는다(코드 변경이므로 승인 범위 밖 — 필요하면 후속 REQ). 검증은 수동 grep으로 증거를 남긴다.

## Phase별 구현

단일 phase — 네 문서를 한 덩어리로 정비해야 문구가 서로 어긋나지 않는다(4파일 ≤ D18 임계 8).

- **phase-1-governance-docs**: `AGENTS.template.md` · `README.md` · `README.en.md` · `docs/RELEASING.md`.

## 변경 파일

[AGENTS.template.md](../../AGENTS.template.md) · [README.md](../../README.md) · [README.en.md](../../README.en.md) · [docs/RELEASING.md](../../docs/RELEASING.md)

## 하위호환·안전

- **기존 설치본 무영향**: `init`은 대상 repo에 `AGENTS.md`가 이미 있으면 덮어쓰지 않는다(`--force`로도). 템플릿 변경은 **신규 설치**에만 적용된다.
- **이 repo의 Codex 리뷰 컨텍스트 무영향**: 이 repo 루트에는 `AGENTS.md`가 없고 `AGENTS.template.md`만 있다. 템플릿 문구 변경이 진행 중 리뷰의 컨텍스트를 바꾸지 않는다.
- **코드 경로 무변경**: `package.json` `files`에 `AGENTS.template.md`가 이미 포함돼 있어 배포 목록도 그대로다. `typecheck`/`test`/`smoke`는 문서 변경에 영향받지 않지만, 회귀가 없음을 보이기 위해 전부 재실행한다.
- **버전 동결**: `package.json`·`package-lock.json`은 0.3.0에서 건드리지 않는다. 이 티켓은 릴리즈가 아니라 릴리즈 *절차*를 고친다.
