# REQ-2026-045 phase-3 — 재리뷰 장기화 원인분류 분석 (⚠️ PROVISIONAL — 최종 아님)

> **PROVISIONAL**: 자율 실행의 **단일 태거(tagger-1)** 1차 태깅이다. freeze §8이 요구하는 **2인 독립 태깅 + adjudication**(사람 단계)을 거치지 않았으므로 **최종 결정이 아니다**. REQ 최종 결정 게이트는 사람 2차 태깅 후에만 확정된다(01-design DEC-5 · 02-plan).

## 방법

- **단위**: 재리뷰 전이(transition) = 라운드 N → N+1. 전이를 **round N+1의 findings**로 분류(첫 리뷰 r1은 baseline — 전이 아님). 분모 = **eligible 32 전이**(freeze §6, LOCKED).
- **루브릭**(freeze §5): ① 실제 미해결 · ② 닫힌 finding 재론 · ③a 변경이 만든 새 결함 · ③b 빠진 oracle/명세 갭 · ④ 사람 판단. 전이당 단일 `primary_cause` + `secondary_codes`.
- **태깅 스키마**(freeze §8): 각 전이에 **근거 `finding_idx`(round N+1의 finding 인덱스, 복수면 복수)**를 기록해 재현·독립 태깅·adjudication이 어느 finding에 근거하는지 식별 가능하게 한다. converged 전이(N+1=approved·0 findings)는 `—`.
- **근거**: eligible 9 series의 `responses/` 아카이브 finding 본문(무결성 41/41 검증됨, freeze §4). 소실 코호트(026·041·044-design)는 제외(freeze §7).
- **태거**: 1인(이 에이전트). **hold**: 판정 애매 시 표기. 2차 태거·adjudication은 사람.

## 전이별 태깅 (32)

