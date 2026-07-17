# Companion Skills — 출처·라이선스 고지

CommitGate가 번들하는 companion skills(`skills/commitgate-*/SKILL.md`)는 Matt Pocock의 공개 skills를
**적응(adapt)** 한 파생물이다. 원문은 MIT 라이선스다.

## 기준 upstream

| 항목 | 값 |
|---|---|
| 저장소 | https://github.com/mattpocock/skills |
| 기준 commit | `d574778f94cf620fcc8ce741584093bc650a61d3` |
| 기준 릴리스 | `v1.1.0` (2026-07-08) |
| 라이선스 | MIT — `Copyright (c) 2026 Matt Pocock` |

⚠️ **commit SHA가 식별자다.** upstream은 디렉터리 경로를 버전 간 이동시키므로(`in-progress/review` → `engineering/code-review`)
경로를 기준으로 삼지 않는다. tag도 이론상 이동 가능하므로 SHA로 고정한다.

⚠️ upstream은 **npm에 발행되지 않는다**(`"private": true`). 레지스트리 아티팩트가 없으므로 git SHA가 유일한 pin 수단이다.

⚠️ `npx skills` 설치기는 **Matt의 것이 아니다**(npm `skills` = `vercel-labs/skills`). CommitGate는 **어떤 외부 installer도
실행하거나 의존하지 않는다** — 이 번들은 패키지 안에 고정된 사본이다.

## 대응 관계

| CommitGate 스킬 | upstream 원문 |
|---|---|
| `commitgate-discovery` | `skills/productivity/grilling/SKILL.md` + `skills/engineering/domain-modeling/SKILL.md` |
| `commitgate-tdd` | `skills/engineering/tdd/SKILL.md` |
| `commitgate-diagnosing-bugs` | `skills/engineering/diagnosing-bugs/SKILL.md` |
| `commitgate-research` | `skills/engineering/research/SKILL.md` |

각 SKILL.md 하단의 `## 출처·라이선스` 절에 개별 적응 내용이 기록되어 있다.

## 무엇이 누구의 것인가

바탕 **아이디어**는 prior art이며 Pocock의 것이 아니다 — TDD의 red/green(Kent Beck), 유비쿼터스 언어(Eric Evans),
델타 디버깅·최소화(Andreas Zeller), ADR(Michael Nygard). 그 아이디어를 쓰는 것은 라이선스 대상이 아니다.

라이선스 대상은 그의 **특정 표현**이다 — 조어("seams", "tracer bullet", "red-capable", 예광탄), 문구, 단계 구조와 순서.
CommitGate의 스킬은 그 표현과 구조를 알아볼 수 있게 재사용하므로 **파생물로 취급하고 고지를 보존한다.**

## 라이선스 고지가 사는 곳

MIT §2는 고지가 *"all copies or substantial portions of the Software"* 를 따라다닐 것을 요구한다.

→ **각 `SKILL.md`가 저작권 표기와 permission notice 전문을 자체적으로 담는다.** `commitgate init`이 대상 프로젝트에
설치하는 것은 그 SKILL.md들이므로, 고지가 파일과 함께 이동한다.

⚠️ **이 `ATTRIBUTION.md`는 provenance 상세용이며 대상 프로젝트에 설치되지 않는다. 라이선스 준수 수단이 아니다** —
준수는 각 SKILL.md 안의 전문이 담당한다.

CommitGate 자신의 루트 `LICENSE`(MIT, `Copyright (c) 2026 sol5288`)는 이 고지와 별개이며 영향을 받지 않는다.

## upstream LICENSE 원문

`https://raw.githubusercontent.com/mattpocock/skills/d574778f94cf620fcc8ce741584093bc650a61d3/LICENSE`

```
MIT License

Copyright (c) 2026 Matt Pocock

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## 갱신

기준 upstream을 올리려면 새 SHA를 골라 4종 SKILL.md의 `## 출처·라이선스`와 이 문서를 함께 갱신하고,
`tests/unit/package-payload.test.ts`의 `UPSTREAM_SHA`를 바꾼다. **자동 동기화는 없다**(의도된 경계 — REQ-2026-019 §4).
