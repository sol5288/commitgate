# REQ-2026-023 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: 코드 변경 8파일 이하 권고. 이 REQ는 5파일이다.

> **phase는 1개다.** 문서·help 문자열만 바꾸므로 쪼갤 축이 없다. REQ-021·022가 작게 유지해 각각 r01·r01에
> 승인된 방식을 따른다(REQ-020은 6 phase 과밀로 설계 리뷰 13회).

---

## Phase 1 — 문서·지원 매트릭스 (`phase-1-docs-support-matrix`)

범위: `README.md` · `README.en.md` · `CHANGELOG.md` · `bin/init.ts`(**`printHelp` 문자열만**) ·
`tests/unit/package-payload.test.ts`.

⚠️ **설치·경고·uninstall 로직 무변경**(R8). `bin/init.ts`는 help 문자열만 만진다.

### 문서 내용 (D5)

README 한/영의 **"설치가 하는 일"/"What Installation Adds"** 에 companion 소개,
**"지원 범위"/"Support scope"** 에 지원 매트릭스. 구조가 이미 대응하므로 자리를 새로 만들지 않는다.

- 4종과 용도(discovery는 **사용자 호출형**) · `--no-agent-entrypoints` · seed-once/`--force` 보존 ·
  gitignore WARN/`--strict` · `AGENTS.md` 정본 · 권장 흐름 · upstream MIT·기준 commit·**외부 installer 미실행**.
- 🔴 **"자동 발견 · 모델 판단 호출"** — **harness가 발견**하고 **모델이 호출을 판단**한다(확률적).
  "harness가 결정한다"고 쓰면 주체가 틀린다.
- 🔴 **직접 호출 표현은 harness별로 제한한다**(D5와 동일). `/commitgate-*` 예시는 **그 호출 형식이 문서화된 환경**
  (Claude Code)에만 붙인다. 다른 harness에는 *"해당 harness가 제공하는 호출 방식이 있으면 그것을 쓰고,
  없으면 `AGENTS.md`의 진입 흐름을 따른다"* 로 안내한다. **모든 harness에서 slash command가 된다고 암시하지 않는다** —
  지원 매트릭스 독자(Cursor CLI 등)가 slash 호출이 가능하다고 오인하면 R5 위반이다.
  `commitgate-discovery`가 **사용자 호출형**이라는 사실은 유지하되 "어디서나 뜬다"는 뜻이 아니다.
- 🔴 **권한 경계**: companion도, 외부 Matt skills 실행 결과도 **CommitGate·Codex 승인 증거가 아니다**.

### 지원 매트릭스 (D1/D2)

| harness | 표기 |
|---|---|
| Claude Code | `.claude/skills` native 발견 — **벤더 1차 문서 근거, 우리 실측 아님** |
| Cursor editor | `.claude/skills` 호환 읽기 — **벤더 1차 문서 근거, 우리 실측 아님** |
| **Cursor CLI** | ⚠️ **버전/모드별 동작 차이 가능 — 보장하지 않음** |
| Codex | **제품 범위 밖** — companion entrypoint 미설치. Codex는 Reviewer, 4종은 Builder 보조. ⚠️ Codex discovery 전반에 대한 주장 아님 |

🔴 **Cursor CLI를 ✅/❌ 어느 쪽으로도 쓰지 않는다.** 벤더가 지원을 발표했고 수정이 진행 중이라 `❌`는 사실이 아니고,
우리가 검증하지 못했으므로 `✅`도 아니다. **모른다고 쓰는 것이 유일하게 정확하다.**
매트릭스에 **근거 종류(벤더 문서)·확인 시점(2026-07-17)·환경(win32 x64 · Node v20.19.5)**을 함께 적어,
낡을 수 있고 **우리가 실측한 게 아님**을 문서가 스스로 밝힌다.

### 테스트 oracle (D4)

⚠️ **범위를 좁게 유지한다 — 과검증은 공허하거나 환경 의존적인 테스트를 만든다.**

**정본 설명은 README 한/영이다.** help·CHANGELOG는 정본이 아니다:
- **CLI help**: `--force`의 **정확한 예외만** 명시한다. 예:
  *"덮어쓰기 가능한 kit 항목만 갱신합니다. AGENTS.md, CLAUDE.md, workflow/.gitignore 및 companion skills는 기존 파일을 보존합니다."*
- **CHANGELOG**: `Unreleased` 아래 **사실 요약만** — *"companion skills 추가 및 lifecycle 문서화"* 정도 + README 링크.
  🔴 **CHANGELOG를 계약 표면으로 만들지 않는다.** `--force` 보존·Cursor 호환성·승인 경계까지 반복하면
  **세 번째 정본**이 생겨 drift 부채가 는다. 사실 요약과 링크만 둔다.

**자동 테스트** (`tests/unit/package-payload.test.ts`):