| series | 전이 | N+1 | primary | (secondary) | 근거 finding_idx | 근거(요약) |
|---|---|---|---|---|---|---|
| 027-design | r1→r2 | nf | ③b | | r2[0],r2[1] | 테스트 oracle 갭(reviewer 주입 이음새·고횟수 무차단 oracle 부재) |
| 027-design | r2→r3 | nf | ③b | | r3[0],r3[1] | 둘 다 ③b — r3[0]=in-flight stamp 순서로 phase-1 커밋 불가(plan 명세 갭)·r3[1]=blocked/invalid attempt-보존 oracle 부재 |
| 027-design | r3→r4 | appr | — converged | | — | |
| 027-phase2 | r1→r2 | nf | ③b | | r2[0] | process.exit가 vitest worker 종료→비승인 경로 oracle 미도달(test-harness 갭) |
| 027-phase2 | r2→r3 | nf | ③b | | r3[0] | 2차 reviewCodexMain이 실제 codex 호출→테스트 금전소모(test-harness 갭) |
| 027-phase2 | r3→r4 | appr | — converged | | — | |
| 028-design | r1→r2 | nf | ① | (③b) | r2[0] | req.config.schema.json 누락 재지적(r1[2] 미완 수정 = 동일 미해결) |
| 028-design | r2→r3 | nf | ③b | | r3[0] | confirmed_at ISO_RE가 달력 무효값 허용(검증 명세 갭, 신규) |
| 028-design | r3→r4 | appr | — converged | | — | |
| 028-phase2 | r1→r2 | nf | ③b | | r2[0],r2[1] | diagnostics '선택지'·hard-blocked option 미검증 oracle 갭 |
| 028-phase2 | r2→r3 | nf | ③b | | r3[0],r3[1],r3[2] | 시도수·outcome·G2 AGENT 경로 미검증 oracle 갭 |
| 028-phase2 | r3→r4 | appr | — converged | | — | |
| 031-design | r1→r2 | nf | ③b | | r2[0] | baseline-미읽음 불변식 검증 oracle 부재 |
| 031-design | r2→r3 | nf | ③b | | r3[0] | hasDesignBaseline 미호출 증명 oracle 부재 |
| 031-design | r3→r4 | nf | ③b | | r4[0] | state 설계가 NEEDS_FIX 중 baseline 상실(설계 명세 갭) |
| 031-design | r4→r5 | appr | — converged | | — | |
| 032-design | r1→r2 | nf | ③b | | r2[0] | policy_version 로그 배선(effective persona) 미고정 oracle 갭 |
| 032-design | r2→r3 | nf | ③b | | r3[0] | 실제 전송 prompt에 base+contract 미검증 oracle 갭 |
| 032-design | r3→r4 | nf | ③b | | r4[0],r4[1] | base-case·degenerate delta 재승인 near-e2e oracle 부재 |
| 032-design | r4→r5 | nf | ③b | | r5[0],r5[1] | 부분변경 문서별 태그·full byte-identity oracle 부재 |
| 032-design | r5→r6 | nf(터미널) | ③b | | r6[0],r6[1],r6[2] | null persona live policy·delta scope·사용자 계약 문서 갭 |
| 034-design | r1→r2 | nf | ③b | | r2[0] | phase 전송 prompt의 실제 base persona 미검증 oracle 갭 |
| 034-design | r2→r3 | nf | ③b | | r3[0],r3[1] | null-persona phase 경로·file grep 약한 oracle 갭 |
| 034-design | r3→r4 | nf | ③b | | r4[0],r4[1] | full+null prompt byte-identity·grep 의미 미고정 oracle 갭 |
| 034-design | r4→r5 | appr | — converged | | — | |
| 040-phase1 | r1→r2 | nf | ③b | (③a) | r2[0] | CommonMark 펜스 토글 char/length 미구별(펜스 내부 삽입) — 명세 미준수 |
| 040-phase1 | r2→r3 | nf | ③b | (③a) | r3[0] | 펜스 info-string backtick 규칙 미구현 — CommonMark 미준수 |
| 040-phase1 | r3→r4 | appr | — converged | | — | |
| 044-phase1 | r1→r2 | nf | ③a | | r2[0] | phase-1 KO 문서가 미배선 설치를 현재형 단정(변경이 만든 doc 불일치) |
| 044-phase1 | r2→r3 | nf | ① | | r3[0],r3[1] | 동일 doc-overclaim이 EN 미러+타 위치에 잔존(미완 수정) |
| 044-phase1 | r3→r4 | nf | ③b | | r4[0] | package-payload가 state.json/responses 경계 독립 미고정 oracle 갭 |
| 044-phase1 | r4→r5 | appr | — converged | | — | |

(028-phase2·044-phase1의 `invalid` 라운드 = operational 전이, 원인 분모 밖 — freeze §6 R-INV.)

**집계 재확인(finding_idx 기준)**: 각 전이의 `primary_cause`는 위 `finding_idx`가 가리키는 round N+1 finding(들)에서 도출했다. 다-finding 전이(예: 028-phase2 r2→r3=r3[0,1,2], 032 r5→r6=r6[0,1,2])는 모든 인덱스가 **동일 버킷(③b)**이라 primary가 명확하다. 인덱스 기반으로 재집계해도 아래 §집계는 **불변**이다(③b=21·①=2·③a=1·②=0·④=0·converged=8).

## 집계 (primary_cause /32)

| 버킷 | 수 | 비율 |
|---|---:|---:|
| **③b oracle/명세 갭** | **21** | 66% |
| ① 실제 미해결 | 2 | 6% |
| ③a 변경이 만든 새 결함 | 1 | 3% |
| **② 닫힌 finding 재론** | **0** | 0% |
| ④ 사람 판단 | 0 | 0% |
| (converged) | 8 | 25% |
| hold | 0 | — |

원인분류 coverage = **32/32**(hold 0).

## DEC-1 임계값 적용 (freeze §8, LOCKED — 태깅 후 기계적 판정)

