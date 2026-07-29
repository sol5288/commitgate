# REQ-2026-088 설계

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

| 자리 | 현재 |
|---|---|
| `lib/evidence.ts` `splitUnboundPhases(content, designRef)` | ✅ 순수 — `{unbound, rebindable, legacy}` |
| `lib/close-proof.ts` `recoveryGuidance({ticketId, unbound, rebindable})` | ✅ 순수 — `{route, lines}`(rebind 명령·확인 문장 포함) |
| `lib/intake.ts` | 위 둘을 쓴다 — **`req:new` 차단 시점**(이미 갇힘) |
| `lib/close-migrate.ts` | 위 둘을 쓴다 — **`req:close --migrate` 거부 시점**(이미 갇힘) |
| `req-next.ts` `resolveNext` | 매니페스트를 **보지 않는다** |
| `req-doctor.ts` | 결속 관련 검사 **없음** |

즉 **판정기와 안내기는 완성돼 있고, 진행 중에 그것을 부르는 곳만 없다.**

## 핵심 설계 결정

### DEC-1 — 새 술어를 만들지 않는다

`splitUnboundPhases` + `recoveryGuidance`를 **그대로** 쓴다(R5). 판정을 다시 구현하면
"한쪽이 권한 명령을 다른 쪽이 거부"하는 상태가 재발한다 — REQ-2026-072가 고친 결함이다.

### DEC-2 — `req:next`는 **액션을 바꾸지 않고 진단만 얹는다**

`resolveNext`가 내는 `kind`·`detail`·`command`는 **건드리지 않는다.** 반환 직전에
`diagnostics`에 안내 줄을 덧붙인다.

```
resolveNext(input) = withStaleBindingNotice(resolveNextCore(input), input)
```

- 🔴 **아무것도 막지 않는다**(R3). 진행 중 결속이 끊긴 것은 오류가 아니다 — 마지막에 재결속하면 된다.
  `kind`를 `AWAIT_HUMAN`으로 바꾸면 REQ-2026-087이 되돌린 바로 그 실수(진행을 막는 정지)를 반복한다.
- 게이트 로직(G1/terminal/G3/G2/…)을 **한 줄도 건드리지 않는다.** 기존 분기가 어느 경로로 반환하든
  안내가 붙으므로, 분기마다 코드를 심는 것보다 누락 위험이 없다.

### DEC-3 — 판정 근거는 **커밋된** 매니페스트(HEAD blob)

`main()`이 `createEvidencePorts(...).headText(...)`로 읽어 넣는다 — intake와 **같은 원천**(R4).
워킹트리 사본은 evidence-finalize 도중일 수 있어 판정 입력이 될 수 없다.

읽을 수 없으면(부재·legacy·파싱 불가) **조용히 아무것도 하지 않는다.** 이건 알림이지 게이트가 아니다.

### DEC-4 — `req:doctor`는 D26으로 같은 사실을 낸다(WARN)

`req:next`는 에이전트 루프가 보고, `req:doctor`는 사람이 상태를 볼 때 본다. 두 표면 모두에 있어야 한다.

- **레벨 상한 WARN — 절대 FAIL 아님.** `req:commit`이 doctor를 하드 게이트로 spawn하므로 FAIL이면
  **결속이 끊긴 티켓의 남은 phase를 커밋조차 못 한다** — 재결속하려면 phase를 끝내야 하는데 끝낼 수가
  없는 교착이 된다. D24·D25와 같은 근거다.

### DEC-5 — 결속이 온전하면 아무것도 출력하지 않는다

`splitUnboundPhases(...).unbound`가 비면 `recoveryGuidance`가 `{route:'none', lines:[]}`을 낸다.
그대로 흘려 **문구를 추가하지 않는다**(R7). 항상 뜨는 안내는 곧 무시되는 안내다.

### DEC-6 — 재결속 불가 phase에는 rebind를 권하지 않는다

`recoveryGuidance`가 이미 `migrate` 분기를 갖는다(`phase_design_ref` 부재 = 레거시). 그 판단을
**그대로 위임**한다(R6) — 여기서 다시 분기하면 두 곳이 갈라진다.

## Phase별 구현

### phase-1-early-notice (DEC-1~6)

- `scripts/req/req-next.ts`
  - `NextInput`에 `committedManifestText?: string | null` 추가(미지정 = 미계산 → 무동작).
  - 순수 `staleBindingNotice(ticketId, manifestText)` 신설 — 위 두 술어 조합.
  - `resolveNext`를 얇은 wrapper로: 기존 본문은 `resolveNextCore`로 이름만 바꾸고 로직 무변경.
  - `main()`이 HEAD blob으로 `committedManifestText`를 채운다.
- `scripts/req/req-doctor.ts` — `DoctorInputs.staleBindingLines?: string[]` + **D26**(WARN 상한) + `main()` 계산.
- `tests/unit/req-next.test.ts` · `tests/unit/req-doctor.test.ts`

회귀 가드:
①미결속 있음 → `req:next`의 `diagnostics`에 rebind 명령(확인 문장 포함)이 실림
②🔴 **`kind`·`detail`·`command`가 안 바뀜**(대조군: 같은 입력에서 notice 없는 경우와 동일)
③결속 온전 → 문구 0줄(DEC-5)
④매니페스트 없음/파싱 불가 → 무동작
⑤레거시(`phase_design_ref` 부재) → rebind가 아니라 `--migrate` 안내(DEC-6)
⑥🔴 D26이 **어떤 입력에서도 FAIL이 아님**(DEC-4)
⑦안내 문구가 `recoveryGuidance` 산출과 **동일**(별도 생성 금지 — R5).

Exit: typecheck0 · 전체 스위트 그린 · Codex phase 리뷰 승인.

### phase-2-docs-changelog

- `docs/workflow.md` · `docs/workflow.en.md` — 설계 재승인 절(`req:rebind`)에 "이제 미리 알려준다" 추가.
- `CHANGELOG.md` — Unreleased + **확인할 파일 표**(phase-1 커밋 SHA·경로).

Exit: typecheck0 · 전체 스위트 그린 · `docs:lint` 그린 · Codex phase 리뷰 승인.

## 변경 파일

| 파일 | phase |
|---|---|
| `scripts/req/req-next.ts` · `scripts/req/req-doctor.ts` | 1 |
| `tests/unit/req-next.test.ts` · `tests/unit/req-doctor.test.ts` | 1 |
| `docs/workflow.md` · `docs/workflow.en.md` · `CHANGELOG.md` | 2 |

## 하위호환·안전

- **아무것도 막지 않는다.** `req:next`는 액션 불변 + 진단 추가, D26은 WARN 상한.
- `committedManifestText` 미지정(legacy 2-arg 호출·테스트) → **현행과 완전히 동일**.
- 판정·안내 술어를 **재구현하지 않으므로** intake·migrate와 갈라질 수 없다.
- `dev-complete` 술어·`req:rebind`·intake 판정 **무변경**. 스키마도 무변경 → `commitgate sync` 불요.
