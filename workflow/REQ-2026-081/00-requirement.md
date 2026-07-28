# REQ-2026-081 요구사항 — 0.12.0 변경이 사용자 문서에 닿지 않은 곳을 메운다

## 왜 지금인가

0.12.0(REQ-2026-076~080)은 **호환성 깨짐**을 담았다 — 최소 런타임이 Node 18 → **Node 20**.
릴리스 후 사용자 문서를 축별로 대조했더니, **소비자가 실제로 부딪힐 지점**에 안내가 없다.

## 실측 (2026-07-28 · main=dfd829b)

### 반영된 것

| 축 | 문서 | 상태 |
|---|---|---|
| Node 20+ 요구 | README ko/en · quick-start ko/en 준비물 표 | ✅ |
| CI 매트릭스 `[20,22,24]` | development ko/en · RELEASING | ✅ |
| CI 20분 타임아웃 | development ko/en | ✅ |

`grep` 실측: `templates/`·`AGENTS.template.md`·`skills/`에는 Node 언급이 **없다**(대상 아님).

### 갭

| # | 문서 | 문제 |
|---|---|---|
| **G1** | `docs/upgrade.md` / `.en.md` | 🔴 **0.12.0 호환성 깨짐 안내가 없다.** 이 문서의 본업이 "업그레이드할 때 무엇을 챙기나"인데 **Node 요구 상승**이 없다. 0.11 사용자가 `commitgate@latest`를 받으면 `EBADENGINE`을 만나는데 그 설명이 어디에도 없다. 문서 구조상 버전별 절 자체가 없다(`# 업그레이드 (0.x)` → `## 예전 설치본에서 옮겨오기`). |
| **G2** | `docs/guarantees.md` / `.en.md` | 지원 범위 표에 **런타임(Node) 행이 없다.** npm·pnpm·yarn·PnP·workspace는 있는데 가장 기본 축이 빠졌다. |
| **G3** | `docs/troubleshooting.md` / `.en.md` | **`EBADENGINE` 항목이 없다.** Node 18 사용자가 만날 **첫 증상**인데 FAQ에 없다(현재 12개 항목 중 0건). |
| **G4** | `docs/development.md` / `.en.md` | `testTimeout: 30초`(REQ-079)·`hang-probe.yml`(REQ-077) 미기재. 기여자용이라 경미. |

## 수용 기준

1. **G1**: `upgrade` ko/en이 **0.11 → 0.12 업그레이드 시 Node 20 이상이 필요**하다고 말하고,
   Node 18에 머무를 경우의 **실제 증상**(경고 / `--engine-strict` 설치 실패)과 선택지를 안내한다.
   🔴 실측된 문구를 쓴다 — `EBADENGINE` · `required: { node: '>=20' }`.
2. **G2**: `guarantees` ko/en 지원 범위 표에 **런타임 행**을 넣는다(Node 20·22·24 검증 · 18 미지원).
3. **G3**: `troubleshooting` ko/en에 `EBADENGINE` 증상 항목을 넣고 **해결 경로**를 준다.
4. **G4**: `development` ko/en에 `testTimeout` 상한과 `hang-probe.yml`의 존재·용도를 적는다.
5. 🔴 **"고쳤다"로 쓰지 않는다.** Node 18 교착의 근원 원인은 미해결이며, 지원 중단은 회피다
   (REQ-2026-080 DEC-2와 같은 계약).
6. 한/영 **양쪽** · `docs:lint` green · `npm test` green.

## 범위 밖

- README 랜딩(이미 반영됨) · `docs/ssot-design/`(REQ-080에서 처리) · 새 기능.
