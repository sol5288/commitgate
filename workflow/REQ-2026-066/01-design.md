# REQ-2026-066 설계

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

| 축 | 현재 | 근거 |
|---|---|---|
| `stopGate` | `phase` \| `req` — `merge`는 **의도적으로 없음** | `config.ts`(REQ-2026-063 DEC-5) |
| 브랜치 생성 | `req:new`가 **현재 브랜치에서** `git checkout -b` | `req-new.ts` |
| 종단 판정 | `req:next`가 `low-only`면 `AWAIT_HUMAN`(통합), `never`면 `DONE` | `req-next.ts` |
| REQ 계승 | `--successor-of` + `series-terminal` close-proof(`replace`/`human-resolution`) | `req-new.ts` · `close-proof.ts` |
| 브랜치 게이트 | **D11**: `phase≠DONE`인데 `state.branch`가 `branchPrefix`로 시작 안 하면 FAIL. **D2**: `state.branch ≠ current`면 FAIL | `req-doctor.ts` |
| 통합 통제점 | `AGENTS.md`의 I1/I2/B1 — **코드가 아니라 계약**이 강제 | `AGENTS.template.md` |

## 핵심 설계 결정

### DEC-1 — 브랜치 구조: delivery 통합 브랜치
```
main
  └─ delivery/<slug>              ← 묶음 전용 통합 브랜치 = 레코드의 유일한 정본
       ├─ feat/req-…-a            → 승인 후 delivery로 integrate
       ├─ feat/req-…-b
       └─ feat/req-…-c(보완)
seal + 모든 member terminal → AWAIT_HUMAN → approve → 사람이 I1/I2/B1로 delivery → main
```
feature를 서로 위에 쌓으면(현재 `req:new` 동작) 마지막 하나를 머지할 때 중간 REQ가 전부 딸려 오고
개별 되돌리기가 불가능하다. 전용 브랜치를 두면 **main이 묶음이 끝날 때까지 깨끗**하다.

### DEC-2 — 🔴 순차 불변식이 충돌을 **구조적으로** 제거한다 (C1·C2)
`begin`은 **현재 delivery HEAD에서** feature를 만들고 그 SHA를 member의 `delivery_base_sha`로 기록한다.
활성 member가 종결되기 전에는 다음 `begin`을 거부한다.
→ integrate 시점에 **delivery HEAD가 feature의 조상**이므로 병합이 fast-forward 가능하고 **충돌이 날 수 없다.**

`integrate` 계약:
1. `delivery_base_sha` === 현재 delivery HEAD 인지 확인
2. delivery HEAD가 feature의 **조상**인지 확인
3. 어긋나면 **merge·레코드 write 0건으로 BLOCKED**
4. 🔴 **자동 rebase·자동 충돌 해결 금지** — 충돌 해결은 새 코드 변경이고 재검수 없이 트리에 들어가면 게이트가 뚫린다
5. 정상 경로만 `git merge --no-ff --no-commit` → 레코드 갱신 → **단일 merge commit**
6. 중간 실패는 `git merge --abort`

### DEC-2b — 🔴 **통합 자격**: 승인된 완료 REQ만 반영한다 (design r02 P1)

DEC-2의 전제(base 일치·조상·clean tree)만으로는 **리뷰 게이트가 통째로 우회된다**:

> `delivery create` → `begin` → feature에 **미승인 변경을 그냥 커밋** → `integrate`
> → 모든 명시 전제를 만족한 채 그 변경이 delivery로 병합된다.

base·조상 조건은 **브랜치 위상**만 말하지 **그 커밋들이 검수를 통과했는지**는 아무것도 말하지 않는다.
`integrate`는 **머지·레코드 쓰기 이전에** 활성 member의 REQ가 **완료·승인 상태**임을 fail-closed로 확인해야 한다.

**자격 조건**(전부 **feature ref의 HEAD-committed 증거**로 확인 — 워킹트리·미커밋 상태는 근거가 아니다):
1. 해당 REQ의 **`dev-complete` close-proof**가 feature ref에 커밋돼 있다
   (= 모든 phase 증거가 durable해진 시점에만 발행된다 — `close-proof.ts`).
2. **커밋된 design 승인 증거**가 완비돼 있다(`req:next`의 종단 DONE 게이트와 같은 근거 —
   `evidence.ts`의 durability 검증).
