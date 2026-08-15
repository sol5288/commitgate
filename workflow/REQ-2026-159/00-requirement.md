# REQ-2026-159 요구 — auto 통합의 정책 스냅샷 결속과 배포 계약 정합

0.23.0 외부 점검이 P1 두 건을 보고했고, **둘 다 코드로 재현 확인**했다.

## P1-1 — 티켓 정책 스냅샷이 최종 `integrate` 에는 적용되지 않는다

| 위치 | 지금 |
|---|---|
| `bin/integrate.ts:850` | `stopGate: cfg.stopGate` — **현재 config 를 그대로** 넘긴다 |
| `bin/integrate.ts:314` | `if (deps.stopGate !== 'auto') return { kind: 'not-required' }` |
| `bin/integrate.ts:630` | `if (deps.interactive && gate.kind !== 'allowed')` — **비대화형은 확인을 묻지 않는다** |
| `scripts/req/lib/config.ts:140` | `effectiveStopGate` — 정본 resolver. `req-commit`·`req-confirm`·`req-doctor` 는 쓴다 |

🔴 **`integrate` 만 정본 resolver 를 쓰지 않는다.**

재현:

```
1. stopGate:"auto" 에서 티켓 A 생성 → state.json 에 policy_snapshot.stop_gate = "auto"
2. 티켓 A 작업·검증 완료
3. config 를 stopGate:"merge" 로 변경
4. 비대화형에서 `commitgate integrate --run`
   → delegationGate 가 not-required (config 가 merge 라서)
   → 최종 확인도 안 묻는다 (비대화형)
   → **위임 없이 main 병합**
```

- **auto 로 시작한 티켓의 더 강한 통제가 나중 config 변경으로 약화된다.**
- 반대 방향도 있다: `merge` 로 시작한 티켓이 나중 `auto` config 를 만나 **없던 위임 요구**가 생긴다.

이것은 REQ-2026-129 가 세운 원칙("티켓 하나가 여러 정책으로 진행되면 이미 받은 확인의 의미가 사후에
달라진다")이 **가장 비싼 지점 하나에서만** 지켜지지 않는 상태다.

## P1-2 — 설치되는 에이전트 계약이 `auto` 를 부정한다

| 위치 | 지금 |
|---|---|
| `AGENTS.template.md:57` | "통합 승인은 `stopGate` 값(`phase`/`req`/`merge`)과 무관하게 **항상** 존재" |
| `AGENTS.template.md:75~77` | 정지 지점 열거에 `phase`·`req`·`merge` 만 |
| `AGENTS.template.md:81~83` | "**통합(main 병합) 승인은 어느 값에서도 필요하다**" |
| `AGENTS.template.md` 관리 블록 `commitgate:autonomy` 예외표 #1 | `I1`/`I2`/`B1` 을 **무조건** 정지로 적음 |

실제 구현은 `stopGate: "auto"` + 유효한 사전 위임이면 사람에게 다시 묻지 않고 통합한다.

🔴 이 파일은 **설치 프로젝트로 복사되는 계약**이다. 새 프로젝트의 에이전트는 이 계약을 따라
**불필요하게 멈춘다** — "자동으로 끝까지"라는 목표를 문서 계층에서 깨뜨린다.

🔴 외부 보고는 두 곳(57 · 75~82)을 지적했지만, **관리 블록 안에도 같은 부정이 있다**(예외표 #1).
   범위를 관측된 곳으로 좁히면 이 저장소가 반복해 온 실수를 또 하는 것이다.

## 목표

1. 티켓이 생성될 때 확정된 `stopGate` 가 **phase 진행부터 최종 main 통합까지** 일관되게 유지된다.
2. 설치되는 AGENTS 계약이 `stopGate: "auto"` + 유효 사전 위임의 무정지 통합을 **정확히** 안내한다.
3. 기존 설치본은 자동으로 덮어쓰지 않되, **옛 계약을 쓰고 있다는 사실을 구체적으로 통지**받는다.

## 범위 밖 (후속 큐)

외부 점검의 "추가 제안" 4건은 이 REQ 에 넣지 않는다 — 축이 다르고, P1 수정을 늦춘다.

- setup 종료 요약 · `doctor` 실효 자율 모드 한 줄 · npm tarball 설치 E2E 를 CI 에 · 전체 스위트 진행 로그.

## 실측 — 전체 스위트 exit 124 에 대해

외부 점검은 전체 스위트가 10분 안에 끝나지 않아 재확인하지 못했다고 적었다.
🔴 **이 저장소의 실측은 `npm test` = 690.16초(11.5분)이고, 그 실행에서 101 파일·3722 건이 전부
통과했다.** 10분 타임아웃이면 정확히 그 지점에서 끊긴다 — 교착이 아니라 초과다.
진행 로그가 없다는 지적 자체는 유효하며 후속 큐로 넘긴다.

## 추가 P1 (외부 리뷰 — phase-1·2 통합 前)

`scopeOfBranch()` 가 `null` 이면 phase-1 은 정책 대상을 비우고 **현재 config 로 폴백**한다.

```
1. stopGate:"auto" 에서 티켓 생성 → policy_snapshot.stop_gate = "auto"
2. 브랜치를 `feat/req-renamed` 로 변경 — branchPrefix(`feat/req-`)는 만족하지만
   뒤에 REQ 번호 형식이 없어 scopeOfBranch() = null
3. config 를 stopGate:"merge" 로 변경
4. 비대화형 `integrate --run` → 위임 검사 꺼짐 → 병합
```

🔴 **브랜치 이름을 바꾸는 것이 `auto` 정책을 약화시키는 통로**다. phase-1 이 막은 결함의 우회로다.
🔴 그 자리에 내가 "오늘 동작 그대로다"라는 주석까지 달아 두었다 — **보존한 것이 곧 구멍이었다.**
