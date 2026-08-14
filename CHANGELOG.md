# Changelog

이 프로젝트는 [Semantic Versioning](https://semver.org/lang/ko/)을 따릅니다.

## Unreleased

- **fix: `hardCap` 이 안내하는 탈출구가 실행 불가였던 문제** — 상한에 닿으면 도구가 "종료하거나 정합한
  대체 REQ를 작성한다"고 안내하는데, `req:new --successor-of` 는 부모에 **사람의 대체 결정**이 기록돼
  있어야 진행합니다. 그 기록을 남기는 CLI 표면이 **없었습니다**(로직은 있었고 배선만 없었습니다).
  - `req:review-exception <REQ> --resolve replace --series "<id>" --reason "…" --confirm "…" --run` 신설.
    실행 직후 `req:new --successor-of` 가 다른 조작 없이 성공합니다.
  - 🔴 **`hardCap` 을 열지 않습니다.** 회차를 되돌리지도 늘리지도 않습니다 — 대체 REQ 는 새 티켓이고
    새 예산이며, 부모 이력은 lineage 로 보존됩니다.
  - `--series` 는 짐작하지 않습니다(한 티켓에 design·phase 가 동시에 열릴 수 있음). 잘못된 값에는
    **그 티켓의 열린 series 목록을 실제 값으로** 돌려줍니다.
  - `--reason`·`--confirm` 은 필수이며 **공백만이면 거부**합니다. 사유는 `note`, 승인 문장은 `method` 에
    각각 남습니다. 결정 시각은 **실제 시계**입니다.
  - 🔴 **남의 staged 파일은 커밋하지 않습니다.** 자기가 바꾼 `state.json` 만 커밋하고, 남은 것이 있으면
    **막는 경로를 실제 값으로 열거**하고 다음 명령을 줍니다.

  확인할 파일: `scripts/req/req-review-exception.ts` · `tests/unit/resolve-replace.test.ts` ·
  `docs/workflow.md`

- **docs: 이 저장소의 `stopGate` 를 `"auto"` 로 전환(도그푸딩)** — `auto` 는 **명시 opt-in** 이고,
  사전 위임(`req:delegate`)이 없으면 통합은 종전대로 막힙니다. 이 전환은 **이 저장소의 설정**이며
  도구 기본값이나 소비자 동작을 바꾸지 않습니다.
  - 전환 경로 실측: `req:new` 는 clean tree 를 요구하므로 config 를 먼저 바꿔도 티켓이 안 열립니다.
    티켓 안에서 config 를 바꾸고 **`req:repolicy <REQ> --run`** 으로 재채택하면 그 티켓부터 새 정책이
    적용됩니다(D32 드리프트는 WARN 이지 FAIL 이 아닙니다).
- **docs: REQ-2026-142 설계문서 정오표** — 완결 티켓의 본문은 고치지 않고 정오표 절만 덧붙였습니다.
  `PinnedInventoryItem` 필드명 · `resumeFrom` 값 3종 · 🔴 **없는 테스트 경로**(vitest 는 매칭 0건이어도
  exit 0 이라 초록이 거짓말을 합니다).

- **fix: 커밋이 증거 기록 도중 죽으면 안내하는 복구 명령 자체가 실행될 수 없던 문제** — `req:next`가
  `req:commit --finalize --run`을 안내하는데, 그 상황에서는 `approvals.jsonl`이 더러워 `D10`이
  그 명령을 막았습니다. **staged로 바꿔도 같았습니다**(`responses/`는 인덱스 여부와 무관하게 flag).
  (이 저장소가 도그푸딩 중 실제로 밟았습니다 — REQ-2026-140 phase-6.)
  - 🔴 **`D10`을 완화하지 않았습니다.** 승인 시점에 아카이브 목록(경로 + SHA-256)을 `state`에 못 박고,
    복구가 그것과 **바이트 단위로 일치할 때만** 정확히 그 파일들만 통과시킵니다. `--finalize` 플래그
    하나로는 아무것도 열리지 않습니다.
  - 목록에 없는 아카이브 주입·승인 이후 내용 변경·소스 파일 혼입·승인과 다른 tree·커밋된 매니페스트와의
    불일치는 전부 **거부**하고, 왜인지와 다음에 할 일을 알려 줍니다.
  - 어느 지점에서 죽었든 재실행이 남은 만큼만 이어서 하고 **수렴**합니다. 소비 상태만 미커밋인 창
    (예전엔 `approval_evidence`가 이미 사라져 복구가 원리적으로 불가능하던 구간)도 이제 풀립니다.
  - 🔴 **이 릴리스 이전에 승인받은 티켓에는 그 목록이 없습니다.** 근거가 없으므로 복구를 열지 않습니다
    (동작은 종전과 같음) — 재리뷰로 새 승인을 받으십시오.
  - 🔴 원장·`state.json`·`approvals.jsonl`을 손으로 고쳐 푸는 경로는 **만들지 않았습니다.**

  확인할 파일: `scripts/req/lib/evidence-recovery.ts` · `scripts/req/req-doctor.ts`(D10 배선) ·
  `scripts/req/req-commit.ts`(checkpoint 재개) · `docs/workflow.md`

- **fix: 리뷰 실행이 중간에 죽으면 그 티켓의 리뷰가 영구 차단되던 문제** — 원장에 `attempt-opened`만
  남아 다음 리뷰가 `리뷰 원장 무결성 실패(fail-closed)`로 막혔고, **빠져나갈 방법이 없었습니다.**
  (이 저장소가 도그푸딩 중 실제로 밟았습니다.)
  - `req:review-exception <REQ> --close-stale <series_id> --reason "…" --run` 신설. 원장에
    `attempt-closed`(판정 `abandoned`)를 남기고 `state`의 회차를 원장에 맞춥니다.
  - 🔴 **원장 행을 지우지 않습니다.** 그 회차에 호출은 실제로 나갔으므로 지우면 기록이 거짓이 됩니다.
    버렸다는 사실을 **더해서** 해소합니다. 사유는 필수입니다.
  - 🔴 **비용은 사라지지 않습니다.** 버린 회차는 `hardCap`에 그대로 남고 `autoBudget`에서만 빠집니다
    (`void_attempts` — 판정을 받지 못한 회차를 위한 기존 회계).
  - 🔴 **이 명령 자체가 중간에 죽어도 재실행이 수렴합니다.** 이미 기록된 행을 다시 만들지 않고 남은
    부분만 맞춥니다 — 그러지 않으면 고치려는 교착을 스스로 만듭니다.
  - 열린 회차가 여럿이면 가장 이른 것부터 닫습니다(재실행이 순서대로 해소).

- **fix: `req:delegate`가 dispatch 경계 계약을 어기고 있었습니다** — `runCli`를 export하지 않아
  `dispatch.test.ts`가 red였습니다. **전체 스위트에서만 드러나는** 종류의 배선 갭입니다.

- **feat: `stopGate: "auto"` — 사전 위임 범위 안의 검증된 변경을 자동 통합합니다** — 🔴 **"무제한 자동
  실행"이 아닙니다.** 값을 바꾸는 것만으로는 아무 권한도 생기지 않습니다. 권한은 설정이 아니라
  **커밋되는 append-only 원장**(`workflow/delegations.jsonl`)에서 나오고, 위임이 없으면 `merge`와
  똑같이 통합 직전에 멈춥니다.
  - `npx commitgate req:delegate` 신설 — 발급·철회(`--revoke`)·조회(`--status`). 승인 문장은 사람이 말한
    그대로 넘기고, **시각·SHA·만료는 도구가 읽습니다**(사람이 적을 자리가 없습니다). 만료 기본 12시간·
    상한 72시간 — 무기한 위임은 만들 수 없습니다.
  - 🔴 **위임이 있어도 막는 것**: `hardCap` 도달 · HIGH 위험(별도 `--high-risk` 없음) · BLOCKED/미판정 리뷰 ·
    trunk 이동 · 대상 브랜치 불일치 · **위임 범위 밖 티켓이나 delivery 레코드** · 귀속을 판정할 수 없는
    커밋이나 `attested` 커밋 · 이미 소비·철회·만료된 위임. 차단 지점에서 "모르겠음"은 통과가 아닙니다.
  - 🔴 **권한은 정확히 한 번 소비됩니다**(CAS). 소비 기록을 먼저 커밋하고 병합하며, 검증한 SHA와 병합할
    SHA 사이에는 **그 소비 커밋 하나만** 허용합니다. 실제 수행 결과는 별도 `executed` 행으로 남으므로,
    `executed` 없는 소비 행은 "소비했는데 결과를 모른다"는 정직한 중단 흔적입니다.
  - 🔴 **push·bypass는 기본 불허이고 서로 독립입니다.** `--allow-push` 없이는 로컬 병합까지만 합니다.
    push를 위임했다면 `--allow-bypass`도 필요합니다 — 병합으로 만들어진 merge SHA는 required check가
    돌아간 적이 없어 **push 자체가 우회**이기 때문입니다(CI를 실행해 통과했더라도 그것은 feature SHA에
    대한 검사입니다). 우회를 실제로 썼다면 원장과 최종 보고 양쪽에 남습니다.
  - **`auto`가 아닌 설정은 아무것도 달라지지 않습니다.** `phase`·`req`·`merge`에서는 이 축이 위임 원장을
    읽지도 않습니다.
  - 🔴 도구가 보장하지 **못하는** 것: 승인 문장이 실제로 사람에게서 왔는지는 검증할 수 없습니다
    (`req:confirm`과 같은 한계). 보장하는 것은 시각·SHA·만료·소비의 정직성입니다.

- **chore: 이 저장소가 리뷰 예산 `onSoftLimit: "auto"`를 채택합니다** — 🔴 **도구 기본값 변경이
  아닙니다.** 소비자 기본값은 그대로 `ask`이며, 바뀐 것은 CommitGate 저장소 자신의
  `req.config.json`뿐입니다. `stopGate: "merge"`로 자율 진행을 고르고도 예산 축이 `ask`라 소프트 한도
  초과 회차마다 멈추던 상태를 해소합니다(REQ-2026-135가 안내하던 바로 그 업그레이드입니다).
  - `hardCap`은 **그대로 8**입니다. `auto`가 없애는 것은 소프트 초과 회차의 사람 예외 승인 하나뿐이고,
    반복 백스톱은 남습니다 — 이 값을 늘리면 `auto`가 "무제한 자동"이 됩니다.
  - 🔴 **리뷰 예산은 정책 스냅샷 대상이 아니라 라이브로 읽힙니다** — 이미 진행 중인 티켓에도 즉시
    적용됩니다(`stopGate`와 다른 점입니다).

- **docs: 랜딩 README의 "사람이 멈추는 지점"이 실제 동작과 어긋나 있었습니다** — `docs/configuration*.md`는
  이미 정정돼 있었지만 **처음 읽는 사람이 보는 랜딩만** 옛 서술로 남아, 정본 문서와 반대를 말했습니다.
  - 🔴 **정지 축은 하나가 아니라 둘입니다.** `reviewBudget.onSoftLimit`(기본 `ask`)은 소프트 한도를 넘긴
    재리뷰 회차마다 사람 예외를 요구합니다 — `stopGate`를 `merge`로 두어도 거기서 멈춥니다. 랜딩이 축을
    하나로 적고 있어, 그렇게 멈춘 사용자는 이유를 어디서도 찾을 수 없었습니다. 두 번째 소절을 만들어
    `ask`·`auto`가 각각 어떻게 되는지와 `hardCap`이 **두 값 모두에서** 막는다는 것을 적었습니다
    (기본값·설정 방법은 `docs/configuration*.md`가 정본이므로 복제하지 않고 링크합니다).
  - 🔴 **`merge`는 delivery set이 없어도 멈춥니다.** 그때는 `req`와 같은 자리 — 그 REQ의 통합 직전 —
    입니다. 랜딩은 묶음 종료만 적고 있어 `merge`를 고르면 묶음을 만들기 전까지 정지가 아예 없다고
    읽혔습니다. 표 셀과 본문 양쪽에 두 경우를 담고, 용어집의 `delivery set` 행에도 묶음이 **선택**임을
    밝혔습니다.
  - "setup의 **세 번째** 질문"이라는 순서 표현도 걷어냈습니다 — setup은 이제 리뷰 예산도 묻습니다.
  - 위 두 오표현을 `RETIRED_CLAIMS`에 한·영으로 등재해, 같은 문장이 문서로 되돌아오면 테스트가 red입니다.
  - **첫 소개(흐름도·`:57`)에도 같은 배타 표현이 남아 있어 함께 고쳤습니다** — "중간에는 멈추지
    않는다"·"그 두 지점에서만"은 리뷰 예산 초과 회차의 사람 정지를 지웁니다. 바로 아래 줄이 이미
    "6~8회는 사람이 예외를 기록해야 한다"고 적고 있어 **같은 화면 안에서 앞뒤가 맞지 않았습니다.**
    지운 것은 "기본값에서 phase 커밋마다 부르지 않는다"는 사실이 아니라 예외를 함께 지우는 절대
    표현입니다. 한글 흐름도의 `여기서만`은 산문과 같은 주장이라 함께 고쳤습니다(영문 흐름도에는
    원래 배타 표현이 없었습니다). 이 문구들도 등재해 재발하면 red입니다.

- **feat: 기존 프로젝트도 `commitgate quickstart`로 자율 진행 계약을 받습니다** — 위 항목이 계약에 §4-1을
  넣었지만 `init`은 seed-once라 **이미 `AGENTS.md`가 있는 저장소에는 닿지 않았습니다**. "직접 반영하세요"라고
  적을 수밖에 없던 자리를 도구가 대신합니다. 관리 블록이 **집합**이 되어(`quickstart`·`autonomy`) 같은
  verb가 계약 블록도 동기화합니다.
  - ⚠️ **이름은 Quick Start에서 왔지만 이제 관리 블록 전체를 다룹니다** — help·`docs/upgrade*.md`·
    `docs/workflow*.md`·`docs/agent-prompt*.md`를 그 범위로 갱신했습니다.
  - 🔴 **마커가 손상된 파일은 아무것도 쓰지 않습니다.** 안전 판정을 블록별 개수가 아니라 **문서 전체 마커
    스트림**으로 합니다 — 두 블록이 교차 중첩되면 각 id는 "정상 쌍 1회"로 보이지만, 한 블록을 치환하면
    다른 블록의 마커와 **그 사이 사용자 내용이 함께 지워집니다**. 반쪽·중복·중첩·교차 전부 차단합니다.
  - 🔴 **계약 마커가 없는 `AGENTS.md`는 고치지 않되 조용하지도 않습니다.** 무엇을 `AGENTS.commitgate.md`
    (설치 시 놓이는 계약 사본)에서 옮기면 되는지 알려 주고, 사본이 없으면 얻는 법을 안내합니다.
  - 한 파일에 여러 블록이면 **한 번만 씁니다**(각 블록을 원본 기준으로 따로 쓰면 마지막 쓰기만 남아 한
    블록을 잃습니다). 블록 밖은 바이트 보존이고 재실행은 멱등입니다.
  - `req:doctor` **D21**이 **네 사유를 구별**합니다: 부재 · 드리프트 · 마커 손상 · 계약 아님.
    앞 둘에만 `quickstart --apply` 해소 명령이 붙습니다(뒤 둘은 그 명령으로 해소되지 않습니다).

- **docs+feat: `auto` 정책의 범위를 확정하고 기존 프로젝트의 업그레이드 경로를 열었습니다** —
  `onSoftLimit: "auto"`가 무엇을 없애고 무엇을 남기는지가 문서에 흩어져 있어, 특히 `hardCap`에서 멈추는
  것이 **정책 실패인지 설계인지** 구분되지 않았습니다. `docs/configuration*.md`의 리뷰 예산 절을 정본으로
  삼아 표로 확정했습니다(`workflow*.md`는 그 정본을 가리킵니다 — 표를 복사하지 않습니다).
  - 🔴 **`hardCap`은 비용 상한이 아니라 반복 백스톱입니다.** `autoBudget`은 판정을 낸 회차(productive)를
    세고 `hardCap`은 **나간 호출 수**(dispatched)를 셉니다 — 판정이 없던 회차도 소모되므로 유효 리뷰를
    `hardCap`번 받지 않고도 도달할 수 있습니다. 그래서 `auto`가 이 정지를 열지 않는 것은 설계입니다.
  - **자율 통합 값을 이때는 두지 않았습니다.** 통합 승인은 세 값 공통 불변식이고, 도구가 확인 기록을
    대신 만드는 방식은 시각 날조 표면을 되살리기 때문입니다. 같은 문서가 **정직한 유일한 형태는 작업
    시작 시점의 사전 위임 기록**이라고 적었고, 그것이 안전 속성 변경이라 별도 논의가 필요하다고 봤습니다.
    ⤷ **그 논의의 결과가 이 릴리스의 첫 항목입니다** — `stopGate: "auto"`가 정확히 그 사전 위임 형태로
    들어왔습니다. 근거는 뒤집히지 않았고, 그 형태를 실제로 구현한 것입니다.
  - **업그레이드 안내가 마찰을 겪는 자리에서 나옵니다**: `stopGate`가 `req`·`merge`인데 아직 `ask`라서
    소프트 예산에서 멈췄을 때, `req:next`가 그 정지를 끄는 방법을 함께 알려 줍니다. `hardCap` 도달에는
    **내지 않습니다**(설정으로 열리지 않는 정지를 열 수 있다고 말하면 거짓 안내입니다). 상시 진단으로
    만들지 않은 이유도 같습니다 — `ask`는 정당한 선택입니다.

- **fix: 정책 스냅샷이 "반쪽 동결"이던 결함 — 이제 두 축이 함께 동결됩니다** — 스냅샷은 `stopGate`만
  얼렸고 거기서 파생되는 `phaseCommit.autoApprove`는 `req:next`가 **현재 config에서 직접** 읽었습니다.
  그래서 스냅샷이 `merge`인데 config가 `phase`인 티켓은 **커밋 게이트는 통과시키는데 `req:next`는 매 phase
  멈추라고** 했습니다 — 한 티켓이 두 정책으로 판정됐고, "설정 변경과 무관하게 LOW phase를 순차 자동
  진행"이 정상 경로에서 깨졌습니다. `effectiveExecutionPolicy(state, cfg)`가 두 값을 함께 내고 `req:next`는
  config의 파생 축을 더 이상 읽지 않습니다(소스 검사로 고정).
  - 파생 규칙은 새로 만들지 않았습니다 — `AUTO_APPROVE_OF`(기존 번역표)가 그대로 SSOT입니다. 스냅샷에는
    계속 `stop_gate` **하나만** 저장합니다(두 값을 저장하면 저장 시점에 갈라질 자리를 새로 만듭니다).
  - 스냅샷 없는 **legacy 티켓은 완전 무변경** — 두 축 모두 현재 config를 따릅니다.
  - 회귀는 실 git에서 `req:next` **main을 태워** 4종(교차 2 + legacy 2)을 고정합니다. 순수 함수는 이미
    옳게 동작했으므로 순수 테스트만으로는 이 결함을 잡을 수 없었습니다.

- **feat: `commitgate setup`이 정지 지점을 정확히 말하고 예산 정책도 묻습니다** — 설정을 고르는 화면이
  `merge`를 "묶음이 끝날 때까지 미룸"이라고만 설명해, **묶음이 없으면 `req`처럼 통합 직전에 멈춘다**는
  사실이 빠져 있었습니다. 같은 화면의 고지 문구와 `docs/configuration*.md`의 설정 표도 함께 정정했습니다 —
  값 설명만 고치면 한 화면에서 상반된 두 문장을 동시에 보게 됩니다.
  - 질문이 셋에서 **넷**으로 늘었습니다: `reviewBudget.onSoftLimit`이 추가됩니다. `stopGate`로 자율 진행을
    골라도 예산 정지는 따로 끼어드는데, 그 축은 `req.config.json`을 직접 편집해야만 닿았습니다 —
    "사람이 멈추는 지점"을 묻는 화면이 정지를 만드는 축 하나를 빠뜨리면 setup을 마쳐도 여전히 끊깁니다.
  - `autoBudget`·`hardCap`은 **묻지 않고 기존 값을 보존**합니다(setup이 사용자가 조정한 값을 덮지 않습니다).
  - 정지 지점 고지가 **`stopGate` 질문에만** 붙습니다(예전 조건은 "null을 못 받는 키"라는 간접 조건이라,
    새 질문에도 엉뚱하게 붙었을 것입니다).

- **feat: 리뷰 소프트 예산 초과 처리를 고를 수 있습니다 — `reviewBudget.onSoftLimit`** — `stopGate`를
  `req`·`merge`로 두고 자율 진행을 설정해도, 리뷰가 `autoBudget`(기본 5)을 넘는 순간 워크플로가 **매 회차**
  멈췄습니다. 그 정지는 `stopGate`가 정한 것이 아니라 예산 축이 따로 만든 것이라, 사용자가 고른 정지 지점과
  무관하게 끼어듭니다. 이제 `"auto"`로 두면 6~8회차가 사람 승인 없이 진행됩니다(기본은 `"ask"` — 현행 유지).
  - 🔴 **`hardCap`은 두 값 모두에서 그대로입니다.** `auto`는 무한 재시도가 아니라 6~8회차의 사람 확인
    생략이며, 이 정지는 **비용 통제이지 안전 게이트가 아닙니다** — 리뷰 승인·증거·통합 통제점은 불변입니다.
  - 원장에 `soft_limit_resolution`(`exception`/`policy`)을 남깁니다. `exception_consumed`의 의미는 넓히지
    않았습니다 — `policy`일 때 그 값은 `false`입니다(정책 통과가 사람 승인으로 위장하면 안 됩니다).
  - `auto`에서 `req:review-exception`은 예외를 **부여하지 않습니다**(소비될 일 없는 승인 기록 방지).
  - 기존 `{"autoBudget":3,"hardCap":6}` 설정은 **그대로 유효**하고 `onSoftLimit`는 `ask`로 채워집니다
    (로더가 `reviewBudget`을 키별로 병합하도록 바꿨고, 스키마는 새 키를 `required`에 넣지 않았습니다).

- **docs: 계약이 "언제 묻지 않는가"를 명시합니다** — 정지 지점은 `stopGate` 하나가 정하도록 도구를 정리했지만
  (아래 두 항목), 끊김의 나머지 절반은 **에이전트 계층**이었습니다. 계약이 "`AWAIT_HUMAN`이면 멈춘다"만
  말하고 `RUN`일 때 물어봐도 되는지를 말하지 않아, 같은 설정에서 같은 워크플로가 세션마다 다르게
  끊겼습니다. 이제 `AGENTS.template.md`가 `RUN`·`AGENT`·`DONE`에서 묻는 것을 계약 위반으로 규정하고,
  멈추는 자리를 **예외 9항목**으로 못 박습니다.
  - 🔴 **예외는 `kind`가 아니라 행위로 판정합니다.** `req:rebind`처럼 확인 문장을 요구하는 명령은
    `AGENT` 상태의 **진단 줄**로 나올 수 있어, `kind`만 보면 에이전트가 사람의 확인 문장을 대신 쓰게 됩니다.
  - 설계 **정정**(같은 목표·방법 수정 → 자율 + 재승인)과 **범위 변경**(`00-requirement.md`가 바뀜 → 사람)의
    경계를 세웠습니다. 이 경계가 없어 기존 "설계 범위 변경은 보고" 규칙과 자율 진행이 정면 충돌했습니다.
  - 권장안 채택 기록은 **사람 확인이 아닙니다** — `user_commit_confirmed`는 `req:confirm`만이 씁니다.
  - `docs/agent-prompt*.md`의 "사람 전용 명령" 표에서 `req:confirm`을 뺐습니다. 그것은 **통제점**이지
    사람 전용 명령이 아닙니다(계약의 사람 전용 표에는 `commitgate setup` 하나뿐이고, `req:next`는 그 명령을
    에이전트가 실행하도록 출력합니다) — 두 문서가 서로 다른 말을 하고 있었습니다.
  - ⚠️ **기존 `AGENTS.md`는 자동으로 갱신되지 않습니다**(`init`은 파일이 없을 때만 생성). 새 계약을 받으려면
    기존 파일에 해당 절을 직접 반영하세요.

- **feat: delivery 묶음의 통합 승인이 "그때 그 내용"에 결속됩니다** — 승인은 `state: "approved"` 플래그
  하나여서, 승인 뒤 묶음 브랜치에 커밋이 더 들어와도 게이트가 조용했습니다. 사람은 "승인했다"고 기억하지만
  **승인한 것과 다른 내용**이 main으로 갈 수 있었습니다(phase 층에는 이미 같은 결속이 있습니다 — D9·
  `approved_tree` provenance). 이제 `approve`가 승인 직전 묶음 tip을 남기고, 이후 **레코드 밖을 건드린
  커밋**이 있으면 `AWAIT_HUMAN`(재승인)이 됩니다. 재승인은 `reopen` → `seal` → `approve` 순서입니다.
  승인이 만드는 레코드 커밋은 제외되므로 승인이 자기 자신을 무효화하지 않습니다. 결속이 없는 옛 레코드는
  그대로 통과합니다(소급 요구 없음).
- **feat: `commitgate integrate`가 stale·미승인 묶음의 병합을 막습니다** — 소스가 `delivery/*`면 그 묶음의
  승인이 병합 인가입니다. 기본 `branchPrefix`에서는 delivery 브랜치가 전제에서 걸러지지만
  `branchPrefix: "delivery/"`는 지원되는 설정이라 병합 지점까지 도달할 수 있어, 소스 브랜치 이름으로
  판정합니다. 이 지점에서는 **확인 불가가 통과가 아닙니다**: 미승인(`open`·`sealed` 미종결)·레코드 파싱
  실패·승인 결속 확인 불가(`base_sha`가 이력에 없음)·레코드의 `branch`가 소스와 불일치는 전부 차단합니다.
  (안내 지점인 `req:next`·`delivery status`는 반대로 판정 불가를 무판정으로 둡니다 — git이 잠깐 실패했다고
  멀쩡한 승인을 무효화하지 않기 위해서입니다.)

- **feat: 티켓은 만들어질 때의 `stopGate`로 끝까지 갑니다(정책 스냅샷)** — 게이트가 매번
  `req.config.json`을 다시 읽어, phase-1·2를 `phase`로 확인받고 중간에 설정을 `merge`로 바꾸면 나머지가
  확인 없이 자동 커밋됐습니다. **이미 받은 확인의 의미가 사후에 바뀌는** 상태였고, 완료된 티켓의 증거만
  보고 어떤 정책으로 진행됐는지 알 수도 없었습니다. `req:new`가 해소값을 `state.policy_snapshot.stop_gate`에
  고정하고 게이트 다섯이 그 값을 봅니다. 스냅샷이 없는 기존 티켓은 예전처럼 config를 따릅니다(무회귀).
- **feat: `commitgate req:repolicy`** — 진행 중 티켓에 현재 config 정책을 채택합니다. 스냅샷만 넣고 이 경로를
  빼면 정책을 바꾼 사용자의 티켓이 옛 정책에 영구히 갇힙니다(REQ-2026-072·093에서 겪은 교착의 재발).
  🔴 게이트 우회가 아닙니다 — 바뀌는 것은 정지 지점뿐이고 기록된 확인은 지워지지 않습니다. 채택 이력은
  append-only이며 시각은 실제 시계에서 읽습니다.
- **feat: `req:doctor` D32(WARN)** — 티켓 스냅샷과 config가 다르거나 스냅샷이 손상됐으면 알리고 채택 명령을
  안내합니다. FAIL이 아닙니다 — 정책 변경은 정당한 행위이고, 게이트가 이미 스냅샷을 쓰므로 판정은 일관합니다.
- **fix: 자유 텍스트 옵션이 플래그를 값으로 삼키던 결함** — `req:confirm --method --run`처럼 값 자리에 온
  **알려진 옵션**이 승인 문장·사유로 해석돼, DRY-RUN 의도가 실제 기록으로 바뀔 수 있었습니다. 모든 대시를
  거부하지는 않습니다(정당한 `-이유`는 그대로 값) — 이 CLI가 해석하는 플래그만 값 누락으로 봅니다.

- **fix: `stopGate: "merge"`가 delivery 묶음 없이도 통합 직전에 멈춥니다** — 묶음에 속하지 않은 REQ의
  `req:next` 종단이 `DONE`이라, **가장 늦게 멈추겠다고 고른 값이 오히려 아무 데서도 멈추지 않았습니다**
  (같은 자리에서 `req`는 `AWAIT_HUMAN`을 냅니다). 이제 묶음이 없으면 `req` 종단과 **같은**
  `AWAIT_HUMAN`(통합 feature→main)입니다. 묶음이 **살아 있으면**(열려 있거나 다른 member가 남음) 종단은
  그대로 `DONE`입니다 — 그건 이 값의 존재 이유이므로 바꾸지 않았습니다.
- **fix: `merge` + 묶음 없음에서 HIGH 사람 확인이 아무 게이트에도 걸리지 않던 공백을 닫았습니다** —
  `merge`는 커밋을 막지 않고(`userConfirmGate`) 묶음 확인은 `delivery integrate`에서만 요구되므로,
  묶음이 없는 HIGH 티켓은 확인 기록 **0건**으로 통합 지점에 도달할 수 있었습니다. 이제 종단이
  `req:confirm --scope req`를 먼저 요구합니다. `req`에서는 이 요구를 켜지 않습니다 — 그 값은 REQ를
  완성시키는 커밋에서 이미 확인을 받고 **소비**하므로 종단에서 다시 물으면 같은 확인을 두 번 받는 셈입니다.
- **refactor: 확인 `scope` 판정을 상수표에서 함수로 승격했습니다**(`requiredConfirmScope`) — `merge`가
  요구하는 scope는 **delivery 묶음 소속에 따라 갈리는데**(속함=`delivery`·없음=`req`) 표는 그 조건을 담지
  못했습니다. `req:next`(안내)·`req:commit`(게이트)·`req:confirm`(입력 검증)·`delivery integrate`(자격검사)
  네 곳이 이 함수 하나를 공유합니다. 오버로드로 `merge`를 포함한 호출부는 묶음 맥락을 **반드시** 주게 해,
  조기 반환이 사라지면 조용한 오답 대신 타입 에러가 나도록 했습니다.
  - 부수 효과로 안내와 도구의 불일치가 사라집니다 — 이전에는 종단이 `--scope req`를 안내해도
    `req:confirm`이 `delivery`만 받아 **실행할 수 없는 명령**을 안내할 수 있었습니다.
  - `readDeliveryGate`·`mentionsMember`가 `lib/delivery.ts`로 이동했습니다(`req-next` re-export 유지).

## 0.22.0 (2026-08-11)

> **통합 seam이 생겼습니다 — 검사가 실제 merge와 결속됩니다.** `commitgate integrate`가 통합 직전
> 절차(항상-strict 심층 증거 검증 → GitHub CI **실행** opt-in → 사람 확인 → **검증한 SHA만 병합** →
> 감사 로그)를 소유하고, `commitgate attest`가 정당한 예외를 기록하며, report는 범위 옵션과 함께
> 크게 빨라졌습니다(아래 실측).
> GitHub CI는 여전히 **기본 실행하지 않습니다** — 조회(`--check-github-ci`)와 실행(`--run-github-ci`)이
> 이름부터 분리됐고, 실행은 사용자 소유 config(`githubCi.workflow`) + 명시 요청에서만 일어납니다.
>
> **업그레이드**(0.20/0.21에서 — caret는 minor를 자동으로 넘지 않습니다. 상세: `docs/upgrade.md` 0.22 절):
>
> ```sh
> npm install -D commitgate@^0.22.0        # lockfile도 함께 갱신됨 — 커밋에 포함 확인
> npx commitgate sync --apply --gitignore  # 새 로컬 로그 규칙(.verify-runs/.integrate-runs) 백필
> npx commitgate check
> npx commitgate report
> ```
>
> breaking 없음(스키마 additive·기존 명령·로그 하위호환 — `--github-ci`는 deprecated alias로 유지).
> rollback: `npm install -D commitgate@0.21.0`(자산·로그는 그대로 둬도 됨 — 구버전이 무시).
> 별도 0.21.1은 없습니다 — 0.21.0의 긴급 정정(gitignore 백필 안내·CI 용어)도 이 릴리스에 포함됩니다.

- **fix: 배포 계약 템플릿의 릴리즈 전제(`verify-range --strict`)를 복원했습니다** — CI green 전제를
  걷어내면서, 그 자리에 들어갔어야 할 `npx commitgate verify-range --strict` 전제를
  `AGENTS.template.md`에만 넣지 않았습니다. `docs/RELEASING.md`와 `ssot-design/04`에는 있었지만
  **실제로 소비자에게 배포되는 템플릿**에는 "반영 이후 각각 따로 요청한다"만 남아, 릴리즈 전제가
  통째로 사라진 상태였습니다(빌드된 tarball에서도 확인). **GitHub CI가 선택인 것과 로컬 strict 검증이
  필수인 것은 다른 축인데** 한 번의 편집으로 둘 다 없어졌습니다. R1/R2/R3 문장에 strict 통과 전제와
  "GitHub CI green은 전제가 아니다"를 함께 넣고, 두 검사를 같은 것으로 취급하지 말라는 주의도 붙였습니다.
- **fix: 배포 템플릿의 옛 승인 명칭을 정정했습니다** — 통제점표에 존재하지 않는
  `merge/push 승인`·`required status checks bypass 승인`이 승인 범위 설명에 남아 있어, 사용자가 받아야 할
  승인 문장을 잘못 말하게 할 수 있었습니다. 현재 정본 두 문장으로 바꿨습니다:
  `검증 결과 확인 후 PR merge 승인`(I2)은 `branch protection bypass를 사용한 direct push 승인`(B1)이 아니다.
- **test: 배포 템플릿의 릴리즈 전제를 두 조건으로 함께 고정합니다** — ① R1/R2/R3 전에 strict가 요구되고
  ② CI green은 릴리즈 전제가 **아니어야** 한다는 것을 한 테스트 묶음에서 검사합니다(한쪽만 보면 이번
  결함을 놓칩니다). 강조 표시에 의존하지 않도록 정규화 후 줄 단위로 비교하며, 옛 승인 명칭이 템플릿으로
  되돌아오면 red입니다. 전제가 빠진 R1/R2/R3 문장과 옛 승인 명칭은 폐기 주장으로 등재해 소비자
  `AGENTS.md`에서도 **C5 WARN**으로 잡히고, **정본 문장에서는 OK**임을 경계 테스트로 고정했습니다.
- **fix: "CommitGate가 CI를 실행하지 않는다"와 "이 저장소의 CI가 자동 실행되지 않는다"를 구분합니다** —
  업그레이드 문서가 소비자에게 "push·tag·pull_request로 자동 실행되지 않습니다"라고 적고 있었습니다.
  그것은 **CommitGate 저장소 자신의 `ci.yml`** 에 대한 사실이지 소비자 저장소에 대한 사실이 아닙니다.
  실제로 검증한 세 소비자 저장소는 **전부 자동 트리거 워크플로를 갖고 있습니다**(ci.yml의 push/PR,
  일부는 `v*` tag push). CommitGate가 보장하는 것은 **자동 dispatch를 하지 않는다**와
  **CI green을 merge·publish의 전제로 강제하지 않는다** 두 가지뿐이며, 저장소 자체 워크플로가
  CommitGate와 무관하게 도는 것은 **막지 못합니다**. 비용을 완전히 통제하려면 그 저장소의
  `.github/workflows/*.yml` 트리거를 따로 점검해야 하고, CommitGate는 프로젝트 소유 워크플로를
  만들거나 고치지 않습니다. 한/영 업그레이드 문서와 폐기 주장 사유 문구를 이 구분에 맞게 고쳤습니다.
- **fix: C5 WARN이 "무엇을 고쳐야 하는지"를 알려줍니다** — 사유(why)만 내고 **발견한 실제 문장**을
  보여주지 않아, 사용자가 자기 파일 어디를 고쳐야 하는지 알 수 없었습니다. 이제 파일별로
  `파일명: "찾은 문장"` + 사유를 줄로 나눠 보여주고, I2 정본 문장과 정확한 비교 경로
  `node_modules/commitgate/AGENTS.template.md`를 함께 냅니다. CLI 출력이므로 Markdown 강조 기호(`**`)를
  쓰지 않습니다(터미널에 기호가 그대로 보입니다). 저장소 자체 워크플로가 자동 실행될 수 있다는 주의도
  같은 메시지에 넣었습니다. 사람용·`--json` 출력은 계속 같은 `CheckReport`에서 파생합니다.
- **fix: 완료 조건에 CI green을 둔 옛 문장을 폐기 주장으로 등재했습니다** — 소비자(lean_lms) `AGENTS.md`의
  "완료 정의" 절에 CI green이 완료 조건으로 들어 있었습니다. 통제점표가 아니라 다른 절이라 기존 항목에
  걸리지 않았습니다. CI 실행이 선택인데 완료 조건에 green을 두면 **CI를 돌리지 않는 정상 경로에서 티켓을
  끝낼 수 없다**는 말이 됩니다. 일반적인 `CI green` 부정문(정정문)까지 오탐하지 않도록 완료 조건 문맥이
  붙은 핵심 구절만 등재했고, 오탐 경계 테스트를 함께 넣었습니다.
- **feat: `commitgate check` C5 — 업그레이드 후 남은 옛 계약 문서를 알려줍니다** — 소비자 세 곳에
  0.22.0을 실제로 설치하고 `sync --apply --gitignore`를 돌려도 `AGENTS.md`에는 0.21 계약이 그대로
  남았습니다. `sync`가 **사용자 소유 파일을 덮어쓰지 않기 때문**이고, 그 정책은 유지해야 합니다
  (프로젝트 고유 규칙이 섞여 있어 자동 교체는 그 내용을 지웁니다). 그래서 고치는 대신 **알립니다**:
  `AGENTS.md`·`AGENTS.commitgate.md`에 폐기된 CommitGate 서술이 있으면 **C5 WARN**이 뜨고, 파일명·발견한
  사유·현행 정책·수동 병합 안내를 함께 냅니다. **WARN이지 FAIL이 아니라** 기존 소비자의 작업·커밋을
  막지 않습니다(`check` exit 0 유지). 판정은 `retiredClaimsIn` **정본을 그대로 재사용**하므로 목록 사본이
  생기지 않고, 강조·줄바꿈 정규화도 그대로 적용됩니다. `check`는 어떤 파일도 쓰지 않습니다.
  C1~C4의 의미·순서·exit 계약은 그대로이며 C5는 뒤에만 붙습니다(additive).
- **fix: `req:next`의 delivery 경로가 옛 I2 문장을 내고 있었습니다** — 일반 통합 경로는 정본 문장으로
  고쳤는데 delivery 묶음 경로에는 CI green을 전제한 옛 축약형이 남아 있었고, 등재된 폐기 주장과
  **표현이 달라** 문서 가드까지 통과했습니다. 두 경로의 안내를 `scripts/req/lib/control-points.ts`의
  **한 상수에서 파생**하도록 바꿔 다시 갈라질 수 없게 했고, 옛 축약형도 폐기 주장으로 등재했습니다.
  회귀는 문자열 검사가 아니라 **실제 `resolveNext` 결과를 보는 행동 테스트**로 고정합니다 —
  문자열 등재만으로는 다음 변형을 막지 못한다는 것이 이번 사례의 교훈입니다.
  폐기 주장 스캔 범위에 **안내를 만드는 코드 표면**(`control-points.ts`·`req-next.ts`·`check.ts`)도 넣었습니다.
- **docs: 업그레이드 문서에 계약 병합 절차를 추가했습니다** — `sync --apply --gitignore`는 스키마와
  gitignore만, `quickstart --apply`는 관리 Quick Start 블록만 다루며 **`AGENTS.md`의 계약 본문은 갱신하지
  않는다**는 사실, `check`의 C5 WARN을 확인하라는 안내, 그리고 파일을 통째로 바꾸지 말고
  `AGENTS.template.md`와 비교해 **CommitGate 계약 부분만 손으로 병합**하라는 절차를 한/영 문서에 넣었습니다.
- **fix: GitHub workflow `path@ref` 형식을 받아들이고, workflow 대조를 전체 경로로 합니다** —
  workflow-run 응답의 `path`는 `.github/workflows/ci.yml` 뿐 아니라
  `.github/workflows/ci.yml@main` · `…@refs/heads/feat/x` 형태로 올 수 있습니다. 예전 구현은
  **basename만** 비교해서 두 방향으로 틀렸습니다: `@ref`가 붙은 정상 응답을 **거부**했고(요청한 CI가
  green이어도 병합이 막힘), 반대로 `other/ci.yml`·`.github/workflows/subdir/ci.yml`처럼 **이름만 같은
  다른 파일을 통과**시켰습니다. 이제 `@` 뒤 ref 표현만 떼고 `.github/workflows/<workflow>` 전체 경로로
  대조합니다(브랜치 축은 `head_branch`가 이미 따로 검증합니다). 정상 경로 fake fixture도 공식 응답과
  같은 `path@ref` 형태로 바꿔, 일반 성공 테스트가 이 계약을 **항상** 지나게 했습니다.
- **fix: 검증 범위(merge-base)도 고정한 trunk SHA로 계산합니다** — `collect()`가 `trunkHeadSha`를 읽어
  토큰에 저장해 놓고, 정작 범위는 `git merge-base <trunkBranch> <head>`로 **브랜치 이름**을 넘겨
  계산하고 있었습니다. 두 호출 사이에 trunk가 움직이면 토큰이 결속한 SHA 쌍과 **다른 범위**를 검증한
  것이 되고, trunk가 feature를 이미 삼킨 위치라면 범위가 **빈 집합으로 축소**되기까지 합니다.
  이제 `featureHeadSha`·`trunkHeadSha`·`mergeBaseSha`·`verificationSummary` 네 값이 모두 같은 SHA 쌍에서
  파생되며, 검증 함수에는 정확히 `mergeBaseSha..featureHeadSha`가 전달됩니다. trunk가 A→B→A로 움직이는
  ABA 상황도 고정 SHA 기준을 유지합니다(실 git 테스트 포함).
- **refactor: `IntegrationCoordinator`의 공개 표면을 `collect()`·`merge()` 둘로 줄였습니다** —
  `revalidate`는 private입니다. 재검증은 병합의 일부이지 호출자가 따로 부를 단계가 아니며,
  공개해 두면 "재검증만 하고 그 결과로 다른 판단을 하는" 사용법이 생겨 TOCTOU 창이 다시 열립니다.
- **fix: dispatch 빈 응답 안내에서 원인을 단정하지 않습니다** — 구현은 `gh workflow run`이 아니라
  raw `gh api`를 쓰므로, 빈 응답을 곧바로 "gh 버전 문제"로 단정하던 문구는 정확하지 않았습니다.
  이제 `return_run_details` 미지원 API 버전/서버(GitHub Enterprise Server 등) 가능성을 먼저 알리고,
  확인할 항목(서버 지원 여부 · 요청한 API 버전 · gh 버전)을 나열합니다. 동작은 그대로 fail-closed입니다.
- **fix: `npm test`가 각 테스트 파일을 정확히 한 번만 실행합니다** — `vitest.workspace.ts`가
  `extends`로 base config를 상속했는데, vitest는 `include` **배열을 덮어쓰지 않고 이어붙입니다**.
  그래서 integration 프로젝트가 등재 목록이 아니라 **전체 파일**을 골랐고, `npm test`는 고유 77파일을
  **138번** 실행했습니다(fast 61 + integration 77). 인프라 값을 `vitest.shared.ts`로 분리하고 두
  프로젝트에서 명시적으로 공유하며 `extends`를 제거했습니다. 실측: **77파일 · 2919 tests · 308초**
  (이전 138파일 실행 · 521초). 계층 가드도 정의 검사에 더해 `vitest list`로 **실제 선택 결과**를
  확인하도록 바꿨습니다 — 구조만 보던 예전 가드는 이 결함을 통과시켰습니다.
- **docs: `I2` 승인 문장을 선택 CI 정책과 일치시켰습니다** — `required checks green 확인 후 PR merge 승인`은
  CI를 실행하지 않은 **정상 경로에서 사실대로 쓸 수 없는** 문장이었습니다(확인한 green이 없는데
  green을 확인했다고 말해야 함). 정본 문장은 **`검증 결과 확인 후 PR merge 승인`** 입니다. 멈추는 시점은
  "필수 로컬 검증 결과를 확인하고, CI를 실행했으면 그 결과도 함께, 실행하지 않았으면 생략 사실을 보고한 뒤"로
  명시했습니다. 옛 문장은 폐기 주장으로 등재해 되살아나면 테스트가 red입니다.
- **docs: SSOT의 남은 자동 CI 서술을 정정하고, 역사 기록은 보존했습니다** — `ssot-design` 04·10·11·README의
  "트리거 = push/tag/pull_request", "CI green이 publish·I2·R1~R3의 선행조건", "경로 B에서 CI는 사후 검증"
  서술을 현재 정책으로 바꿨습니다. 반면 **역사 문서는 지우지 않습니다**: `13-review-and-validation-log.md`와
  `docs/follow-ups-design.md`는 당시 사실·제안을 그대로 두고 **"현재 정책이 아님" 표지**만 덧붙였으며,
  폐기 주장 검사 대상에서 제외하되 그 표지가 사라지면 테스트가 red가 되도록 고정했습니다.
- **test: 폐기 주장 검사가 강조 표시·줄바꿈으로 우회되지 않습니다** — 축자 부분 문자열만 보던 매처가
  `**CI는 push 이후에** 돈다`처럼 강조를 끼우거나 문장을 두 줄로 접으면 통과했습니다. 이제 검사 대상과
  등재 문자열 양쪽을 정규화(마크다운 강조·코드 표시 문자 제거 + 공백 압축)해서 비교하며,
  가드가 실제로 문다는 것을 변이 검사로 증명합니다. 어미 변형(`돈다`↔`돕니다`)까지 잡지는 못하므로
  필요한 변형은 계속 별도 항목으로 등재합니다(정직한 한계 표기).
- **정책: GitHub CI는 이 저장소에서도 수동 실행 전용이 됐습니다** — `.github/workflows/ci.yml`이
  `workflow_dispatch` **하나만** 트리거로 갖습니다. 예전에는 `push: branches:[main] + tags:['v*']`와
  `pull_request`가 걸려 있어 커밋 하나에 3 OS × 3 Node = 9잡이 자동으로 돌았습니다 — "평소 CI 0회,
  사람이 지시할 때만" 정책과 정반대였고, 문서는 그 정책을 적고 파일은 반대로 동작하고 있었습니다.
  이제 실행 경로는 `gh workflow run ci.yml --ref <branch>` 또는
  `commitgate integrate --run --run-github-ci` 둘뿐입니다. 3 OS × 3 Node 검증 내용은 그대로 유지됩니다.
  트리거 계약과 결정 행렬(Enter/n/y·config 유무·비대화형·`--no-github-ci`)은 회귀 테스트로 잠갔습니다.
  🔴 소비자 프로젝트에는 아무 영향이 없습니다 — CommitGate는 여러분의 워크플로 파일을 만들지도
  고치지도 않고, `req.config.json.sample`에 `githubCi`를 넣지 않습니다(CI 설정은 사용자 소유 opt-in).
- **fix: GitHub CI run을 추정하지 않고 dispatch 응답의 id에 결속합니다** — dispatch 요청에
  `return_run_details=true`(boolean)를 실어 응답의 `workflow_run_id`만 사용합니다. 예전에는 dispatch 뒤
  `created_at`·`head_sha`로 실행 **목록을 뒤져** 이번 run을 추측했고, 같은 SHA에서 동시 실행이 있으면
  원리적으로 갈라졌습니다. 목록 추정 경로는 **삭제**했습니다(포트에 `listRuns`가 없어 fallback을 둘
  자리 자체가 없습니다). id를 못 받으면(구형 API·`gh` < v2.87.0) 조용히 다른 방법으로 넘어가지 않고
  실패합니다. 조회한 run은 매 폴링마다 head SHA·`event=workflow_dispatch`·브랜치·워크플로가 요청한
  것과 같은지 대조합니다. `Accept`·`X-GitHub-Api-Version` 헤더도 명시합니다.
- **fix: 명시 요청한 CI에서 `success`만 통과입니다** — `skipped`(요청한 검사가 실행되지 않음)와
  `neutral`(판정 없음)을 더 이상 green으로 세지 않습니다. 이 축은 기존 **조회** 축
  (`verify-range --check-github-ci`)보다 의도적으로 엄격합니다 — 저쪽은 남이 만든 기존 체크 묶음을
  읽는 것이고, 이쪽은 우리가 방금 하나를 돌려 그 결과로 병합을 결정하기 때문입니다.
- **fix: 검증한 SHA와 실제 병합 SHA를 원자적으로 결속합니다(가장 중요한 수정)** — 예전 `integrate`는
  feature HEAD **SHA**를 검증해 놓고 마지막에 브랜치 **이름**을 병합했습니다. 그 사이에는 CI 대기(최대
  `timeoutMinutes`분)와 사람의 [y/N] 확인이 있어, 그동안 다른 창에서 커밋 하나가 얹히면 **검증하지 않은
  커밋이 trunk로 들어갈 수 있었습니다.** trunk 쪽 이동도 무방비였습니다. 이제 증거 검증을 통과하면
  feature/trunk 두 SHA를 결속하고(`PreparedIntegration`), 병합 직전에 현재 브랜치·양쪽 ref·워킹트리
  clean·merge/rebase 진행 여부를 **다시** 확인합니다. 하나라도 바뀌었으면 병합하지 않고 재실행을
  안내합니다. 병합 자체는 `checkout --detach <trunkSHA>` → `merge --no-ff <featureSHA>` →
  **부모가 그 두 SHA인지 대조** → `update-ref refs/heads/<trunk> <merge> <oldTrunk>`(**비교·교환**)
  순서라, 재검증과 갱신 사이에 trunk가 움직여도 교환이 거부되고 trunk는 그대로 남습니다. 실패·충돌에서는
  `merge --abort` 후 원래 feature 브랜치로 복귀합니다(자동 reset·stash·push 없음). 감사 로그에
  `feature_head_sha`·`trunk_head_sha`·`merge_parents`가 추가됩니다(additive). 실 git 저장소에서
  ref 이동·CAS 거부·충돌 복구·**검증하지 않은 SHA가 병합되지 않음**(변이 테스트)을 검증합니다.
- **refactor: `bin/integrate.ts`가 인자 파싱·질문·출력·감사 로그만 합니다** — 준비 토큰 생성·재검증·
  CAS 병합은 `lib/integration-coordinator.ts`가, 전제·strict 판정은 기존 `lib/merge-gate.ts`가 소유합니다.
- **feat: `commitgate report`가 검증 불가 사유를 알려줍니다** — verify-range 수집 실패를 null로 삼켜
  "판정 불가"만 남기던 동작을 고쳤습니다. `verification_available`(boolean)과
  `verification_unavailable_reason`(안정 문자열 — 예: `base ref not found: v9.9.9`)이 JSON에 **추가**되고
  사람용 출력도 같은 사유를 보여줍니다. **기존 필드는 제거·변경되지 않았습니다**(계산 실패 시
  `evidence` 섹션이 부재하는 동작도 그대로).
- **test: 외부 호출 경계를 목록으로 고정합니다** — `COMMITGATE_TEST` kill switch는 **현재 알려진**
  production 외부 호출 경로(codex·gh·`git ls-remote`·`fetch`)를 막습니다. 모든 미래 호출을 막는 보편적
  샌드박스가 아니므로, 프로세스를 스폰하거나 원격·과금 대상을 다루는 production 파일의 allowlist를
  메타 테스트가 유지합니다 — 목록 밖에서 그런 코드가 생기면 red입니다. **로컬 git은 막지 않습니다**
  (정상 동작이고 원격 효과가 없습니다). 실제 codex를 호출하는 수동 도구
  `scripts/verify-review-overrides.mjs`에도 같은 env 가드를 넣었습니다.
- **docs: SSOT와 구현을 다시 맞췄습니다** — 문서가 코드보다 늦어 있던 서술을 전수 정정했습니다.
  이미 구현됐는데 "없다"고 적혀 있던 것: 리뷰 전 secret 스캔(기본 차단), trunk 브랜치 설정 키,
  자산 skew 감지(doctor D20 + `sync`), 심층 범위 검증·`attest`·`integrate`. 정책과 반대로 적혀 있던 것:
  CI green이 publish·merge의 필수 전제라는 서술, push/tag가 Actions를 시작시킨다는 서술.
  `docs/RELEASING.md`의 배포 게이트를 **필수 로컬 게이트 + 선택 GitHub CI**로 다시 썼고,
  SSOT 08에 통합·검증 축(§2.11)·관측 축(§2.12)·kill switch 범위(§2.13)를 신설했습니다.
  되살아나면 안 되는 문장 8건을 폐기 주장 등재부에 추가해 회귀 테스트로 잠갔습니다.
  README의 CI 배지도 제거했습니다 — 수동 실행 전용 워크플로에서는 "매 커밋이 검증된다"는 잘못된
  신호를 주기 때문입니다.
- **perf 실측 정정** — REQ D의 report 개선 효과를 단일 수치로 과장하지 않습니다. 이번 릴리스 시점
  재측정(로컬 win32 · `v0.21.0..HEAD` **69커밋** · manifest·아카이브 포함 · 3회 중앙값):
  **2.19초**(2.19 / 2.19 / 2.08). 개선의 원인은 manifest마다 `git show`를 띄우던 N+1 경로를
  `git cat-file --batch` 배치 1회로 바꾼 것입니다 — 배수는 범위 내 manifest 수에 따라 달라지므로
  고정된 보장 값으로 읽지 마세요.
- **test: 외부 호출 kill switch — COMMITGATE_TEST (0.22 REQ F)** — 테스트 setup이
  `COMMITGATE_TEST=1`을 설정(자식 프로세스에 env 상속)하고, production 어댑터의 **실제 spawn
  경로**(codex·gh 조회·gh workflow_dispatch·git ls-remote)와 fetch가 테스트 환경에서 호출 즉시
  실패한다. fake spawn 주입은 테스트 seam이라 막지 않는다. escape hatch 없음 — 가드 실재를
  고정하는 메타 테스트 동반. fake reviewer 주입 시 "codex 실제 호출" 경고를 더 이상 출력하지
  않는다(자동 안전 검토가 테스트 출력을 실호출로 오독하던 표면 제거).
- **test: fast 계층 재조정 (0.22 REQ F)** — 실 git 회복·결속 테스트 3파일(rebind-reentry·
  doctor-stranded-evidence·doctor-terminal-wiring, 파일별 테스트 시간 합 ~86초)을 통합 계층으로
  이동. 같은 부류의 secret-scan-wiring은 **대표 wiring으로 fast에 유지** — fast만 돌려도 리뷰
  게이트 배선 회귀는 잡힌다. 로컬 실측 fast 벽시계 ~2분(0.21.0 실측 ~2.8분 — 머신 부하에 따라
  변동, 하드 단언은 프로세스 수·계층 목록 가드로만 한다).
- **feat(doctor): 관측 스키마 v2 — 검사별 적용 가능 분모·reason code (0.22 REQ E)** —
  `.doctor-runs.jsonl` 행에 `schema_version: 2`와 `evaluations`(OK 포함 전 평가 — id·applicable·
  outcome pass|warn|fail|not-applicable·blocked·reason_code·subjects)를 additive로 추가.
  v1 필드(verdict·evaluated·nonok)는 그대로 유지돼 구소비자가 계속 동작한다. applicable은
  msg 문자열 매칭이 아니라 검사가 명시하는 필드다(관찰에서 권위를 구하지 않음). reason_code는
  검사 명시값 또는 `<id>-<outcome>` 안정 폴백. 민감 경로·메시지 본문은 여전히 기록하지 않는다.
- **feat(report): doctor v2 분모 집계 (0.22 REQ E)** — 검사별 적용 가능 수·발화율·FAIL·실제 차단
  수·reason code 분포를 v2 행에서만 계산하고, 구버전 v1 행 수를 "분모 계산 불가로 제외"로 명시.
  "무발화=무가치"로 읽지 않는 안내 유지.
- **perf(report): evidence 계산 N+1 제거 — 실측 29.5초 → 1.2초 (0.22)** — manifest마다
  `git show` 프로세스를 만들던 구조를 `git cat-file --batch` 배치 읽기(심층 수집 공유)로 대체.
  수치는 이 저장소(티켓 ~127개) 로컬 실측이며 환경에 따라 다르다. Git 프로세스 수는 manifest
  수와 무관하게 고정(회귀 테스트).
- **feat(report): evidence 범위 옵션 `--base <ref>` / `--head <ref>` / `--last <N>` (0.22)** —
  기본(merge-base..HEAD)이 trunk 위에서 빈 범위가 되는 문제를 표기+안내로 해소하고, 명시 범위
  (예: `--base v0.21.0`)의 6범주 심층 분류·검증 범위·계산 시각을 출력. `--base`+`--last` 동시
  지정은 오류. `--last`가 이력보다 깊으면 루트까지로 정직하게 축소.
- **feat(verify-range): 심층 증거 검증 — 6범주 (REQ-2026-127)** — 표시자 매칭을 검증으로.
  승인 소비=행 스키마(validateManifest 재사용)+아카이브 실재+SHA-256 일치+중복 소비 부재,
  부기=trailer+변경 경로 전부 워크플로 하위(사용자 코드 혼입=손상 증거), 머지=conflict resolution
  변경 시 미입증 강등. 검증 불가(blob 읽기 실패·state 부재)는 손상 단정 대신 미입증+축소 표기.
  `--strict`는 미입증+손상 증거에서 실패, attested는 통과. blob 읽기는 `git cat-file --batch`
  1프로세스 배치(N+1 금지 — 프로세스 수 회귀 테스트 고정). `.verify-runs.jsonl` counts는 6키
  additive(구행 호환).
- **feat(attest): `commitgate attest <sha> --reason "..."` (REQ-2026-127)** — 승인 증거가 없는 것이
  정상인 커밋(release·setup·수동 충돌 정정·승인된 우회)의 명시 예외 승인. `workflow/attestations.jsonl`
  append-only 감사 기록(sha·tree·이유·시각·로컬 identity — 서명 아님) + 부기 커밋. verify-range/
  integrate가 attested로 분류. 손상 증거는 attest로 구제되지 않는다.
- **feat(integrate): `commitgate integrate` — feature→trunk 로컬 통합 seam (REQ-2026-126)** —
  통합 직전 절차를 도구가 소유한다: 전제 확인 → **항상-strict** 승인 증거 검증(미입증·손상 시 차단·
  목록 표시) → GitHub CI **실행** opt-in → 사람 최종 확인([y/N] 기본 No) → 로컬 `merge --no-ff`
  (충돌 시 자동 원상 복구) → 감사 로그 1행(`workflow/.integrate-runs.jsonl`, gitignored).
  push·PR·자동 stash/reset은 하지 않는다. `delivery integrate`(feature→delivery)와 층이 다르다.
- **feat(ci-run): GitHub CI 실행(workflow_dispatch) 명시 opt-in (REQ-2026-126)** — 조회
  (`--check-github-ci`)와 분리된 실행 축. config `"githubCi": { "workflow", "timeoutMinutes" }`가
  있어야 하며(도구가 워크플로를 추측하지 않음), `--run --run-github-ci`(실제 통합 실행 중의 단계 — dry-run은 CI에 닿지 않음) 또는 `--run` 대화형 [y/N]의 y에서만
  실행한다. dispatch 전 원격 SHA=로컬 HEAD 대조(자동 push 없음), dispatch 이전 시각·브랜치·
  head SHA로 해당 run만 식별(오연결 금지), 단일 timeout, 실패·식별 불가 시 통합 중단. 선택은
  실행 단위이며 저장되지 않는다 — 다음 통합에서 자동 실행되지 않는다.
- **fix(guidance): gitignore 백필 안내 정정 (REQ-2026-125)** — `sync` 기본은 dry-run이므로
  `--apply` 없는 백필 안내(verify-range 런타임 경고·0.21.0 업그레이드 안내·문서 표)는 복사-실행해도
  무효였다. 전부 `npx commitgate sync --apply --gitignore`로 정정하고, `sync --gitignore` 줄은 같은
  줄에 `--apply`를 요구하는 회귀 가드를 추가.
- **fix(verify-range): CI "조회"와 "실행" 용어 분리 (REQ-2026-125)** — `--github-ci`는 기존
  check-runs **조회**일 뿐 워크플로 실행이 아니다. 정식 옵션명을 `--check-github-ci`/
  `--no-check-github-ci`로 바꾸고(기존 옵션은 deprecated alias — 동작 동일·안내 1줄), 대화형 질문을
  "기존 GitHub CI 결과를 조회하시겠습니까? 워크플로를 실행하지 않습니다"로 정정. 워크플로 실행은
  별도 opt-in(`--run-github-ci`)으로만 추가될 예정이며 조용한 의미 변경은 하지 않는다.
- **docs(upgrade): 0.20/0.21 → 0.22 업그레이드 절 (REQ-2026-125)** — caret가 minor를 넘지 않는
  이유·권장 설치 명령·gitignore 백필·rollback을 `docs/upgrade.md`/`.en.md`에 추가.

## 0.21.0 (2026-08-10)

> **로컬만으로 머지까지 지키는 묶음입니다 — GitHub CI는 이제 공식적으로 선택 사항입니다.**
>
> 지금까지 "이 브랜치의 커밋들이 전부 리뷰를 통과했는가"는 확인할 방법이 없었고, 확인하려면
> 유료 CI를 붙이는 길뿐이었습니다. 이 릴리스는 그 검증을 **로컬 명령**으로 제공하고
> (`verify-range`), 비밀이 리뷰 프롬프트에 실려 나가기 **전에** 차단하며(`secretScan` 기본
> `block`), 경고를 상태별로 분류하고(D30), phase가 실제로 건드리는 민감 경로를 알리고(D31),
> 그 모든 관측을 한 명령으로 요약합니다(`report`).
>
> **업그레이드 시 알아둘 것** — ① `secretScan`은 기본 차단입니다(고신뢰 패턴만 — 오탐이면
> `"warn"`/`"off"`). ② 새 로컬 로그 `workflow/.verify-runs.jsonl`이 생깁니다(gitignored —
> 기존 설치본은 `npx commitgate sync --apply --gitignore`로 규칙 백필). ③ design 승인의 부기 커밋이
> 2개→1개가 됩니다. 나머지는 전부 추가·경고 전용이라 기존 워크플로를 막지 않습니다.

- **`commitgate report` — 로컬 관측 요약** (REQ-2026-124). 도구가 쌓는 관측 로그 3종
  (`.doctor-runs`·`.review-calls`·`.verify-runs`)을 읽기 전용으로 요약합니다: 검사별 발화·FAIL과
  WARN-only 비율·해소 관측, 리뷰 대상당 호출 분포·델타 비율·full 전환 사유·프롬프트 크기/소요
  분위수, trunk 대비 승인 증거(verify-range), GitHub CI 선택 분포. 없는 원천은 "데이터 없음"으로
  표기하며 추정하지 않습니다. 아무것도 쓰지 않고 네트워크도 쓰지 않습니다.
- **(개발) 추적 파일의 병합 충돌 마커 가드** (REQ-2026-123). 충돌 해소가 조용히 실패해 마커가
  남은 파일이 push된 실사고(이후 수동 정정)의 재발 방지 — 추적 텍스트 파일 전수에서 줄 시작
  마커를 검출하는 테스트를 추가했습니다(바이너리는 내용 스니핑으로 제외, 감사 아카이브 경로
  제외, 단독 `=`×7 줄은 markdown 헤딩 밑줄이라 검사하지 않음).
- **(개발) 테스트 계층 실행 스크립트** (REQ-2026-122). 실측(2026-08-10)에서 테스트 시간의 91.2%를
  차지한 스폰 계열 12파일을 통합 계층(`tests/tiers.ts`)으로 분리하고 `npm run test:fast`(~3분)·
  `npm run test:integration`을 추가했습니다. `npm test`(전체)의 의미·권위는 그대로이며, 가드가
  목록 실재성과 fast ∪ integration = 전체를 강제합니다. 게이트는 여전히 테스트를 실행하지 않습니다.
- **design 승인의 부기 커밋이 2개에서 1개가 됩니다** (REQ-2026-121). 승인 증거(finalize) 커밋
  직후 항상 따라오던 `state checkpoint` 커밋을 없애고, **같은 검증**(바이트·티켓 id 대조)을 통과한
  `state.json`을 finalize 커밋에 함께 싣습니다 — 파일 내용은 동일하고 커밋 경계만 합쳐집니다
  (소비자 3곳 실측: checkpoint류가 부기 커밋의 ~25%·1,526건이었고 그 design 짝이 대상).
  검증에 실패하면 기존처럼 증거만 커밋하고 별도 checkpoint가 폴백으로 동작합니다.
  phase 경로(evidence-finalize)는 복구 불변식 때문에 이번에 바꾸지 않습니다.
- **리뷰 전송 직전 secret scan — 기본 차단** (REQ-2026-120). 조립 프롬프트(staged diff·설계 문서
  전문 포함)가 외부로 나가기 직전, 고신뢰 패턴(개인키 PEM · AWS AKIA/ASIA · GitHub ghp/gho/ghu/
  ghs/ghr/PAT · Slack xox?/xapp · Google · OpenAI · JWT)을 검사해 일치하면 **호출 없이** 멈춥니다 —
  리뷰 예산도 차감되지 않습니다. 메시지는 마스킹된 앞부분만 보여줍니다.
  - 기본값은 `secretScan: "block"`입니다. 오탐이라면 `"warn"`(경고 후 전송)·`"off"`가 탈출구입니다.
    이 목록이 못 잡는 비밀은 얼마든지 있습니다 — 육안 확인 의무는 그대로입니다.
  - **프롬프트 크기 표면**: `promptWarnBytes`(기본 256KiB) 초과 시 구성 분해(persona·본문·문맥)와
    함께 경고하고 전송은 진행합니다. `promptMaxBytes`(opt-in)를 설정하면 초과분은 **절단 없이**
    전송을 거부하고 축소 경로를 안내합니다.
- **델타 설계 리뷰의 full 전환이 결정적 조건이 됩니다** (REQ-2026-118). 지금까지 "이 변경은
  델타로 볼 범위를 벗어났다"는 판단은 리뷰어 재량(`full_review_requested`)에만 맡겨져 있었고,
  그 재량은 소비자 3곳 누적 **0건**으로 한 번도 행사되지 않았습니다(설계 재개는 32.6%였는데도).
  이제 **전 문서 변경**·**02-plan phase 구조 변경**이면 도구가 델타 대신 전체 설계 리뷰를
  조립하고 그 사실을 실행 출력에 표시합니다. 방향은 항상 델타→full(더 넓은 리뷰)뿐입니다.
  - 리뷰 호출 로그에 `full_review_reason`(선택 키)이 남습니다: `no-baseline` · `invalid-baseline` ·
    `all-docs-changed` · `phase-structure-changed`. 기존 행(키 없음)은 그대로 유효합니다.
  - 리뷰어 재량 경로·응답 스키마는 바뀌지 않습니다 — 결정적 조건이 앞단에 추가된 것입니다.
- **phase의 실효 위험을 감지합니다 — D31(경고 전용)** (REQ-2026-119). 위험도는 티켓 생성 시
  입력값(기본 LOW)만 신뢰되고 phase가 실제로 무엇을 건드리는지는 아무 표면도 보지 않았습니다 —
  LOW 문서 티켓의 한 phase가 결제 웹훅을 수정해도 조용했습니다. 이제 staged 경로가 민감 패턴
  (`.env`·secret·credential·password·private-key·payment·webhook·migration)에 일치하면
  `req:doctor`가 패턴·대표 경로와 함께 **경고**합니다. 어떤 경우에도 커밋을 막지 않습니다 —
  확인 강제는 발화율 데이터가 쌓인 뒤 별도로 결정합니다(0.13.0 block→warn 정정 선례).
  - `req.config.json`의 `riskPaths`(선택)로 패턴을 **대체**할 수 있습니다(합집합이 아니라서
    기본 목록의 오탐 항목을 제거할 수 있습니다). `[]`는 감지 비활성입니다.
  - 실행 로그(`.doctor-runs.jsonl`)에는 id·level만 남고 경로는 기록되지 않습니다.
- **`commitgate verify-range` — 머지 직전 로컬 승인 증거 검증 + GitHub CI opt-in** (REQ-2026-116).
  base..head 범위의 커밋을 로컬 git과 커밋된 `approvals.jsonl`만으로 **승인 소비 · 도구 부기 ·
  머지 · 미입증**으로 분류합니다(GitHub 인증·네트워크 불필요). 기본은 보고(exit 0)이고
  `--strict`일 때만 미입증 커밋이 게이트가 됩니다.
  - **GitHub CI는 기본 비활성입니다** — 사용량·비용이 발생할 수 있으므로 CommitGate의 필수
    조건이 아닙니다. 대화형에서는 매번 `[y/N]`(기본 No)으로 묻고, `--github-ci`/`--no-github-ci`로
    명시할 수 있으며, 비대화형은 플래그 없이는 생략합니다. opt-in 시에도 head SHA의 check-runs를
    **1회 조회**할 뿐 워크플로를 트리거하지 않고, 명시 요청한 확인이 실패하면 exit 1로 드러냅니다.
    선택은 실행 단위이며 저장되지 않습니다.
  - 실행 요약(SHA·범주별 개수·CI 선택)은 `workflow/.verify-runs.jsonl`(gitignored)에 쌓입니다 —
    내용(커밋 메시지·파일 본문)은 담지 않으며, 기록 실패는 판정을 바꾸지 않습니다.
    기존 설치본은 `npx commitgate sync --apply --gitignore`로 규칙을 백필할 수 있습니다(규칙이 없으면
    기록을 건너뛰고 경고만 냅니다).
  - `req:next`의 통합 안내와 문서(workflow·guarantees 한/영)에 사용법을 배선했고, SSOT 로드맵
    STR-01을 "로컬 검증 우선 · 원격 강제는 opt-in 확장"으로 정정했습니다.
- **D30이 미도달 티켓을 상태별로 분류합니다** (REQ-2026-117). 지금까지는 병합 직전의 일시적
  정상·미병합 브랜치 생존·로컬 trunk 지연·실조치 대상이 한 목록에 섞여 경고 피로를 만들었습니다
  (소비자 3곳 실측: D30이 WARN 발화의 최대 원천). 이제 **조치 대상**을 앞세우고, "미병합 브랜치에
  있음(진행 중이면 정상)"과 "로컬 trunk가 원격 추적 ref보다 뒤처짐(pull로 해소)"을 구분하며,
  티켓마다 리뷰 횟수와 **마지막 리뷰 이후 경과**를 표기합니다(시각 미기록도 그 사실을 표기).
  - **네트워크를 쓰지 않습니다** — `git fetch` 없이 이미 존재하는 remote-tracking ref만 읽고,
    ref가 없으면 그 축은 "판정 불가"로 표기합니다. 원격 ref의 마지막 커밋 시각(신선도)을 함께 냅니다.
  - 판정은 그대로입니다 — D30은 여전히 WARN이고 어떤 경우에도 커밋을 막지 않습니다.
- **doctor 실행 로그에 발화 대상이 남습니다** (REQ-2026-117). `workflow/.doctor-runs.jsonl`의
  `nonok[]` 항목에 선택 필드 `subjects`(티켓 id·계약 파일명 같은 **저위험 식별자만**)가 추가됩니다.
  "어느 티켓이 며칠째 걸려 있는가"를 로그만으로 분석할 수 있게 됩니다. 기존 행(필드 없음)은
  그대로 유효하며, 워킹트리 경로·메시지 본문은 여전히 기록하지 않습니다.

## 0.20.0 (2026-08-02)

> **도구가 자기 자신을 관측하고, 자기 서술을 사실로 맞춘 묶음입니다.**
>
> 소비자 저장소 3곳(271티켓·리뷰 호출 2,089건·16일)의 실제 이력을 측정하는 데서 시작했습니다.
> 그 과정에서 두 가지가 드러났습니다 — **게이트가 실제로 무엇을 막는지 아무도 알 수 없었고**
> (진단 결과가 어디에도 기록되지 않았습니다), **설정 화면과 계약 문서가 더 이상 지키지 않는
> 약속을 하고 있었습니다**(정지 지점을 바꾼 0.13.0 이후 문구가 따라오지 않았습니다).
>
> **`req:doctor`를 쓰신다면 달라지는 것** — 새 진단 두 개가 늘고(D29·D30, 둘 다 **경고**이며
> 커밋을 막지 않습니다), 실행할 때마다 판정 요약이 로컬 파일에 한 줄씩 쌓입니다.
> `commitgate setup`의 정지 지점 안내 문구도 실제 동작에 맞게 바뀝니다.
> 진행 중인 티켓 위로 업그레이드해도 이어서 작업할 수 있습니다.

> **새로 생기는 로컬 파일 2종** — 둘 다 `.gitignore`로 커밋되지 않으며 **내용**(프롬프트·diff·
> 지적 본문)은 담기지 않습니다.
>
> | 파일 | 담는 것 |
> |---|---|
> | `workflow/.doctor-runs.jsonl` | `req:doctor` 실행 1회 = 1행. 전체 판정·평가된 검사 수·OK가 아닌 검사의 id와 level |
> | `workflow/.review-calls.jsonl`(기존) | 행에 델타 모드 여부·전체 재리뷰 요청 여부가 **추가**됩니다 |
>
> 기존 설치본에 `.gitignore` 규칙이 아직 없다면 **D22가 경고로 알려줍니다**(차단하지 않습니다).

- **(내부) 검사 하나의 존재 이유를 사실대로 적고 테스트로 고정했습니다** (REQ-2026-115).
  **동작은 바뀌지 않습니다** — 주석과 테스트만 손봤습니다.

  D15(리뷰 응답이 "고쳐라"인데 지적이 비어 있으면 커밋을 막는 검사)의 주석이 스스로를
  "스키마와 중복"이라고 적고 있었는데, 사실이 아니었습니다. 스키마는 그 경우를 막지 않아서
  **커밋 직전에는 D15만 잡습니다.** 잘못된 자기 서술은 나중에 이 검사를 정리 대상으로 오해하게
  만들 수 있어 고쳤고, 그 주장을 테스트로 고정했습니다(스키마 통과 ↔ D15 차단 대비).

  함께: `req:doctor` 관측 로그 테스트가 종료 코드까지 대조하도록 했습니다.

- **병합하지 않은 티켓의 리뷰 증거를 진단이 알려줍니다** (REQ-2026-114, 새 검사 **D30**).

  승인 증거는 그 티켓의 **feature 브랜치에** 커밋됩니다. 브랜치를 병합하지 않으면 **증거는
  메인라인에 남지 않습니다.** 파괴되는 건 아니지만(브랜치에 그대로 있습니다) 보이지 않고,
  브랜치를 지우면 함께 사라집니다.

  이제 `req:doctor`가 **리뷰를 받았는데 증거가 trunk에 없는 티켓**을 리뷰 횟수와 함께 알려줍니다.
  진행 중이면 정상이므로 **차단하지 않습니다**(WARN). 리뷰 8회를 받고 남아 있는 티켓과 오늘
  1회 받은 티켓은 횟수로 구별하시면 됩니다.

  **왜 넣었나**: 소비자 저장소 3곳(리뷰 호출 2,089건·16일)을 조사해 보니 **3.1%(65건)** 의 응답이
  메인라인에 없었고, 그중 **66.2%가 반려 기록**이었습니다(남은 것은 47.9%). 아카이브만 보고
  회고하면 **실패가 체계적으로 적게 잡힙니다.** 보장 문서(한/영)에도 이 경계를 명시했습니다.

- **리뷰 호출 로그가 델타 리뷰 정보를 함께 남깁니다** (REQ-2026-113).

  `workflow/.review-calls.jsonl`의 각 행에 두 값이 추가됩니다 — 그 호출이 **델타 모드**였는지
  (`delta_mode`), 리뷰어가 **전체 재리뷰를 요청**했는지(`full_review_requested`).

  **왜**: 델타 리뷰의 전체 재리뷰 요청이 실측 **0회**인데, 그게 "필요한 상황이 없었다"인지
  "쓰이지 않는다"인지 판단하려면 **분모(델타 호출이 몇 번이었나)** 가 필요합니다. 그런데 로그에
  델타 여부가 없어 `policy_version` 해시를 역산해야 했습니다. 이제 로그가 직접 답합니다.

  **동작은 바뀌지 않았습니다.** 담기는 것은 boolean 두 개이고, 프롬프트·diff·지적 본문은 여전히
  담기지 않습니다. 기존 행은 이 필드가 없어도 그대로 유효합니다.

  설계 문서(`docs/ssot-design/gaps-and-decisions.md`)의 낡은 서술 두 건도 함께 고쳤습니다 —
  델타 리뷰를 아직 없는 기능처럼 적어 둔 항목과, 관측 로그가 하나도 없다고 적어 둔 항목입니다.

- **설정 화면과 계약 문서가 더 이상 지키지 않는 약속을 하지 않습니다** (REQ-2026-112).

  `commitgate setup`에서 정지 지점(`stopGate`)을 고를 때 뜨던 고지가 **사실과 달랐습니다.**
  0.13.0(REQ-2026-071)이 위험도에 따른 별도 백스톱을 걷어내고 정지 지점을 이 설정 하나로 모았는데,
  화면 문구·`AGENTS.md` 템플릿·설계 문서·코드 주석이 옛 서술 그대로 남아 있었습니다.
  **사용자가 보호받는다고 믿는 자리에서 실제로는 보호받지 않았습니다.**

  이제 고지가 **이 값이 무엇을 정하는지**를 말합니다 — `phase`(매 phase 커밋 전) ·
  `req`(REQ를 끝내는 커밋 전) · `merge`(커밋에서는 멈추지 않음). 그리고 **통합(main 병합) 승인은
  어느 값에서도 필요하다**는 사실을 함께 말합니다(이 부분은 원래도 참이라 그대로 뒀습니다).

  **동작은 바뀌지 않았습니다.** 서술만 실제 동작에 맞췄습니다.

  회귀 가드도 함께 넓혔습니다. 이전 가드는 `README`와 `docs/`만 봐서
  **소비자에게 배포되는 `AGENTS.md` 템플릿·스킬·페르소나가 검사 밖**이었고, 같은 주장을 다른 문장으로
  쓰면 그대로 통과했습니다. 이제 배포되는 지침 파일과 해당 코드 표면까지 검사하고, 표현 변형도 등재합니다.

- **이미 설치된 저장소의 낡은 `AGENTS.md`를 진단이 알려줍니다** (REQ-2026-112, 새 검사 **D29**).

  `AGENTS.md`는 여러분 소유의 파일이라 `init`도 **없을 때만** 만들고 `sync`도 손대지 않습니다.
  그래서 위 정정이 **이미 설치된 저장소에는 자동으로 닿지 않습니다.** 대신 `req:doctor`가
  계약 파일(`AGENTS.md`·`AGENTS.commitgate.md`)에 더 이상 사실이 아닌 서술이 있으면
  그 문장과 이유를 **WARN**으로 알려줍니다.

  **파일을 고치지 않습니다. 커밋을 막지도 않습니다**(WARN이지 FAIL이 아닙니다) —
  서술 문제로 여러분의 작업이 멈추면 안 되기 때문입니다. 안내를 보고 해당 문장을 지우거나
  현재 동작으로 갱신하시면 됩니다.

- **`req:doctor`가 자기 판정을 기록합니다** (REQ-2026-111, 새 파일 `workflow/.doctor-runs.jsonl`).

  실행할 때마다 그 회차의 판정 요약 **한 줄**이 append됩니다 — 티켓 id·시각·전체 판정(PASS/FAIL)·
  평가된 검사 개수·**OK가 아닌 검사의 id와 level**. 검사 메시지 본문은 담지 않습니다(경로·파일명이
  섞이지 않게).

  **왜 넣었나**: 등록부에 검사가 22개 있는데(차단 10 · 진단 12), 그중 실제로 무엇이 무엇을 막았는지
  **기록이 전혀 없었습니다**. 발화를 실측할 수 있던 게이트는 리뷰·응답구조·리뷰예산 셋뿐이었고,
  그 셋의 공통점은 각자 로그를 남긴다는 것이었습니다. 기록이 없으면 검사를 더하는 것도 빼는 것도
  근거 없이 하게 됩니다.

  **동작에는 영향이 없습니다.** 출력·FAIL 개수·exit code가 그대로이고, 로그 기록이 실패해도
  (권한 없음·디스크 가득 참 등) 판정은 동일하게 진행됩니다 — 관측은 게이트가 아닙니다.

  **커밋되지 않습니다.** `workflow/.review-calls.jsonl`과 같은 자리·같은 성격의 로컬 관측 파일이며
  `.gitignore` 규칙이 루트와 배포 템플릿 양쪽에 함께 들어갑니다. 기존 설치본에 템플릿이 아직
  없다면 **D22가 WARN으로 알려줍니다**(차단하지 않습니다).

## 0.19.0 (2026-08-02)

> **자체 감사에서 나온 묶음입니다.** "여러 번 고치다 보니 비대해진 것 같다"는 점검 요청에서
> 시작해, 코드 중복·최대 모듈·진단 체계·배포 페이로드 네 축을 실측하고 그중 근거가 확인된 것만
> 고쳤습니다. 감사가 제안한 항목의 절반 이상은 **측정 결과 하지 않기로 했고**, 그 판단 근거도
> 아래에 남겼습니다.
>
> **`req:doctor`를 쓰신다면 출력이 달라집니다** — 세 가지 모두 *덜 막고 더 알려주는* 방향입니다:
> 잘못된 경고가 사라지고(D18), 쓰이지 않는 값 때문에 커밋이 막히던 것이 풀리고(D5),
> HIGH 티켓이 왜 막힐지 미리 알려줍니다(D28 신설). 나머지는 내부 정리라 관측되지 않습니다.
> 진행 중인 티켓 위로 업그레이드해도 이어서 작업할 수 있습니다.

> **하지 않기로 한 것** — 감사가 제안했으나 측정 후 제외했습니다. 근거를 남기지 않으면
> 다음 사람이 "하다 만 것"으로 읽습니다.
>
> | 제안 | 하지 않은 이유 |
> |---|---|
> | JSONL 원장 3형제 제네릭화(~120줄) | **세 파일을 함께 바꾼 커밋이 히스토리 전체에서 0건.** 중복이 유지보수 비용을 물린 적이 없습니다 |
> | `review-codex.ts`의 `mainImpl`(523줄) 분해 | **단계 순서가 곧 감사 계약**인데 그 순서를 검증할 오라클이 없습니다. 순서를 지키는 코드를 오라클 없이 재배치하는 것은 이 도구의 존재 이유를 위험에 빠뜨립니다 |
> | 프롬프트·series 도메인 분리(~750줄) | 테스트 가능성 이득이 없습니다(이미 export·테스트됨). 남는 것은 줄 수뿐입니다 |
> | git 어댑터·sha256·경로 유틸 통합 | 방금 복원 누락으로 데인 자리에 간접층을 얹는 일이고, 한 줄 표현식을 import로 바꾸는 것이 더 낫다고 단정하기 어렵습니다 |
> | `req:doctor` 체크 21→10 병합 | **출력이 나빠집니다.** D19~D24는 사용자가 서로 다르게 조치하는 여섯 진단이라, 합치면 "무엇이 잘못됐는지"를 가리키지 못합니다 |
> | `CHANGELOG.md` 배포 제외(−50 KB) | 오프라인 변경 이력을 잃는 대가가 더 큽니다. **바이트 절감은 이 프로젝트의 문제가 아니었습니다** |

- **`req:doctor`가 "왜 커밋이 막힐지"를 미리 알려줍니다 — HIGH 사람확인** (REQ-2026-110, 새 검사 **D28**).

  `req:commit`이 막는 조건들은 대부분 `req:doctor`에 대응하는 검사가 있어서, 커밋을 실행하기 전에
  무엇이 문제인지 알 수 있었습니다. **그런데 딱 하나, HIGH 위험 티켓의 사람확인만 예외였습니다.**
  확인 기록이 없거나 범위(scope)가 어긋나면 `req:doctor`는 통과라고 하는데 `req:commit`은 실패했고,
  이유는 커밋을 실행해봐야 알 수 있었습니다.

  이제 `req:doctor`가 그 상태를 **WARN으로 미리 알리고**, 어떤 명령으로 기록해야 하는지까지
  그대로 보여줍니다.

  🔴 **이 검사는 막지 않습니다(WARN이며 FAIL이 아닙니다).** 실제 차단은 계속 `req:commit`이 합니다.
  진단이 게이트가 되면 **진단의 오차가 곧 차단**이 되기 때문입니다 — doctor의 판정이 커밋 게이트와
  조금이라도 어긋나는 순간 커밋이 doctor 때문에 막히게 됩니다. 그래서 판정 자체도 doctor가 새로
  계산하지 않고 **커밋 게이트와 같은 함수를 호출**해 결과만 표시합니다.

  LOW 티켓과, HIGH이지만 확인이 갖춰진 티켓의 출력·exit code는 달라지지 않습니다.

- **`commitgate delivery`의 증거 검증이 정본 구현을 씁니다** (REQ-2026-109).

  승인 증거 무결성 검증기에 넘기는 포트 3개(`headText`·`headBlobSha256`·`headArchivePaths`)가
  **두 벌** 있었습니다. `bin/delivery.ts`가 임의 커밋 기준으로 검증해야 해서 따로 구현했는데,
  **정본이 주석으로 경고해 둔 함정 두 개를 그대로 밟았습니다** — 파일 내용을 바이트가 아니라
  디코딩된 문자열로 해싱했고, `git ls-tree`에 `-z`를 주지 않았습니다.

  정본에 `ref` 인자를 추가하고(기본 `HEAD` — 기존 호출부는 그대로) 사본을 지웠습니다.

  **`-z` 누락은 실제로 재현되는 거짓 차단이었습니다.** 티켓 경로에 비ASCII가 들어가고
  `core.quotePath`가 참이면(**git 기본값**) `ls-tree`가 경로를 인용해 내보내므로, 매니페스트가 기록한
  경로와 어긋나 `delivery integrate`가 정상 증거를 두고 실패합니다. `ticketRoot`는 설정 스키마상
  문자집합 제약이 없어 한글 경로를 쓸 수 있습니다. 재현 테스트를 남겼습니다 — **옛 방식을 테스트
  안에서 직접 실행해** 인용이 실제로 일어나는 것을 보이고, 정본이 원래 경로를 내는 것을 대조합니다.

  🔴 **바이트 해싱 쪽은 "버그를 고쳤다"고 말하지 않습니다.** 응답 아카이브는 도구가 UTF-8 JSON으로
  쓰므로 디코딩/재인코딩이 무손실이고, 지금은 그 차이가 드러나는 경로가 없습니다. 정본을 쓰면서
  함께 사라졌을 뿐입니다 — **재현할 수 없는 것을 고쳤다고 하지 않습니다.**

  (조사 중에 알게 된 것 하나: 이 저장소를 개발하는 환경은 `core.quotepath=false`로 설정돼 있어
  처음 관측에서 인용이 보이지 않았습니다. **기본값이 아닌 로컬 설정이 결함을 가릴 수 있습니다.**
  그래서 재현 테스트는 저장소 설정을 명시적으로 세웁니다.)

- **더 이상 쓰이지 않는 값의 형식 때문에 커밋이 막히지 않습니다** (REQ-2026-108).

  `req:doctor` D5는 `state.codex_thread_id`가 UUID 형식인지 검사하고 **FAIL**을 냈습니다. `req:commit`은
  `req:doctor`를 하드 게이트로 실행하므로, 이 FAIL은 곧 **커밋 차단**이었습니다.

  그런데 이 값을 **읽는 코드는 그 검사 자신뿐입니다.** 재리뷰가 stateless로 고정된 뒤 값을 소비하던
  분기가 죽었고, 이번 묶음의 REQ-2026-103이 그 죽은 배선을 제거하면서 완전히 기록 전용이 됐습니다.
  값의 출처는 codex CLI가 내는 thread id인데, **codex가 그 형식을 바꾸는 날 아무것도 읽지 않는 값
  때문에 모든 사용자의 커밋이 동시에 막히는** 구조였습니다.

  **WARN으로 낮췄습니다.** 형식 이상은 계속 보고합니다(그 값은 승인 증거에 기록되므로 알 값어치가
  있습니다) — 다만 막지는 않습니다. 판정 조건과 메시지 문자열은 그대로이고, **바뀐 것은 심각도
  하나뿐**입니다. 정상 UUID를 쓰는 티켓의 출력은 달라지지 않습니다.

- **`req:doctor`가 `phases[].max_files` 선언을 인정합니다** (REQ-2026-107).

  **버그 수정입니다.** REQ-2026-086이 "이 phase는 의도적으로 크다"는 탈출구
  (`state.json`의 `phases[].max_files`)를 만들고 granularity 게이트를 리뷰 직전으로 옮겼는데,
  **`req:doctor`의 D18은 그 선언을 인자로 받지도 않았습니다.** 그래서 선언으로 리뷰 게이트를
  정당하게 통과시킨 phase에도 `req:doctor`는 계속 "8파일 초과" 경고를 냈습니다 — 도구가 스스로 준
  탈출구를 스스로 인정하지 않았던 셈입니다. 감사 대상 저장소 두 곳에서 **5개 티켓**이 이 선언을
  쓰고 있었습니다.

  이제 D18은 리뷰 preflight와 **같은 함수**(`judgePhaseArea`)로 판정하고, 세는 대상도 같은
  기준(staged 코드 파일)으로 맞췄습니다. 두 표면이 다시 갈라질 수 있는 구조를 남기지 않는 것이
  이 수정의 실질입니다 — 원래 결함이 "정책이 옮겨갔는데 사본이 남은 것"이었기 때문입니다.

  경고 문구에 **임계의 출처**도 드러냅니다: 선언을 썼으면 `선언한 상한 20`, 아니면 `권고 8`로
  표기합니다. 자기 선언이 인정됐는지 출력에서 바로 보이도록 하기 위해서입니다.

  **바뀌는 것**: 선언이 있는 phase에서 WARN → OK. **선언이 없으면 판정은 그대로입니다.**
  D18은 이전과 같이 **WARN이며 FAIL이 아닙니다** — 커밋을 막지 않습니다.

> **확인할 파일** — 각 항목이 어느 커밋에서 왔는지.
>
> | REQ · phase | 구현 커밋 | 확인할 파일 |
> |---|---|---|
> | 103 phase-1 (죽은 resume 배선·`withAttemptRecorded` 제거) | `145b453` | `review-codex.ts`의 `callReviewer` · `lib/adapters.ts`의 `createCodexReviewerAdapter` · `tests/unit/req-adapters.test.ts` · `docs/ssot-design/06`·`gaps-and-decisions.md` G-06 |
> | 103 phase-2 (참조 없는 심볼 3종) | `1888c81` | `bin/quickstart.ts` 상단 · `req-close.ts`의 `plannedPhaseIdsFromState` 호출 · `lib/review-ledger.ts` 말미 |
> | 103 phase-3 (`gitAdapter` 복원) | `4532ddd` | `review-codex.ts`의 `main()` try/finally · `tests/unit/req-review-codex.test.ts` O2-8·O2-8b |
> | 103 phase-4 (CHANGELOG) | `5791cdd` | `CHANGELOG.md` |
> | 104 phase-1 (문서 진실성 가드 범위) | `b5b32ef` | `tests/unit/docs-stale-claims.test.ts`의 `docFiles`·`STALE_CLAIMS` |
> | 105 phase-1 (CLI 경계 헬퍼 + 11곳) | `ae82735` | `scripts/req/lib/cli-boundary.ts`(신규) · `tests/unit/cli-boundary.test.ts`(신규) · `bin/init.ts`·`scripts/req/req-*.ts` 말미 |
> | 105 phase-2 (나머지 7곳) | `02099af` | `bin/{quickstart,uninstall,sync,migrate}.ts`(전환) · `bin/{check,delivery,setup}.ts`(미공유 사유 주석) |
> | 106 phase-1·1b (프롬프트 바이트 골든) | `f89e58a` · `a180694` | `tests/unit/review-prompt-golden.test.ts` |
> | 106 phase-2 (타입 하강) | `9dcba47` | `scripts/req/lib/review-types.ts`(신규) · `review-codex.ts`의 re-export · `lib/{evidence,review-exception,review-ledger}.ts`의 import |
> | 106 phase-3 (이 문서) | **이 커밋** | `CHANGELOG.md` |

- **리뷰 프롬프트의 바이트를 테스트로 고정했습니다** (REQ-2026-106 · `f89e58a`·`a180694`).

  프롬프트는 리뷰어에게 **그대로 전달되는 입력**입니다. 조립 코드는 이미 단위 테스트가 있었지만
  `toContain`과 순서 비교라 **구분자·공백이 바뀌어도 통과**했습니다. 리뷰 결과가 조용히 달라질 수 있는
  축이 핀 없이 열려 있었던 셈입니다. 6개 조합(`phase`/`design` × 이전 findings 유무, delta 모드,
  이미 커밋된 phase 참고 블록)의 출력 전문을 테스트에 박은 문자열과 바이트 비교합니다.

  값어치를 변이검사로 확인했습니다: 블록 구분자를 `\n`에서 `\n\n`으로 바꾸면 **기존 구조 테스트 8건은
  전부 통과하고 새 골든 5건은 전부 실패**합니다. 즉 기존 테스트가 못 보던 축을 덮습니다.

- **`lib/`이 다시 leaf가 됐습니다** (REQ-2026-106 · `9dcba47`).

  `lib/`의 세 모듈이 `review-codex.ts`에서 타입을 **거꾸로** import하고 있었습니다. `import type`이라
  런타임 순환은 없었지만 의존 방향이 뒤집혀 있어, 앞으로 무엇을 떼어내든 순환을 만드는 상태였습니다.
  `ReviewKind`·`ApprovalEvidence`의 정의를 `lib/review-types.ts`로 내리고 `review-codex.ts`는
  **re-export만** 남겼습니다 — 이 타입을 쓰는 CLI 9개는 한 줄도 바뀌지 않았습니다.

- 🔴 **하지 않기로 한 것** (같은 감사에서 제안됐으나 판단으로 제외).

  자체 감사는 `review-codex.ts`(3,040줄)의 추가 분해를 제안했습니다. **측정해 보고 하지 않기로 했습니다.**

  - **프롬프트 조립 분리(~350줄)**: 감사는 "`main()`을 돌려야만 검증된다"를 근거로 들었지만 **사실이
    아닙니다** — `assembleReviewPrompt`는 이미 export돼 있고 직접 테스트되고 있었습니다. 남는 이득은
    파일 줄 수뿐입니다.
  - **series/budget 분리(~400줄)**: 이미 두터운 테스트가 있습니다. 이동은 조직화일 뿐 안전성을 더하지
    않습니다.
  - **`mainImpl`(523줄) 분해**: **이 함수의 단계 순서가 곧 감사 계약**인데(원장 기록 → 바인딩 캡처 →
    호출 → 변조 검증 → 증거 보존), 그 순서를 검증하는 단위 테스트가 없습니다. 순서를 지키는 코드를
    순서를 검증할 오라클 없이 재배치하는 것은 이 도구가 존재하는 이유를 위험에 빠뜨립니다. 분해하려면
    순서 계약의 오라클을 먼저 설계해야 하고, 그것은 별도 작업입니다.

  같은 기준으로 A트랙의 다른 제안들도 제외했습니다 — git 어댑터 싱글턴 통합(방금 복원 누락으로 데인
  자리에 간접층을 얹는 일), sha256·경로 유틸 통합, JSONL 원장 제네릭화(세 파일을 **함께 바꾼 커밋이
  히스토리 전체에서 0건** — 중복이 비용을 물린 적이 없습니다). **줄 수 감소가 곧 개선은 아닙니다.**

- **CLI 오류 경계를 한 곳으로 모았습니다** (REQ-2026-105).

  18개 CLI 진입점이 각자 같은 7줄을 복제하고 있었습니다 — 예외를 `commitgate: <메시지>` 한 줄과
  exit 1로 바꾸는 경계입니다. 이 경계의 계약은 **스택트레이스를 사용자에게 노출하지 않는 것**인데,
  18곳에 흩어져 있으면 한 곳만 어긋나도 raw stack이 그대로 새어 나갑니다. `makeRunCli`로 모았습니다.

  엔트리포인트 판정(`isMain`)도 18곳 전부 `isEntrypoint`로 통일했습니다. 그전에는 16곳이
  `pathToFileURL(process.argv[1] ?? '')`, 2곳이 가드 우선 형태였습니다. **결과는 실측상 같습니다** —
  `pathToFileURL('')`은 예외를 던지지 않고 현재 디렉터리 URL을 내므로 어떤 모듈과도 일치하지
  않습니다. 그래도 가드 우선을 정본으로 삼았습니다. 같은 결과를 **문서화되지 않은 동작에 기대어**
  얻고 있으면, Node가 그 동작을 바꾸는 날 18곳이 한꺼번에 흔들리기 때문입니다.

  🔴 **세 곳(`check`·`delivery`·`setup`)은 자기 `runCli`를 유지합니다.** 셋 다 도움말 요청을 오류가
  아닌 **제어 흐름**으로 처리하고(`setup`은 async이기도 합니다), 이를 헬퍼에 흡수하려면 예외 클래스와
  핸들러를 파라미터로 받아야 합니다. 그러면 "예외 → 한 줄 + exit 1"이라는 계약이 "경우에 따라 정상
  종료"로 약해집니다. 호출자 셋을 위해 공용 계약을 넓히지 않았고, **왜 공유하지 않는지 각 파일에
  주석으로 남겼습니다** — 다음 사람이 누락으로 오해해 되돌리지 않도록.

  소비자가 보는 것은 달라지지 않습니다: 오류 메시지 문자열·exit code·verb 표면 전부 그대로입니다.

- **문서 거짓 서술 가드가 `docs/` 하위 전체를 봅니다** (REQ-2026-104).

  `docs-stale-claims` 검사는 "과거에 실제로 적었던 거짓 문장이 다시 나타나면 실패한다"는 장치입니다.
  그런데 대상 수집이 **비재귀**여서 `docs/ssot-design/` 18개 문서(285KB)가 통째로 빠져 있었습니다 —
  가장 오래 살아남는 설계 SSOT 문서가 검사 밖이었던 셈입니다. 재귀로 바꾸고, **범위가 다시 좁아지면
  실패하는 단언**을 함께 넣었습니다(기존 검사는 파일 수만 보아 회귀를 놓쳤습니다).

  REQ-2026-103이 정정한 resume 서술도 금지 목록에 등재했습니다. 등재하는 과정에서 하나 배웠습니다 —
  **정정문이 옛 문구를 그대로 인용하면 가드가 자기 자신에게 걸립니다.** 부분 문자열 검사기는 주장과
  인용을 구별하지 못합니다. 인용부호를 예외 처리하는 파서를 만드는 대신(그 길은 REQ-2026-044에서
  이미 폐기했습니다) 정정문을 풀어 썼고, 그 규칙을 테스트 파일 주석에 남겼습니다.

  🔴 **이 가드의 한계를 분명히 해둡니다.** 고정 문자열 목록이며 **새로운 거짓 서술을 스스로 찾지
  못합니다.** REQ-103이 발견한 resume 서술도 등재 *후에야* 막힙니다 — 발견 자체는 사람이 했습니다.
  범위 확장으로 얻은 것은 "이미 아는 거짓말이 무가드 구역으로 이주하지 못한다"는 예방뿐입니다.


- **`main()`이 `gitAdapter`도 원래대로 되돌립니다** (REQ-2026-103 · `4532ddd`).

  `req:review-codex`의 `main()`은 주입받은 reviewer를 호출이 끝나면 복원했지만(REQ-2026-027 D3),
  바로 옆에서 재할당하는 모듈 전역 `gitAdapter`는 되돌리지 않았습니다. 그래서 호출이 끝난 뒤에도
  **그 호출의 저장소 root가 남았고**, 다음 호출이 자기 root를 세우기 전에 모듈의 git 헬퍼를 쓰면
  엉뚱한 저장소를 향할 수 있었습니다. 같은 위험을 지적한 주석이 reviewer 쪽에만 달려 있었습니다.

  **CLI 사용자에게는 관측되지 않습니다** — 명령 하나가 프로세스 하나이기 때문입니다. 실제 영향은
  한 프로세스에서 `main()`을 여러 번 부르는 경우(near-e2e 테스트)에 한정됩니다. 회귀 테스트
  O2-8·O2-8b를 붙였고, 복원 한 줄을 빼면 둘 다 실패하는 것을 확인했습니다.

- **도달할 수 없던 resume 경로를 제거했습니다** (REQ-2026-103 · `145b453`).

  REQ-2026-013 P4에서 재리뷰를 stateless(항상 새 스레드)로 고정한 뒤, 호출부의 `isResume`이
  `false` 상수가 되어 `codex exec resume` 분기 전체가 실행될 수 없는 코드로 남아 있었습니다.
  문서(`docs/ssot-design/06`, `gaps-and-decisions.md` G-06)는 이를 **나중에 켜기만 하면 되는 보존
  코드처럼 서술해 실제보다 준비된 기능처럼 읽혔습니다.** 배선을 어댑터까지 걷어내고 문서도 정정했습니다.

  🔴 **`state.codex_thread_id` 필드는 그대로 기록합니다.** 기존 티켓의 `state.json`과 승인 증거
  스냅샷이 이 값을 갖고 있기 때문입니다. 없앤 것은 그 값을 **읽어서 분기하던 죽은 경로**뿐입니다.

  resume이 필요해지면(REQ-2026-045 레버 C — 현재 보류) 게이트 정책과 감사 설계부터 새로 합니다.
  옛 코드가 필요하면 `145b453^`에 있습니다.

- **참조가 하나도 없던 심볼 3종을 제거했습니다** (REQ-2026-103 · `1888c81`).

  `QUICKSTART_MARKER_OPEN`/`_CLOSE`(마커 문자열의 정본은 원래부터 정규식이었습니다),
  `req-close.ts`의 `committedPlannedPhaseIds` 별칭(정본 `plannedPhaseIdsFromState`를 직접 호출),
  `lib/review-ledger.ts`의 `unclosedAttempts`(어떤 게이트에도 연결돼 있지 않았습니다).

  `unclosedAttempts`가 지원하려던 관측 — "예산은 깎였는데 완료되지 않은 호출" — 은 **그대로
  가능합니다.** 그것을 가능하게 하는 것은 이 조회 헬퍼가 아니라 외부 호출 **전에** 커밋되는
  `attempt-opened` 원장 행이고, 그 경로는 손대지 않았습니다. 자동 진단으로 만들 때는 `req:doctor`
  체크와 함께 작성합니다(그때는 출력이 바뀌므로 별도 작업입니다). 옛 코드는 `1888c81^`에 있습니다.

- **`withAttemptRecorded`를 제거하고 테스트를 프로덕션 함수로 옮겼습니다** (REQ-2026-103 · `145b453`).

  이 래퍼는 프로덕션에서 아무도 부르지 않았고(`main()`은 `gateAndRecordAttempt`를 직접 호출),
  테스트 5곳만 이를 통해 게이트를 검증하고 있었습니다. 테스트를 지우는 대신 `gateAndRecordAttempt`
  대상으로 다시 썼습니다 — 검증 대상이 원래 래퍼가 아니라 게이트였으므로 커버리지는 줄지 않고,
  이제 실제 실행되는 함수를 직접 겨냥합니다.

## 0.18.0 (2026-08-02)

> 이번 묶음은 **"적용한 프로젝트에서 변경 하나마다 수십 분이 걸린다"**는 제보에서 나왔습니다.
> 원인을 실측했더니 CommitGate가 테스트를 강제한 적은 없었고, 계획서 문구에 **범위와 시점이
> 없어서** 매 phase마다 전체 스위트를 돌리게 된 것이었습니다. 실행 시점을 규정하고(100),
> 그 규칙이 이미 설치된 저장소에도 닿도록 전달 경로를 고쳤습니다(101).
> 함께 받은 소비자 개선 요청 중 **동작을 바꾸면 안 되는 것**은 동작 대신 **설명**을 고쳤습니다(102).

> **확인할 파일** — 각 항목이 어느 커밋에서 왔는지.
>
> | REQ · phase | 구현 커밋 | 확인할 파일 |
> |---|---|---|
> | 100 phase-1 (테스트 실행 계층 규정) | `2219264` | `req-new.ts` 스캐폴드 · `AGENTS.template.md` §1-1 · `docs/development.md`·`.en.md` |
> | 102 phase-1 (legacy 진단 정직성) | **이 커밋** | `req-doctor.ts`의 `exempt`·`legacyNote` · `req-close.ts` legacy 거부 사유 |
> | 101 phase-1 (Quick Start 드리프트 탐지 + 계층 한 줄) | `a8b5bca` | `bin/quickstart.ts`의 `quickstartBackfillTargets` · `req-doctor.ts` D21 분기 · `templates/CLAUDE.template.md`·`AGENTS.template.md` 블록 7번 |

- **legacy 티켓에서 `req:doctor`가 왜 FAIL하는지 이유를 말합니다** (REQ-2026-102).

  소비 저장소에서 "legacy 티켓은 아무 조치도 할 수 없는데 `req:doctor`만 FAIL 3건을 낸다"는
  개선 요청을 받았습니다. 실측해보니 **`legacy`에는 두 축이 있고 서로 겹치지 않았습니다** —
  `req:new`를 막지 않는 축(HEAD의 durability marker)과 `req:review-codex`를 막는 축(state의
  모델 버전)입니다. 보고해 주신 티켓 4건은 **전부 리뷰가 가능한 상태**였습니다. 즉 아직
  리뷰·커밋으로 진행할 수 있고, 브랜치 축 검사(D2/D3/D11)는 정확히 그것을 지키고 있었습니다.

  `req:commit`은 `req:doctor`를 하드 게이트로 실행하므로, 요청하신 대로 면제하거나 WARN으로
  낮추면 **그 티켓들이 main에서 커밋 가능해집니다.** 그래서 **동작은 그대로 두었습니다.**

  대신 FAIL 메시지가 이유를 말합니다: durability marker가 없어 종결을 검증할 수 없다는 것,
  진행 중이면 feature 브랜치에서 작업하라는 것, 그리고 **이미 끝난 티켓이면 지금은 이 FAIL을
  해소할 수단이 없다**는 것까지 그대로 알립니다. 없는 해결책을 안내하지 않기 위해서입니다.

  함께 정정한 것: `req:close --abandon`이 legacy 티켓을 거부하며 대던 이유
  "legacy 티켓은 intake를 막지 않으므로 **탈출구가 필요 없습니다**"가 **더 이상 사실이 아니었습니다.**
  0.17.0에서 "종결"에 새 효용(브랜치 축 면제)이 생기면서, 끝난 legacy 티켓에도 종결 표시가
  필요해졌기 때문입니다. 이제 남아 있는 갭을 사실대로 알립니다.

  ⚠️ **아직 없는 것**: 끝난 legacy 티켓을 종결로 표시할 경로는 여전히 없습니다. 이번 변경은
  그 사실을 **숨기지 않고 말하는 것**까지이고, 경로 신설은 별도 과제입니다.

- **Quick Start 블록이 낡았을 때 알려줍니다 — 그리고 그 블록에 테스트 실행 규칙을 넣었습니다** (REQ-2026-101).

  `commitgate quickstart`는 처음부터 낡은 블록을 **교체**할 수 있었지만, `req:doctor`는 블록이
  **아예 없을 때만** 알렸습니다. 그래서 블록 내용이 개정돼도 이미 설치된 저장소는 아무 신호를 받지
  못했고, 신호가 없으니 아무도 갱신하지 않았습니다. 지금까지 블록을 한 번도 개정하지 않아 드러나지
  않던 구멍입니다.

  이제 **D21이 부재와 드리프트를 구분해서** 알립니다. 이번 릴리스가 그 첫 사례입니다 — Quick Start
  블록에 아래 한 줄이 추가됐습니다:

  > 테스트는 phase 진행 중엔 **변경한 소스를 import하는 것만**, **전체 스위트는 통합 직전 1회** 돌린다.

  **기존 저장소에서 하실 일**: `req:doctor`가 D21 WARN으로 알려주면 `npx commitgate quickstart --apply`
  한 번이면 됩니다. ⚠️ 마커(`<!-- commitgate:quickstart -->`) **안쪽을 직접 수정하셨다면 그 수정은
  덮어써집니다** — 마커 안은 도구가 관리하는 영역입니다. D21은 **WARN이라 아무것도 차단하지 않으므로**
  원치 않으시면 갱신하지 않고 계속 쓰셔도 됩니다.

  참고로 이 조사에서 **tsx 기동 제거는 하지 않기로 했습니다.** 기동 비용은 실재하지만(482→73ms)
  곱해질 자리가 없었습니다 — 소비자 저장소 109개 티켓의 실측 결과 티켓 시간의 86~91%는 "리뷰 라운드
  사이"(수정+테스트)였고 명령 기동은 0.2% 미만이었습니다. 그래서 그 축 대신 이 규칙의 **전달**을 고쳤습니다.

- **테스트를 매 phase마다 전부 돌리지 않도록 실행 시점을 규정했습니다** (REQ-2026-100).

  "적용한 프로젝트에서 변경 하나마다 스위트·CI에 수십 분이 걸린다"는 제보에서 시작했습니다.
  원인을 실측했더니 **CommitGate는 테스트를 강제한 적이 없었습니다** — `req:doctor`·`req:commit`
  어디에도 테스트를 실행하는 코드가 없고, `req.config.json`에 테스트 설정도 없으며, `init`이
  CI를 심지도 않습니다. 문제는 `req:new`가 만드는 `02-plan.md`의 `Exit:` 문구에 **범위와 시점이
  없어서** 에이전트가 매 phase마다 전체 스위트로 해석했다는 것이었습니다.

  이제 스캐폴드와 `AGENTS.md` 템플릿이 실행 시점을 명시합니다:

  | 시점 | 범위 |
  |---|---|
  | phase 진행 중 | 변경한 소스를 import하는 테스트 |
  | **통합(main 병합) 직전 1회** | **전체 스위트** |

  **전체 스위트를 줄이는 변경이 아닙니다.** 회귀 판정의 권위는 그대로 전체 스위트이고, main에
  도달하는 경로에는 전량 검증이 그대로 남습니다. 옮긴 것은 **시점**입니다 — phase 커밋은 feature
  브랜치라 되돌리기 싸고 main 병합은 비쌉니다. 이 기준점은 `stopGate` 값(`phase`/`req`/`merge`)과
  무관합니다(통합 승인은 어느 값에서나 필요하므로).

  ⚠️ **변경분만 자동으로 고르는 방식은 권하지 않습니다.** 실측했습니다 —
  `vitest run --changed HEAD~1`이 50파일 **전부**를 골라 **513초**가 걸렸습니다(전체 295초보다 느림).
  루트 파일 하나가 전 그래프를 무효화하고 모듈 그래프가 넓기 때문입니다.

  🔴 **기존 설치본에는 자동으로 반영되지 않습니다.** `AGENTS.md`는 `init`이 한 번 심은 뒤 여러분
  소유이고 `commitgate sync` 대상이 아닙니다(sync는 스키마 축과 persona만 다룹니다). 기존 저장소에
  적용하려면 위 표를 `AGENTS.md`에 직접 옮기시면 됩니다. 새 티켓의 `02-plan.md`는 이 버전부터
  새 문구로 생성됩니다.

  함께 정정한 것: `docs/development.md`(한/영)가 "전체 스위트를 돌리고 **게이트 판정도 이것을
  본다**"고 적고 있었는데 **사실이 아니었습니다.** 게이트는 테스트를 보지 않습니다.

## 0.17.0 (2026-08-01)

> 이번 묶음은 소비 저장소가 보고한 **두 건의 버그 리포트**에서 시작했습니다. 하나는 교착(승인이 나도
> 커밋할 수 없음)이고, 하나는 종결된 티켓의 진단이 영원히 실패하는 문제입니다. 그 둘을 고치는
> 과정에서 **도구 스스로가 거짓을 말하던 곳 두 군데**를 더 찾아 함께 고쳤습니다(REQ-098·099).

> **확인할 파일** — 각 항목이 어느 커밋에서 왔는지.
>
> | REQ · phase | 구현 커밋 | 확인할 파일 |
> |---|---|---|
> | 096 phase-1 (문자 집합 SSOT + 호출 전 가드) | `3a691d5` | `lib/scratch.ts`의 `ARCHIVE_BASE_RE`·`ARCHIVE_NAME_RE` · `req-next.ts`의 `PHASE_ID_RE`·`phaseModelProblems` · `review-codex.ts`의 `resolvePhaseTarget` |
> | 097 phase-1 (종결 티켓 브랜치 축 면제) | `53025bd` | `req-doctor.ts`의 `ticketTerminalEvent`·D2/D3/D11 · `docs/ssot-design/07-…md` §3.0 · `tests/unit/doctor-terminal-wiring.test.ts` |
> | 098 phase-1 (면적 경고 문구 정직성) | `dffa896` | `review-codex.ts`의 `phaseAreaMessage`(+`gate` 인자)와 그 호출부 · `tests/unit/review-lifecycle-wiring.test.ts`의 REQ-098 배선 테스트 |
> | 099 phase-1 (D-체크 표 정합 + 등록부) | `7b1a9b1` | `req-doctor.ts`의 `D_CHECK_IDS`·`CheckId` · `docs/ssot-design/07-…md` §3 표 · `tests/unit/docs-stale-claims.test.ts`의 REQ-099 가드 |

- **`req:doctor` 진단 목록 문서가 8건 누락돼 있던 것을 채우고, 재발을 막는 가드를 넣었습니다** (REQ-2026-099).

  설계 문서의 D-체크 정본 표가 "구현된 검사는 13개뿐이다"라고 적고 있었는데 실제로는 **21개**였습니다.
  D20~D27(자산 skew·Quick Start 백필·스크래치 보호·lockfile 위생·setup 게이트·미병합 종결 티켓·
  결속 끊긴 phase·승인 증인 불일치)이 표에 통째로 없었습니다. 여덟 건 모두 WARN 전용이라 차단 동작이
  잘못 적힌 것은 아니지만, 존재하는 진단을 문서로 알 수 없었습니다.

  이제 D-체크 id의 권위는 `req-doctor.ts`의 `D_CHECK_IDS` 등록부이고 **타입이 등재를 강제합니다** —
  등록부에 없는 id로는 검사를 추가할 수 없습니다. 여기에 등록부와 문서 표의 일치를 검사하는 테스트를
  더해, 다음에 검사가 추가될 때 문서가 조용히 뒤처지지 않습니다. **런타임 동작 변경은 없습니다.**

- **검수 면적 경고가 과금 여부를 거짓으로 안내하던 것을 고쳤습니다** (REQ-2026-098).

  `granularityGate`의 기본값은 `warn`이고, 그때 임계(8파일)를 넘겨도 **리뷰는 그대로 실행되고
  호출이 나갑니다.** 그런데 안내 문구는 `block` 모드를 가정해 쓰여 있어서, 기본 설정 사용자에게
  "리뷰를 실행하지 않았습니다 — 소모된 것이 없습니다"라고 **비용에 관한 거짓**을 말한 뒤 곧바로
  호출이 나갔습니다. 게다가 "정책을 끄려면 `"granularityGate": "warn"`"이라고 **이미 켜져 있는
  설정**을 권했습니다.

  이제 문구가 설정에 따라 갈라집니다. `warn`에서는 이 검사가 리뷰를 멈추지 않는다는 사실과, 실제로
  멈추게 하려면 `"granularityGate": "block"`이라는 것을 알립니다. `block` 모드 문구는 그대로입니다.
  **동작은 하나도 바뀌지 않습니다 — 출력 문자열만 바뀝니다.**

- **종결된 티켓에 `req:doctor`를 돌리면 항상 실패하던 문제를 고쳤습니다** (REQ-2026-097).

  티켓을 종결하고 브랜치를 병합·삭제하는 것은 **권장 운영**인데, 그 뒤 `req:doctor`가 D2(브랜치 일치)·
  D3(브랜치 존재)·D11(feature 브랜치)로 계속 FAIL을 냈습니다. 보고한 저장소에서는 종결 티켓 118건이
  전부 exit 1이었습니다. 그래서 `req:doctor`를 스크립트·CI의 건강 점검으로 쓸 수 없었고, 더 나쁘게는
  AGENTS.md 계약을 따르는 에이전트가 그 FAIL을 보고 **종결 티켓의 feature 브랜치를 되살리려 했습니다.**

  이제 종결이 **검증된** 티켓에서는 세 검사가 `OK`로 면제되고 사유(`종결 티켓(dev-complete) — …`)를
  남깁니다. 종결 판정은 `req:close`·`req:commit`와 **같은 술어·같은 입력**을 씁니다 — 파일 한 줄을
  만들어 게이트를 푸는 우회는 생기지 않습니다.

  **면제되지 않는 것**: 워킹트리 축(D10·D13)과 승인 축(D6·D9·D16)은 그대로입니다. 커밋 게이트는
  `commit_allowed`이므로 이 변경으로 **종결 티켓이 커밋 가능해지지 않습니다**(테스트로 고정).
  종결되지 않은 티켓의 동작은 **하나도 바뀌지 않습니다.**

- **phase id에 `_`나 `.`를 쓰면 승인이 나도 커밋할 수 없던 교착을 없앴습니다** (REQ-2026-096).

  소비 저장소(0.16.0)의 보고입니다. `req:next`가 통과시키는 phase id의 문자 집합(`_`·`.` 허용)과
  승인 아카이브 파일명의 문자 집합(`_`·`.` 불허)이 어긋나 있었고, phase id는 **무해화 없이** 그대로
  아카이브 파일명의 base가 됩니다. 그래서 `phase_1` 같은 id를 쓰면 도구가 `phase_1-r01-approved.json`을
  **쓰고 나서 그 파일을 자기 것으로 인식하지 못했습니다** — `req:doctor` D10이 워킹트리를 영원히
  더럽다고 보고, evidence 커밋이 아무것도 stage하지 못하며, `approvals.jsonl` 행도 쓸 수 없었습니다.
  증상이 D10으로 나타나 원인이 phase id 문자라는 것을 추적하기 어려웠습니다.

  이제 두 술어가 `lib/scratch.ts`의 **한 상수(`ARCHIVE_BASE_RE`)에서 파생**되어 갈라질 수 없습니다.

  **동작이 좁아지는 변경입니다.** `_`·`.`가 든 phase id는 이제 거부됩니다. 다만 그런 id로는 애초에
  커밋 가능한 승인을 만들 수 없었으므로(위 세 경로가 전부 막혔습니다) 동작하던 워크플로는 깨지지
  않습니다. 바뀌는 것은 **실패 지점과 메시지**입니다 — 추적 불가능한 D10 교착 대신, `req:review-codex`가
  **유료 리뷰 호출이 나가기 전에** 이유와 고치는 법을 말하고 멈춥니다. 시정은 `02-plan.md`와
  `state.json`의 `phases[].id`에서 `_`·`.`를 `-`로 바꾸는 것입니다.
  스키마는 그대로라 **`commitgate sync`가 필요 없습니다.**

## 0.16.0 (2026-08-01)

> 이번 묶음은 소비 저장소가 보고한 **한 건의 교착 사고**에서 나왔습니다. 승인이 실제로 있는데도 티켓을
> 종결할 수 없었고, 그 티켓 하나가 저장소 전체의 `req:new`를 막았습니다. 원인 사건을 없애는 **예방**과,
> 그래도 막혔을 때를 위한 **탈출구**를 함께 넣었습니다.
>
> **동작이 좁아지는 변경이 하나 있습니다**(REQ-2026-092). 지금까지 통과하던 staged 구성 하나가
> **phase 리뷰 시작 전에 거부**됩니다. 그 구성의 유일한 귀결이 복구 불가능한 교착이었으므로 의도된
> 차단입니다. 시정은 `git restore --staged` 한 번이고 **코드는 한 줄도 바뀌지 않습니다.**
> 스키마는 그대로라 **`commitgate sync`가 필요 없습니다.**

> **확인할 파일** — 각 항목이 어느 커밋에서 왔는지.
>
> | REQ · phase | 구현 커밋 | 확인할 파일 |
> |---|---|---|
> | 092 phase-1 (술어 SSOT + 리뷰 전 게이트) | `26ee07fc` | `lib/scratch.ts`의 `sourceCommitForbiddenStaged` · `review-codex.ts`의 `forbiddenStagedMessage`·`quotePathspec`·`mainImpl` 게이트 · `req-commit.ts`의 `stagedNames` |
> | 092 phase-2 (문서) | `66ce6d3b` | `docs/troubleshooting.md`·`.en.md` |
> | 093 phase-1 (`abandoned` + `--abandon`) | `97c531ca` | `lib/close-proof.ts`의 `abandoned`·`OPTIONAL_KEYS`·`verifiedTerminalEvent` · `req-close.ts`의 `runAbandon` · `lib/intake.ts` |
> | 093 phase-2 (문서) | `9ea57768` | `docs/troubleshooting.md`·`.en.md` |
> | 094 phase-2 (D27 진단) | `6d485ac4` | `lib/evidence.ts`의 `consumedApprovalsWithoutRow` · `req-doctor.ts`의 D27 |
> | 094 phase-3 (문서·CHANGELOG) | **이 커밋** | `docs/troubleshooting.md`·`.en.md` · 이 파일 |

- **여러 줄 커밋 메시지가 조용히 망가지지 않도록 안내합니다** (REQ-2026-095).

  소비 저장소에서 `req:commit -m`에 여러 줄 메시지를 넘겼더니 **본문이 사라지고** 줄바꿈이 리터럴
  `\n`으로 바뀐 커밋 6건이 main에 병합됐다는 보고를 받았습니다. 원인은 CommitGate가 아니라
  **패키지 매니저·`npx`의 인자 재직렬화**입니다 — 받는 시점에 이미 망가져 있어 복원할 수 없습니다.

  Windows 11 / Node 24 / npm 11 / pnpm 9에서 전 경로를 측정했습니다.

  | 호출 경로 | 여러 줄 `-m` |
  |---|---|
  | `npm run … -- -m` | 🔴 개행 **이후가 통째로 사라짐** |
  | `pnpm <script> -m` | 🔴 리터럴 `\n` 두 글자 |
  | `npx <명령>` · `pnpm exec <명령>` · `npx tsx <script>` | 🔴 개행 이후 사라짐 |
  | **`--message-file`** (모든 경로) | ✅ **온전** |

  🔴 **npm 쪽이 더 위험합니다.** pnpm은 이스케이프해 내용이 남지만 npm·npx는 **조용히 버립니다** —
  도구도 사용자도 탐지할 수 없습니다. `packageManager: "npm"`이면 더 조심하세요.

  `--message-file`은 **이전부터 있었고**(0.7.0, REQ-2026-018) 모든 경로에서 온전합니다. 문제는
  **정본 안내가 그것을 가리키지 않았다**는 것이었습니다 — `req:next`가 내는 커밋 명령이 항상 `-m`이었고,
  에이전트 계약은 그 명령을 그대로 실행하라고 합니다. 이번 릴리스가 그 자리를 고칩니다.

  - `req:next`의 커밋 안내에 **여러 줄용 `--message-file` 명령이 함께** 나옵니다(사람 확인 경로와
    LOW 자동 커밋 경로 **둘 다**). RUN 명령 자체는 그대로 실행 가능한 `-m` 형태를 유지합니다.
  - **`-F`** 를 `--message-file`의 별칭으로 받습니다(`git commit -F` 규약).
  - 리터럴 `\n`이 있고 실제 개행이 없으면 **경고**합니다. 🔴 **고치지는 않습니다** — 본문에 정말
    `\n`이라고 쓴 경우와 구별할 수 없기 때문입니다. 차단도 하지 않습니다.
    그리고 이 경고는 **npm의 조용한 절단을 잡지 못합니다**(흔적이 남지 않습니다).

  한 줄 메시지는 `-m`으로 계속 써도 안전합니다.

- **유실된 승인 기록을 `req:doctor`가 알려 줍니다** (REQ-2026-094).

  승인이 소비될 때 도구는 `responses/approvals.jsonl`에 그 행을 **먼저** 커밋합니다. 그러니 "소비
  기록은 있는데 행이 없다"는 것은 그 커밋이 사라졌다는 뜻입니다(revert·force-push·잘못된 병합).
  그 상태에서는 티켓을 종결할 수 없는데, 지금까지 **`req:doctor`는 PASS를 내며 침묵**했습니다 —
  D26이 매니페스트에 *행이 있는* phase만 보기 때문입니다.

  이제 **D27**이 그것을 봅니다.

  ```text
  [req:doctor] WARN D27: 🔴 소비된 승인인데 매니페스트에 행이 없습니다 — 증거가 유실됐고
     이 상태로는 티켓을 종결할 수 없습니다.
     해당 phase: phase-1b
  ```

  🔴 **그 기록은 복구할 수 없고, 복원 명령도 제공하지 않습니다.** 승인 핀(`approved_at`·
  `response_sha256` 등)은 소비와 동시에 `state.json`에서 지워지므로 되살릴 근거가 남지 않습니다.
  값을 추정해 채우는 복원은 **승인 기록의 날조**입니다. 그래서 D27은 실제로 가능한 두 경로만 안내합니다 —
  **그 phase를 다시 수행**하거나, 끝낼 수 없으면 **`req:close --abandon`으로 종결**하는 것.

  **경고일 뿐 아무것도 막지 않습니다**(`req:doctor`는 계속 PASS로 끝납니다). 진단이 스스로 새 교착을
  만들지 않기 위해서입니다. 오탐도 없습니다 — 정상 진행 중인 티켓, 완료된 티켓, 그리고 HIGH 티켓에서
  `req:confirm`이 남기는 중간 체크포인트 어디에서도 뜨지 않습니다.

- **끝낼 수 없는 티켓을 명시적으로 포기해 종결할 수 있습니다** (REQ-2026-093).

  `req:new`는 미종결 durable 티켓 **하나**로 저장소의 모든 후속 작업을 막습니다. 그런데 지금까지 그
  상태에서 빠져나오는 길은 **완료뿐**이었습니다. 설계 전제가 무너졌거나 요구가 철회돼 완료할 수 없는
  티켓에는 출구가 없었고, 남은 방법은 감사 파일 직접 편집이었습니다.

  종결 이벤트 3종 중 사람이 쓸 수 있는 것이 하나도 없었기 때문입니다.

  | 이벤트 | 왜 못 쓰나 |
  |---|---|
  | `dev-complete` | 완료해야 나옵니다 |
  | `migrated-complete` | `req:close --migrate`가 **부분 완료 티켓을 명시적으로 거부**합니다(완료를 사후 확인하는 명령이므로) |
  | `series-terminal` | **열린 리뷰 series**를 요구하는데 교착 티켓은 대개 그 반대이고(모두 승인으로 닫힘/리뷰 이력 없음), 애초에 그 값을 기록하는 명령이 없었습니다 |

  이제 `req:close --abandon`이 있습니다.

  ```sh
  npx commitgate req:close 2026-004 --abandon \
    --reason "설계 전제가 무너져 이 접근을 폐기" \
    --confirm "PM 승인 2026-08-01" --run
  ```

  🔴 **포기는 되돌리기가 아닙니다.** `ticket-close.jsonl`에 **선언 한 줄만** 추가합니다 — 이미 커밋된
  phase 증거·승인 매니페스트·설계 승인·리뷰 원장은 **한 바이트도 바뀌지 않고 히스토리에 남습니다.**
  커밋된 phase가 있으면 실행 전에 개수를 알려 줍니다.

  사유와 승인 문장이 **둘 다 필수**이고, 시각은 **도구가 실제 시계에서** 찍습니다(사람이 적어 넣는
  자리를 만들지 않습니다). 기본은 dry-run이고 `--run` 후에만 씁니다. 이후 `req:new`는 그 티켓을
  `abandoned`로 **표시하며** 통과시킵니다 — 완료로 보고하지 않습니다.

  완료 증거가 항상 이깁니다: 실수로 포기 행이 남아도 실제로 완료된 티켓은 여전히 `dev-complete`로
  보고됩니다. 그리고 포기는 **복원 대상이 아닙니다**(`req:reconstruct`) — 사유·승인 문장은 그 사람만
  아는 값이라 도구가 지어낼 수 없기 때문입니다.

  기존에 커밋된 close-proof 행은 **그대로 유효**합니다. 새 필드 두 개는 선택 필드이고, 그 키가 없는
  기존 행은 정상으로 취급합니다(그렇지 않으면 업그레이드만으로 완료 티켓이 손상 판정을 받아 `req:new`가
  전부 막혔을 것입니다).

- **커밋할 수 없는 승인이 만들어지지 않습니다** (REQ-2026-092).

  소비 저장소에서 **phase 승인이 실제로 존재하는데도 어떤 명령으로도 티켓을 종결할 수 없는** 교착이
  보고됐습니다. 그 티켓 하나가 `req:new` intake 게이트를 통해 **저장소 전체의 후속 작업**을 막았고,
  남은 탈출구는 감사 파일 직접 편집뿐이었습니다.

  원인은 두 명령이 "유효한 staged tree"를 **다르게 정의**한 것입니다.

  ```
  리뷰:  git write-tree(인덱스 전체)를 무검사로 승인 바인딩
  커밋:  (a) staged tree == 승인 해시   ∧   (b) state.json·responses/ 는 staged 금지
  ```

  리뷰 시점 인덱스에 `state.json`이 있으면 그 tree가 그대로 승인되고, 이후 (a)와 (b)는 **동시에 참이 될
  수 없습니다** — 유지하면 (b) 위반, unstage하면 tree가 달라져 (a) 위반. 승인 행은 `req:commit`의
  evidence-finalize에서만 기록되므로 **승인 사실이 영원히 매니페스트에 남지 못하고**, 그 행을 유일한
  증거 출처로 삼는 `req:reconstruct`·`req:rebind`·`req:close --migrate`가 전부 거부합니다.

  중간의 D10이 못 막은 이유는 판정식이 `index === '?' || worktree !== ' '`라 **staged이고 워킹트리가
  clean한 상태를 아예 보지 않기** 때문입니다. `git add -A`가 이 경계를 조용히 넘었습니다.

  이제 **phase 리뷰를 시작하기 전에** 같은 술어로 검사하고 거부합니다. 유료 호출·예산 차감·attempt
  기록·부기 커밋 **어느 것도 일어나기 전**입니다.

  ```text
  phase 리뷰를 시작할 수 없습니다 — 승인해도 커밋할 수 없는 staged 구성입니다.
  리뷰를 실행하지 않았습니다 — 소모된 것이 없습니다.

  워크플로 파일이 staged에 있습니다(req:commit이 source 커밋에서 금지하는 경로):
    workflow/REQ-2026-001/state.json

  해소:
    git restore --staged -- workflow/REQ-2026-001/state.json
  ```

  판정은 `req:commit`이 쓰는 것과 **같은 순수 술어**(`sourceCommitForbiddenStaged`)이고, 두 명령이
  **같은 방식으로 얻은 같은 바이트**를 넣습니다. 술어만 공유해서는 부족합니다 — 리뷰 개발 중 실제로,
  `req:commit`이 staged 경로를 `--name-only`(개행 split + `trim()`)로 읽는 한 선행 공백이 든 **다른
  파일**을 리뷰는 통과시키고 커밋은 현재 티켓 것으로 오인해 **같은 교착이 재현**된다는 것이
  드러났습니다. 그래서 `stagedNames()`도 `-z` 기반으로 교정했습니다.

  🔴 **`req:commit`의 staged 경로 판독이 달라집니다.** 예전 구현(`--name-only` + 개행 split +
  `trim()`)에는 **서로 독립된 두 오류 원인**이 있었고, 판정이 바뀌는 경로는 그 둘 중 하나에
  걸리는 것뿐입니다. 두 경우 모두 **이전이 틀렸습니다.**

  | 원인 | 걸리는 경로 | 왜 틀렸나 |
  |---|---|---|
  | **① `trim()`** — git 출력은 멀쩡한데 코드가 다듬었다 | 앞뒤에 **공백**이 있는 경로 | ` <t>/state.json`은 Git에서 **다른 파일**인데 금지 경로로 오인해 정상 리뷰·커밋을 막음 |
  | **② `-z` 부재** — git이 경로를 C-인용하거나 split이 깨진다 | 큰따옴표 `"` · 역슬래시 `\` · 개행·탭 등 제어문자 · (`core.quotePath` 기본값에서) 비ASCII | `"a\"b.ts"`처럼 인용된 표시 문자열로 읽혀 접두사 비교가 빗나가 진짜 위반을 **놓침**(fail-open). 개행은 split 자체를 쪼갬 |

  ①은 git 출력이 원본 그대로였는데도 코드가 바꾼 경우이고, ②는 git 출력 자체가 원본이 아니었던
  경우입니다 — **원인이 다르므로 어느 한쪽으로 뭉뚱그릴 수 없습니다.** `"`·`\`가 든 이름
  (예: `src/a"b.ts`)도 ②에 **포함**됩니다. 두 원인 어디에도 걸리지 않는 경로 — 실무의 거의 전부 —
  에서는 판독이 완전히 동일합니다.

  design 리뷰는 대상이 아닙니다. 설계 승인은 `approved_diff_hash`를 설정하지 않아 위 (a)∧(b) 충돌이
  구조적으로 불가능하고, 게이트를 걸면 설계 문서만 staged인 정상 경로를 막을 위험만 생깁니다.

  ⚠️ **이미 교착에 빠진 티켓은 이 변경으로 풀리지 않습니다.** 이번 릴리스는 **예방**입니다.
  복구 경로(승인 행 복원)·명시적 포기 경로·`req:doctor` 가시성은 별도 REQ로 이어집니다.

## 0.15.0 (2026-07-30)

> **동작이 좁아지는 변경은 없습니다.** 설계 리뷰 프롬프트에 참고 블록이 추가되고 재결속 안내 문구가
> 정확해질 뿐입니다. 스키마도 그대로라 **`commitgate sync`가 필요 없습니다.**
>
> minor인 이유: 리뷰어에게 가는 **프롬프트 계약에 블록이 추가**되기 때문입니다(리뷰 판정에 영향을 줄 수 있는
> 입력 변경). 다만 **커밋된 phase가 없으면 프롬프트는 바이트 단위로 0.14.1과 동일**합니다 —
> 첫 설계 리뷰(가장 흔한 경로)는 아무것도 달라지지 않습니다.
>
> 이 릴리스의 두 항목은 모두 소비 repo의 **0.14.1 운영 이력 실측**에서 출발했습니다.

> **REQ-2026-091은 두 커밋으로 나뉘어 들어왔습니다.**
>
> | phase | 구현 커밋 | 확인할 파일 |
> |---|---|---|
> | phase-1 (커밋된 phase 블록) | `852c0576` | `scripts/req/review-codex.ts`의 `committedPhaseIds`·`shippedPhasesBlock`·`assembleReviewPrompt`의 `shippedPhaseIds` |
> | phase-2 (안내 시점·CHANGELOG) | **이 커밋** | `scripts/req/req-next.ts`의 `staleBindingNotice` · 이 파일 |

- **설계 리뷰어가 "이미 커밋된 phase"를 알게 됩니다** (REQ-2026-091).

  소비 repo 실측에서 나온 비용 구조입니다. 최근 7개 티켓에서 **design 호출 31 vs phase 호출 34** — 거의
  1:1이고, **design 승인이 2회 이상인 티켓은 예외 없이 `req:rebind`가 필요**했습니다. 연쇄는 이렇습니다.

  ```
  계획 한 줄 수정 → D13 freshness가 전체 해시 일치 요구 → 설계 재승인 강제
                 → 앞선 phase 전량 좌초 → 끝에서 phase 수만큼 rebind
  ```

  🔴 그 연쇄를 **시작시키는 것**이 이번 수정 대상입니다. 설계 리뷰 프롬프트에는 00/01/02 문서만 들어가서
  **리뷰어가 어느 phase가 이미 커밋됐는지 알 수 없었습니다.** 실제로 어느 티켓에서는 phase-1이 커밋된
  **뒤에** "Phase 1은 red 테스트를 계획하지 않았다"가 P1으로 나왔고, 그 P1을 닫으려 계획을 고치자
  재승인 → 좌초 → rebind로 이어졌습니다. **리뷰어 잘못이 아닙니다 — 알 방법이 없었습니다.**

  이제 커밋된 phase가 있으면 프롬프트에 참고 블록이 붙습니다.

  ```
  # 이미 승인·커밋된 phase (참고 사실)
  - phase-1-app-image

  이 phase들의 코드는 이미 커밋됐다 — 설계 문서를 수정해도 그 코드는 바뀌지 않는다.
  따라서 이 phase의 결함을 실제로 고치는 경로는 후속 REQ다.
  이 사실을 severity 판단에 반영하라. 판단은 당신의 것이다 …
  ```

  🔴 **severity를 정해주지 않습니다.** 초안에는 "이 설계 승인을 막는 근거가 아니다"라고 썼는데,
  **설계 리뷰가 P1으로 반려**했습니다 — 그렇게 쓰면 이미 커밋된 phase의 **보안 구멍이나 정상 경로 요구
  위반**도 `observations`로 새어 P1 분류가 우회된다는 지적이었습니다. 맞는 지적이라 **사실**(이미 커밋됨)과
  **경로**(후속 REQ)만 주고 판단은 리뷰어에게 남기도록 고쳤습니다.

  🔴 **커밋된 phase가 없으면 프롬프트가 바이트 단위로 이전과 동일합니다.** 첫 설계 리뷰가 가장 흔한
  경로라 거기에는 아무것도 더하지 않습니다. D13·`design_hash`·phase 결속 모델은 **그대로**입니다 —
  이 변경은 재승인의 *빈도*를 줄이는 것이고, 재승인이 앞선 phase를 좌초시키는 안전 속성은 유지됩니다.

- **재결속 안내가 "지금"이 아니라 "티켓을 닫기 전에"라고 말합니다** (REQ-2026-091).

  0.14.0이 넣은 안내가 *"지금 재결속하지 않으면…"*이었는데, **지금 하면 헛일이 될 수 있습니다.**
  rebind 행의 `to_design_ref`는 그때의 design_ref라, 이후 설계가 또 재승인되면 그 행은 산입되지 않아
  **다시 재결속해야** 합니다. 조기 실행은 커밋 1개와 확인 문장 1개를 버리는 셈입니다.

  이제 시점을 정확히 말하고, 설계가 안정된 뒤 한 번에 하라고 안내합니다.

## 0.14.1 (2026-07-30)

> 🔴 **0.14.0 이하를 쓰는 Stage B 설치본은 이 버전으로 올리세요.** `req:rebind`·`req:confirm`이
> `commitgate <verb>` 경로에서 **실행 즉시 죽었습니다.** 그 둘은 각각 "설계 재승인으로 막힌 티켓"과
> "HIGH 위험 티켓의 커밋 차단"을 푸는 **유일한 명령**입니다.
>
> Stage A 설치본(`tsx scripts/…` 직접 실행)은 영향이 없었습니다. 스키마 무변경 → `commitgate sync` 불요.

> **REQ-2026-090은 두 커밋으로 나뉘어 들어왔습니다.**
>
> | phase | 구현 커밋 | 확인할 파일 |
> |---|---|---|
> | phase-1 (runCli 계약 복구) | `018ff8b1` | `scripts/req/req-rebind.ts`·`scripts/req/req-confirm.ts`의 `runCli` · `bin/commitgate.mjs`의 계약 검사 · `tests/unit/dispatch.test.ts` |
> | phase-2 (CHANGELOG) | **이 커밋** | 이 파일 |

- 🔴 **`req:rebind`와 `req:confirm`이 실행 즉시 죽던 문제를 고쳤습니다** (REQ-2026-090).

  ```
  TypeError: mod.runCli is not a function   (bin/commitgate.mjs)
  ```

  `bin/commitgate.mjs`는 dispatch 대상이 모두 `runCli(argv)`를 export한다고 가정하는데, **10개 중 2개가
  그 계약을 어기고 있었습니다.** 둘 다 오류 경계는 있었지만 `isMain` 블록에 **인라인**돼 export되지 않았습니다.

  🔴 **두 명령 모두 도구 자신이 처방하는 해법이라 더 나빴습니다.**

  | 막힌 상황 | 도구가 안내하던 명령 |
  |---|---|
  | 설계 재승인으로 phase 결속이 끊겨 티켓이 안 닫힘 | `req:rebind` |
  | HIGH 위험 티켓의 커밋 차단 | `req:confirm` |

  특히 **0.14.0이 방금 추가한 D26과 `staleBindingNotice`가 가리키는 명령이 `req:rebind`였습니다** —
  진단은 좋아졌는데 처방이 실행되지 않았습니다. `req:confirm`은 HIGH 티켓의 유일한 탈출구라
  죽으면 빠져나갈 길이 없었습니다.

  **왜 지금까지 안 잡혔나**: 이 저장소는 **Stage A**(`tsx scripts/…` 직접 실행)로 dogfooding하는데,
  그 경로는 dispatch를 거치지 않습니다. **Stage B 소비자**(`commitgate <verb>`)만 정면으로 맞았습니다.
  `smoke`도 전 verb의 *package.json 설치*는 검사했지만 실제 호출은 `req:doctor` 하나뿐이라,
  "설치 배선은 맞는데 모듈이 실행 가능한가"는 보지 않았습니다 — 가드는 있었는데 **틀린 것을 재고** 있었습니다.

  이제 `VERB_MODULES`의 **모든 대상을 실제로 import**해 `runCli` 계약을 단언하는 테스트가 있고,
  계약이 깨진 채 배포돼도 사용자는 원시 TypeError 대신 **진단 가능한 오류**를 봅니다.

  > **`main` 폴백은 넣지 않았습니다.** `(mod.runCli ?? mod.main)(...)`은 한 줄로 증상을 지우지만
  > 오류 경계가 조용히 사라져 스택트레이스가 그대로 새어 나옵니다. 계약을 지키게 하는 것이 수정이지
  > 위반을 관용하는 것이 수정이 아닙니다. 그 금지도 테스트로 고정했습니다(실제 subprocess 실행).

  ⚠️ 오류 문구 접두어가 `req:rebind:`/`req:confirm:` → **`commitgate:`**로 바뀝니다(나머지 8개와 동일).
  판정·부작용은 그대로입니다.

## 0.14.0 (2026-07-30)

> **동작이 좁아지는 변경은 없습니다.** 새 진단(`req:doctor` **D26**)과 측정 로그 필드가 추가될 뿐이고,
> 둘 다 아무것도 막지 않습니다. 스키마도 바뀌지 않아 **`commitgate sync`가 필요 없습니다.**
>
> 이 릴리스의 두 REQ는 모두 소비 repo의 **0.13.1 운영 이력 실측**에서 출발했습니다 —
> 그중 하나는 점검 도중 그 repo에서 **실제로 발생한 종결 교착**입니다.

> **REQ-2026-089는 두 커밋으로 나뉘어 들어왔습니다.**
>
> | phase | 구현 커밋 | 확인할 파일 |
> |---|---|---|
> | phase-1 (면적 기록) | `6bfd13ab` | `scripts/req/review-codex.ts`의 `ReviewCallLogRow` 3필드·`buildReviewCallLogRow`의 `phaseArea`·preflight verdict 보존 |
> | phase-2 (CHANGELOG) | **이 커밋** | 이 파일 |

- **phase 검수 면적 판정이 측정 로그에 남습니다** (REQ-2026-089).

  REQ-2026-086이 옮겨 놓은 면적 판정은 초과 시 **경고 한 줄을 출력하고 사라졌습니다.** 그래서
  "경고가 몇 번 났고 몇 번 무시됐는가" — 즉 **정책이 효과가 있는가**에 답할 수 없었습니다.
  실제로 소비 repo를 감사할 때 파일 수를 커밋에서 사후에 역산해야 했습니다.

  `.review-calls.jsonl`(측정 전용 로그)에 세 값이 추가됩니다.

  ```json
  { "code_file_count": 14, "granularity_over": true, "granularity_limit": 8 }
  ```

  `granularity_limit`이 함께 있어야 **당시 판정을 재현**할 수 있습니다 — 임계는 `phases[].max_files`
  선언으로 phase마다 다르고 config로도 바뀌므로, 개수만으로는 "그때 넘었는가"를 알 수 없습니다.

  🔴 **파일 경로·이름은 남기지 않습니다.** REQ-2026-045가 세운 "개수/해시만, 내용배제" 계약 그대로입니다 —
  목록을 남기면 이 로그가 측정 로그가 아니라 코드 이력이 됩니다. design 리뷰는 판정 대상이 아니므로
  세 값이 모두 `null`입니다(`0`이면 "면적 0"과 "측정 대상 아님"이 구별되지 않습니다).

  판정 로직·임계·게이트 동작은 **바뀌지 않습니다.** 이미 하던 판정을 버리지 않고 기록할 뿐입니다.

> **REQ-2026-088은 두 커밋으로 나뉘어 들어왔습니다.** 아래 항목의 구현은 이 커밋이 아니라 **같은 브랜치의 앞선 커밋**에 있습니다.
>
> | phase | 구현 커밋 | 확인할 파일 |
> |---|---|---|
> | phase-1 (사전 안내) | `12e62271` | `scripts/req/req-next.ts`의 `staleBindingNotice`·`resolveNext` wrapper · `scripts/req/req-doctor.ts`의 D26 |
> | phase-2 (문서) | **이 커밋** | `docs/workflow.md` · `docs/workflow.en.md` · 이 파일 |

- 🔴 **설계를 다시 승인해 앞선 phase의 결속이 끊기면 이제 그 자리에서 알려줍니다** (REQ-2026-088).

  소비 repo에서 실제로 일어난 일입니다. 한 티켓이 설계를 **네 번** 승인받는 동안 앞선 세 phase가 옛
  `design_hash`에 묶인 채 남았고, **4개 phase를 전부 완료·커밋한 뒤에야** `dev-complete`가 발행되지 않는다는
  것을 알게 됐습니다. 그 시점엔 다음 `req:new`까지 막힌 상태였습니다.

  판정에 필요한 데이터는 **이미 커밋된 매니페스트에 전부 있었습니다.** 다만 그것을 읽는 곳이
  `req:new` 차단 시점과 `req:close --migrate` 거부 시점 — **둘 다 이미 갇힌 뒤**뿐이었습니다.

  이제 `req:next`가 진단 줄에 실행할 명령을 그대로 붙이고, `req:doctor`가 **D26**으로 같은 사실을 냅니다.

  ```
  - ⚠️ 설계 재승인으로 앞선 phase의 결속이 끊겼습니다 — 지금 재결속하지 않으면 마지막 phase를 마쳐도 티켓이 닫히지 않습니다.
  - npx commitgate req:rebind REQ-2026-086 --phase phase-1-x --confirm "rebind REQ-2026-086 phase-1-x" --run
  ```

  🔴 **아무것도 막지 않습니다.** `req:next`의 판정(`kind`·`detail`·`command`)은 그대로고 진단만 늘어납니다.
  D26도 **WARN 상한**입니다 — FAIL이면 재결속에 필요한 남은 phase를 커밋조차 못 하는 교착이 됩니다.
  결속이 온전한 티켓에는 **한 줄도 붙지 않습니다.**

  판정·안내는 `req:new` 차단과 `req:close --migrate` 거부가 쓰는 것과 **같은 함수**(`splitUnboundPhases` +
  `recoveryGuidance`)입니다. 다시 구현하면 한쪽이 권한 명령을 다른 쪽이 거부하는 상태(REQ-2026-072가 고친
  결함)가 재발합니다. `phase_design_ref`가 없는 레거시 phase에는 `req:rebind` 대신 `--migrate`를 권하는
  분기도 그대로 물려받습니다.

## 0.13.1 (2026-07-29)

- 🔴 **granularity 게이트 기본값을 `warn`으로 되돌립니다 — 워크플로가 면적 때문에 멈추지 않습니다** (REQ-2026-087).

  0.13.0은 기본값을 `"block"`으로 냈습니다. 막다른 길은 아니었습니다 — 소모되는 것이 0이고(attempt·원장·커밋
  무생성) 탈출구가 셋이었습니다(staging 축소 / `phases[].max_files` 선언 / `granularityGate: "warn"`).
  그러나 **자동으로 넘어가지 않는 정지**라 자율 워크플로가 거기서 끊깁니다. 그 대가가 정책의 이득보다 크다는
  것이 사용자 판단이고, 이 릴리스가 그것을 반영합니다.

  **바뀐 것은 기본값 한 줄뿐입니다.** 판정 시점(리뷰 호출 직전)과 두 탈출구 안내는 그대로입니다 —
  이 정책의 실제 가치는 강도가 아니라 **시점**이기 때문입니다. 예전 D18은 *커밋 직전*에
  *"다음부터 분할 권고"*라는 행동 불가능한 조언을 냈지만, 리뷰 직전이면 시정이 `git restore --staged`
  (staging 재구성)라 쌉니다. 경고만으로도 그 이득은 남습니다.

  | `granularityGate` | 동작 |
  |---|---|
  | `"warn"` (**기본**) | 경고 후 리뷰 진행 — 멈추지 않습니다 |
  | `"block"` | 리뷰를 실행하지 않습니다(opt-in, 기능은 그대로) |

  이미 `"granularityGate"`를 명시한 설정은 **영향이 없습니다**(명시값 우선). 동작이 **넓어지는** 방향이라
  이 업그레이드로 새로 막히는 것은 없습니다. **스키마는 바뀌지 않았으므로 `commitgate sync`도 불요합니다.**

  > **자동 분할을 넣지 않은 이유**: 도구는 어떤 파일이 함께 검수돼야 하는지 알 수 없습니다. 임의로 staging을
  > 절반만 남기면 빌드가 깨진 중간 트리가 생기고, phase 승인은 트리에 결속되므로 **깨진 트리를 승인**하게 됩니다.
  > 큰 리뷰 한 번보다 나쁩니다. 어디서 자를지는 사람의 판단으로 남깁니다.

## 0.13.0 (2026-07-29)

> ⚠️ **업그레이드 시 확인**: 이 릴리스는 **동작을 좁힙니다**(REQ-2026-086 — 8파일 초과 phase가 리뷰 전에 막힙니다).
> 되돌리려면 `req.config.json`에 `"granularityGate": "warn"` 한 줄입니다.
>
> 🔄 **정정(0.13.1)**: 위 기본값은 **0.13.1에서 `"warn"`으로 되돌렸습니다.** 0.13.1 이상에서는 기본 설정이
> 면적 때문에 멈추지 않습니다 — 차단이 필요하면 `"granularityGate": "block"`을 명시하세요.
> 아래 서술은 0.13.0 시점의 사실로 보존합니다.
>
> 또한 `machine.schema.json`·`req.config.schema.json`이 모두 바뀌었으므로, 업그레이드 후 `req:doctor`가
> **D20 WARN**(자산 skew)을 내면 **`npx commitgate sync`**로 재동기화하세요(FAIL 아니며 게이트를 막지 않습니다).
>
> 이 릴리스의 세 REQ는 모두 소비 repo의 **0.11.0 운영 이력 실측**(리뷰 호출 68회)에서 출발했습니다.

> **REQ-2026-086은 두 커밋으로 나뉘어 들어왔습니다.** 아래 항목의 구현은 이 커밋이 아니라 **같은 브랜치의 앞선 커밋**에 있습니다.
>
> | phase | 구현 커밋 | 확인할 파일 |
> |---|---|---|
> | phase-1 (리뷰 전 면적 판정) | `2b205849` | `scripts/req/review-codex.ts`의 `phaseCodeFiles`·`judgePhaseArea`·`declaredPhaseMaxFiles`·`phaseAreaMessage`와 phase preflight · `scripts/req/lib/config.ts`의 `granularityGate` · `workflow/req.config.schema.json` |
> | phase-2 (D18 문구·문서) | **이 커밋** | `scripts/req/req-doctor.ts`의 `phaseGranularityWarnings` · `docs/workflow*.md` · 이 파일 |

- 🔴 **너무 큰 phase는 이제 리뷰 전에 멈춥니다 — 동작이 좁아지는 변경입니다** (REQ-2026-086).

  소비 repo 실측에서 phase 26개 중 **18개(69%)가 권고치(8파일)를 초과**했고, 초과 phase의 평균 리뷰
  라운드는 **2.39**였습니다(≤8파일은 1.38). D18은 매번 WARN을 냈고 매번 무시됐습니다 — 무시에 비용이
  없었고(`절대 FAIL 아님`), **무엇보다 시점이 커밋 직전이라 이미 늦었습니다.** 그때 "쪼개라"는 말은
  이미 짠 코드를 되돌리라는 뜻이라, 합리적인 작업자라면 리뷰를 한 번 더 받는 쪽을 택합니다.

  이제 판정은 **`req:review-codex`가 phase 리뷰를 실행하기 직전**에 일어납니다. 이 시점의 시정은
  코드 재작성이 아니라 **staging 재구성**(`git restore --staged`)이라 쌉니다. 차단은 예산 게이트·attempt
  기록·원장 커밋보다 **앞**이라 **소모되는 것이 없습니다** — 되돌릴 상태가 남지 않습니다.

  탈출구는 둘이고 메시지가 둘 다 제시합니다.

  | 선택 | 방법 |
  |---|---|
  | A. 지금 나눈다(권장) | `git restore --staged <뺄 파일들>` → 빼낸 파일은 `phases[]`에 항목을 추가해 다음 phase로 |
  | B. 원래 크다고 선언한다 | `phases[]`의 해당 항목에 `"max_files": <실제 개수>` (기계적 일괄 변경 등) |

  `max_files`는 `state.json`에 남고 그 파일은 커밋되므로 **선언이 기록**됩니다. 값은 1 이상의 정수여야
  하며 그 밖의 값은 거부됩니다 — 오타 하나로 게이트가 조용히 기본값으로 되돌아가면 선언자는 자기가
  선언했다고 믿게 됩니다.

  ⚠️ **업그레이드 시 진행 중이던 큰 phase가 멈춥니다.** 그것이 이 변경의 목적이라 조용히 넘기지 않습니다.
  이전 동작으로 되돌리려면 `req.config.json`에 **`"granularityGate": "warn"`** 한 줄이면 됩니다(경고만 내고 진행).
  임계는 `granularityMaxFiles`(기본 8)로 바꿉니다. design 리뷰는 영향받지 않습니다.

  `req:doctor`의 **D18은 WARN 그대로**입니다. 거기서 FAIL로 올리면 이미 Codex 승인을 받은 phase가
  커밋되지 못하고 승인도 소비되지 않는 **교착**이 됩니다(`req:commit`이 doctor를 하드 게이트로 spawn합니다).

  > 개발 중 Codex 리뷰가 P1을 하나 잡았습니다. 파일 목록을 `git diff --cached --name-only`로 읽었는데,
  > 기본 `core.quotePath=true`에서 **비ASCII 경로는 C-quote된 표시 문자열**로 나옵니다. 그러면 티켓 내부
  > 경로가 제외되지 않아 코드가 0줄인데도 면적 초과로 리뷰가 막힙니다. `-z`(NUL 구분, 인용 없음)로 고치고
  > 한글 파일명 회귀 테스트를 넣었습니다.

> **REQ-2026-085는 다섯 커밋으로 나뉘어 들어왔습니다.** 아래 항목의 구현은 이 커밋이 아니라 **같은 브랜치의 앞선 커밋**에 있고, 작업 트리의 해당 파일에서 지금 바로 확인할 수 있습니다.
>
> | phase | 구현 커밋 | 확인할 파일 |
> |---|---|---|
> | phase-1 (죽은 state.phase 제거) | `f3dbf5d4` | `scripts/req/req-new.ts`의 `buildInitialState` · `scripts/req/review-codex.ts`의 `loadState`·`contextPhase` · `scripts/req/req-doctor.ts`의 D11 |
> | phase-2 (부기 표식 — 고빈도) | `bade6f50` | `scripts/req/lib/bookkeeping.ts`(신설) · `lib/state-checkpoint.ts` · `lib/evidence.ts` · `req-commit.ts` |
> | phase-3 (부기 표식 — lifecycle) | `733ed2ee` | `scripts/req/req-close.ts`·`req-rebind.ts`·`req-reconstruct.ts`·`req-review-exception.ts` · `bin/delivery.ts` · `tests/unit/bookkeeping.test.ts`의 전수 스캔 |
> | phase-4 (D25) | `b1d02374` | `scripts/req/req-doctor.ts`의 `unmergedClosedTickets`·D25 · `scripts/req/lib/config.ts`의 `trunkBranch` · `workflow/req.config.schema.json` |
> | phase-5 (문서·CHANGELOG) | **이 커밋** | `docs/workflow.md` · `docs/workflow.en.md` · 이 파일 |

- 🔴 **`req:doctor`가 "끝났는데 아직 병합 안 된 티켓"을 알려줍니다 — D25** (REQ-2026-085).

  소비 repo 실측에서 **`dev-complete`까지 정상 종결된 티켓 6개가 15시간 동안 trunk 밖에 쌓여** 있었습니다.
  게다가 각 브랜치가 다음 브랜치의 조상이라 **순서를 바꿔 병합하거나 하나만 되돌릴 수 없는** 상태였습니다.
  `stopGate: "merge"`는 "병합은 사람이 한다"는 선언인데, **도구는 그 사람이 실제로 했는지 어디서도 보지
  않았습니다.** 사람이 `git branch --merged`를 직접 치기 전에는 알 길이 없었습니다.

  판정 근거는 **커밋된 종결 증거**(`responses/ticket-close.jsonl`)가 trunk 트리에 있는가입니다 —
  병합 후 브랜치를 지우는 정상 운영에서도 오탐이 없습니다. 검사 중인 티켓 자신은 세지 않습니다.

  **WARN일 뿐 아무것도 막지 않습니다.** trunk 이름은 `req.config.json`의 `trunkBranch`(기본 `"main"`)이고,
  `null`이면 꺼집니다. 로컬에 그 ref가 없으면 조용히 통과합니다 — 오탐은 진짜 경고까지 죽입니다.

- **`git log`에서 코드 커밋만 볼 수 있습니다** (REQ-2026-085).

  실측 구간에서 108커밋 중 **79개(73%)가 부기 커밋**이었고 실제 코드는 23개(21%)였습니다. 부기 커밋 수는
  내구성의 대가라 **줄이지 않았습니다**(원장은 외부 호출 *전에* 커밋돼야 실패한 시도가 기록에 남습니다).
  대신 도구가 만드는 커밋 **11자리 전부**에 trailer를 답니다.

  ```bash
  git log --oneline --invert-grep --grep=^CommitGate-Bookkeeping:\ true
  ```

  subject 규약(`chore(REQ-…)`)이 아니라 trailer인 이유는 **사람도 같은 subject를 쓰기 때문**입니다 —
  trailer라야 손으로 쓴 커밋이 함께 숨지 않습니다. `req:commit -m "…"`으로 만드는 소스 커밋에는 붙지 않습니다.
  테스트가 소스를 전수 스캔해 커밋 자리 하나라도 빠지면 실패합니다.

  ⚠️ 표식은 **이 릴리스 이후 커밋에만** 있습니다. 이전 히스토리는 이 필터로 걸러지지 않습니다.

- **죽은 `state.phase`를 제거했습니다 — 리뷰 프롬프트 오염과 D11 우회로가 함께 사라집니다** (REQ-2026-085).

  `req:new`가 `phase: "INTAKE"`를 한 번 쓰고 그 뒤 아무도 갱신하지 않아, **모든 티켓이 영원히 `INTAKE`**였습니다.
  단순히 죽어 있던 게 아닙니다:

  1. 리뷰 프롬프트의 Review Context가 이 값을 실어 **매 호출마다 리뷰어에게 `- phase: INTAKE`라는
     거짓 정보**를 토큰 써서 보냈습니다. 이제 진행 중인 phase(phase 리뷰면 그 대상, design 리뷰면 `current_phase`)가 들어갑니다.
  2. 🔴 **D11이 이 값으로 열렸습니다.** `phase !== 'DONE'` 조건이 앞에 붙어 있었는데 런타임은 `'DONE'`을
     어디에도 쓰지 않으므로 정상 경로에서는 늘 참 — 아무 기능이 없었습니다. 그런데 검사는 **워킹
     `state.json`**을 읽으므로, 손으로 `"phase": "DONE"`을 써 넣으면 `main` 위에서도 D11이 통과했습니다.
     조건을 없애 그 위조 경로만 닫았습니다. **정상 경로 판정은 완전히 동일합니다.**

  기존 티켓의 `state.json`에 값이 남아 있어도 무해합니다(읽는 코드가 없습니다). 마이그레이션은 없습니다.

> **REQ-2026-084는 세 커밋으로 나뉘어 들어왔습니다.** 아래 항목의 구현은 이 커밋이 아니라 **같은 브랜치의 앞선 커밋**에 있고, 작업 트리의 해당 파일에서 지금 바로 확인할 수 있습니다.
>
> | phase | 구현 커밋 | 확인할 파일 |
> |---|---|---|
> | phase-1 (risk_level 계약 축소) | `70b0c1c4` | `workflow/machine.schema.json`의 `properties.risk_level.deprecated` · `scripts/req/lib/adapters.ts`의 `dropDeprecatedProperties` · `scripts/req/review-codex.ts`의 `validateVerdict` |
> | phase-2 (invalid 예산) | `484ecc95` | `scripts/req/review-codex.ts`의 `voidAttempt`·`budgetCounts`·`checkReviewBudget` · `scripts/req/req-next.ts`의 G3 · `scripts/req/req-review-exception.ts`의 `planReviewException` |
> | phase-3 (CHANGELOG) | **이 커밋** | 이 파일 |

- **리뷰어에게 `risk_level`을 더 이상 묻지 않습니다** (REQ-2026-084).

  소비 repo의 리뷰 호출 68회를 감사한 결과, 응답 67건 중 **31건이 `risk_level: HIGH`**였고 그중 **7건은
  승인과 함께** HIGH였습니다. 그런데 티켓은 계속 `LOW`였고 사람 확인은 0회였습니다. 이 필드는 **어떤 게이트에도
  닿지 않았습니다** — 검증기가 값의 유효성만 보고 버렸고, 실제 판정은 `req:new` 때 정해지는 티켓 자신의
  `risk_level`(`req:commit`·`req:next`가 소비)이 합니다. 매 리뷰마다 묻고, 받아 적고, 버린 셈입니다.

  이제 리뷰어에게 가는 출력 스키마에서 **이 필드가 아예 빠집니다.** 리뷰어는 요청받지도, 방출할 수도 없습니다.

  🔴 **기존 증거는 하나도 깨지지 않습니다.** 검증 SSOT(`workflow/machine.schema.json`)는 root가
  `additionalProperties: false`라, property 정의를 지우면 `risk_level`을 담은 **과거 아카이브가 전부 구조
  부적합**이 됩니다(`req:doctor`의 D17·D9가 아카이브를 재검증합니다). 그래서 SSOT에는 property를 `deprecated`로
  **남기고** `required`에서만 뺐습니다. 리뷰어가 보는 strict 출력 스키마를 파생할 때만 탈락시킵니다 —
  `findings[].severity`를 P1로 좁힐 때(REQ-2026-018) 쓴 것과 같은 구조입니다. `machine_schema_version`도
  같은 이유로 **`1.1`을 유지**합니다(상향하면 정확 일치 검사로 전 아카이브가 무효가 됩니다).

  > **소비 repo 안내**: `machine.schema.json`이 바뀌었으므로 업그레이드 후 `req:doctor`가 **D20 WARN**
  > (자산 skew)을 낼 수 있습니다. `npx commitgate sync`로 재동기화하면 됩니다 — FAIL이 아니며 게이트를 막지 않습니다.

  이 변경은 **티켓의** `risk_level`·`stopGate`·HIGH 확인 경로를 건드리지 않습니다(REQ-2026-071의 결정 그대로).

- **리뷰어가 깨진 응답을 내도 빌더의 리뷰 예산이 깎이지 않습니다** (REQ-2026-084).

  소비 repo에서 실제로 일어난 일입니다: 한 phase의 시도 수가 **3인데 아카이브된 라운드는 2개**뿐이었습니다.
  2회차가 `invalid`(호출은 성공했지만 응답이 스키마·도메인 검증을 통과하지 못함, 49초 소모, 산출물 0)로
  끝났고, 그 회차가 정상 회차와 똑같이 예산을 소모했습니다. **리뷰어의 계약 위반인데 빌더가 대가를 치릅니다** —
  어려운 phase의 5회차에서 이런 일이 나면 곧바로 사람 예외 사유서(`req:review-exception`)를 써야 했습니다.

  이제 회차를 두 축으로 셉니다.

  | 계수 | 의미 | 자동 예산(`autoBudget`) | 절대 상한(`hardCap`) |
  |---|---|---|---|
  | `refunded_attempts` (기존) | 호출이 **나가지 않음**(pre-dispatch 실패) — 비용 0 | 차감 | 차감 |
  | `void_attempts` (신규) | 호출은 나갔고 **판정이 없음**(`invalid`) — 비용 발생 | 차감 | **차감 안 함** |

  🔴 **무한 루프는 여전히 불가능합니다.** `hardCap`은 실제로 나간 호출 수로 판정하므로, 리뷰어가 계속
  깨진 응답만 내도 8회에서 반드시 멈춥니다. 넓어진 것은 "사람 사유서 없이 자동으로 재시도할 수 있는 범위"뿐입니다.

  `req:next`의 예산 소진 안내도 같은 판정을 씁니다 — 한쪽만 고쳤다면 `req:next`는 "예산 소진(사람 결정 필요)"이라고
  하는데 `req:review-codex`는 그냥 통과시키는 모순이 생겼을 것입니다. 진단 줄이 두 계수를 각각 보여줍니다.

  옛 `state.json`(신규 계수가 없는 티켓)은 두 계수가 같은 값이 되어 **판정이 이전과 완전히 동일**합니다.

## 0.12.2 (2026-07-29)

> **REQ-2026-083은 세 커밋으로 나뉘어 들어왔습니다.** 아래 항목의 구현은 이 커밋이 아니라 **같은 브랜치의 앞선 커밋**에 있고, 작업 트리의 해당 파일에서 지금 바로 확인할 수 있습니다.
>
> | phase | 구현 커밋 | 확인할 파일 |
> |---|---|---|
> | phase-1 (안내 배선) | `3bf7760d` | `scripts/req/lib/adapters.ts`의 `CODEX_INSTALL_HINT` · `bin/init.ts`의 `setupGuidanceLines` · `bin/setup.ts` · `bin/check.ts` |
> | phase-2 (회귀 가드) | `c663e4df` | `tests/unit/codex-missing-guidance.test.ts` · `tests/unit/init.test.ts`의 "G-A" |
> | phase-3 (CHANGELOG) | **이 커밋** | 이 파일 |

- 🔴 **`npx commitgate init`의 설치 후 안내를 그대로 따르면 마지막에 막혔습니다 — 고쳤습니다** (REQ-2026-083).

  0.12.1 배포본을 격리 환경에 실설치해 확인한 결과, 안내가 `setup`을 **한 번도 언급하지 않았습니다.**
  `… → 설치분 커밋 → 무관한 변경 정리 → req:new`로 끝나는데, setup을 마치지 않으면 그 `req:new`가 차단됩니다.
  **따라 하면 막히는 절차**였습니다. 0.12.1이 `--help`에서 고친 것과 같은 결함인데 그때 범위를 `--help`로만
  잡아 놓쳤고, 오히려 이쪽이 더 나쁩니다 — `--help`는 일부만 치지만 **init 출력은 설치하는 사람 전원이 봅니다.**

  이제 순서가 **setup → 설치 커밋 → req:new**입니다. setup이 바꾸는 `req.config.json`은 그 자체가 설치
  산출물이라 안내가 인쇄하는 `git add --` 목록에 이미 들어 있고, 따라서 **한 번의 설치 커밋에 함께 담깁니다**
  — 추가 단계가 없습니다. 정상 경로와 `unsafe` 경로 **둘 다** 고쳤습니다.

  🔴 개발 중 이 순서를 한 번 틀렸습니다. 처음에는 setup을 설치 커밋 **뒤**에 뒀는데, 그러면 setup이 만든
  config 변경이 미커밋으로 남아 다음 `req:new`가 여전히 막힙니다 — 막히는 자리를 옮겼을 뿐이었습니다.
  Codex 리뷰가 이것을 P1으로 잡아냈고, 설계를 정정한 뒤 다시 승인받았습니다.

- 🔴 **codex가 없다고 말하면서 설치 방법은 알려주지 않았습니다** (REQ-2026-083).

  `npm i -g @openai/codex`를 **런타임에 말하는 곳은 `--help` 단 하나**였습니다. 정작 사용자가 막히는 자리
  셋은 "설치·PATH를 확인하세요"라고만 했습니다 — 신규 PC에서 막다른 길입니다.

  | 표면 | 이제 함께 주는 것 |
  |---|---|
  | `init` 설치 후 안내 | `codex --version   # … 없으면 설치: npm i -g @openai/codex (설치 후 새 터미널에서 …)` |
  | `setup` — codex 미설치 | 같은 설치 명령을 오류 메시지에 동반 |
  | `check` — C2 실패 | 같은 설치 명령을 진단 행에 동반 |

  표기는 공유 상수 `CODEX_INSTALL_HINT` 한 곳에서 정합니다. **새 터미널 안내**를 함께 넣은 이유는,
  Windows에서 전역 설치 직후 `codex`를 못 찾는 것이 PATH 갱신 문제인데 그때 사용자가 **설치가 실패했다고
  오해**하기 때문입니다 — 설치 명령만 주면 같은 자리에서 두 번 막힙니다.

  ✅ **미로그인 경로는 건드리지 않았습니다.** 실측으로 정상 동작을 확인했습니다 — 안내 후 `codex login`을
  실제로 실행하고, 재검증해서, 실패하면 실행 가능한 다음 명령을 줍니다. 고칠 것이 없는 곳은 만지지 않았습니다.

  회귀 가드 두 개를 추가했습니다. 🔴 둘 다 **실제 사용자 대면 경로를 실행**합니다 — 처음에는 메시지 빌더를
  직접 호출해 검사했다가 리뷰에서 P1을 받았습니다. 그 방식은 표면이 빌더를 **더 이상 호출하지 않게** 바뀌어도
  통과합니다. 두 가드 모두 변이 검사로 실제 검출을 확인했습니다.

## 0.12.1 (2026-07-28)

> **REQ-2026-082는 세 커밋으로 나뉘어 들어왔습니다.** 아래 두 항목의 구현은 이 커밋이 아니라 **같은 브랜치의 앞선 커밋**에 있고, 작업 트리의 해당 파일에서 지금 바로 확인할 수 있습니다.
>
> | phase | 구현 커밋 | 확인할 파일 |
> |---|---|---|
> | phase-1 (도움말) | `0ac5554b` | `bin/init.ts`의 `HELP_TEXT` · `tests/unit/init.test.ts`의 "`--help` ↔ dispatch 정합" |
> | phase-2 (랜딩) | `0db00cd3` | `README.md` · `README.en.md` |
> | phase-3 (문서 정합) | **이 커밋** | `docs/quick-start.md`/`.en.md` · 이 CHANGELOG |

- **대문이 "이미 git·npm을 아는 사람"만 상대하고 있었습니다 — 비개발자가 끝까지 따라올 수 있게 고쳤습니다** (REQ-2026-082 phase-2, 구현 커밋 `0db00cd3`).

  랜딩의 정확성·정직성은 유지 대상이었습니다. 문제는 난이도가 아니라 **전제**였습니다 — 설명 없는 용어가 스무 개 가까이 되고, 가장 어려운 문장(`clean 워킹트리`·`stage`·`-A`/`.`)이 하필 "3분 설치" 바로 아래 있었습니다.

  🔴 **비용을 어디서도 말하지 않았습니다.** 준비물 표는 `codex --version`만 확인시켰지, 리뷰가 Codex를 **실제로 호출**해 계정 사용량·요금을 쓴다는 사실이 랜딩에도 Quick Start에도 없었습니다. 금액·플랜명은 적지 않습니다(검증할 수 없고 바뀝니다) — 대신 **재리뷰 상한**(자동 5회 · 6~8회는 사람 예외 · 9회부터 차단)을 함께 적어 되돌아가는 화살표가 무한 반복이 아님을 밝혔습니다.

  같은 비용·상한 진술을 [Quick Start](docs/quick-start.md)의 준비물 표에도 넣었습니다(이 커밋) — 랜딩만 고치면 두 문서가 갈라지고, 설치를 실제로 따라 하는 사람은 Quick Start를 봅니다.

  🔴 **"승인 문장"의 실물이 없었습니다.** "통제점에서 승인 문장을 주면 된다"고만 적혀 있어 **무엇을 타이핑해야 하는지** 알 수 없었습니다. `req:next`가 실제로 인쇄하는 `AWAIT_HUMAN` 블록과 그에 대한 답(`req:commit --run 승인`)을 주고받는 한 턴으로 실었습니다.

  전체 stage 금지에 **이유**(민감정보가 딸려가 그대로 외부로 전송됨)를 붙이고 복사해 칠 수 있는 커밋 블록으로 바꿨습니다. 시작 조건은 **행동**(`git init`·`npm init -y`)으로, 그리고 **막혔을 때** 절을 신설해 읽기 전용 진단 `npx commitgate check`를 1차 도구로 세웠습니다 — 이 명령은 그전까지 랜딩에 **한 번도** 나오지 않았습니다.

  그 밖에 독자 분기 한 줄 · Node 배지 · 흐름도 세로 압축(33→25줄) · `req:*`와 `npx commitgate <verb>`의 **호출 방식이 다르다**는 것이 보이도록 명령표 분리 · 접이식 용어 사전 13항목 · 되돌리기 안내를 더했습니다.

  🔴 **보장은 약화하지도 과장하지도 않았습니다.** 안전 4문구와 보안 경고 2건은 위치·바이트 그대로이고, `docs-stale-claims` 가드가 "사람 확인 없이는 커밋되지 않습니다" 류의 과잉 약속이 새로 들어오지 못하게 막습니다.

- **`npx commitgate --help`가 필수 단계인 `setup`을 몰랐습니다** (REQ-2026-082 phase-1, 구현 커밋 `0ac5554b`).

  도움말은 `init`·`migrate`·`uninstall` 3개만 안내했지만 실제로 dispatch되는 verb는 그보다 많았고(`setup`·`check`·`sync`·`quickstart`·`delivery`), "설치 후" 순서도 `codex 확인 → … → 첫 티켓 생성`이라 **setup 없이 `req:new`로 가서 막히는 순서**였습니다. 터미널에서 `--help`부터 치는 사용자는 필수 단계를 모른 채 진행했습니다.

  등록된 verb를 모두 안내하고 setup을 첫 순서에 놓았습니다. `tests/unit/init.test.ts`가 **dispatch 테이블과 도움말 문자열을 교차 검증**합니다 — 새 verb를 등록하고 도움말을 잊으면 그 시점에 실패합니다.

- **0.12.0의 호환성 깨짐 안내가 정작 업그레이드 문서에 없었습니다 — 채웠습니다** (REQ-2026-081).

  0.12.0은 이 프로젝트의 **첫 호환성 깨짐**(Node 18 → 20)인데, `docs/upgrade.md`에는 버전별 절 자체가 없어 안내할 자리가 없었습니다. 0.11 사용자가 바로 그 문서를 열어 볼 상황이었습니다.

  **버전별 주의사항** 절을 만들고 `0.11 → 0.12`를 넣었습니다 — 실측한 `EBADENGINE` 출력, 기본 설치(경고만)와 `--engine-strict`(설치 실패)의 차이, 그리고 **선택지 세 갈래**를 표로 담았습니다.

  🔴 그중 가장 중요한 것: **0.11로 내려가도 멈춤 현상은 해결되지 않습니다.** 그 문제는 어느 버전에서도 고쳐지지 않았고, 0.12는 원인을 고친 것이 아니라 **나타나던 조건(Node 18)을 지원 대상에서 뺀 것**입니다.

  [보장과 한계](docs/guarantees.md)의 지원 범위 표에 **런타임 행**(Node 20·22·24 검증 · 18 미지원 · 20은 EOL이지만 의도적 지원)을, [문제 해결](docs/troubleshooting.md)에 `EBADENGINE` 항목을 추가했습니다. [개발·현재 범위](docs/development.md)에는 테스트 상한 30초의 근거와 교착 조사용 프로브 워크플로를 적었습니다.

## 0.12.0 (2026-07-28)

- 🔴 **호환성 깨짐 — Node 18을 더 이상 지원하지 않습니다. 최소 Node 20입니다** (REQ-2026-080).

  `engines.node`가 `>=18.17` → **`>=20`**, CI 매트릭스가 `[18, 20, 22]` → **`[20, 22, 24]`**로 바뀝니다. Node 18에서는 설치 시 경고가 뜨고, `--engine-strict` 환경에서는 **설치가 실패**합니다.

  **왜**: `macos-latest · node 18`에서만 테스트 스위트가 간헐적으로 교착했습니다(REQ-2026-077이 20% 재현·원인을 vitest 워커의 JS 루프까지 좁힘). 같은 커밋의 node 20·22는 매번 통과했습니다. Node 18은 **2025-04-30 EOL**로 15개월이 지났습니다.

  🔴 **이것은 "고쳤다"가 아니라 "지원하지 않기로 했다"입니다.** 교착의 근원 원인은 **여전히 모릅니다** — REQ-2026-079의 `pool: 'threads'` 시도는 실패했고 되돌렸습니다. Node 18을 되돌리면 **교착도 함께 돌아옵니다.**

  조사용 `hang-probe.yml`의 Node 버전 고정값(18)은 입력으로 뺐습니다(기본 22) — 워치독·증거 수집 도구의 가치는 유지하고 낡은 값만 없앴습니다.

  ⚠️ **Node 24는 이 저장소에서 처음 검증됩니다.**


- **랜딩 앞부분이 실제 동작과 달랐고, 읽기 어려웠습니다 — 다시 썼습니다** (REQ-2026-078).

  🔴 **흐름도가 틀렸습니다.** `req:commit` 옆에 "사람이 확인"이 붙어 있어 **저장할 때마다 사람이 멈추는 것**으로 읽혔는데, 기본 설정(`stopGate: "req"`)에서는 작업 중간의 저장이 사람 정지 없이 진행되고 확인은 **작업이 끝나는 지점과 합치는 지점**에서만 요구됩니다. REQ-2026-071이 바꾼 동작인데 랜딩 그림이 그 전 상태를 그리고 있었습니다. (REQ-2026-073이 문서 본문의 같은 오류를 고쳤지만 랜딩 그림은 대상이 아니었습니다.)

  그림을 **반복과 관문**이 보이는 형태로 다시 그렸습니다 — 검사에 걸리면 위로 돌아가고, 통과해야 아래로 내려가며, 사람은 루프 밖 마지막에 있습니다.

  첫 화면에서 **내부 용어 12종**(`P1`·`stale`·`AWAIT_HUMAN`·`staged tree`·`git add`·`--sandbox` 등)을 없앴습니다. AI에게 코딩을 시키는 사람이 git 스테이징을 몰라도 **무엇을 막아 주는 도구인지** 알 수 있어야 하기 때문입니다.

  🔴 **안전 4문구는 한 글자도 바꾸지 않고 옆에 풀이를 붙였습니다.** 그 문장들은 정확해서 정본입니다 — 쉽게 만든다고 정확성을 깎으면 이 문서가 하는 유일한 약속이 흐려집니다. 보안 경고 2건도 표현만 쉬워졌고 **세 가지 사실**(변경 내용이 통째로 외부로 나감 · 그 변경 밖의 파일도 읽힘 · 우회 가능)은 그대로입니다.


- **`macos · node 18` 스위트 교착의 원인을 특정했습니다** (REQ-2026-077 · 조사).

  `hang-probe.yml`(수동 실행 전용)로 **10회 중 2회(20%) 재현**했고, 워치독이 프로세스를 죽이기 **전에** `ps`와 스택(`sample`)을 수집해 원인을 좁혔습니다.

  🔴 **테스트가 하나도 실행되기 전에 멈춥니다.** 교착한 잡의 vitest 출력은 배너 한 줄(104바이트)뿐입니다 — 특정 테스트가 아니라 **vitest 기동 경로**의 문제입니다. 스택상 vitest 본체는 `kevent`에서 대기하고, **워커가 JS 루프에서 회전**합니다(1560/1560 샘플).

  🔴 **앞서 적은 "esbuild 고아 프로세스가 원인"은 틀렸습니다.** 샘플에서 esbuild는 두 인스턴스 모두 놀고 있었습니다 — 부모가 죽지 않아 남은 **피해자**이지 원인이 아닙니다.

  파일 하나만 돌려도 재현되므로 **파일 병렬 설정(REQ-2026-044·075)과 무관**하다는 것도 확정됐습니다.

  권고는 vitest 업그레이드이며, 검증에는 ⚠️ **31회 이상**이 필요합니다 — 기저율 20%에서 아무것도 고치지 않아도 우연히 0건이 나올 확률이 10회면 **10.7%**, 30회면 **0.124%**, 31회에서야 **0.099%**로 0.1% 아래가 됩니다. 구현은 후속 REQ입니다.


- **교착한 CI 잡이 6시간이 아니라 20분 만에 끝납니다** (REQ-2026-076).

  `timeout-minutes`가 없어 GitHub 기본값 **360분**이 적용되고 있었습니다. 2026-07-27 `macos-latest · node 18`이 두 번 교착했고(각각 35분·13.6분 시점에 사람이 손으로 취소), 그중 한 번은 **0.11.0 릴리스 CI를 통째로 막았습니다** — REQ-2026-075가 넣은 `concurrency`가 `main` 실행을 직렬화하기 때문입니다.

  🔴 **20분인 이유**: 실측 최장은 windows의 **7.0분**입니다. 그 약 3배로 두어, 더 조였을 때 러너 변동으로 **정상 실행이 죽어 거짓 red**가 나는 것을 피합니다.

  🔴 **두 번째 목적은 로그입니다**: GitHub는 **진행 중인 잡의 로그를 주지 않습니다.** 그래서 오늘 원인을 보려면 잡을 죽여야 했습니다 — 진단하려면 증거를 없애야 하는 상태였습니다. 타임아웃으로 종료되면 로그가 남고, 그것이 후속 근원 원인 조사의 전제입니다.

  ⚠️ **"교착을 실제로 잡는다"는 아직 검증되지 않았습니다** — 관측된 교착은 간헐적이고 재현 절차가 없습니다. 지금 확인된 것은 **정상 실행을 죽이지 않는다**는 것뿐입니다.

## 0.11.0 (2026-07-27)

- **테스트 스위트가 507초에서 310초로 줄었습니다** (REQ-2026-075).

  REQ-2026-044가 hang을 없애려고 `fileParallelism: false`(전면 직렬)를 넣었는데, **그 사이의 값**이 시도되지 않았습니다. hang 조건은 `동시 워커 수 × 워커당 스폰`이고 **워커 상한이 그 곱을 묶습니다** — `maxWorkers: 2`로 47파일 2237 tests가 **310초**에 통과합니다(직렬 507초 대비 1.64배, hang 없음).

  🔴 **왜 2인가**: GitHub 러너는 4 vCPU이고, 워커 수가 코어 수에 닿으면 REQ-044의 hang 조건으로 되돌아갑니다. 그 **절반**에서 멈춥니다. 되돌리려면 `fileParallelism: false`로 복귀하면 이전 동작과 정확히 같아집니다.

  🔴 **`npm test`의 범위는 그대로입니다** — 변경분만 돌리는 방식은 쓰지 않습니다. 2026-07-27 `readme-landing.test.ts`가 README만 고친 변경에서 깨졌고 **Codex 리뷰 2회가 그것을 통과시켰습니다.** 전체 스위트만이 잡았습니다.

- **CI가 같은 브랜치의 이전 실행을 취소합니다** (REQ-2026-075). 🔴 단 **`main`과 태그는 취소하지 않습니다** — 이 저장소는 direct push 후 CI를 **사후 검증**으로 쓰므로, 앞 실행이 취소되면 그 커밋이 검증됐다는 기록 자체가 사라집니다. `refs/tags/*`는 `refs/heads/main`과 다른 ref라 두 조건을 모두 적어야 릴리스 검증이 살아남습니다.

- **README를 훑어서 이해되는 구조로 재구성했습니다** (REQ-2026-074).

  앞 세 절이 같은 가치 제안을 산문으로 세 번 말하고 있어서, 그림이 잡히려면 **세 번째 절까지 읽어야** 했습니다. 하나로 합치고 **ASCII 흐름도**를 넣었습니다 — 다만 그림 아래 한 문단은 남깁니다. 그림은 호출 관계를 보여 줄 뿐 **"승인된 그 tree만 커밋된다"**는 계약을 말하지 못하기 때문입니다.

  보장(3건)과 경고(외부 전송·git hook 부재)가 떨어져 있어 **보장만 읽고 내려가면 경고를 지나칠 수 있었습니다.** 한 절로 붙이되 두 경고는 표 밖 강조 블록으로 유지했습니다 — 표는 훑기 위한 것이고 이 둘은 읽어야 하는 것입니다.

  **준비물 표를 신설**해 설치 절차 앞에 두었습니다. Codex CLI가 없으면 설치는 성공하고 **리뷰 단계에서** 막히는데, 그 사실이 다른 문서에만 있었습니다. `stopGate`도 한 문장에서 표로 올렸습니다.

  🔴 **정보를 지운 것이 아니라 재배치·압축입니다.** 절 11 → 9, 표 24 → 40행. companion skills · `/req` 예시 · 첫 응답 예시 · 명령표 · 문서 표는 전부 남아 있습니다. 한/영 같은 구조입니다.

- 🔴 **문서가 이미 없어진 안전 속성을 계속 보장한다고 쓰고 있었습니다 — 바로잡았습니다** (REQ-2026-073).

  REQ-2026-071이 "HIGH 위험 티켓은 설정과 무관하게 매 phase 확인"이라는 백스톱을 **의도적으로 제거**했는데, 문서 5곳이 그 백스톱을 그대로 약속하고 있었습니다. `docs/workflow.md`는 **같은 파일 안에서 앞뒤가 모순**이었습니다(28행은 옛 계약, 192행은 새 계약). 보장 문서가 실제보다 강한 약속을 하면 읽는 사람이 그 약속을 믿고 자기 검토를 생략합니다.

  🔴 **완화 사실을 숨기지 않습니다.** [보장과 한계](docs/guarantees.md)의 *보장하지 않는 것*에 그 백스톱이 **더 이상 없다**는 것과, 필요하면 `stopGate: "phase"`로 되돌리는 법을 적었습니다. 문장이 사라진 것과 보장이 없어진 것은 읽는 사람에게 다르게 보이지 않기 때문입니다.

  정지 지점 기술의 **정본을 한 곳**(`docs/workflow.md`의 "HIGH 위험 티켓의 사람 확인")으로 두고 나머지 문서는 그리로 링크합니다 — 이번 결함 자체가 같은 사실을 세 곳에 온전히 쓰면 갈라진다는 증거입니다.

- **README가 필수 설치 단계를 빠뜨리고 있었습니다** (REQ-2026-073). "3분 시작"이 `install` + `init` 두 단계만 보여 줬는데, `commitgate setup`을 마치지 않으면 `req:new`가 **막힙니다** — 따라 하면 막히는 안내였습니다. 3단계로 고치고, setup이 **사람 전용 대화형** 명령이라는 제약과 `stopGate` 선택(기본값 `req`)을 함께 적었습니다.

- **setup이 무엇을 묻는지**를 [Quick Start](docs/quick-start.md)에 적었습니다 — 3문항·↑/↓ 선택·기본값(`gpt-5.6-terra` / `medium` / `req`)·모델 3종과 "직접 입력" 항목. [에이전트 가이드](docs/agent-prompt.md)에는 `setup`·`req:confirm`이 **에이전트가 실행하지 않는 명령**임을 명시했습니다.

- 알려진 거짓 문장이 문서로 되돌아오지 않도록 **고정 목록 회귀 가드**를 두었습니다(`tests/unit/docs-stale-claims.test.ts`). 🔴 문서-코드 일치를 일반적으로 판정하는 스캐너가 **아닙니다** — 표현을 바꾼 같은 거짓말은 사람 리뷰의 몫입니다.

- 🔴 **낡은 `dev-complete`로 티켓이 영구히 막히던 결함을 고쳤습니다** (REQ-2026-072 · 소비자 버그리포트).

  `dev-complete`가 발행된 뒤 phase를 하나 더 붙이면서 설계를 재승인하면, 그 완료 증거는 **옛 `design_ref`를 담은 채 낡습니다.** 그러면 intake는 `developing`(차단)으로, `req:close --migrate`는 "이미 종결"(no-op)로 읽어 **지원 명령 3개가 모두 거부**했습니다 — 감사 로그를 손으로 고치는 것 말고는 탈출구가 없었습니다.

  🔴 원인은 **"이미 종결"을 판정하는 술어가 두 곳에서 서로 달랐던 것**입니다(한쪽은 *검증된* 완료, 다른 쪽은 *행의 존재*). 이제 두 판정자가 **같은 함수**를 씁니다.

  🔴 **`--migrate`의 자격이 바뀝니다**: 끊긴 결속이 **전부 재결속 가능**하면 마이그레이션은 거부하고 `req:rebind`를 안내합니다. 사람 확인을 거치는 강한 경로가 살아 있는데 사후 스탬프(`reconstructed: true`)로 우회하면 감사 기록에서 두 종결이 구별되지 않기 때문입니다. `phase_design_ref`가 없는 진짜 레거시는 그대로 마이그레이션됩니다 — 지금까지 **완전히 교착이던 조합**이 여기서 열립니다.

  🔴 **`req:rebind`가 재진입 가능해졌습니다.** 재결속은 두 커밋(재결속 기록 → `dev-complete`)이고, 두 번째가 실패하면 재실행이 "이미 재결속됨"으로 거부돼 **완료 판정에 영영 닿지 못했습니다.** 이제 그것은 실패가 아니라 no-op이며 완료 판정까지 진행합니다. 티켓 스크래치가 사라졌으면 HEAD에 커밋된 `state.json`으로 판정하고, 그것도 비어 있으면 "아직 완료가 아니다" 대신 **판정하지 못했다는 사실**을 알립니다.

  🔴 **`req:new` 차단 메시지가 적용 가능한 명령만 제시합니다.** 재결속 가능하면 phase별 `req:rebind` 명령줄을, 레거시가 섞였으면 `req:close --migrate`를 냅니다 — 안내와 실제 판정이 **같은 생성기**에서 나오므로 갈릴 수 없습니다.

  실측: 이 저장소 HEAD의 durable 티켓 24개 전부에서 옛 술어와 새 술어의 판정이 **동일**했습니다(기존 데이터 무회귀).

- 🔴 **HIGH 위험 티켓의 확인 지점이 `stopGate`를 따릅니다 — 안전 속성 변경입니다** (REQ-2026-071).

  지금까지 HIGH 티켓은 `stopGate`와 **무관하게** 매 phase 커밋에서 멈췄습니다. 이제 확인 지점을 `stopGate`가 정합니다: `phase`=매 phase(현행 그대로) · `req`=**REQ를 완성시키는 커밋** · `merge`=`delivery integrate`.

  🔴 **HIGH 도 이제 중간 phase 는 자동 커밋됩니다**(`req`·`merge`). REQ-2026-037의 "HIGH는 어느 값에서도 매 phase 정지"를 **의도적으로 완화**한 것입니다 — 정지 지점을 `stopGate`가 단독으로 정한다는 것이 이 변경의 요구사항입니다.

  🔴 **확인이 사라지는 값은 없습니다.** 세 값 모두 도구가 강제하고, 확인 없이는 `dev-complete`가 발행되지 않아 종결도 통합 자격도 성립하지 않습니다. 바뀐 것은 **빈도**입니다.

  🔴 **`req`·`delivery` 범위는 아직 작성되지 않은 변경까지 미리 승인합니다.** `--scope req`는 "이 REQ의 남은 phase 전부"를 뜻합니다. 매 변경을 보고 승인하려면 `stopGate: "phase"`를 쓰세요.

  🔴 **범위는 크기 순서가 아니라 진술입니다** — 넓은 확인으로 좁은 지점을 통과할 수 없습니다. 그러면 `phase`가 보장하려던 "매 phase 새 확인"이 확인 한 번으로 사라집니다.

  🔴 **fail-closed 축은 그대로입니다**: `risk_level`이 `LOW`도 `HIGH`도 아니면(누락·오타·`MEDIUM`·손상) 어떤 `stopGate`에서도 자동 커밋하지 않고 사람에게 갑니다.

- **`req:confirm` — HIGH 확인을 기록하는 명령** (REQ-2026-071).

  🔴 지금까지 `user_commit_confirmed`를 넣는 방법은 **`state.json` 손편집**뿐이었습니다. 시각을 사람이 적어 넣는 방식이라 **지어낼 수 있었고**, 그것이 과거 한 REQ가 폐기된 사유입니다. 이 명령은 시각을 **실제 시계**에서 읽습니다.

  넓은 범위를 고르면 그 뜻("아직 작성되지 않은 변경까지 미리 승인")을 출력이 명시합니다.

- **쓸 수 없는 phase 리뷰를 호출 전에 막습니다** (REQ-2026-070).

  `state.json`의 `phases[]`를 채우지 않은 채 `--kind phase` 리뷰를 돌리면, 승인이 나와도 `req:commit`이 거부합니다(커밋 경로가 `phases[]`를 유효 id 목록으로 쓰므로 빈 목록에서는 어떤 phase 승인도 통과하지 못합니다). 지금까지는 **호출이 그대로 나가 유료 1회를 쓰고 나서야** `phase_id 비유효: null`로 실패했습니다.

  🔴 원인은 **빈 `phases[]`를 레거시로 단정**한 것이었습니다. `req:new`는 모든 새 티켓을 빈 배열로 초기화하므로, 길이만 보면 신규 티켓이 전부 레거시로 오인됩니다. 이제 `review_series_model_version` 유무로 구별하고, 신규 티켓이면 **호출·원장 기록·예산 차감보다 앞에서** 거부하며 고칠 방법을 알려 줍니다.

  🔴 **`--phase`를 조용히 버리지 않습니다.** 레거시 티켓이라도 반영할 수 없으면 거부합니다 — 무시되면 사용자가 자기가 지정한 phase에 승인이 붙었다고 잘못 믿습니다.

  예전 티켓(`phases[]` 추적 이전)의 phase 리뷰는 **그대로 동작**합니다.

- **설계를 다시 승인해도 티켓이 막히지 않습니다 — `req:rebind`** (REQ-2026-069).

  리뷰가 P1을 내면 설계 문서를 고치게 되고 그때마다 설계 재승인이 걸립니다. 지금까지는 그 순간 **앞서 승인된 phase가 옛 해시에 묶인 채** 남아 완료 증거(`dev-complete`)가 발행되지 않았고, **티켓 종결도 다음 REQ 생성도 막혔습니다.** 빠져나갈 길이 없었습니다 — phase 리뷰는 staged diff 범위인데 그 코드는 이미 커밋된 뒤입니다.

  > **실측**: REQ-2026-066·067(설계 4회 재승인)은 막혀 `req:close --migrate`로 우회했고, 재승인이 0회인 REQ-2026-068은 그대로 자가 종결했습니다.

  🔴 **재결속은 사람의 판단입니다.** "이 설계 변경이 그 phase의 검수를 무효화하는가"는 도구가 알 수 없으므로 확인 문구를 요구하고, 그 사실을 `approvals.jsonl`에 **append**합니다(누가·언제·어느 해시에서 어느 해시로). 기존 승인 행은 고치지 않아 원래 결속도 그대로 남습니다.

  재결속이 **마지막 남은 결속을 채우면 그 자리에서 `dev-complete`를 발행**해 티켓이 종결됩니다. 이게 없으면 결속만 고쳐지고 티켓은 막힌 채라 결국 `--migrate`로 우회해야 합니다 — **이 기능을 자기 자신에게 적용해 보고서야 드러난 누락**이었습니다.

  🔴 **자동 carry-forward는 만들지 않았습니다.** "설계가 바뀌어도 앞선 phase는 유효하다"를 기본값으로 두면 **D1으로 검토한 작업이 D2 완료로 새는** 경로가 그대로 열립니다. 재결속 기록이 없는 티켓의 동작은 이전과 동일합니다.

- 🔴 **기본 멈춤 지점이 `phase` → `req`로 바뀝니다** (REQ-2026-067). **안전 기본값을 완화하는 변경입니다.**

  `stopGate`를 **명시하지 않은** 프로젝트는 업그레이드만으로 **LOW 위험 phase가 사람 정지 없이 자동 커밋**됩니다. 사람 확인은 REQ가 끝날 때 한 번으로 모입니다. 매 phase 멈추던 기존 동작을 유지하려면 `req.config.json`에 `"stopGate": "phase"`를 명시하거나 `commitgate setup`에서 고르세요.

  🔴 **HIGH 위험 티켓은 어느 값에서도 매 phase 확인합니다** — 이 변경이 그 축을 건드리지 않습니다(`req:commit`의 Gate B가 이중 백스톱). `risk_level`이 없거나 이상한 값이면 자동 커밋하지 않고 사람에게 갑니다.

- 🔴 **기본 추론강도가 `high` → `medium`으로 바뀝니다** (REQ-2026-067).

  `reviewReasoningEffort`를 **명시하지 않은** 프로젝트는 리뷰가 얕아지고 그만큼 빨라·싸집니다. 기존처럼 깊게 쓰려면 `req.config.json`에 `"reviewReasoningEffort": "high"`를 명시하거나 `commitgate setup`에서 고르세요. 값을 이미 명시한 설정은 **영향이 없습니다**.

- **리뷰 모델을 목록에서 고릅니다** (REQ-2026-067).

  `commitgate setup`이 `gpt-5.6-sol` · `gpt-5.6-terra`(기본) · `gpt-5.6-luna`를 보여 줍니다.

  🔴 **enum이 아니라 추천 목록입니다** — 스키마는 그대로 자유 문자열이고, 목록 끝의 **"직접 입력…"**으로 어떤 모델이든 쓸 수 있습니다. enum으로 잠갔다면 다른 모델을 핀한 기존 프로젝트의 `req.config.json`이 스키마 위반으로 거부되어 그 프로젝트의 모든 명령이 막혔을 것입니다.

- **`commitgate setup`에서 값이 정해진 항목을 방향키로 고릅니다** (REQ-2026-067).

  추론강도·멈춤 지점처럼 선택지가 있는 질문은 ↑/↓로 고르고 Enter로 확정합니다(Ctrl+C 취소). 값을 정확히 타이핑할 필요가 없어졌습니다. **리뷰 모델은 정해진 목록이 없어 자유 입력 그대로**입니다.

  목록의 첫 줄이 **현재 값 유지**이고 커서가 거기서 시작합니다 — Enter만 누르면 아무것도 바뀌지 않는다는 기존 계약이 그대로입니다. 값을 비울 수 있는 항목에는 **비움(전역 상속)** 항목이 함께 나오고, 그 유무는 스키마가 정합니다(안내 문구와 같은 근거).

  🔴 **저장 계약은 그대로입니다** — 건드린 키만 기록 · 유지=미기록 · 원자적 저장 · 로그인 실패 시 미저장. 선택 UI는 `Prompter` 구현 안에서만 일어나고 확정값을 문자열로 반환하므로 해석·검증·저장 경로가 한 줄도 바뀌지 않았습니다(기존 setup 테스트가 무수정 통과).

  🔴 **raw mode를 못 쓰는 환경은 자유 입력으로 되돌아갑니다** — 위젯을 못 쓴다고 setup이 실패하지 않습니다. 비-TTY 거부 계약도 그대로입니다.

- **setup 시작 배너와 종료 시 커밋 안내를 추가했습니다** (REQ-2026-067).

  저장 후 `req.config.json`을 커밋하라고 안내합니다. 🔴 진행 중인 티켓이 있는 저장소에서 setup을 돌리면 커밋하지 않은 설정 변경이 `req:doctor`의 **D10·D13에 걸려 FAIL**합니다(소비자 프로젝트 실측). 커밋하면 즉시 PASS인데 지금까지는 그 안내가 없어, 사용자가 방금 실행한 setup이 워크플로를 망가뜨렸다고 읽을 수 있었습니다.

## 0.10.0

- **여러 REQ를 한 묶음으로 묶고 묶음이 끝날 때까지 main 병합 정지를 미룹니다** (REQ-2026-066). 🔴 **p1~p3는 한 릴리스로만 공개됩니다** — `create`/`begin`만 배포되면 통합할 수 없는 묶음이 만들어집니다.

  > 구현은 이 REQ의 phase-1~3에 커밋돼 있습니다 — `scripts/req/lib/delivery.ts`의 순수 모델(`isTerminal`·`canBegin`·`deliveryGateVerdict`·`integrateTopologyProblems`) · `bin/delivery.ts`의 verb와 통합 자격 검증(`cd05c2c`) · `stopGate: "merge"`와 `req:next` 종단 분기.

  요구사항이 커서 REQ를 나누거나 여러 설계 문서를 순차로 구현할 때, 지금까지는 REQ마다 통합 정지가 걸렸습니다. 이제 `commitgate delivery`로 REQ들을 하나의 묶음으로 묶고, `stopGate: "merge"`로 **묶음 전체가 끝날 때까지** 정지를 미룰 수 있습니다.

  한 번에 **활성 REQ는 하나**입니다 — 이 순차 불변식이 병합 충돌을 구조적으로 없앱니다. `integrate`는 feature ref에 커밋된 `dev-complete` 증거·승인 매니페스트·**응답 파일 SHA-256**·**승인 트리 provenance**를 확인하고, **승인 이후의 코드 커밋이 있으면 거부**합니다. `--force` 류 우회는 없습니다.

  🔴 미검수 코드 탐지의 기준점은 **가장 최근 승인 트리의 커밋**입니다. close-proof 파일의 마지막 수정 커밋을 기준으로 삼으면, 미검수 코드를 커밋한 뒤 close-proof를 의미 동일하게 재포맷하는 커밋 하나로 검사 범위가 비어 버립니다.

  🔴 **도구는 `delivery` → `main`을 병합하지 않습니다.** `approve`는 승인을 기록할 뿐이고 실제 병합은 기존 통제점표(I1/I2/B1)에서 사람이 실행합니다. `seal` 이후에는 `begin` 할 수 없고, `reopen`은 승인이 있었다는 사실을 이력에 남깁니다.

  🔴 **보증 범위**: 이 검증은 실수와 절차 이탈(승인 뒤 커밋 · checkout 이탈 · amend/rebase · 증거 손상)을 막습니다. **커밋된 증거 자체를 일관되게 위조하는 행위는 막지 못합니다** — 저장소 전반의 보증 범위(협력적 worker · 단일 활성 워크트리)와 같습니다.

  실측(이 저장소): 정상 완료된 REQ 6건을 각자의 `dev-complete` 커밋으로 판정 → **6/6 통과**(오탐 0), 같은 증거로 이후 이력을 주면 **전부 차단**.

- **미로그인 리뷰가 예산을 태우기 전에 멈춥니다** (REQ-2026-065).

  > 구현은 이 REQ의 phase-1(`8b8d3c9`)에 커밋돼 있습니다 — `scripts/req/review-codex.ts`의 `assertReviewerReady`와 예산 gate 앞 배선, `probes` 주입 seam.

  지금까지는 로그인이 안 돼 있어도 원장에 `attempt-opened`가 기록·커밋되고 예산이 차감된 뒤에야 codex가 죽었고, 그 실패는 `dispatched`로 분류되어 **차감이 유지**됐습니다. 이제 호출 **직전**(예산 gate·원장 기록보다 앞)에 설치·로그인을 확인하고, 미로그인이면 **예산 차감도 원장 기록도 없이** 멈추며 메시지가 그 사실과 조치를 함께 알려 줍니다.

  🔴 **`unknown`(판정 불가)은 차단하지 않습니다.** auth 확인은 진단이지 승인 무결성 게이트가 아니며, 오탐 비용이 비대칭입니다 — 잘못 통과시키면 호출이 스스로 실패할 뿐이지만(예산 1회), 잘못 차단하면 리뷰어 출력 문자열 변경 하나로 **모든 사용자의 모든 리뷰가 동시에 멈춥니다**. **우회 플래그는 만들지 않았습니다** — 대신 차단 조건 자체를 좁게 잡아 탈출구가 필요 없게 했습니다. `--dry-run`은 외부 호출이 없으므로 확인하지 않습니다.

- **어느 모델이 승인했는지가 커밋 이력에 남습니다** (REQ-2026-064). 🔴 **이 항목이 위 `setup` 계열 변경(REQ-2026-060~063)의 릴리스 선행 조건입니다** — 모델 교체가 쉬워졌는데 감사 기록이 따라오지 않으면 "바꿀 수는 있는데 누가 승인했는지는 모르는" 창이 열립니다.

  > 구현은 이 REQ의 phase-1~2에 커밋돼 있습니다 — `scripts/req/lib/review-ledger.ts`의 `OPTIONAL_LEDGER_KEYS`·검증 분리·직렬화 정규화(`08b009e`) · `scripts/req/review-codex.ts`의 `pinned`/`REVIEW_PROVIDER_ID` 단일 배선(`c4a4fdc`).

  리뷰 호출의 **모델·추론강도·provider**가 커밋되는 원장(`review-ledger.jsonl`)의 `attempt-opened`·`attempt-closed` **양쪽**에 남습니다. 지금까지 이 값은 gitignore된 측정 로그(`.review-calls.jsonl`)에만 있어서 fresh clone에서는 알 수 없었습니다. 값은 호출부에서 **한 번** 읽어 두 기록에 같은 값으로 흘리므로 갈라지지 않습니다.

  🔴 **정직성 경계**: 기록되는 것은 *CommitGate가 요청에 핀한 값*이지 *리뷰어가 실제로 실행한 모델*이 아닙니다. `null`은 "핀하지 않음(전역 상속)", **키 부재**는 이 필드 도입 이전 행입니다.

  🔴 **선행 결함도 함께 고쳤습니다.** 원장은 허용 키와 필수 키가 **같은 배열**이라, 키를 하나 추가하는 순간 **이미 커밋된 모든 행이 "필수 키 누락"으로 거부**되고 그 티켓의 리뷰가 전부 막혔습니다(주석은 "릴리스 후 additive-only"라고 했지만 검증기가 그 additive를 허용하지 않았습니다). 이제 선택 키가 분리되어 있고, 계약 3항(과거 행은 부재 허용 · 새 행은 `null`이어도 키 유지 · 있으면 엄격 검증)이 테스트로 고정됩니다.

- **멈춤 지점을 `stopGate` 한 축으로 고릅니다** (REQ-2026-063).

  > 구현은 이 REQ의 phase-1~2에 커밋돼 있습니다 — `scripts/req/lib/config.ts`의 `StopGate`·`AUTO_APPROVE_OF`·`resolveStopAxes`와 `workflow/req.config.schema.json`(`34a629a`) · `bin/setup.ts`의 세 번째 질문과 legacy 정규화(`c5d3013`).

  기존 `phaseCommit.autoApprove`(`never`/`low-only`)는 **구현 언어**라서 `commitgate setup`이 물어보기 어려운 형태였습니다. 사용자가 고르고 싶은 것은 **어디서 멈추는가**입니다. 이제 `stopGate`가 의미 축(`phase` = 매 phase 확인 · `req` = REQ 완료 시 한 번)이고 `phaseCommit`은 **deprecated alias**입니다.

  **기존 설정은 그대로 동작합니다** — `phaseCommit`만 있으면 `stopGate`가 역파생됩니다. 둘 다 있고 모순이면 거부하되, 오류가 **두 값·기대 매핑·해결 방법**을 알려 줍니다. 🔴 충돌 판정은 **raw 키의 명시 여부** 기준입니다 — 해소값을 비교하면 `phaseCommit`이 부재해도 기본값으로 채워지므로 `stopGate`만 쓴 정상 설정이 오탐되어 **새 축을 아무도 못 쓰게** 됩니다.

  🔴 `setup`에서 `stopGate`를 고르면 legacy `phaseCommit` 키를 **같은 쓰기에서 제거**합니다. 없으면 기존 `low-only` 프로젝트가 `phase`를 고르는 **정상 경로**에서 두 축이 모순인 파일이 만들어지고, 그 파일이 위 충돌 검사에 걸려 이후 모든 명령이 막힙니다.

  **HIGH 위험 티켓은 어느 값에서도 매 phase 확인**하고 통합(main 병합) 승인도 그대로 필요합니다 — setup 화면과 문서가 이 사실을 명시합니다. **`merge` 값은 아직 없습니다**(그 묶음을 표현하는 delivery set이 함께 있어야 성립하므로 후속 REQ에서 동작과 함께 추가됩니다).

- **setup을 마쳐야 워크플로가 시작됩니다 — 단, 기존 설치본은 그대로 동작합니다** (REQ-2026-062).

  > 구현은 이 REQ의 phase-1~3에 커밋돼 있습니다 — `scripts/req/lib/config.ts`의 `SetupMarker`·`CONFIG_SCHEMA.setup`과 `workflow/req.config.schema.json`(`b9fb58e`) · `scripts/req/lib/setup-gate.ts`의 `setupGateVerdict`/`resolveGateRoot`/`countValidTickets`(`cc1f84d`) · 워크플로 verb 7종 배선과 `req-doctor.ts`의 D24(`96e2a26`).

  `commitgate setup`은 만들어졌지만 강제되지 않아서, 설치 직후 리뷰 모델·추론강도를 확인하지 않고 codex 로그인도 없이 티켓을 열 수 있었습니다. 그 결과는 첫 리뷰 호출에서야 드러나고, 그 실패는 `dispatched`로 분류되어 **리뷰 예산까지 차감**합니다.

  이제 setup 완료가 `req.config.json`의 `setup` 마커로 기록되고, 마커가 없으면 **변경을 만드는 워크플로 명령**(`req:new`·`req:next`·`req:review-codex`·`req:commit`·`req:close`·`req:reconstruct`·`req:review-exception`)이 fail-closed로 막힙니다. 차단 메시지는 **"실행하라"가 아니라 "사용자에게 요청하라"**고 지시합니다 — setup은 대화형 전용이라 에이전트가 실행하면 비-TTY로 즉시 실패하기 때문입니다.

  🔴 **기존 설치본은 막히지 않습니다.** 업그레이드 직후 진행 중이던 티켓이 있는 사용자가 커밋도 리뷰도 못 하는 상태가 되면 안 됩니다 — 그 상황에서는 setup을 실행해도 `req.config.json`이 dirty해져 clean-tree 게이트에 걸려 더 나빠집니다. **유효 티켓 ≥ 1 이고 설치 신호 ≥ 2**면 마커 없이 통과합니다(grandfather). 유효 티켓은 `state.json`의 `id`가 디렉터리명과 일치하는 것만 세므로, **빈 `REQ-*` 디렉터리나 복사된 껍데기로는 영구 면제를 얻지 못합니다**.

  🔴 **진단 수단은 남깁니다.** `commitgate check`와 `req:doctor`는 마커가 없어도 동작합니다 — 막으면 문제를 진단할 방법까지 사라집니다. `req:doctor`의 신규 **D24는 WARN 상한**입니다(FAIL로 승격하면 `req:commit`이 doctor를 하드 게이트로 spawn하므로 마커 없는 설치본의 모든 커밋이 벽돌이 됩니다).

  마커의 의미는 **"이 프로젝트의 설정이 끝났다"**(팀 공유)이지 "내가 로그인돼 있다"가 아닙니다 — `req.config.json`은 커밋되고 로그인은 개발자별입니다.

- **`commitgate check` — 설치 직후에도 쓸 수 있는 비대화형 진단** (REQ-2026-061).

  > 구현은 이 REQ의 **phase-1(`7d35fe7`)에 이미 커밋**돼 있습니다 — `bin/check.ts`(`runChecks`/`renderJson`/`parseArgs`) · `bin/dispatch.mjs`의 `check` verb 등록 · `tests/unit/check.test.ts`(C1~C4·`--json`·`--dir` 검증). 이 항목은 그 동작을 문서화하는 phase-2입니다.

  `setup`이 대화형 전용이 되면서 리뷰어 가용성 진단이 그 안에만 남았고, `req:doctor`는 **활성 티켓을 전제**하므로 설치 직후·CI·에이전트 사전 점검에는 쓸 수 없었습니다. `npx commitgate check`가 **티켓 없이도** `req.config.json` 유효성(C1) · 리뷰어 CLI 설치(C2) · 로그인(C3) · 모델·추론강도 고정 여부(C4)를 진단하고, `--json`으로 기계용 출력도 냅니다.

  특히 `codex 종료 코드 1`로 죽는 리뷰는 `dispatched`로 분류되어 **예산까지 차감**하므로, 재시도 전에 `check`로 원인을 가리는 편이 쌉니다.

  🔴 **읽기 전용이고 어떤 게이트에도 배선되지 않습니다.** 아무것도 고치지 않으며(`--fix` 없음), 로그인 실행은 대화형이 필요하므로 `setup`의 소관입니다. `req:commit`이 `req:doctor`를 하드 게이트로 spawn하는 것과 달리 `check`는 어디서도 spawn되지 않으므로, exit 1이 기존 워크플로를 새로 막지 않습니다. **`C3`가 판정 불가면 WARN이지 FAIL이 아닙니다** — probe는 진단이지 승인 무결성 게이트가 아니라서, codex가 출력 형식을 바꾼 날 진단이 곧 오탐 경보가 되면 안 됩니다.

- **`commitgate setup` — 리뷰어 설정을 대화형으로 마칩니다** (REQ-2026-060). 지금까지 리뷰 모델·추론강도는 `req.config.json`을 손으로 열어 고쳐야 했고, **codex의 설치·로그인 여부를 확인하는 수단이 코드에 전혀 없었습니다** — 미로그인은 첫 리뷰 호출에서야 `codex 종료 코드 1`이라는 불투명한 형태로 드러났고, 그 시도는 `dispatched`로 분류되어 **리뷰 예산까지 차감**했습니다.

  `npx commitgate setup`이 모델·추론강도를 묻고 **`codex login`을 직접 실행한 뒤 결과를 재검증**합니다. 각 질문은 현재 값이 기본 답변이라 Enter로 유지되고, **건드린 키만** 기록합니다(고르지 않은 값이 고정되지 않도록). 저장은 같은 폴더 temp + rename의 **원자적 교체**이며, **로그인이 확인되지 않으면 아무것도 쓰지 않습니다**. 자격증명은 다루지 않습니다 — 비밀값을 stdin으로 받는 `codex login --with-api-key`/`--with-access-token`은 쓰지 않고 브라우저 플로우만 실행하며, 인증은 `~/.codex/`에 남습니다.

  🔴 **대화형 전용이자 이 저장소 최초의 "사람 전용" 명령입니다.** TTY가 아니면 질문을 하나도 던지지 않고 즉시 종료합니다 — 에이전트 세션이 blocking read에서 얼어붙지 않게 하기 위해서이고, 더 근본적으로는 **에이전트가 리뷰 모델 같은 게이트 파라미터를 스스로 바꾸는 경로를 구조적으로 닫기 위해서**입니다. `AGENTS.md`에 "사람 전용 명령" 절을 신설해 계약이 먼저 막습니다.

  **setup은 아무것도 강제하지 않습니다** — 실행하지 않아도 모든 명령이 기본값으로 그대로 동작합니다.

  **TTY 판정 실측**(Windows 11 · Git for Windows 2.46.0 · Node v24.18.0 — 구현은 `bin/setup.ts`의 `isInteractiveTty`):

  | 조합 | stdin/stdout | 판정 |
  |---|---|---|
  | PowerShell 대화형 | `true`/`true` | 허용 |
  | Git Bash(mintty) 대화형 | `true`/`true` | 허용 |
  | 위 두 터미널의 `npx` 경유 | 유지 | 허용 |
  | 에이전트·파이프 셸 | `undefined` | 거부 |

  판정식은 **stdin·stdout이 모두 `true`일 때만** 대화형입니다. *"mintty는 `isTTY`가 `undefined`"* 는 ConPTY 이전의 옛 동작이라 통상 경로 `npx commitgate setup`이 두 터미널 모두에서 그대로 통과합니다. `TERM`·`MSYSTEM` 같은 env 휴리스틱으로 보완하지 **않습니다** — 비대화형 에이전트 셸에도 동일하게 존재해 대화형을 구분하지 못하고, 쓰면 막아야 할 바로 그 경로를 통과시킵니다.

## 0.9.10

**티켓을 끝낸 뒤 다음 티켓을 시작할 수 있습니다** (REQ-2026-057~059, 실제 Nuxt 소비자 프로젝트에 설치→사용→제거 전 과정을 따라간 감사의 후속).

- **작업 상태가 승인 증거와 함께 커밋됩니다 — durable state checkpoint** (REQ-2026-057). 지금까지 `req:commit`의 evidence-finalize는 `responses/`만 커밋하고 **소비된 상태는 커밋 뒤에 디스크에만** 썼습니다. 그래서 티켓을 정상 완주해도 `state.json`이 dirty로 남았고, 그 파일이 **다음 `req:new`의 clean-tree 게이트를 막았습니다**(`req:new`의 스크래치 예외는 증거 변조를 막으려고 `state.json`을 의도적으로 제외합니다). 그런데 계약과 문서는 `state.json`을 직접 커밋하지 말라고 하므로 **남겨도 막히고 버려도 안 되는** 상태였고, 실제로 버리면(문서가 지시하는 유일한 해소책) 커밋된 승인 증거가 있는데도 `req:next`가 **설계 재리뷰를 지시**했습니다(유료 Codex 호출). `git checkout <다른 브랜치>`도 같은 이유로 막혔습니다.

  이제 **design 승인 직후**와 **phase 소비 직후**에 해당 티켓의 `state.json` **한 경로만** 담는 pathspec 커밋을 발행합니다. 🔴 **순서를 바꾸지 않았습니다** — 소비를 evidence 커밋 앞으로 옮겨 한 커밋에 담으면 `consumeState`가 `pending_evidence_for`·`approval_evidence`를 제거하므로 커밋 실패 시 `req:commit --finalize` 복구가 근거를 잃습니다. 🔴 evidence 커밋의 **"`responses/` 외 staged 금지" 가드도 완화하지 않았습니다** — 상태는 자기 커밋으로 갑니다. 커밋 전에 디스크 내용이 도구가 방금 쓴 상태와 **바이트 동일한지**, `state.id`가 대상 티켓과 일치하는지 확인하고 아니면 fail-closed합니다. 변경이 없으면 커밋하지 않습니다(멱등). checkpoint 실패는 승인·커밋 판정을 바꾸지 않고 경고만 냅니다.

  `computeReviewSemanticIdentity`에서 **`state.json`을 제외**했습니다. checkpoint가 인덱스의 그 항목을 갱신하므로, 제외하지 않으면 **방금 승인한 리뷰를 `req:next` G2가 stale로 오판**합니다 — `responses/`를 제외한 것과 같은 이유입니다. 승인 바인딩(D9)은 그대로라 방어가 약해지지 않습니다.

- **안내가 그대로 실행 가능해지고, 정상 상태가 실패처럼 보이지 않습니다** (REQ-2026-058).
  - `req:next`가 사람 승인(`AWAIT_HUMAN`) 경로에서 출력하던 커밋 명령에 **메시지 자리표시자가 빠져** 있어, 그대로 실행하면 `req:doctor` 17개 체크를 모두 통과한 **뒤에** `커밋 메시지 필요`로 죽었습니다(LOW 자동 커밋 경로에만 자리표시자가 있었습니다). 두 경로가 **같은 상수**를 공유하도록 했습니다.
  - HEAD에 증거가 아직 없는 **정상 상태**에서 git의 `fatal: path … does not exist in 'HEAD'`가 그대로 표출됐습니다(코드는 이미 `catch → null`로 처리하고 있었습니다). 부재가 정상인 조회 4곳에만 stderr를 버리는 runner를 씁니다 — **전역 억제가 아니라** 그 조회들에 한정하므로 진짜 오류의 진단은 그대로 보입니다.
  - `commitgate uninstall` 계획이 도입 커밋 revert를 권하면서 그 커밋에 든 **`workflow/.gitignore`가 함께 사라져 기존 티켓의 scratch가 드러난다**는 파급을 예고하지 않았습니다(§3은 증거 보존을 지시하므로 두 안내가 서로를 무효화했습니다). 보존할 증거가 있을 때만 경고와 선택지를 냅니다. 그 밖에 Stage B에 존재하지 않는 `scripts/`를 잔여 후보에서 빼고, `not-installed` 판정에서도 **남아 있는 티켓 증거를 고지**하며, `_npx` 삭제가 CommitGate만이 아니라 **그 사용자의 모든 npx 패키지 캐시**를 지운다는 범위를 명시합니다.
  - 설치 안내의 lockfile 인과 설명("2단계 install이 lockfile을 만든다")을 Stage B 사실대로 고쳤습니다 — lockfile을 바꾸는 것은 `init` **이전**의 `npm i -D commitgate`입니다.

- **테스트 픽스처 정리를 결정적으로** (REQ-2026-059). 새 near-e2e 픽스처의 임시 저장소 정리가 git의 **detached auto 유지보수**와 경합해 `ENOTEMPTY`로 간헐 실패했습니다(단언은 전부 통과, ubuntu·Node 20에서만 재현). 픽스처 저장소에서 `gc.auto`·`maintenance.auto`를 모두 끄고(git 버전별 두 경로), 정리에 짧은 재시도를 더했습니다. 단언은 변경하지 않았습니다.

전체 테스트 1709 → 1729.

## 0.9.9

**리뷰 게이트 운영 보강 4종** (REQ-2026-053~056, 소비 저장소 운영감사 후속). 모두 0.9.8 위의 **추가 기능**(신규 명령·additive 필드·opt-in)이라 기존 사용자는 무회귀입니다.

- **레거시 완료 티켓 마이그레이션 종결 — `req:close --migrate`** (REQ-2026-053). 0.9.8의 `req:next` DONE 게이트/intake가 close-proof·design 결속 도입 **이전에** 완료·병합된 durable 티켓을 영구 미종결로 분류해 **새 REQ 생성을 막던 워크플로 잠금**을 해소합니다. dev-complete를 흉내 내지 않는 별도 close 이벤트 **`migrated-complete`**(사후 스탬프 — `reconstructed:true`+근거 필수)를 두고, `req:close`가 HEAD-committed 증거 무결성·커밋된 design 승인·phase 증거·**본선 병합 여부(integrated)**·부분완료 여부(커밋된 phase 계획)를 검증한 티켓만 종결합니다. 🔴 완료성 판정의 mainline은 **신뢰된 ref**(`origin/HEAD`→`origin/main`→로컬 `main`)로만 해소하며 운영자 override를 받지 않습니다(임의 ref로 미병합 티켓을 통과시키는 우회 차단). dry-run 기본·재실행 멱등.

- **리뷰 호출 lifecycle 분류 + pre-dispatch 무차감 예산** (REQ-2026-054). 리뷰 attempt 실패를 `pre_dispatch_failed`(reviewer subprocess 미기동)·`dispatched_unknown`·`dispatch_confirmed`·`completed`로 분류해 원장(`review-ledger.jsonl`)에 **보상 `attempt-closed`**를 남깁니다 — 이전엔 실패가 조용한 unclosed로 뭉개져 "codex가 뜨지도 못한 실패"와 "모델이 부분 실행된 실패"가 구별되지 않았습니다. **명백한 pre-dispatch 실패(spawn 실패)만 회차를 환불**하고 dispatch 후·불명은 fail-closed로 차감합니다. 환불은 `attempts`를 감소시키지 않고(원장 자연키 충돌 회피) **`refunded_attempts` 별도 카운터**로 예산이 보는 유효 회차를 낮춥니다.

- **`req:review-exception` 전용 명령 + 구조화 rationale** (REQ-2026-055). 예산 needs-exception 구간(6~8회차)의 사람 예외를 `state.json` 수동 편집 대신 **검증·원자 기록**합니다. 대상 series·회차를 소비 게이트와 **같은 함수**로 계산해 오기를 막고, 구조화 rationale(직전 findings·이번 변경·미해결·재시도 근거)을 전용 `review-exceptions.jsonl`에 durable하게 남깁니다(릴리스된 `review-ledger` 스키마는 불변 — 필수 키 추가가 기존 커밋 원장을 깨뜨리지 않게 sibling 파일 사용). 🔴 **durable rationale을 먼저 커밋한 뒤에만** 소비 가능한 state를 기록해, 부분 실패 시 근거 없는 예외가 소비되지 않습니다. 소비 로직·예산 게이트는 무변경.

- **lockfile 리뷰 프롬프트 요약 + frozen-lockfile doctor D23** (REQ-2026-056). `git diff --cached`의 lockfile(수천 줄 기계생성) 구획을 리뷰 프롬프트에서 **요약**(경로·변경 통계·생략분 SHA-256)으로 대체해 토큰과 리뷰 노이즈를 줄입니다. 🔴 **승인 바인딩(reviewTree)은 불변**이라 승인은 여전히 전체 lockfile을 결속하고, 요약은 리뷰어가 보는 프롬프트만 바꿉니다(측정 로그·원장 prompt 해시는 전송된 요약본 기준이라 자동 정합). config **`lockfilePromptFull`**(기본 false)로 전문 opt-in. `req:doctor` **D23**은 감지된 패키지 매니저의 lockfile이 없거나 untracked면 **WARN**합니다(FAIL 아님 — 재현 가능한 설치 안내). 경로 판별은 rename(한쪽만 lockfile)·git quoted(공백) 경로까지 처리합니다.

전체 테스트 1363 → 1709.

## 0.9.8

**design 승인 증거가 커밋 이력에 확실히 남습니다** (REQ-2026-048). CommitGate는 `state.json`을 의도적으로 커밋하지 않으므로 저장소의 감사 정본은 `approvals.jsonl` 매니페스트와 커밋된 응답 아카이브뿐인데, 그 정본을 만드는 경로가 비대칭이었습니다 — **phase 증거는 매 `req:commit`이 자동 커밋**(needs-fix 라운드 포함)하는 반면 **design 증거는 수동 `req:commit --finalize-design`에만 의존**했고, 그마저 승인본 1건만 커밋했습니다. 게다가 그 수동 단계는 어떤 도구 출력·문서에도 안내되지 않았고, 커밋된 매니페스트를 확인하는 게이트도 없었습니다(D13은 미커밋 `state.json` 플래그를, D17은 **온디스크** 아카이브를 봅니다). 그 결과 REQ가 "전 phase 커밋 + 병합"에 도달해도 **설계 승인 증거가 커밋 이력에 전혀 남지 않을 수 있었고 아무 게이트도 불평하지 않았습니다** — 소비자 저장소에서 실측된 사고입니다.

이제 성공한 `req:review-codex --kind design --run`이 **승인 아카이브·needs-fix 라운드·매니페스트를 그 자리에서 커밋**합니다. 운영자가 별도 명령을 기억할 필요가 없습니다. `--finalize-design`은 제거하지 않고 **멱등 복구 경로**로 남아 같은 구현을 호출하므로 두 경로의 동작이 갈라질 수 없습니다. 멱등 판정은 온디스크가 아니라 **`HEAD` 기준**입니다 — 매니페스트 기록·stage까지 되고 커밋만 실패한 부분 상태에서 재시도가 영구히 skip되어 증거를 복구하지 못하던 함정을 없앴습니다. 커밋 실패는 **승인 판정이나 종료 코드를 바꾸지 않고**(기록 실패가 게이트 결정을 뒤집으면 계약 위반입니다) 복구 명령을 안내합니다. 커밋은 **pathspec 범위**라 설계 문서를 stage한 채 승인하는 정상 경로에서도 무관한 staged 변경이 섞이지 않고 index에 그대로 남습니다.

design 매니페스트 행에 **`archive_inventory`**(각 아카이브의 경로·SHA-256)를 추가해 그 승인에 이르는 **모든 라운드**를 함께 영속화합니다. 목록은 승인 시점 티켓 `responses/` 직계의 design 아카이브 전부를 라운드 오름차순으로 담아 디렉터리 읽기 순서에 비의존이며, 파일명 sweep과 달리 사후 감사에서 **재검증 가능**합니다. 선택 필드라 기존 매니페스트는 그대로 유효합니다.

**`req:next`가 완료를 선언하기 직전** `HEAD`의 Git blob에서 매니페스트 design 행·아카이브·SHA를 검증하고, 미완이면 `DONE` 대신 **`BLOCKED`와 복구 명령**을 반환합니다. 판별 marker(`evidence_durability_required`, `req:new`가 스캐폴드에 심음)도 **커밋된 blob**에서 읽어 캐시 소실로 우회되지 않습니다. 🔴 이 검사는 **`req:next`의 완료 판정에서만** fail-closed입니다 — `req:doctor`·일반 `req:commit`에는 넣지 않았습니다(doctor는 `req:commit`의 하드 게이트라 FAIL이면 기존 소비자의 모든 커밋이 벽돌이 됩니다). **0.9.8 이전에 만들어진 티켓은 검사 대상이 아니며 기존 DONE 동작을 유지합니다.**

내부적으로는 매니페스트 모델·검증을 leaf 모듈 `scripts/req/lib/evidence.ts`로 추출해 `review-codex`↔`req-commit` 런타임 순환 없이 두 경로가 같은 구현을 공유하게 했고(그 순환이 흡수를 막던 구조적 원인입니다), 그 leaf 불변식을 테스트로 고정했습니다.

**DONE 게이트가 실제로 검증하는 것**(REQ-2026-049에서 fail-closed로 보강): `HEAD`의 Git blob만 보고 ① 커밋된 `state.json`이 해석 가능한지(부재·파손·`phases` 비배열이면 BLOCKED) ② 커밋된 `approvals.jsonl` 전체가 매니페스트 검증(스키마·경로 confinement·`-approved.json` 파일명·SHA 형식·예상 외 필드·중복/주입)을 통과하는지 ③ design 행의 `response_sha256`이 **HEAD blob의 SHA와 일치**하는지(존재 확인이 아니라 대조) ④ `archive_inventory`가 **비어 있지 않고** 승인 아카이브를 정확한 SHA로 포함하는지 ⑤ 인벤토리가 **HEAD에 있는 그 티켓 design 아카이브 전체 집합과 정확히 일치**하는지(빠짐·잉여 모두 거부) ⑥ 각 인벤토리 항목의 SHA가 HEAD blob과 일치하는지를 확인합니다. 초기 구현은 존재만 확인하고 빈 인벤토리를 통과시켜, 손상된 커밋 매니페스트가 완료 판정을 통과할 수 있었습니다.

> 한 가지 예외가 있습니다: **phase 행의 `phase_id` 멤버십은 이 게이트가 검사하지 않습니다.** `state.json`은 설계상 스캐폴드 이후 재커밋되지 않아 `HEAD`의 `phases`가 항상 비어 있기 때문입니다. 그 바인딩은 커밋 시점에 `req:commit`의 evidence preflight가 이미 강제합니다.

테스트 환경은 **global/system git config와 `EMAIL` 등 환경 유래 identity를 차단**합니다. 그러지 않으면 저장소-local identity를 빠뜨린 fixture가 개발자 머신의 전역 설정에 가려 **CI에서만 실패**합니다(실제로 그렇게 됐습니다). 전체 테스트 1306 → 1363.

## 0.9.7

**소비자 저장소에서 review-call 측정 로그가 커밋을 막던 P0 수정 + 기존 설치본 백필** (REQ-2026-047). `req:review-codex`가 소비 저장소 루트에 남기는 측정 로그(`workflow/.review-calls.jsonl`)의 무시 규칙이 **배포 템플릿 `templates/workflow.gitignore`에 누락**돼 있었습니다(개발 저장소 자신의 루트 `.gitignore`에만 있었고, npm은 `.gitignore` 이름을 tarball에서 제외하므로 소비자에게 전달되지 않습니다). 그 결과 `commitgate init`한 저장소에서 리뷰를 한 번이라도 돌리면 로그가 untracked로 남아 **`req:doctor` D10이 FAIL하고 `req:commit`이 모든 커밋을 차단**했습니다. 템플릿에 앵커형 `/.review-calls.jsonl`을 추가해 **신규 설치는 즉시 해소**되고, 회귀는 문자열 비교가 아니라 **packed tarball → 실제 `init` → `git check-ignore -v`(매칭 출처까지 단언)** 로 `scripts/smoke.mjs`에 고정했습니다.

`workflow/.gitignore`는 seed-once(부재 시에만 생성, `--force`로도 미덮음)라 템플릿 수정만으로는 기존 설치본이 구제되지 않으므로, 명시적 opt-in **`commitgate sync --gitignore [--apply]`** 를 추가했습니다 — 누락된 kit 규칙 **행만 말미에 추가**하고 기존 행은 변경·삭제·재정렬하지 않으며, 파일이 없으면 템플릿 전체로 생성합니다. 존재 판정은 **Git ignore 의미론을 보존**해 후행 공백·CR만 무시하고 **앞 공백은 패턴의 일부로 취급**합니다(` /.review-calls.jsonl`처럼 실제로는 무시되지 않는 행을 "이미 있음"으로 오판해 백필을 건너뛰지 않도록). **`sync` 기본 동작은 불변**이라 `--gitignore` 없이는 이 파일을 전혀 건드리지 않습니다.

진단으로 **`req:doctor` D22**를 추가했습니다 — repo-root 런타임 스크래치가 ignore도 tracked도 아니면 "다음 review 뒤 D10이 커밋을 막는다"를 알리고 백필 명령을 안내합니다. **WARN 상한이며 절대 FAIL이 아닙니다**(doctor는 `req:commit`의 하드 게이트라 FAIL이면 소비자 커밋이 벽돌이 됩니다). D10의 스크래치 의미론(`reviewScratchPaths`)은 **의도적으로 무변경**입니다 — 로그를 스크래치 허용목록에 넣으면 배포 ignore 누락 자체를 D10이 숨기게 됩니다. 런타임 생성 파일 인벤토리 표와 이미 커밋해 tracked가 된 경우의 복구(`git rm --cached`) 절차는 [문제 해결](https://github.com/sol5288/commitgate/blob/main/docs/troubleshooting.md)에 정리했습니다.

## 0.9.6

**Claude Code용 품질 오버레이 companion skill `commitgate-quality` 추가** (REQ-2026-044). 기존 4종에 이어 5번째 companion skill을 같은 안전한 설치 경로(seed-once·`--force` 미덮음·confinement·`--no-agent-entrypoints` opt-out·uninstall)로 번들·설치합니다. 이 스킬은 Superpowers 방법론의 장점(요구 정제·설계/계획 품질·Test-First·증거 기반 검증)만 **협조적 지침**으로 흡수하며, Superpowers 플러그인·런타임은 설치·실행·의존하지 않습니다. 정본(SSOT) 비복제·설계 품질·계획 품질은 자체 소유하고, Test-First·버그 진단·요구 정제는 형제 스킬(`commitgate-tdd`·`commitgate-diagnosing-bugs`·`commitgate-discovery`)을 가리켜 내부 중복을 피합니다. 새 설치의 `CLAUDE.md`에 발견 포인터 1줄을 추가하되 계약 정본(`AGENTS.md`)은 불변입니다. **강제는 CommitGate 실행 게이트가 담당하며 이 스킬은 방법일 뿐**입니다 — `req:next`의 행동 계산, 리뷰·승인 판정, `state.json`/`responses/`, 커밋 권한을 침범하지 않습니다.

## 0.9.5

**리뷰 게이트 모델·reasoning effort를 review-call 로그에 기록** (REQ-2026-043). `req:review-codex`가 남기는 측정 로그(`workflow/.review-calls.jsonl`)의 각 행에 `review_model`·`review_reasoning_effort` 두 필드를 추가합니다. 값은 commitgate가 그 리뷰에 해소·전달한 값(`req.config.json`의 `reviewModel`/`reviewReasoningEffort`, 미지정 시 코어 기본 `gpt-5.6-terra`/`high`)이며, 두 값을 `null`로 두어 codex 전역 설정을 상속하는 경우 `null`로 기록해 **미핀 상태를 드러냅니다**. 이로써 "어떤 모델이 각 리뷰를 통과시켰는가"를 로그에서 감사·재현할 수 있습니다. 로그는 `.gitignore` 대상 측정 전용이라 커밋 산출물·승인 원장(`approvals.jsonl`)·게이트 판정에 영향이 없는 **순수 additive**이며, 기존 사용자는 무회귀입니다.

## 0.9.4

**README 랜딩 서사 보강 + 히어로 이미지** (문서 릴리스). 0.9.3의 랜딩 위에 제품 서사를 강화했습니다 — "코드는 한 AI가 만들고, 다른 AI가 다시 봅니다"(자기 검수의 맹점 → 교대 검수 동기), "사람은 결정에만 참여합니다"(직접 챙기던 일 ↔ CommitGate가 연결 표), 4단계 흐름, 그리고 워크플로를 나타내는 히어로 이미지(빌더 AI → 리뷰어 AI → 사람 확인 → 커밋 게이트)를 추가했습니다. 이미지는 **WebP(~70KB)**로 GitHub raw URL에서 서빙 — `files[]`·npm tarball·payload 축은 **무변경**입니다. 실행 코드·의존성 변경이 없어 기존 사용자는 무회귀입니다.

## 0.9.3

**README 전면 개편 — 랜딩 페이지 + `docs/` 분리(한/영)** (REQ-2026-042). ~620줄의 `README.md`가 제품 소개·온보딩·운영·제거·안전 계약·개발 현황을 한 화면에 섞어 초점이 흐렸습니다. **README를 랜딩(제품 1줄·핵심 보장·⚠️ 주의·3분 시작·작동 방식·자주 쓰는 명령·docs 허브)으로 줄이고**, 상세를 `docs/` 9종(quick-start·agent-prompt·workflow·guarantees·configuration·upgrade·uninstall·troubleshooting·development)으로 **손실 없이 이동**했습니다. `README.md`/`README.en.md`는 각각 랜딩으로, `docs/*.md`·`docs/*.en.md`로 완전 이중언어. 순수 문서 재배치 — 코드·런타임·게이트·npm payload 축은 **무변경**(`docs/`는 `files[]`에 넣지 않아 tarball 비대화 없음, README→docs 링크는 GitHub 절대 blob URL이라 npm 페이지에서도 해소됨). 링크·앵커 무결성은 `remark-validate-links`로, README→docs 절대 URL·안전 4문구 존재·위치는 전용 테스트로 검증합니다. 기존 사용자 무회귀(설치본에 영향 없음).

## 0.9.2

REQ-2026-039(0.9.1)이 **신규 설치**의 온보딩을 고쳤다면, 0.9.2는 **기존 설치까지 백필**합니다(REQ-2026-040).
`commitgate quickstart` verb + doctor D21 추가 — 순수 additive라 기존 사용자는 무회귀입니다.

- **기존 파일 Quick Start 백필 — `commitgate quickstart` + doctor D21** (REQ-2026-040). REQ-2026-039가 신규
  설치의 `CLAUDE.md`/`AGENTS.md`에 Quick Start를 넣었지만 seed-once라 **기존 파일엔 닿지 않았습니다**. 새 verb
  `commitgate quickstart`(기본 dry-run·`--apply`)가 기존 파일에 관리 블록(`<!-- commitgate:quickstart -->`)만
  **멱등 주입**하고 블록 밖 내용은 보존합니다(CommonMark 코드펜스 인지·줄바꿈 dominant EOL 정렬). `AGENTS.md`는
  계약 마커가 있을 때만 대상입니다. `req:doctor` **D21**이 기존 파일에 블록이 없으면 **WARN**(FAIL 아님)으로
  백필을 안내합니다. sync(whole-file 복사)와 달리 read-merge-write이므로 별도 verb입니다.

## 0.9.1

신규 설치의 온보딩을 개선하는 **문서 릴리스**입니다(REQ-2026-039). 실행 코드·의존성 변경이 없어 기존
사용자는 무회귀이고, **신규 설치에만** 반영됩니다(seed-once — 기존 `CLAUDE.md`/`AGENTS.md`는 보존).

- **온보딩 Quick Start — always-loaded 템플릿 자립화** (REQ-2026-039). 신규 설치가 생성하는
  `CLAUDE.md`(Claude Code가 항상 로드)와 `AGENTS.md`(Codex·Cursor가 항상 읽는 계약) **앞부분**에,
  첫 요청에서 올바른 첫 행동을 고를 수 있는 자립형 Quick Start 블록(`req:new` → `req:next` 루프 · 5
  kind · `state.json`/`responses` staging 금지 · `git commit` 직접 사용 예외)을 넣습니다. 이전엔 이
  앞부분이 "`AGENTS.md`를 읽어라"는 이정표라, 에이전트가 계약 존재는 알아도 **첫 조작에서 멈추곤**
  했습니다. 두 템플릿의 블록은 **바이트 동일**(단위 테스트로 강제 — 한쪽만 고치는 drift 방지).
  **신규 설치에만 반영**(seed-once — 기존 `CLAUDE.md`/`AGENTS.md`는 보존). 기존 파일에 Quick Start를
  주입하는 UX는 후속(REQ-040).

## 0.9.0

phase 자동 커밋 opt-in(REQ-2026-037)과 업그레이드 자산 skew 감지·복구(REQ-2026-038)가 핵심입니다. 둘 다 0.8.x 위
**추가 기능**(opt-in·additive·backward-compatible)이라 기존 사용자는 무회귀입니다. 업그레이드는 `npm install -D commitgate@latest`
후 `commitgate sync --apply`로 vendored 자산을 맞추세요(README "업그레이드 (0.x)" 절).

- **자산 skew 감지·복구 — `commitgate sync` + doctor D20** (REQ-2026-038). 소비 프로젝트가 런타임을 minor 넘어
  업그레이드할 때의 두 함정을 닫습니다. **(1) 캐럿 범위**: `^0.y`는 0.x minor를 자동으로 넘지 않아(`npm update`가
  0.7.x에 머묾) 범위를 명시적으로 올려야 합니다 — README에 "업그레이드 (0.x)" 절을 신설하고, "업데이트는 한 번"이라던
  기존 오도 문구(한/영)를 교정했습니다. **(2) vendored 자산 skew**: 런타임은 스키마·persona를 소비 repo의 사본에서
  읽는데 `npm update`는 그 사본을 갱신하지 않아, 새 런타임이 옛 계약을 읽어 신규 필드(`full_review_requested`)가
  조용히 죽습니다(`machine_schema_version`이 minor 간 불변이라 버전으로는 감지 불가 — **content-hash로만** 잡힘).
  신규 **`commitgate sync`**(기본 dry-run·`--apply`·`--persona`)가 vendored 스키마 축을 설치된 패키지 사본으로
  되돌리고(모든 쓰기는 init의 confinement 경로 재사용, `targetRoot===패키지 루트`면 하드 거부), 페르소나는 opt-in에서
  **부재 복원만**(사용자 수정본 불가침). **`req:doctor` D20**이 vendored 스키마가 설치 사본과 어긋나면 WARN합니다
  (**절대 FAIL 아님** — 커밋 게이트를 벽돌로 만들지 않음). SSOT 갭 **G-10**·로드맵 **STR-06**을 MVP(manifest-free
  content-oracle) 범위로 부분 해결했습니다(커밋 install 원장·persona 3-way·rollback은 후속).

- **phase 자동 커밋(opt-in) — `phaseCommit.autoApprove`** (REQ-2026-037). `req.config.json`에
  `"phaseCommit": { "autoApprove": "low-only" }`를 두면 **LOW 위험** 티켓의 Codex 승인 phase가 사람 정지 없이
  자동 커밋되고(`req:next`가 `req:commit --run`을 RUN으로 지시), 사람 확인은 feature→main **병합 직전 한 번**으로
  모입니다(종단이 `DONE` 대신 `AWAIT_HUMAN`(통합)). **기본값 `never`는 현행 동작(매 phase 확인)과 100% 동일**해
  기존 사용자는 무회귀입니다. **HIGH 티켓은 정책과 무관하게 매 phase 확인**(`userConfirmGate` 백스톱)이고,
  fail-closed로 `risk_level`이 정확히 `LOW`일 때만 자동입니다(누락·불명·`"all"` 정책은 없음 — HIGH livelock 방지).
  Codex 리뷰 게이트·커밋시점 doctor 재검증은 무변경 — 제거되는 것은 LOW phase의 *사람 정지*뿐입니다.
  (런타임은 이미 구현·커밋돼 있습니다: 설정 배선·enum은 [`scripts/req/lib/config.ts`](scripts/req/lib/config.ts)의
  `phaseCommit`/`CONFIG_SCHEMA`, 자동 커밋 분기·복구 가드·병합 게이트는 [`scripts/req/req-next.ts`](scripts/req/req-next.ts)의
  `resolveNext`. 이 문서 변경은 그 검증된 동작을 문서·기본 설정에 반영한 것입니다.)

## 0.8.1

- **README에 0.8.0 기능 문서화** — 설정 표에 `reviewBudget`(재리뷰 시도 예산·상한), "무엇을 보장하나요?"에
  무한 재리뷰 방지(예산 게이트), "설계 재리뷰는 delta로 좁혀집니다" 절(delta review·full review escalation)을
  한/영 README에 추가했습니다. 코드 변경 없음(문서만).

## 0.8.0

리뷰 루프 수렴 안정화와 design delta review가 핵심입니다. 모두 `0.7.0` 설치 모델 위의 **추가 기능**이라 기존
사용자는 별도 조치가 필요 없습니다 — 패키지를 업그레이드한 뒤 `commitgate init`으로 갱신된 관리 자산을 받습니다.

### Companion Skills

- **Companion Skills 추가 및 lifecycle 문서화** — `commitgate init`이 `.claude/skills/commitgate-*/SKILL.md` 4종
  (`discovery`·`tdd`·`diagnosing-bugs`·`research`)을 함께 설치합니다. 설치·보존·경고·제거 계획·지원 범위는
  [README](README.md#companion-skills) / [README (English)](README.en.md#companion-skills)를 참조하세요.
- **`init` 쓰기 경로 symlink confinement** — 설치 대상 전 경로에서 상위 디렉터리·leaf를 `lstat`으로 검사해
  대상 루트 밖을 가리키는 symlink를 따라가지 않습니다(우발적 symlink로 인한 외부 파일 생성·덮어쓰기 차단).

### 리뷰 루프 수렴 안정화

- **리뷰 시도 계수·예산 게이트** — `(review_kind, phase_id)`별 review series로 시도를 계수하고, 자동 예산
  (`reviewBudget.autoBudget`, 기본 5)을 넘으면 사람 예외 손기록이 있어야 진행, 하드캡(`reviewBudget.hardCap`,
  기본 8)에서 완전 차단합니다. `req.config.json`의 `reviewBudget`로 조정합니다 — 무한 재리뷰 루프를 막습니다.
- **리뷰 배칭** — 한 라운드에서 여러 P1을 함께 반환하도록 유도해 라운드 수를 줄입니다.
- **대체 REQ lineage** — 미수렴 REQ를 사람 결정(`human-resolution`)으로 종료하고 `req:new --successor-of <REQ>`로
  부모 이력을 보존한 대체 REQ를 만듭니다.

### Design delta review

- **design 재리뷰가 delta로 동작** — 승인된 설계 baseline 이후 **변경된 문서만** 심사하도록 리뷰 프롬프트를
  구성합니다. 변경 문서는 `[변경됨]`, 미변경 문서는 `[승인 baseline]`으로 표시하고, "변경분·직접 영향만 심사,
  승인 영역 재심사 금지" 계약을 리뷰어에게 겁니다. 미변경 문서 본문은 생략해 토큰을 절감합니다 — 승인 후
  작은 편집이 전체 재리뷰를 유발해 승인이 되돌려지던 문제를 줄입니다.
- **full review escalation** — 변경이 너무 근본적이라 delta로 판단할 수 없으면 리뷰어가 `full_review_requested`로
  전체 재리뷰를 요청할 수 있습니다(다음 라운드가 full 모드로 전환). `reviewPersonaPath: null`이어도 delta
  design 리뷰에는 내장 delta 계약이 주입됩니다.

### 기타

- **ISO 타임스탬프 달력 검증** — 손기록·evidence의 ISO 타임스탬프를 형식뿐 아니라 달력 유효성까지 검사합니다
  (`2026-99-99T…` 같은 달력상 불가능한 값을 거부).

## 0.7.0

**설치 모델이 바뀝니다 — 기존 사용자는 조치가 필요합니다.** 실행 코드와 런타임 의존성을 대상 프로젝트에 복사·주입하지 않고, `commitgate` 패키지에서 실행합니다. 프로젝트에는 거버넌스·감사 데이터만 남습니다.

> **npm 배포 이력**: `0.5.0`·`0.6.0`은 npm에 배포되지 않았습니다. `0.4.0` 다음 릴리스가 `0.7.0`이며, 아래 `0.5.0`·`0.6.0` 항목의 변경도 **전부 `0.7.0`에 포함**됩니다.

### ⚠️ Breaking

- **설치가 2단계가 됩니다.** `npx commitgate` 단독 실행으로는 더 이상 설치되지 않습니다.

  ```sh
  npm install -D commitgate    # 1) 런타임이 node_modules/commitgate 에 들어옵니다
  npx commitgate init          # 2) 설정·계약·스키마와 req:* 스크립트를 깝니다
  ```

  `init`은 대상 `package.json`에 `devDependencies.commitgate` 선언이 없으면 **중단**합니다 — `req:*`가 가리킬 런타임이 없기 때문입니다. 선언의 **존재만** 확인하고 값 형태는 검증하지 않습니다(`file:`·`link:`·`workspace:`·git URL 전부 정당한 설치 형태입니다).

- **`scripts/req/**`를 복사하지 않습니다.** 실행 코드는 `node_modules/commitgate`에만 있습니다.
- **`tsx`·`ajv`·`cross-spawn`을 대상 `package.json`에 주입하지 않습니다.** 이들은 `commitgate` 패키지의 runtime dependency로 전이 설치됩니다.
- **`req:*` 스크립트 값이 `commitgate <verb>`가 됩니다**(예: `req:new` → `commitgate req:new`). `npm run req:new -- <slug>` UX와 인자 전달은 그대로입니다.

### 기존 설치본(0.6.0 이하)에서 옮겨오기

기존 프로젝트에는 `scripts/req/`가 복사돼 있고 `req:*`가 `tsx scripts/req/*.ts`를 가리킵니다. `init`은 이 상태를 감지하면 조용히 섞이지 않도록 **중단하고** `migrate`를 안내합니다.

```sh
npm install -D commitgate
npx commitgate migrate         # 계획만 출력 — 아무것도 쓰지 않습니다
npx commitgate migrate --apply # package.json 의 req:* 만 전환
```

- **아무것도 삭제하지 않습니다.** `scripts/req/`·스키마·persona·설정·진입점·`workflow/REQ-*` 증거를 전부 그대로 둡니다. 남은 `scripts/req/`는 더 이상 실행되지 않으니, 정리하려면 `npx commitgate uninstall` 계획을 먼저 확인하세요.
- **직접 고친 스크립트는 덮어쓰지 않습니다.** 값이 **정확히** 기존 주입값일 때만 전환하고, 한 글자라도 다르면 사용자 값으로 보아 보존한 뒤 수동 조치를 안내합니다.
- **커밋하지 않습니다.** `package.json` 한 파일만 쓰고, 검토는 사용자 몫입니다.

### 추가

- **`commitgate migrate`** — 위 비파괴 전환 명령. 기본 dry-run.
- **`req:doctor` D19 — 설치 모드 진단.** `req:*` 값의 **형태만**으로 예전(vendored)/현재(런타임 패키지)/혼합/없음/사용자정의를 분류합니다. 혼합일 때만 WARN하며 **FAIL하지 않습니다** — 예전 설치 형태는 결함이 아니라 지원되는 상태이고, `req:commit`이 doctor를 하드 게이트로 실행하므로 FAIL로 두면 정당한 프로젝트의 커밋이 막힙니다. manifest·lockfile·`node_modules`·버전은 검증하지 않습니다.
- **verb dispatch** — `commitgate <verb>`가 패키지 내부 모듈로 라우팅됩니다. `npx commitgate --dry-run` 같은 기존 옵션 형태는 그대로 `init`으로 갑니다(하위호환).
- **`uninstall`에 런타임 제거 안내 추가** — `npm uninstall -D commitgate`. 이 명령은 여전히 **읽기 전용**이며 안내를 문자열로 출력만 합니다(npm을 실행하지 않습니다).

### 지원 범위

- **npm** — 완전 지원. 매 릴리스 packed tarball smoke로 검증합니다.
- **pnpm·yarn**(`node_modules` linker) — 지원. 표준 `node_modules/.bin/commitgate` 해소를 씁니다.
- **Yarn PnP** — **이번 릴리스 미지원**(검증하지 않았습니다). `nodeLinker: node-modules`를 쓰세요.
- **workspace/monorepo** — 워크스페이스 root 설치를 지원합니다. 하위 패키지 독립 설치는 미지원.
- 런타임 버전은 lockfile이 고정하므로 `package-lock.json`(pnpm/yarn은 각 lockfile)을 **커밋하세요**.

### 알려진 한계

- **관리 자산(스키마·persona)과 런타임 패키지의 버전 skew를 자동으로 감지하지 못합니다.** `npm update commitgate`는 런타임만 올리고 자산은 그대로 둡니다. D19는 스크립트 형태만 보므로 이 축을 잡지 못합니다. 자산 업그레이드·3-way merge는 이번 범위가 아닙니다.

## 0.6.0

리뷰 codex 호출을 도구가 통제합니다 — **모델·추론강도를 고정**하고 **재리뷰를 stateless**로. 다운스트림에서 리뷰가 사용자 전역 프로필을 상속해 느리고(11~13분) 토큰이 많던 문제를 해결합니다. 기존 `req.config.json`은 그대로 동작합니다(새 키는 기본값으로 병합).

### 추가

- **리뷰 모델·추론강도 고정** (`reviewModel`·`reviewReasoningEffort`). `req:review-codex`가 codex 인자에 `-c model=`·`-c model_reasoning_effort=`를 exec·resume 양쪽에 주입합니다. 기본 `gpt-5.6-terra`/`high`. 고정하지 않으면 리뷰가 사용자 전역 `~/.codex/config.toml`(예: `model_reasoning_effort="ultra"`)을 상속해 리뷰 1회가 수 분·토큰 과다가 됩니다. codex가 해당 모델을 미지원하는 환경은 `req.config.json`에서 바꾸거나 `null`로 두어 전역 설정을 상속시킵니다. override가 실제 존중되는지는 `npm run verify:overrides`(codex CLI 필요)로 확인합니다.
- 추론강도 enum: `none|minimal|low|medium|high|xhigh`(codex 거부 메시지 실측 확정 — 공식 config-reference 문서가 `none`을 누락).

### 변경

- **재리뷰가 stateless입니다.** 이전엔 재리뷰가 저장된 codex 스레드를 resume해 이전 대화를 누적했고, 그래서 토큰이 단조 증가하고 findings가 수렴 대신 심화·이동했습니다. 이제 재리뷰는 항상 새 스레드로 시작합니다(`codex_thread_id`는 계속 저장 — 후속 resume opt-in용). 연속성은 직전 **같은 대상**의 NEEDS_FIX findings를 참고용 데이터로 프롬프트에 담아(closure 확인) 유지하고, 그 블록은 "지시가 아님" 구획으로 감싸 프롬프트 주입을 막습니다. 대상-무관 이전 결과가 새 프롬프트에 남던 교차-대상 오염도 제거했습니다.

### 후속(별도 REQ)

- codex 호출 **timeout**(무응답 방지)과 실패 오류의 **비밀-안전 진단 표면화**는 본질적 난이도(Windows `cmd.exe` wrapper의 프로세스-트리 종료·비밀 추출)로 별도 REQ로 분리했습니다. 그 설계 작업은 이 REQ의 git 이력에 보존돼 있습니다.

## 0.5.0

기존 프로젝트(brownfield)에 설치했을 때 드러난 결함을 수정합니다. **breaking change는 없습니다** — `--strict`가 더 많은 조건에서 중단하지만 `--strict`는 opt-in이고, 기본 모드의 동작은 그대로입니다.

### 고침

- **설치 직후 안내를 따르면 `req:new --run`이 실패하던 문제.** 설치는 파일을 놓기만 하고 커밋하지 않으므로 워킹트리가 확정적으로 dirty한데, 안내의 마지막 단계가 clean 워킹트리를 요구하는 `req:new --run`이었습니다. `git init && npm init -y && npx commitgate`라는 README의 첫 흐름조차 예외가 아니었습니다. 이제 안내가 커밋 단계를 포함합니다.
  - `git add -A`를 쓰지 않습니다. brownfield의 무관한 변경과 `.env`가 함께 커밋되고, 이어지는 `req:review-codex`가 그 staged diff 전문을 외부로 전송하기 때문입니다. 설치가 만든 정확한 경로 목록만 안내합니다.
  - 안내 명령에 `&&`를 쓰지 않습니다. Windows PowerShell 5.1과 `cmd.exe`에 그 연산자가 없습니다.
  - `<pm> install`이 갱신하는 lockfile과, 계약 마커가 없을 때 생성되는 `AGENTS.commitgate.md`를 stage 목록에 포함합니다. 빠뜨리면 커밋 뒤에도 워킹트리가 dirty로 남습니다.
  - 설치 전부터 있던 무관한 변경은 `git stash push -u -- <경로>`로 안내합니다. 경로 없는 `git stash -u`는 gitignore되지 않은 `node_modules/`까지 쓸어 갑니다.
  - 설치 전에 **staged 변경**이 있거나 **산출물과 겹치는 tracked 수정**이 있으면 `git add` 목록을 내지 않습니다. 전자는 커밋이 삼키고 후자는 사후 분리가 불가능합니다. 잘못된 안내보다 안내 없음이 낫습니다.
  - `node_modules`가 무시되지 않으면 `.gitignore` 추가를 안내하고 그 파일을 설치 커밋에 담습니다. 무시 규칙은 **tracked 저장소 `.gitignore`**에서 온 것만 인정합니다 — `.git/info/exclude`와 전역 ignore는 clone에 따라오지 않습니다.
  - 경로에 공백이 있으면 큰따옴표로 묶습니다. 큰따옴표·백틱·`$`·`%`·`!`가 든 경로는 어떤 셸 인용으로도 안전하지 않으므로 복붙 명령을 아예 내지 않습니다 — `cmd.exe`는 큰따옴표 안에서도 `%VAR%`와 `!VAR!`를 치환합니다.
  - `git status --porcelain`이 C-인용해 주는 경로(`"notes today.txt"`)를 되돌립니다. 되돌리지 않으면 산출물 매칭이 실패하고 안내가 이중 인용을 냅니다.

- **`.claude`를 통짜로 무시하는 repo에서 진입점이 조용히 추적 제외되던 문제.** 설치는 "성공"을 출력했지만 팀원의 fresh clone과 CI에는 계약 포인터가 없었습니다. 이제 `git check-ignore`로 감지해 경고하고, 동작하는 `.gitignore` 패턴을 제시합니다(부모 디렉터리가 제외되면 하위 부정 패턴이 무효라는 함정 포함). `--strict`에서는 파일을 하나도 쓰기 전에 중단합니다.

- **진입점 템플릿이 `npm run …`을 하드코딩하던 문제.** pnpm/yarn 프로젝트에 틀린 명령이 깔렸습니다. 이제 계약(`AGENTS.md`)과 같은 pm-중립 표기를 씁니다. 치환 렌더링은 쓰지 않습니다 — `uninstall`이 설치본과 패키지 원본의 sha256을 비교하므로, 렌더하면 자기가 깐 파일을 지우지 못합니다.

- **런타임 문구의 pm 리터럴.** `req:next`는 npm을, `req:new`·`req:doctor`·`req:review-codex`는 pnpm을 박아 두어 어느 프로젝트에서든 최소 하나는 틀렸습니다. config 로드 이후의 안내·에러는 이제 감지한 패키지매니저로 렌더합니다.

- **`--`를 "알 수 없는 옵션"으로 거부하던 문제.** npm은 `npm run x -- a`에서 `--`를 제거하지만 pnpm/yarn은 그대로 전달합니다. 이제 POSIX end-of-options 구분자로 흡수합니다. `--` 이후 인자도 계속 옵션으로 파싱하므로 `req:commit <id> -- --run`이 조용히 dry-run이 되지 않습니다.

- **`uninstall`이 skip한 사용자 파일을 소유물로 오인하던 경로.** stage 목록은 패키지 원본과 byte-identical한 파일만 CommitGate 소유로 봅니다.

### 새로 알림

- `README`와 `AGENTS.template.md`에 **`req:review-codex`가 `git diff --cached` 전문을 Codex(OpenAI)로 전송한다**는 사실을 명시했습니다. codex는 `--sandbox read-only`로 저장소 루트를 읽으며, 마스킹·필터·길이 상한이 없습니다.
- **git hook을 설치하지 않으므로 `git commit`을 직접 치면 게이트가 우회된다**는 점도 README 상단에 명시했습니다. 이 도구의 강제력은 협조하는 에이전트를 계약 궤도에 유지하는 데 있습니다.

### 아직 하지 않은 것

- 트렁크 브랜치가 `'main'`으로 하드코딩되어 있습니다(`trunkBranch` config 없음).
- `req:review-codex`에 타임아웃이 없습니다.
- 리뷰 전 시크릿 스캔 훅(`preReviewCommand`)이 없습니다.

## 0.4.0 이전

`git log`를 참조하세요.
