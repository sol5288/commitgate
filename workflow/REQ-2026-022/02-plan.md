# REQ-2026-022 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고.

> 🔴 **phase는 2개다**(PM 지시 — 다시 넓어지지 않게). REQ-020은 설계 1개가 6 phase를 덮어 설계 리뷰가 13회로
> 늘었다(앞 phase 승인 때마다 뒤 phase까지 전체 재검수 — CommitGate 알려진 결함). REQ-021은 phase를 작게 유지해
> **r01에 승인**됐다. 검수 면적 축소가 유일하게 통한 대책이다.

각 phase 공통 절차: 그 phase의 인수 기준만 구현 → 관련 unit test → typecheck → 전체 test →
staged 범위를 해당 phase 파일로 제한 → `req:next`가 지시하는 리뷰.
**P1만 수정한다. observation은 backlog로.**

---

## Phase 1 — 공존·migration 무추가 (`phase-1-coexist-migrate`)

범위: **`tests/unit/init.test.ts` · `tests/unit/migrate.test.ts`만.** `bin/**` 무변경(D1).

**테스트 oracle** (`tmpTarget()`·`OPTS()`·`snapshot()` 재사용):

**공존 A — 타사 선설치**
- `.claude/skills/tdd/SKILL.md`(타사)를 먼저 만든다 → init
- 타사 파일이 **byte-identical**로 유지된다(⚠️ 존재 여부가 아니라 **내용 비교** — 존재만 보면 덮여도 통과).
- `commitgate-tdd`가 **별도 생성**된다(`.claude/skills/commitgate-tdd/SKILL.md`).
- 타사 `grill-me` 등 다른 이름도 함께 둬서 **접두사 격리**를 확인한다.

**공존 B — CommitGate 선설치**
- init → 타사 `tdd/SKILL.md` 추가 → **재-init**
- 양쪽 다 보존(타사 byte-identical · companion 4종 그대로). **멱등**.

**migration 무추가 (R3)**
- Stage A 시드 대상에서 `migrate` **dry-run** → `.claude/skills/commitgate-*` **4종 전부 부재**.
- 같은 대상에서 `migrate --apply` → **여전히 4종 부재**. 설치는 명시적 `init`에서만이다.
- ⚠️ dry-run은 원래 무부작용이므로 **`--apply`가 진짜 검증점**이다. 둘 다 단언한다.
- 기존 migrate 회귀(exact-match만 전환·사용자 정의 script 보존·프로젝트 파일 미삭제)는 그대로 그린.

Exit: typecheck0 · 단위 그린 · Codex phase 리뷰 승인 · HIGH 확인 후 별도 커밋.

---

## Phase 2 — packed-tarball smoke (`phase-2-smoke-companion`)

범위: **`scripts/smoke.mjs`만.**

**🔴 R7 fingerprint 보정 (필수)**
- 현재: `out.set(rel, readFileSync(abs).length)` — **크기만**. 같은 크기 내용 변경을 놓친다.
- 변경: `out.set(rel, sha256(readFileSync(abs)))` — `node:crypto` `createHash`.
- `assertSameTree`는 값 비교라 **수정 불필요**.
- 🔴 **변이 검증**: 같은 크기로 내용만 바꾼 파일을 심으면 **크기 기반은 통과하고 내용 기반은 잡는다**.
  이 대조가 없으면 "SHA로 바꿨다"는 주장이 공허하다.
- 왜 필수인가: smoke가 **uninstall 읽기 전용**을 이 snapshot으로 검증한다 — 그 축의 유일한 end-to-end 방어선이다.

**companion 검증 (R4/R6)**
- packed tgz 설치 → `init` → `.claude/skills/commitgate-{discovery,tdd,diagnosing-bugs,research}/SKILL.md` **4종 생성**.
- 설치된 SKILL.md에 MIT permission notice 전문·baseline SHA가 **동행**하는지 확인(R9의 end-to-end 증명).
- `smokeMigrate`의 Stage A 대상에서 **companion 부재** 확인(R6).

**R5 — 기존 증명 유지**
- 무복사(`scripts/req/**` 부재) · 무주입(`tsx`·`ajv`·`cross-spawn`) · `req:*`가 `commitgate <verb>` · dispatch 도달 ·
  uninstall 읽기 전용 · migrate 비파괴 — **전부 그대로**. companion 검증은 **추가만**.
- npm 캐시 일회용 격리 규약 유지(`npm_config_cache`).
- `smokeMigrate`는 **별도 Stage A 대상**을 계속 쓴다(fresh 대상에 겹치면 D19 발동).

Exit: typecheck0 · 단위 그린 · **smoke 실행 그린** · Codex phase 리뷰 승인 · HIGH 확인 후 별도 커밋.

---

## 완료

- 게이트 해당분(unit·typecheck) + smoke.
- 🔴 **이 REQ 단독으로 main 병합하지 않는다**(PM 결정). **REQ-A2-3**(문서·Cursor CLI 표기)까지 승인·검증된 뒤
  **하나의 PR로 통합 검토·병합**한다.
- HIGH 티켓: 각 phase의 `req:commit --run` **직전** 통제점에서 사용자 확인.

## 후속 (이번 범위 밖)

- **REQ-A2-3**: README(ko/en)·CLI help·CHANGELOG. 🔴 **Cursor CLI 지원 표기를 검증한 버전·모드와 함께 확정** —
  같은 벤더 스레드에 "다음 CLI 릴리스에서 수정 예정"이 있어 **`❌`는 보편적 제품 사실이 아니라 버전·모드 의존 상태**다(PM 지시).
  검증 불가면 `⚠️ 버전/모드별 동작 차이 가능, 보장하지 않음`으로 표기한다.
- **REQ-C**: 출시본 v0.7.0의 dangling symlink 구멍(`add()`·`applyCopies`·`assertEntrypointPathsUsable`가 `existsSync` 기반).
- **REQ-D**: finalize 경로의 사람 확인을 CLI·상태 모델로 강제. 손으로 적는 `user_commit_confirmed`는 위조 가능(REQ-019 실증).
- **REQ-B**: `00/01/02` 템플릿 + persona 리뷰 관점 2종.
