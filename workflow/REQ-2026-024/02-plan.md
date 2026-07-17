# REQ-2026-024 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고.

> 🔴 **phase는 2개다.** REQ-020은 설계 1개가 6 phase를 덮어 **설계 리뷰가 13회**로 늘었다 — 앞 phase를
> 승인받을 때마다 뒤 phase까지 전체 재검수됐다(CommitGate 알려진 결함, Stage B 중단 사유와 동일).
> phase를 작게 유지한 REQ-021·022는 **2회·1회**였다. 검수 면적 축소가 유일하게 통한 대책이다.

각 phase 공통 절차: 그 phase의 인수 기준만 구현 → 관련 unit test → typecheck → 전체 test →
staged 범위를 해당 phase 파일로 제한 → `req:next`가 지시하는 리뷰.
**P1만 수정한다. observation은 backlog로.**

**테스트는 기존 인프라를 재사용한다**(새로 만들지 않는다):
`tmpTarget()` · `OPTS()` · `snapshot()`(lstat/readlink 기반) · `outsideDir()` ·
`expectRejectedWithNoWrites(dir, outside, run)`(외부를 throw보다 **먼저** 검사) · `trySymlink(target, path, type)`.

---

## Phase 1 — confinement 헬퍼 + `add()`·`applyCopies` (`phase-1-confine-helper-add`)

범위: `bin/init.ts` · `tests/unit/init.test.ts`. D1·D2·D3. 모드 **A·B·C**.

**구현**
1. `statWritableDest(targetRoot, destRel): Stats | null` 추출 — 본문은 `planCompanionSkills` 449-460 그대로.
2. `planCompanionSkills`(W9)와 `workflow/.gitignore` 인라인(W8)이 **그 헬퍼를 쓰게** 한다.
   🔴 **동작 무변경 리팩터다** — 메시지·순서 동일. K2~K5가 그대로 그린이어야 한다.
3. `add()`(W1·W2)가 `existsSync` 대신 헬퍼를 쓴다 — **반환값이 곧 부재 판정**이다(D2).
4. `applyCopies`에 **전량 검증 → 쓰기** 두 루프(D3) + **export**.

**테스트 oracle**

🔴 **각 fixture는 단언을 2개 갖는다** (design-r01 P1). `expectRejectedWithNoWrites`(정상 실행)만 쓰면
**D3 백스톱이 `add()` 변이를 가린다** — `add()`를 `existsSync`로 되돌려도 `applyCopies`의 전량 검증이
쓰기 전에 거부해 초록이 된다. 그때 거부는 preflight가 아니라 apply이고 **`--dry-run`은 조용히 통과한다**(R5 위반).

**계측: `--dry-run` = preflight 전용 관측점.** `applyCopies`는 `if (!opts.dryRun)` 안이라 dry-run은
백스톱에 **도달하지 못한다**. 실측으로 양방향 확인함(01-design D3 표):
현행 코드에서 `.cursor` junction + dry-run은 **throw 없음**(→ 변이를 잡는다),
이미 방어된 companion 경로 + dry-run은 **throw 있음**(→ 계측이 눈멀지 않았다).

| # | fixture | ① 정상 실행 | ② `--dry-run` (preflight 도달) |
|---|---|---|---|
| E7 | `.cursor/` ancestor junction | `expectRejectedWithNoWrites` | **throw** · 외부·대상 불변 |
| E8 | `workflow/machine.schema.json` live leaf + `--force` | 외부 `user-owned.md` **바이트 불변** | **throw** |
| E9 | `.cursor/rules/commitgate.mdc` dangling leaf | `expectRejectedWithNoWrites` | **throw** |

- 🔴 **E7이 격리의 핵심이다.** `.cursor/`는 companion(`.claude/**`만)도 gitignore(`workflow/`만)도 검사하지 않는다
  — **`add()`의 검사만이 유일한 방어선**이다. `.claude/`·`workflow/` fixture로는 "우연히 막히는 것"과 구분되지 않는다.
- **E8도 격리돼 있다**: `workflow/` 상위는 **실제 디렉터리**라 gitignore의 `assertConfinedDest`가 통과한다
  → leaf 검사만이 방어선.
- **비-ENOENT fail-closed (R4)**: leaf `lstat`이 ENOENT 아닌 오류를 내는 fixture → **부재로 삼키지 않고 throw**.
  ⚠️ 이식성 있는 재현이 어려우면 **그 사유를 적고** `trySymlink` 관례처럼 skip한다 —
  **못 만든 fixture를 통과로 적지 않는다.**
- **🔴 백스톱(D3) — `applyCopies` 직접 호출**: 손으로 만든 `plan`(검사를 안 거친 symlink dest 포함)을 넘겨
  **throw + 외부 불변**. `runInit` 경유로는 preflight가 먼저 발화해 **백스톱 제거 변이가 통과한다** —
  그래서 export가 필요하다. 이 테스트가 없으면 백스톱 주장은 공허하다.
- **대조군 K2·K3·K4·K5 그대로 그린** — 리팩터가 동작을 바꾸지 않았다는 증거.
- **정상 경로 무회귀(R8)**: symlink 없는 설치·멱등 재설치·`--force`·`--no-agent-entrypoints`·`--strict`·
  `--dry-run` 기존 테스트 전부 그린.

**🔴 변이 검증** (없으면 oracle이 공허하다)
- `add()`의 헬퍼를 `existsSync`로 되돌린다 → **E7·E8·E9의 ② dry-run 단언이 반드시 실패**한다.
  ⚠️ **① 정상 실행 단언은 통과한다** — 백스톱이 가리기 때문이다. **그게 ②가 존재하는 이유다.**
