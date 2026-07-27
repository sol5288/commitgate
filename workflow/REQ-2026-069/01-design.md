# REQ-2026-069 설계 — phase 재결속(rebind)

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

`scripts/req/lib/evidence.ts`

- `ManifestEntry.phase_design_ref?` — phase 행이 승인 시점에 결속된 design 해시(**선택 필드**).
- `designHashFromManifest(content)` — 매니페스트의 **마지막** design 행의 `design_hash`.
- `evidencedPhaseIdsFromManifest(content, designRef)` — `phase_design_ref === designRef`인 phase만 낸다.

`scripts/req/req-commit.ts`

- `computeDevCompleteProof` — `inventory.every(id => evidenced.has(id))`가 아니면 `null`(= 미발행).

## 핵심 설계 결정

### DEC-1 — 🔴 재결속은 **매니페스트에 남는 별도 행**이다

새 `kind: 'rebind'` 행을 `approvals.jsonl`에 append 한다.

```jsonc
{ "kind": "rebind", "phase_id": "phase-2-x",
  "from_design_ref": "<옛 해시>", "to_design_ref": "<현재 해시>",
  "confirmation": "<사람이 입력한 문구>", "confirmed_at": "<실제 시각>", … }
```

🔴 **기존 phase 행을 고치지 않는다.** 승인 증거는 append-only여야 감사가 성립한다 —
`phase_design_ref`를 덮어쓰면 "이 phase가 원래 어느 설계로 검토됐는가"가 사라지고,
재결속이 있었다는 사실 자체가 기록에서 증발한다.

### DEC-2 — 🔴 재결속은 **사람의 확인**을 요구한다 (R2)

"이 설계 변경이 그 phase의 검수를 무효화하는가"는 **도구가 알 수 없다.** 설계 diff가 그 phase의
코드와 무관한지는 의미 판단이다.

확인 문구는 `rebind <REQ-id> <phase-id>` — 묶음마다 다르게(`delivery`의 확인 문구와 같은 이유:
고정 문구면 복사-붙여넣기로 엉뚱한 대상을 재결속한다).

🔴 **시각은 실제 시계에서 읽는다.** 지어낸 타임스탬프는 REQ-2026-019가 폐기된 사유다.

### DEC-3 — 🔴 자동 carry-forward를 만들지 않는다 (R3)

"설계가 바뀌어도 앞선 phase는 유효하다"를 기본값으로 두면 DEC-B5가 막던 것(D1 검토분이 D2 완료에
새는 것)이 그대로 열린다. **명시적 행이 있을 때만** 산입한다.

⚠️ 설계 변경의 "영향 범위"를 도구가 판정하는 방안은 **기각**했다. 설계 문서의 어느 문장이 어느
phase의 코드에 걸리는지는 텍스트로 측정되지 않는다 — 그런 판정기는 오탐이면 정상 종결을 막고,
누락이면 이 REQ가 막으려는 바로 그 누수를 만든다.

### DEC-4 — 산입 규칙: **결속 또는 재결속**

`evidencedPhaseIdsFromManifest(content, designRef)`가 다음 중 하나면 산입한다.

1. `phase_design_ref === designRef` (기존)
2. 그 phase에 대해 `to_design_ref === designRef`인 **유효한 rebind 행**이 있다

🔴 rebind 행의 `from_design_ref`는 **그 phase가 실제로 결속됐던 해시와 일치**해야 한다.
아무 해시나 받으면 존재하지 않던 승인을 지어낼 수 있다.

### DEC-5 — 🔴 현재 설계가 승인 상태일 때만 (수용기준 6)

재결속의 대상(`to_design_ref`)은 **매니페스트의 현재 design_ref**여야 한다. 임의 해시로의 재결속은
받지 않는다 — 승인되지 않은 설계로 phase를 묶는 경로가 되면 안 된다.

### DEC-6 — verb는 `req:rebind`

`npx commitgate req:rebind <REQ> --phase <id> --confirm "<문구>" --run`.

- `--run` 없으면 계획만(재결속 대상·from/to 해시 표시).
- 대상 phase가 이미 현재 해시에 결속돼 있으면 **거부**한다(불필요한 행을 남기지 않는다).
- 🔴 **setup 완료 게이트**를 지난다(다른 상태 변경 verb와 동일).

### DEC-7 — 매니페스트 검증 확장

`MANIFEST_KEYS`에 rebind 전용 키를 더하고, `validateManifest`가 rebind 행을 검증한다.
🔴 **기존 행 무회귀**: rebind 행이 없는 매니페스트의 검증 결과가 한 글자도 바뀌지 않아야 한다.
🔴 `kind` 확장이 `ReviewKind`(design|phase)를 오염시키지 않게 한다 — rebind는 리뷰가 아니다.

### DEC-8 — 🔴 재결속은 **완료 판정을 다시 한다** (phase-4 · 자체 검증에서 발견)

`req:rebind`를 이 REQ 자신에게 적용해 보니 **결속은 고쳐졌는데 티켓이 여전히 안 닫혔다.**

```
산입 phase: phase-1-rebind-model, phase-2-rebind-verb, phase-3-docs   ← 재결속 성공
ticket-close.jsonl 없음 · req:new 여전히 차단                          ← 문제 그대로
```

**원인**: `dev-complete`는 `req:commit`의 evidence-finalize에서만 발행된다. 마지막 phase를 커밋한
**뒤에** 재결속하면 완료를 다시 판정할 계기가 없고, 부를 `req:commit`도 남아 있지 않다.

🔴 즉 phase-1~3만으로는 **이 REQ가 해결하려던 문제가 그대로 남는다** — 결속만 고치고 그 결과를
반영할 경로가 없으니 사용자는 여전히 `--migrate`로 우회해야 한다. 설계 누락이다:
"기록만 남기는 명령"으로 두면서 그 기록이 완료 판정에 **언제** 반영되는지를 짚지 않았다.

**결정**: `req:rebind`가 재결속 커밋 후 완료 판정을 다시 하고, 성립하면 `dev-complete`를 발행한다.

🔴 판정과 발행은 **`req-commit`의 정본을 재사용**한다(`computeDevCompleteProof` + HEAD 재검증).
직접 재구현하면 두 경로의 완료 판정이 갈라진다 — 한쪽에서만 닫히는 티켓이 생긴다.

🔴 **발행 조건이 안 되면 조용히 넘어간다.** 재결속 자체는 유효한 기록이고, 남은 phase가 있어서
아직 완료가 아닐 수도 있다. 그때 실패로 만들면 정상적인 중간 재결속이 막힌다.

## Phase별 구현

`02-plan.md` 참조.

## 변경 파일

| 파일 | 변경 |
|---|---|
| `scripts/req/lib/evidence.ts` | rebind 행 타입·검증·`evidencedPhaseIdsFromManifest` 산입 규칙 |
| `scripts/req/req-rebind.ts` (신규) | verb |
| `bin/dispatch.mjs` · `bin/init.ts` | verb 등록·스크립트 주입 |
| 테스트 · docs 한/영 · CHANGELOG | |

## 하위호환·안전

- rebind 행이 없는 티켓은 **동작이 동일**하다(산입 규칙 1만 적용).
- `--migrate`는 그대로 — 진짜 레거시 티켓용.
- 기존 phase 행을 고치지 않으므로 과거 증거의 바이트가 변하지 않는다.
