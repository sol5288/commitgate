# REQ-2026-080 설계 — 지원 범위를 줄이되, 무엇을 줄였는지 정확히 말한다

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

`grep` 실측 — Node 18 요구가 등장하는 곳:

| 파일 | 내용 |
|---|---|
| `package.json` | `engines.node: ">=18.17"` |
| `.github/workflows/ci.yml` | `node: [18, 20, 22]` |
| `.github/workflows/hang-probe.yml` | `node-version: 18` 고정(REQ-2026-077 조사용) |
| `README.md` / `.en.md` | 준비물 표 "Node.js 18.17+" |
| `docs/quick-start.md` / `.en.md` | 준비물 표 |
| `docs/development.md` / `.en.md` | CI 매트릭스 설명 |
| `docs/RELEASING.md` | 배포 게이트의 매트릭스 설명 |
| `docs/ssot-design/` 01·02·10·README | **"현재 구현의 사실"** |
| `docs/ssot-design/` 11·13 | 🔴 **날짜가 붙은 검수 이력** |

## 핵심 설계 결정

### DEC-1 — 🔴 "현재 사실"은 고치고, **이력은 고치지 않는다**

`docs/ssot-design/README.md`가 스스로 규정한다: "01~12는 **현재 구현의 사실**을 기준으로 한다.
13은 **시점이 있는 검수 이력**이다."

| 문서 | 처리 | 이유 |
|---|---|---|
| 01·02·10·README | **갱신** | 지금 사실을 말하는 문서다. 두면 **거짓 사실**이 된다. |
| 11·13 | 🔴 **그대로 둔다** | "2026-07-17 보고: CI 9/9(3 OS × Node 18/20/22)"는 **그때 실제로 그랬다**는 기록이다. 고치면 **역사 위조**다. |

🔴 이 구분이 이 REQ에서 가장 틀리기 쉬운 지점이다. "Node 18을 전부 지운다"로 접근하면
과거 기록까지 바꿔 감사 가치를 파괴한다.

### DEC-2 — 🔴 **"고쳤다"가 아니라 "지원하지 않는다"**로 쓴다

교착의 근원 원인은 **여전히 모른다**(REQ-2026-077이 워커의 JS 루프까지 좁혔을 뿐).
Node 18을 매트릭스에서 빼면 **관측 조건이 사라질 뿐 원인이 해결되는 것이 아니다.**

CHANGELOG·문서는 그 차이를 정확히 말한다:
- ✅ "Node 18을 더 이상 지원하지 않습니다"
- 🔴 ❌ "교착을 고쳤습니다"

이유: 나중에 누군가 Node 18로 되돌리면 **같은 교착이 그대로 난다.**
"고쳤다"고 적혀 있으면 그 사람은 다른 원인을 찾느라 시간을 버린다.

### DEC-3 — 매트릭스는 `[20, 22, 24]`

사용자 결정이다. 잡 수는 **9개로 현행과 같다**(3 OS × 3 node).

🔴 **Node 24는 이 저장소에서 한 번도 검증된 적이 없다.** 새 실패가 나올 수 있고,
그것은 **알아내야 할 사실**이지 회피할 대상이 아니다. 나오면 그 자리에서 보고한다.

### DEC-4 — `hang-probe.yml`의 node 버전을 **입력으로 뺀다**

프로브는 REQ-2026-077이 node 18 교착을 조사하려고 만들었고 `node-version: 18`이 박혀 있다.
Node 18을 지원하지 않으면 그 고정값은 **지원하지 않는 버전을 시험하는 도구**로 남는다.

→ `node_version` 입력을 추가하고 기본값을 **22**(지원 중인 LTS)로 둔다.
🔴 워치독·증거 수집이라는 **도구의 가치는 그대로 유지**하면서 낡은 고정값만 없앤다.

(❌ 대안 "프로브를 지운다"는 기각한다 — 다음 교착 때 다시 만들어야 한다.)

### DEC-5 — 🔴 branch protection은 **사용자 조치**로 남긴다

매트릭스가 바뀌면 잡 이름이 바뀐다(`… node 18` 소멸 · `… node 24` 신설).
required status checks 목록을 갱신하지 않으면 **PR이 없는 체크를 영원히 기다린다.**

🔴 저장소 설정은 도구가 임의로 바꾸지 않는다. 요구서와 완료 보고에 **명시적 조치 항목**으로 적는다.

## Phase별 구현

| phase | 범위 | 파일 |
|---|---|---|
| phase-1 | 런타임 요구·CI | `package.json` · `ci.yml` · `hang-probe.yml` |
| phase-2 | 문서 한/영 · ssot-design · CHANGELOG | README ko/en · quick-start ko/en · development ko/en · RELEASING · ssot-design 01·02·10·README · CHANGELOG |

## 변경 파일

phase-1: `package.json` · `.github/workflows/ci.yml` · `.github/workflows/hang-probe.yml`
phase-2: 위 문서 목록

🔴 **건드리지 않는 파일**: `docs/ssot-design/11-*` · `docs/ssot-design/13-*`(검수 이력) ·
`package-lock.json`(engines 변경은 lockfile에 영향 없음 — 확인 후 그대로면 커밋하지 않는다).

## 하위호환·안전

- 🔴 **호환성 깨짐이다.** Node 18 사용자는 `npm i` 시 `engines` 경고를 받고,
  `--engine-strict` 환경에서는 설치가 **실패**한다. CHANGELOG가 이것을 앞세운다.
- 되돌림: `engines`와 매트릭스를 되돌리면 된다. 다만 되돌리면 **교착도 함께 돌아온다.**
- 제품 코드(`scripts/`·`bin/`)는 바뀌지 않는다 — 런타임 요구와 CI·문서만이다.