3. 증거 무결성 검증이 통과한다(아카이브 해시·`approvals.jsonl` 정합).
4. feature ref에 **그 증거 이후의 코드 커밋이 없다** — 있으면 "승인 뒤 덧붙인 미검수 변경"이다.

🔴 **하나라도 어긋나면 merge·레코드 write 0건으로 BLOCKED**다. 이 검증은 DEC-2의 위상 검증보다
**앞**에 온다 — 위상이 맞아도 내용이 미검수면 반영하면 안 되기 때문이다.

🔴 **`--force` 류 우회를 만들지 않는다.** 미검수 코드를 통합 브랜치에 넣는 경로는 존재하지 않아야 한다.
정상 복구는 "리뷰를 마치고 다시 integrate"이지 "확인을 끄고 밀어 넣기"가 아니다.

### DEC-2c — 🔴 `begin`은 **`open` 묶음에만** 허용한다 (design r02 P1)

"활성 member가 없으면 `begin` 가능"만으로는 **닫힌 묶음에 REQ가 추가된다**:

> 빈 묶음을 `seal` → 모든 member terminal(0건)이므로 `AWAIT_HUMAN` → 그 상태에서 `delivery begin A`
> → 활성 member가 없으므로 통과 → **닫힌 묶음에 새 member가 들어간다.**
> `approve` 이후에도 같다 — 승인된 묶음의 내용이 사후에 바뀐다.

이것은 R1("사용자가 묶음을 닫는다")과 R4("닫힌 묶음 전체에 대해 통합 직전 정지")를 모두 무너뜨린다.

**계약**:
```text
begin 가능 ⇔ record.state === 'open'  AND  활성 member 없음
```
- `begin`과 `begin --successor-of` **양쪽**의 공통 전제다.
- `sealed`·`approved`에서 다시 열려면 **`reopen`만이 유일한 경로**다(그 전이는 승인을 무효화하고
  append-only 이벤트를 남긴다 — DEC-8).
- 순수 판정 `canBegin(record)`이 이 두 조건을 **함께** 본다. 음성 테스트로 고정한다.

### DEC-3 — 🔴 레코드 읽기 정본은 delivery ref (C3)
- 판정(membership·`sealed`·approve)은 **언제나 `refs/heads/delivery/<slug>`의 레코드**를 읽는다.
  feature의 사본은 **판정 입력이 아니다** — 분기 시점에 고정되어 stale이고, 그것으로 "모두 종결"을
  판정하면 분기 이후 추가된 member를 몰라 **조기 정지**한다.
- 🔴 **사본을 지우지 않는다.** 지우면 integrate가 delete/modify 충돌을 내 DEC-2의 무충돌 불변식을 스스로 깬다.
- feature의 `state.json`에는 **불변 소속 포인터만** 둔다: `delivery_slug`·`delivery_base_sha`.
  둘은 분기 시점에 확정되고 이후 바뀌지 않으므로 stale 개념이 없다.

### DEC-4 — 레코드 스키마: 처음부터 확장 가능하게
```jsonc
{
  "schema_version": 1,
  "slug": "...", "target_branch": "main", "branch": "delivery/...",
  "state": "open" | "sealed" | "approved",
  "members": [{ "req_id", "order", "delivery_base_sha", "status": "active|integrated|superseded",
                "successor_of": null, "integrated_at": null, "superseded_evidence": null }],
  "events": [ { "event": "created|sealed|approved|reopened", "at", "confirmation" } ]
}
```
🔴 **`schema_version` + 필수/선택 키 분리를 처음부터** 둔다 — REQ-2026-064가 원장에서 겪은 함정
(허용 키 == 필수 키 → 키 추가가 기존 파일을 전부 무효화)을 신규 스키마가 반복하지 않는다.

### DEC-5 — 🔴 `superseded` 증거는 **사본으로 보존** (C4)
parent feature ref는 미승인 변경을 담은 채 병합되지 않으므로 **삭제될 수 있고**, 그러면 SHA가 가리키던
object가 GC되어 검증 원본이 사라진다. 그래서 `superseded` 처리 시 delivery에 **함께 커밋**한다:

- parent feature의 **검증 당시 HEAD SHA와 ref 이름**
- 검증한 `series-terminal` close-proof **행의 정규화 사본**
- 원본 close-proof **blob SHA 및 행 SHA**
- **검증 시각**(실제 시계)과 `resolution`

🔴 **최종 게이트는 삭제될 수 있는 feature ref가 아니라 이 스냅샷을 읽는다.**