| 조건 | 기준 | 실측 | 판정 |
|---|---|---|---|
| B: Review Context Ledger | ②≥8/32 & target≥3 | ②=0 | ❌ 미충족 |
| **검증 도구 위임/oracle** | **③b≥8/32 & 최빈** | **③b=21, 최빈(>①2·③a1)** | ✅ **충족** |
| Builder 테스트·phase분할 | ①+③a≥17/32 | ①+③a=3 | ❌ 미충족 |
| ④ Ledger disposition | ④≥4/32 & target≥2 | ④=0 | ❌ 미충족 |
| 결론 불가(inconclusive) | coverage<24/32 | coverage=32 | ❌ 해당 없음 |

## 잠정 결론 (PROVISIONAL)

**잠정 판정(1차 태깅 · DEC-1 기계적 적용) — 확정 아님(§REQ 최종 결정 게이트).** 정직한 결론 문장:

> 완전 아카이브된 32개 전이에 대한 **1차 태깅**에서는 **닫힌 finding 재론(②)이 관측되지 않았고 oracle·명세 갭(③b)이 우세**했다(③b=21/32 · ②=0/32). 그러므로 **현시점에서는 stateless 게이트를 유지**하고, **2인 태깅 확정 시 oracle 개선 REQ를 우선 검토**한다. **resume·Ledger의 게이트 재도입은 (현 트리거 기준) 지원되지 않는다.**

- 🔴 이는 resume이 **어떤 상황에서도 무용하다는 반증**이나 원래 정책의 **완전한 실증이 아니다.** 정확히는 "이 완전 아카이브 표본의 **1차 태깅**에서 재론이 관측되지 않아 **재도입 트리거가 미충족**"이라는 제한적 의미다(단일 태거 · 9 series 상관 표본 · 소실 터미널 2건 제외).
- ③b 형태: 대부분 "near-e2e oracle 부재"·"grep 약함"·"byte-identity 미고정"·"CommonMark 미준수"로, 리뷰어가 매 라운드 **다른** 검증 공백을 지적한다.
- **REQ-032**(eligible · 유일 온전 6R 터미널) = **5/5 ③b** — freeze 가설과 **일치**.

**후속 REQ 후보(2인 태깅 확정 後)**: 설계·계획 단계의 **검증 oracle을 도구/패턴에 위임** — ①near-e2e/main-통합 oracle 표준 패턴(reviewer 주입 seam·attempt-보존·전송 prompt byte-identity), ②CommonMark 등 복잡 명세는 파서 라이브러리 위임(040 펜스형), ③touchpoint별 exact assertion(grep 금지). Ledger·resume 재도입은 **트리거 미충족**(② 미관측) — 확정은 2인 태깅 後.

## 한계 (🔴 선택편향 — freeze §7)

- 소실 3(026·041·044-design) 제외. **026·041 = 터미널 비수렴**(가장 심한 사례)인데 아카이브 부재 → **잠긴 코호트 밖**이라 이 잠정 분석의 분류·집계 근거로 쓸 수 없다. 정직한 편향 진술: "**이 잠정 분석은 eligible 32전이·1차 태깅에만** 근거하며 소실 터미널 2건은 **미관측**"이다 — 편향이 이 잠정 결론을 **강화한다고 단정하지 않는다**(제외 사례를 근거로 재도입하는 셈이므로). *(외부 맥락 가설: REQ-041은 손수 링크-oracle 비수렴이었으나 **코호트 밖**이며 이 잠정 분석의 근거가 아니다.)*
- **민감도**: 040(2)·044 r1→r2를 ③a로 재분류해도 ③b=19·③a=3 — ③b 여전히 최빈·≥8. **결정 불변**(robust).
- 단일 태거 1차 태깅. ③a/③b 경계(040·044)와 ①/③b 경계(028-d r1→r2·044 r2→r3)는 2차 태거 adjudication 대상.

## REQ 최종 결정 게이트 (사람 — 자율 범위 밖)

이 잠정 결론은 **2인 독립 태깅 + adjudication**(또는 hold 기반 3-값 확정) 후에만 최종 확정된다(01-design DEC-5). 자율 실행은 여기까지(1차 태깅 + 잠정 판정)이며, 최종 결정·후속 REQ 개설은 사람 확인을 요한다.
