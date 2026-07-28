# REQ-2026-082 요구사항

## 무엇을

랜딩 README(ko/en)와 그 첫 접촉 경로를 **비개발자 바이브코더가 끝까지 따라올 수 있도록** 고친다.

## 왜

README는 대문이자 첫 화면인데, 현재는 **"이미 git·npm을 아는 개발자"를 암묵적 독자로 가정**한다.
점검에서 비개발자가 실제로 막히는 지점이 확인됐다.

| # | 막히는 지점 | 근거 |
|---|---|---|
| 1 | **비용을 어디서도 말하지 않는다** — Codex 리뷰는 실제 호출이라 계정 사용량을 소비하는데, 준비물 표는 `codex --version`만 확인시킨다 | `README.md:91` · 실측 `check` C3 = `Logged in using ChatGPT` |
| 2 | **"승인 문장"의 실물이 없다** — 무엇을 타이핑해야 하는지 알 수 없다 | `README.md:133` vs 실제 값 `req:commit --run 승인` (`req-next.ts:653`) |
| 3 | **가장 어려운 문장이 설치 바로 아래** — `clean 워킹트리`·`stage`·`-A`/`.`가 설명 없이 한 문장에, 금지 이유(민감정보 외부 전송)는 quick-start에만 | `README.md:107` vs `docs/quick-start.md:56` |
| 4 | **`npx commitgate check`가 README에 0회** — 비개발자에게 가장 쓸모 있는 읽기 전용 진단인데 대문에 없다 | `README.md` 전문 |
| 5 | **시작 조건이 "조건"으로만 있고 "행동"이 없다** — git 저장소도 `package.json`도 없는 폴더가 흔하다 | `README.md:97` vs `docs/quick-start.md:6-8` |
| 6 | 🔴 **`npx commitgate --help`가 `setup`을 모른다** — README는 setup을 "건너뛸 수 없다"고 하는데, 터미널 도움말은 `init`·`migrate`·`uninstall`만 안내하고 "설치 후" 순서에도 setup이 없다 | `bin/init.ts:1454-1482` vs `bin/dispatch.mjs:15-34` |
| 7 | 리뷰가 반려를 반복하면 어떻게 되는지 대문에 없다 → **무한 루프처럼 보인다** | `reviewBudget`은 `docs/configuration.md:14`에만 |
| 8 | **되돌리는 법**이 표 링크 하나뿐 — 겁먹은 초보에게 안심 장치가 없다 | `README.md:175` |
| 9 | **용어 미설명** — `staged diff`·`phase`·`devDependency`·`fail-closed`·`delivery set`·`AWAIT_HUMAN` | 전반 |
| 10 | **탐색 UI 없음** — 182줄 9섹션에 목차·독자 분기 없음, 실제 화면 예시 0개, Node 배지 없음 | 전반 |

## 제약

- 🔴 **안전 4문구는 `## 3분 설치` 헤딩보다 앞에 바이트 그대로** 남아야 한다 — `tests/unit/readme-landing.test.ts`가 정본 가드다. 경고를 뒤로 옮기거나 문구를 바꾸지 않는다.
- 🔴 **docs 링크는 절대 blob URL**(`https://github.com/sol5288/commitgate/blob/main/docs/…`) — 상대 링크는 npm 페이지에서 깨진다(`docs/`는 tarball 미포함).
- 🔴 **보장/비보장 진술을 약화하지 않는다.** 읽기 쉽게 만드는 것이지 무르게 만드는 것이 아니다.
- npm 패키지 페이지는 **mermaid를 렌더링하지 않는다** → 다이어그램은 ASCII 유지.
- 코드 동작·게이트·보장 계약 불변. 유일한 코드 변경은 `bin/init.ts`의 **도움말 문자열**이다.

## 완료 기준

- 위 10건이 ko/en 양쪽에 반영된다.
- `npx commitgate --help`가 실제 dispatch 가능한 verb를 빠짐없이 안내하고, "설치 후" 순서에 setup이 들어간다 — 회귀 테스트로 고정한다.
- `npm run docs:lint` · `npm test` 그린.
- README에 싣는 터미널 출력은 **실제 실행 결과**여야 한다(지어내지 않는다).
