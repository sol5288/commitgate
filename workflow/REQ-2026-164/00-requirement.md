# REQ-2026-164 요구사항

## 무엇

업그레이드 시 **조치가 필요한 축**을 코드의 등록부 하나로 모으고, 정본 문서(`docs/upgrade.*`)와
README(한/영)가 그 **전부**를 담는지 테스트가 검사하게 한다.

## 왜

### ① README 가 이미 갈라져 있다(실측)

REQ-2026-161 이 `docs/upgrade.md`·`.en.md` 에 **명령 표면 축**(`sync --apply --scripts`)을 추가했지만
README 는 건드리지 않았다. 그래서 지금 README 는 옛 명령을 안내한다:

| 위치 | 현재 |
|---|---|
| `README.md` 업그레이드 스니펫 · 명령표 | `npx commitgate sync --apply --gitignore` (`--scripts` 없음) |
| `README.en.md` 대응 위치 | 동일 |

이 저장소가 반복해 온 형태 그대로다 — **새 절 추가는 갱신이 아니다**(REQ-2026-073). 축을 늘린 사람이
문서 네 곳을 전부 기억해야 하는 구조라, 기억에 기대는 한 또 갈라진다.

### ② 축이 흩어져 있어 "누락 없이"를 사람이 보장한다

조치가 필요한 축과 그 진단·조치가 서로 다른 표면에 나뉘어 있다(실측 확인):

| 축 | 진단 | 조치 |
|---|---|---|
| vendored 스키마 | `doctor` D20 | `sync --apply` |
| `workflow/.gitignore` | `doctor` D22 | `sync --apply --gitignore` |
| `req:*` 명령 표면 | `check` C6 · `doctor` D33 | `sync --apply --scripts` |
| 관리 블록(Quick Start) | `doctor` D21 | `quickstart --apply` |
| `AGENTS.md` 계약 문구 | `check` C5 | **수동 병합**(도구가 고치지 않는다) |
| **혼합(mixed) 설치** | `doctor` D19 | `migrate --apply` |
| review persona | `sync` 계획 출력 | `sync --apply --persona [--persona-apply]` |
| caret 범위(`^0.x`) | **진단 없음** | 명시 설치(`npm i -D commitgate@<ver>`) |

진단은 `check` 2곳 + `doctor` 4곳, 조치는 `sync` 4축 + `quickstart` + `migrate` + 수동 2종이다.
어느 문서도 이 여덟을 **한 자리에서** 열거하지 않는다.

## 제약

- 🔴 **문서에 목록을 손으로 적는 것으로 끝내지 않는다.** 그것이 지금 갈라진 원인이다. 등록부는 코드에
  두고 문서가 그것을 담는지 **테스트가 검사**한다(`D_CHECK_IDS` ↔ 07 정본표가 이미 쓰는 방식).
- 🔴 **등록부가 가리키는 진단 id 는 실재해야 한다.** 존재하지 않는 체크를 가리키는 문서를 만들지 않는다 —
  `D_CHECK_IDS` 와 `check` 의 항목 id 로 대조한다.
- 🔴 **정본은 한 곳**(`docs/upgrade.md`)이고 README 는 요약 + 링크다. README 가 절차를 복제하면 또 갈라진다.
- 동작 변경 없음 — 진단·조치 명령 자체는 그대로 두고 **문서 정합과 가드만** 더한다.

## 완료 기준

1. 축 등록부가 코드에 있고, 각 축이 **진단 id·조치 명령**을 담는다.
2. `docs/upgrade.md`·`docs/upgrade.en.md` 가 **모든 축**을 한 표에 담고, 가드가 누락을 red 로 만든다.
3. README 한/영의 업그레이드 안내·명령표가 정본과 일치한다(`--scripts` 포함).
4. 등록부에 축을 **추가하면** 문서를 안 고쳤을 때 테스트가 red 다(변이로 확인).
5. 변경한 소스를 import 하는 테스트 그린 · 통합 직전 전체 스위트 1회 그린.

## 비목표

- 진단·조치 **동작** 변경(새 체크·새 sync 축 추가).
- caret 범위 자동화 — PM 이 강제하므로 코드로 못 고친다(문서 안내가 유일한 수단).
- 버전별 주의사항 절(`## 버전별 주의사항`)의 과거 항목 재작성 — 지나온 버전 기록은 그대로 둔다.
- 🔴 **D19 동작 변경.** D19 는 **`mixed` 만 WARN** 하고 순수 Stage A 는 `OK` 다 — 코드가 그 이유를 적고
  있다(*"Stage A 는 결함이 아니라 지원되는 설치 형태"* · FAIL 이면 이 저장소 자신과 정당한 Stage A 소비자
  전원의 커밋이 막힌다). 등록부는 **그 사실 그대로** 적는다: 축은 "Stage A→B 전환 필요"가 아니라
  **"혼합(mixed) 설치"** 다. 사실과 다른 안내를 만들지 않는다.
