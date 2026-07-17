# REQ-2026-021 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고.

> 🔴 **phase를 2개로 유지한다**(의도적). REQ-020은 설계 1개가 6 phase를 덮어 **설계 리뷰가 13회**로 늘었다 —
> 앞 phase를 승인받을 때마다 뒤 phase까지 전체 재검수돼 무관한 지적이 계속 나왔다(CommitGate 알려진 결함,
> Stage B 중단 사유와 동일). 검수 면적을 줄이는 것이 유일하게 통한 대책이었다. 이 REQ도 작게 유지한다.

각 phase 공통 절차: 그 phase의 인수 기준만 구현 → 관련 unit test → typecheck → 전체 test →
staged 범위를 해당 phase 파일로 제한 → `git diff --cached --check`/`--stat` 확인 → `req:next`가 지시하는 리뷰.
**P1만 수정한다. observation은 backlog에 적고 같은 phase로 끌어들이지 않는다.**

---

## Phase 1 — companion gitignore 경고 (`phase-1-companion-ignore-warn`)

범위: `bin/init.ts` + `tests/unit/init.test.ts`. D1·D2·D3·D4. uninstall은 건드리지 않는다(phase-2).

**테스트 oracle** (`tmpTarget()`·`snapshot()`·`expectRejectedWithNoWrites` 재사용):

- **R1**: `.gitignore`에 `.claude/`를 둔 fixture → init → **WARN 출력**, 설치는 진행됨(4종 존재).
- **R2**: 같은 fixture + `--strict` → **설치 전 throw + 쓰기 0회**(대상 snapshot 무변화).
- **정상 경로 대조군**: `.claude/`를 ignore하지 않은 fixture → init → **companion 경고 없음**(위양성 방지).

🔴 **R3 경고 원인 격리 fixture — naive fixture는 공허하다.**
`.claude/`를 ignore하고 tdd만 미리 만들면, init이 **생성하는 나머지 3개 companion과 기존 entrypoint**가
경고를 유발해 **userDiffers를 누락한 구현도 통과**한다(REQ-020 design-r10에서 지적된 함정).

격리 절차:
1. `.gitignore`에 `.claude/` → init 1회(4종 + entrypoint 생성)
2. `.claude/` 아래 **tdd를 제외한 전부**를 `git add -f` + commit → tracked(= at-risk 아님)
3. tdd 내용 수정 → tdd만 **exists ∧ differs ∧ ignored ∧ untracked** = userDiffers ∧ at-risk
4. init → **WARN이 나고, 그 원인 경로가 tdd임을 단언**한다("WARN이 났다"만으로는 부족)
5. `--strict` → **설치 전 throw + 쓰기 0회**
- **음성 대조군**: 같은 상태에서 tdd까지 `git add -f`로 추적 → **WARN 없음**(userDiffers가 원인임을 분리 증명).
- 🔴 **변이 검증**: 판정에서 `userDiffers`를 빼면 이 fixture가 **반드시 실패**해야 한다.
  통과하면 oracle이 공허한 것이다 — 그 경우 fixture를 고친다.

- **R5 회귀**: 기존 계약 포인터(`.claude/skills/commitgate/SKILL.md`·`.claude/commands/req.md`·
  `.cursor/rules/commitgate.mdc`) WARN·`--strict`와 `workflow/.gitignore` 경고가 **그대로 그린**.
  companion 경고를 위해 기존 경고를 억제하지 않는다.
- `--no-agent-entrypoints` + `.claude/` ignore → companion 미설치이므로 **companion 경고 없음**.

Exit: typecheck0 · 단위 그린 · Codex phase 리뷰 승인 · HIGH 확인 후 별도 커밋.

---

## Phase 1b — `create` 격리 strict oracle 보정 (`phase-1b-create-isolation-oracle`)

범위: **`tests/unit/init.test.ts` 1파일.** 구현(`bin/init.ts`) **무변경** — 판정식은 이미 `create`를 포함한다.
증명 보완이다.

**결함**: phase-1의 `create: --strict` 테스트에 **격리가 없다**.
```ts
const before = snapshot(dir)
expect(() => runInit(OPTS(dir, { strict: true }))).toThrow()   // ← 메시지 미검사
```
`.claude/`를 ignore하면 **기존 계약 포인터**(`.claude/skills/commitgate/SKILL.md`·`.claude/commands/req.md`)가
먼저 strict 오류를 낸다 → **`companionAtRisk`에서 `create`를 빼도 이 테스트는 초록**이다.
thrown error에 companion 경로가 포함되는지도 확인하지 않는다.