| 대상 | 검사 |
|---|---|
| **README 한/영** | 4개 skill 이름 · `--no-agent-entrypoints` · **`--force` 보존** · `--strict` · `AGENTS.md` · **승인 증거 경계** · **SHA** · **외부 installer 미의존** |
| **help(`printHelp`)** | **정확한 `--force` 예외** · `--no-agent-entrypoints` |
| **SHA 일치** | README 한/영과 `skills/ATTRIBUTION.md`가 **동일 값**(`d574778…`) |
| **payload 전체** | 🔴 `auto-invoked` **0건** |
| **CHANGELOG** | `Unreleased` 아래 **companion 항목 존재**(존재 검사만 — 계약 표면 아님) |

🔴 **필수 변이 검증** — 각각 **반드시 실패**해야 한다:
1. **help에서 `--force` 예외 문구 제거**
2. **한글 README의 "보존"을 "덮어씀"으로** 변조(영문·help는 그대로) → 표면 간 모순을 잡는지
3. **영문 README의 SHA만** 다른 값으로 변조

⚠️ **하지 않는 것**(과검증 방지):
- 🔴 **`staged diff`를 unit test oracle로 넣지 않는다.** 커밋 뒤·CI에서는 index가 비어 **환경 의존적이거나 공허**해진다.
  `bin/init.ts` 변경이 `printHelp` 문자열로만 한정됐는지는 **phase 구현 전 staged-diff/리뷰 체크리스트로만** 확인한다.
- 🔴 **`.cursor/skills` 문자열 0건 검사를 하지 않는다.** "설치하지 않는다"는 **설명 자체를 막는다**.
  대신 **설치 코드의 companion destination이 `.claude/skills/commitgate-*` 4개뿐**임을 기존 설치 테스트
  (`KIT_COMPANION_SKILLS` dest 검사 — REQ-020 phase-2에 이미 있음)로 고정한다. 그게 정확한 축이다.
- **CHANGELOG 단독 변이 검증을 하지 않는다** — 계약 표면이 아니므로.

⚠️ **이 테스트는 불변값·표면 정합 회귀 방지용이다.** 문서의 **모든 의미를 증명하지 않는다** —
문맥·링크·번역 정합성은 **최종 phase 리뷰에서 사람·Codex가 별도로** 검토한다. 과대주장하지 않는다.

### 구현 전 체크리스트 (테스트 아님)

- `git diff --cached --stat`으로 `bin/init.ts` 변경이 **`printHelp` 문자열 범위**인지 눈으로 확인한다.
- `git diff --cached --check`(공백) 확인.
- 이 둘은 **리뷰 시점 확인 사항**이지 unit test가 아니다.

Exit: typecheck0 · 단위 그린 · **smoke 그린** · Codex phase 리뷰 승인 · HIGH 확인 후 별도 커밋.

---

## 완료

- 게이트 해당분(unit·typecheck) + smoke.

### 🔴 배송 정책 — PR 없음, main 순차 병합 (PM 확정)

이 프로젝트는 **1인 개발 흐름**이다. **PR을 만들지 않는다.**
문서 작업 때문에 **이미 완료된 코드 안전성 변경을 묶어 두지 않는다**.

1. **REQ-020~022 완료 기준점(`b3d4221` 계보)** 을 **사용자의 명시적 병합 승인 후** `main`에 병합한다.
2. 병합 **전** 확인: 정확한 **조상 관계** · **clean tree** · **`req:next=DONE`** · **전체 테스트** · **fresh tgz smoke**.
3. 병합은 가능하면 **`git merge --ff-only`**. **merge와 push/publish를 같은 명령·같은 승인으로 묶지 않는다.**
4. **REQ-023**은 설계 재승인 → 구현 → phase 승인 → HIGH 확인 → 별도 커밋까지 끝낸 뒤 **최신 `main`에 순차 병합**한다.
5. **npm publish/tag/release**는 REQ-023까지 main에 병합되고 **main 기준 fresh tgz smoke가 성공한 뒤**,
   **별도 사용자 승인으로만** 검토한다.
6. 🔴 **main 병합 · 원격 push · publish는 각각 별도의 통제점이다. 자동 실행하거나 묶어서 실행하지 않는다.**

- HIGH 티켓: `req:commit --run` **직전** 통제점에서 사용자 확인.

## 후속 (이번 범위 밖)

- **REQ-C**: 출시본 v0.7.0의 dangling symlink 구멍(`add()`·`applyCopies`·`assertEntrypointPathsUsable`가 `existsSync` 기반).
  companion 경로는 REQ-020에서 이미 막았으나 **기존 자산은 그대로**다.
- **REQ-D**: finalize 경로의 사람 확인을 CLI·상태 모델로 강제. 손으로 적는 `user_commit_confirmed`는 위조 가능(REQ-019가 실증).
- **REQ-B**: `00/01/02` 템플릿 섹션 + persona 리뷰 관점 2종(명세 충족·구현 품질). P1-only 차단 정책 무변경.
- Cursor CLI 실측 재검증 — `cursor-agent`가 있는 환경에서 버전·모드별로 확인해 매트릭스를 갱신한다.