### DEC-6 — 🔴 종결(terminal)은 **재귀 정의** (C5)
```text
member가 terminal ⇔
  integrated
  또는
  superseded 이고,
    같은 delivery 안에 direct successor가 **정확히 하나** 있고,
    successor의 order가 parent보다 **뒤**이며,
    그 successor가 **재귀적으로** terminal이고,
    체인의 마지막 leaf가 **integrated**
```
successor 체인은 **acyclic**이어야 하고 반드시 `integrated`에서 끝나야 한다.
단순 존재 검사는 순환(`R1→R2→R1`)과 `superseded`만의 체인을 전부 terminal로 오인한다.

### DEC-7 — verb 인터페이스 (안내가 아니라 전용 명령)
```
commitgate delivery create <slug>              delivery 브랜치 + 레코드 생성
commitgate delivery begin <req-slug>           REQ 등록 + feature 생성(req:new 위임)
commitgate delivery begin --successor-of <REQ> 검수 실패 REQ를 superseded로 교체(DEC-5)
commitgate delivery integrate                  feature 반영 + 레코드 갱신(단일 merge commit)
commitgate delivery seal                       확인 문구 → 묶음 닫기
commitgate delivery approve                    확인 문구 → 최종 승인 기록
commitgate delivery reopen                     승인 무효화 후 재개(append-only 이벤트)
commitgate delivery status                     현재 상태(읽기 전용)
```
브랜치 전환·검증·반영·레코드 갱신은 **사람이 따를 절차가 아니라 하나의 원자적 워크플로**다.
절차로 두면 D2/D11 회피를 사람이 해야 하고 부분 실패가 재도입된다.

🔴 **현재 브랜치 위치에 의존하지 않는다.** delivery ref와 레코드를 **직접 읽고**, clean tree ·
진행 중 merge/rebase 없음 · 활성 member 없음 · ref와 state 포인터 정합을 검증한 뒤 **도구가 이동**한다.
그래서 사용자의 수동 `git checkout` 이탈은 상태 전이가 아니며 불변식을 깨지 않는다.

### DEC-8a — 🔴 최종 게이트는 **전이를 만든 명령이 낸다** (design r01 P1)

`req:next`의 종단 분기만으로는 게이트가 **영영 나오지 않는다**:
마지막 member를 integrate하면 그 REQ의 `req:next`는 이미 끝나 있고, 그 뒤 `seal`을 해도
**`req:next`를 다시 부를 이유가 없다.** 즉 "묶음이 닫혔고 전부 종결"이라는 전이를 아무도 관측하지 않는다.

→ **전이를 만든 명령이 그 자리에서 게이트를 낸다**:

| 명령 | 전이 후 조건 | 결과 |
|---|---|---|
| `delivery integrate` | `sealed` && 모든 member terminal | **`AWAIT_HUMAN`(통합) 출력 + exit 코드** |
| `delivery seal` | 모든 member terminal | **`AWAIT_HUMAN`(통합) 출력 + exit 코드** |
| `delivery status` | 위와 동일 | 같은 판정을 **읽기 전용**으로 표시 |
| `req:next`(stopGate=merge) | 위와 동일 | 같은 판정(사용자가 습관적으로 부를 때의 보조 경로) |

🔴 **판정 로직은 한 순수 함수**(`deliveryGateVerdict`)에서 나온다 — 네 곳이 각자 판정하면 갈라진다.
`req:next`는 **유일한 발생지가 아니라 보조 경로**다.

### DEC-8 — `seal`·`approve`·`reopen`은 확인 문구 통제점
사용자가 확인 문구를 입력하고 그 사실을 레코드에 **커밋**한다. `setup`처럼 대화형 전용 verb일 필요는
없다 — 기존 HIGH 확인(`user_commit_confirmed`)과 같은 성격이다.
🔴 **확인 시각은 실제 시계에서 읽는다**(REQ-2026-019 폐기 사유 재발 방지).
- `approve`는 **`sealed` && 모든 member terminal**일 때만 허용한다.
- `reopen`은 현재 상태를 바꾸는 것과 **별도로 append-only 이벤트**를 남긴다 — 상태만 갱신하면
  "승인이 있었다가 무효화됐다"는 사실이 사라진다.

### DEC-9 — D2/D11과의 관계 (실측 확인)
- **D11**(`req-doctor.ts`): `phase≠DONE`인데 `state.branch`가 `branchPrefix`로 시작 안 하면 FAIL.
- **D2**: `state.branch ≠ current`면 FAIL.