- 헬퍼에서 `assertConfinedDest` 호출을 뺀다 → **E7의 ②가 반드시 실패**한다.
- `applyCopies`의 검증 루프를 뺀다 → **백스톱 테스트가 반드시 실패**한다(runInit 경유 테스트는 통과 — 그게 요점).
- 변이는 **ESM 문법으로 유효**해야 한다(typecheck 0). `require` 혼용은 모듈 해석 실패라 **가드를 검증하지 않는다**(REQ-020 실측).

Exit: typecheck0 · 단위 그린 · Codex phase 리뷰 승인 · **HIGH 확인 후** 별도 커밋.

---

## Phase 2 — 개별 쓰기 경로 (`phase-2-confine-individual-writes`)

범위: `bin/init.ts` · `tests/unit/init.test.ts`. D4·D5. 모드 **A·D**. W3~W7.

**구현**
1. W5 `AGENTS.md`(989) · W6 `CLAUDE.md`(1000) · W7 `AGENTS.commitgate.md`(1004) → 헬퍼 반환값으로 판정.
2. W4 `package.json`(895) · W3 `req.config.json`(940) → 헬퍼를 **읽기보다 앞**에 둔다(D5).
   부재 케이스의 **기존 에러 메시지는 유지**한다(`null` 반환 → 기존 분기).
3. `assertEntrypointPathsUsable` docstring 정정(D4) — **"confinement 방어가 아니다. 방어는 `statWritableDest`가 한다."**
   구현은 **바꾸지 않는다**(규칙 두 벌 방지).

**테스트 oracle** (전부 `expectRejectedWithNoWrites`)

| # | fixture | 모드 | 단언 |
|---|---|---|---|
| E1 | `AGENTS.md` → 외부 미존재 파일 | A | throw · 외부에 **미생성** |
| E2 | `CLAUDE.md` → 외부 미존재 파일 | A | throw · 외부에 **미생성** |
| E3 | `AGENTS.commitgate.md` → 외부 미존재 (마커 없는 실제 `AGENTS.md` 필요) | A | throw · 외부에 **미생성** |
| E4 | `req.config.json` → 외부 미존재 파일 | A | throw · 외부에 **미생성** |
| E5 | `req.config.json` → 외부 **실파일**(`{}`) | D | throw · 그 파일 **바이트 불변** |
| E6 | `package.json` → 외부 **실파일**(유효) | D | throw · 그 파일 **바이트 불변** |

- **E3 전제**: `agentsMarkerMissing`가 참이어야 그 경로가 발동한다 → 계약 마커 **없는** 실제 `AGENTS.md`를 둔다.
  ⚠️ 이 전제가 틀리면 코드가 그 분기에 **도달조차 안 해** 테스트가 공허하게 초록이 된다.
- **E5·E6이 D 모드의 유일한 증거다** — dangling(A)만 테스트하면 `existsSync`=true 경로가 그대로 뚫린 채 초록이다.
- **dry-run 대조군(K1)**: E1 fixture + `--dry-run` → 여전히 throw(preflight) · **외부·대상 둘 다 불변**.
- **부재 메시지 회귀**: `package.json` 없는 대상 → **기존 메시지 그대로**(`package.json이 없습니다` 계열).

**🔴 변이 검증**
- W5의 헬퍼를 `!existsSync`로 되돌린다 → **E1이 반드시 실패**한다.
- W3의 헬퍼를 `existsSync`로 되돌린다 → **E4·E5가 반드시 실패**한다.
- W4의 헬퍼를 `existsSync`로 되돌린다 → **E6이 반드시 실패**한다.

Exit: typecheck0 · 단위 그린 · Codex phase 리뷰 승인 · **HIGH 확인 후** 별도 커밋.

---

## 완료

- 게이트 해당분(unit·typecheck). smoke는 **이 REQ가 바꾸지 않는다**(정상 경로 무변경 — `scripts/smoke.mjs` 무변경).
- HIGH 티켓: 각 phase의 `req:commit --run` **직전** 통제점에서 사용자 확인.
  🔴 리뷰 **승인 후**에만 받는다 — 설계·phase 리뷰 전에 받은 확인은 커밋 실행 승인이 아니다.
- **main 병합·원격 push는 각각 별도 통제점**(사용자 명시 승인). `--ff-only`. merge와 push를 같은 승인으로 묶지 않는다.
- 🔴 **이 REQ 완료는 publish의 선행 조건일 뿐, publish를 포함하지 않는다.** publish·tag·release는 **여전히 금지**이며
  main 병합 + main 기준 fresh tgz smoke 성공 후 **별도 승인**을 받는다.

## 후속 (이번 범위 밖)

- **`bin/migrate.ts`·`bin/uninstall.ts` 쓰기 경로 실측** — 같은 4모드로. ⚠️ **측정 전까지 "안전하다"고 말하지 않는다.**
- **배송 게이트 REQ** — direct-push를 계속 쓸 거면 **"동일 SHA 원격 CI 성공 후 main 전진"** 게이트가 필요하다.
  **사후 CI만으로는 main 반영 전 차단을 제공하지 못한다.**
- **REQ-D** — finalize 경로의 사람 확인을 CLI·상태 모델로 강제(손으로 적는 `user_commit_confirmed`는 위조 가능 — REQ-019가 실증).
- **REQ-B** — `00/01/02` 템플릿 + persona 리뷰 관점 2종.
- Cursor CLI 실측 재검증 — `cursor-agent` 있는 환경에서 버전·모드별로.