⚠️ WARN 쪽(`create: 첫 init에서 …`)은 경로를 단언하므로 `create` 제외를 잡는다. **뚫린 건 strict 쪽뿐이다.**
그래도 R2(strict fail-closed)가 `create` 상태에서 증명되지 않은 것은 실제 gap이다 — ownedSkip·userDiffers는
격리했는데 `create`만 안 한 비대칭이기도 하다.

**테스트 oracle** (phase-1의 `isolateOnly`·`expectStrictThrowMentioning`·`captureWarn` 재사용):
1. `.claude/` ignore 상태에서 **초기 설치**(4종 생성).
2. **`commitgate-tdd/SKILL.md`만 제거** → 재실행 시 그 경로가 다시 **`create` 상태**가 된다
   (나머지 3종은 byte-identical = `ownedSkip`).
3. 나머지 3개 companion과 **기존 `.claude` 포인터를 강제 추적**(`git add -f`) → at-risk 원인에서 제거.
   `.claude/` 아래 계약 포인터는 `KIT_AGENT_ENTRYPOINTS`의 2종이다(`CONTRACT_POINTER_RELPATHS` 실측).
4. 일반 init → **WARN 원인이 tdd 하나임**을 확인(나머지 3종은 경고에 등장하지 않음).
5. **별도 동일 fixture**의 `--strict` → **오류 메시지에 tdd 경로 포함** + **대상 snapshot 무변화**.
6. 🔴 **변이 검증**: 판정식에서 `create`를 빼면 이 fixture가 **반드시 실패**한다.

Exit: typecheck0 · 단위 그린 · Codex phase 리뷰 승인 · HIGH 확인 후 별도 커밋. **phase-2는 그 뒤에만.**

---

## Phase 2 — uninstall 계획에 companion 포함 (`phase-2-companion-uninstall`)

범위: `bin/uninstall.ts` + `tests/unit/uninstall.test.ts`. D5.

**테스트 oracle**:
- companion 4종이 uninstall 계획 출력에 **등장**한다.
- 🔴 **읽기 전용 유지**: 대상 tree **전후 snapshot 동일**(기존 uninstall 테스트 관례 재사용).
- `child_process` 미import 구조 테스트가 **계속 그린**(uninstall이 npm을 spawn하지 않는다).
- **분류 정직성(R6)**: byte-identical이면 `identical`, 사용자가 고쳤으면 `differs`.
  ⚠️ 테스트가 **"differs = 사용자 수정"이라고 단언하지 않는다** — 그건 "다른 버전이 깐 것"일 수도 있다.
  분류 값만 고정하고 의미를 과대 주장하지 않는다.
- 부재(미설치·`--no-agent-entrypoints`) → `absent`. 부재가 정상이므로 오류가 아니다.
- **기존 항목 회귀**: `KIT_AGENT_ENTRYPOINTS`·`workflow/.gitignore`·schema·persona 분류가 그대로.

Exit: typecheck0 · 단위 그린 · Codex phase 리뷰 승인 · HIGH 확인 후 별도 커밋.

---

## 완료

- 게이트 해당분(unit·typecheck).
- 🔴 **이 REQ 단독으로 main 병합하지 않는다**(PM 결정). REQ-A2-2(공존·smoke)·REQ-A2-3(문서·Cursor CLI 표기)까지
  **셋 다 승인·검증된 뒤 하나의 PR로 통합 검토·병합**한다.
- HIGH 티켓: 각 phase의 `req:commit --run` **직전** 통제점에서 사용자 확인. 리뷰 전 선승인은 커밋 실행 승인이 아니다.

## 후속 (이번 범위 밖)

- **REQ-A2-2**: 타사 skill 공존 fixture(선/후설치) · Stage-A migrate 비추가 검증 · packed-tarball fresh-install smoke.
- **REQ-A2-3**: README(ko/en)·CLI help·CHANGELOG. 🔴 **Cursor CLI 지원 표기를 검증한 버전·모드와 함께 확정**해야 한다 —
  같은 벤더 스레드에 "다음 CLI 릴리스에서 수정 예정"이 있어 **`❌`는 보편적 제품 사실이 아니라 버전·모드 의존 상태**다(PM 지시).
  검증 불가면 `⚠️ 버전/모드별 동작 차이 가능, 보장하지 않음`으로 표기한다.
- **REQ-C**: 출시본 v0.7.0의 dangling symlink 구멍(`add()`·`applyCopies`·`assertEntrypointPathsUsable`가 `existsSync` 기반).
- **REQ-D**: finalize 경로의 사람 확인을 CLI·상태 모델로 강제. 손으로 적는 `user_commit_confirmed`는 위조 가능(REQ-019가 실증).
- **REQ-B**: `00/01/02` 템플릿 + persona 리뷰 관점 2종.