→ delivery 브랜치 위 작업은 **티켓이 활성이 아닌 시점**이어야 한다. `integrate`가 그 조건을 전제·검증하고
브랜치 전환을 스스로 수행하므로 사람이 D2/D11을 피해 다니지 않아도 된다(DEC-7의 근거).
**D2/D11 자체는 건드리지 않는다** — 그 게이트를 완화하면 티켓 작업이 엉뚱한 브랜치에서 일어날 수 있다.

### DEC-10 — `stopGate: "merge"`
enum에 값을 더하고, `req:next` 종단이 delivery 레코드를 읽어 판정한다.
🔴 **레코드는 delivery ref에서 읽는다**(DEC-3) — feature의 사본이 아니다.
묶음이 없거나 `open`이면 종단은 `DONE`(다음 REQ를 열 수 있다), `sealed`+전부 terminal이면 `AWAIT_HUMAN`.

🔴 **`req:next`는 게이트의 유일한 발생지가 아니다**(DEC-8a) — `integrate`·`seal`이 전이 직후 같은 판정을
같은 순수 함수로 낸다. 그러지 않으면 마지막 integrate 뒤 seal한 사용자는 게이트를 **영영 보지 못한다.**

### DEC-11 — 병합 실행은 하지 않는다 (C6)
`approve`까지가 이 REQ의 책임이고, 실제 `delivery → main`은 기존 I1/I2/B1에서 사람이 실행한다.
도구가 수동 `git merge`를 차단할 수 없다는 점도 변함없다 — 강제는 GitHub/GitLab 보호 규칙의 몫이다.

## Phase별 구현

| phase | 내용 | 코드 파일 |
|---|---|---|
| **phase-1** | 레코드 스키마 + 순수 판정(terminal 재귀·불변식) — **IO·verb 없음** | 2 |
| **phase-2** | verb + git 오케스트레이션(`create`/`begin`/`integrate`/`status`) | 3 |
| **phase-3** | `seal`/`approve`/`reopen` + `stopGate:"merge"` + `req:next` 종단 + 문서 | 6 |

## 변경 파일

- `scripts/req/lib/delivery.ts` **(신규)** — 스키마·순수 판정
- `bin/delivery.ts` **(신규)** — verb + git 오케스트레이션
- `bin/dispatch.mjs` — `delivery` 등록
- `scripts/req/lib/config.ts` · `workflow/req.config.schema.json` — `stopGate: "merge"`
- `scripts/req/req-next.ts` — 종단 분기
- `tests/unit/delivery.test.ts` **(신규)** 외
- `docs/*` · `CHANGELOG.md`

## 하위호환·안전

- **묶음을 안 쓰면 무영향**: `stopGate`가 `phase`/`req`면 delivery 코드 경로에 들어가지 않는다.
- **D2/D11 불변**(DEC-9): 브랜치 게이트를 완화하지 않는다.
- **충돌 = 거부**(DEC-2): 자동 해결이 없으므로 충돌 해결이라는 이름의 새 코드가 들어갈 수 없다.
- 🔴 **닫힌 묶음 불변**(DEC-2c): `sealed`·`approved`에는 member를 추가할 수 없다. 재개는 `reopen`뿐이다.
- 🔴 **통합 자격**(DEC-2b): 위상이 맞아도 **승인된 완료 REQ가 아니면 반영하지 않는다.** 이것이 없으면
  "feature에 미승인 변경 커밋 → integrate"가 리뷰 게이트를 통째로 우회한다.
- **증거 보존**(DEC-5): feature ref가 삭제돼도 감사 가능하다.
- **스키마 확장 가능**(DEC-4): 원장의 함정을 반복하지 않는다.
- 🔴 **릴리스 단위**: p1~p3를 한 릴리스로만 공개한다(부분 배포는 통합 불가한 묶음을 만든다).

### 미측정 (정직성 경계)

1. **`git merge --no-ff --no-commit`이 fast-forward 가능 상황에서 `MERGE_HEAD`를 세우고 레코드 수정분까지
   하나의 merge commit이 되는지** — phase-2의 **첫 수용 기준**으로 실측한다.
2. **delivery 브랜치와 기존 게이트 전체의 상호작용** — D2·D11은 코드로 확인했다(DEC-9).
   D3(branch 존재)·`review_base_sha`는 미확인이며 phase-2에서 확인한다.
