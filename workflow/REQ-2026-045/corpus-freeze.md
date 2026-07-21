# 코퍼스 Freeze — 재리뷰 장기화 원인분류 (REQ-2026-0XX phase-1 선행 산출물)

> 상태: **pre-ticket 작업 문서**(untracked, 미커밋). REQ 개설 시 `workflow/REQ-.../`로 이동.
> §10-1 무결성 검증 완료 → **분모 32 = 검증됨**(잠정 아님). DEC-1 락 가능 상태.

## 1. 고정값 (분모가 조용히 바뀌지 않도록)

| 항목 | 값 |
|---|---|
| 분석 cutoff (UTC, 실제 클록) | `2026-07-21T08:39:50Z` |
| `workflow/.review-calls.jsonl` SHA-256 | `F985BB949E4F25BD92F20C1704BDA6563E90CD1FBF11330C3B0463EFB6B30537` |
| 로그 행 수 | 120 (REQ-025 ~ REQ-044) |
| Git HEAD | `20ee23f338a810edf0a7975b13442919215df779` |
| 워킹트리(로그 기준) | clean |
| 아카이브 검사 규칙 | **v2** (§4) — 실행 완료 |

## 2. 용어

`finding-content-blinded / cause-label-blinded` (NOT `outcome-blinded`). 라운드 수·outcome·아카이브 존재·finding **개수**는 이미 관측함. 잠그는 것 = "finding **본문**·원인 라벨을 보기 전 분석계획·임계값 고정".

## 3. 판정 규칙

**R-SEG (series 세그먼트 — 관측 가능 프록시):** `.review-calls.jsonl`에는 `review_base`가 **없다**. 로그로 관측 가능한 series 분할 프록시는 **`target + policy_version`**이며, "유효 승인으로 series가 닫힌 뒤 `policy_version` 변경 시 새 series 시작"으로 분할한다. (실제 승인 바인딩은 `review_base_sha`까지 포함하나 로그엔 없음 — 아래에서 아카이브로 별도 검증.)
- 로그상 target 중간 `policy_version` 전환: **REQ-038 design**(r1–3=`30e6d1`, r4=`b683868`)·**REQ-044 design**(r1–6=`30e6d1`, r7–8=`b683868`) **둘뿐**.
- ✅ **아카이브 검증(§4)**: eligible 9개 series 각각 `review_base_sha`가 **전 라운드 불변**(예: 032-design=`65c7556a…`×6, 034-design=`853bfe98…`×5). 즉 policy_version 프록시가 놓칠 숨은 review_base 분할이 eligible 코호트엔 **없음** — 프록시 확인됨.
- 결과: **REQ-038 design** = series-A(r1–3 승인, **3R 비장기**)+series-B(r4, 1R) → 장기 코호트 제외. **REQ-044 design** = series-A(r1–6, 6R 장기)+series-B(r7–8, 2R 비장기).

**R-INV (invalid 격리):** `invalid`(archive_round=null)는 설계상 미아카이브(원인분석 불가)이고 유실 아님. ①~④ 분모 제외, **별도 `operational/invalid transition` 수**로 보존.

## 4. 아카이브 검사 규칙 v2 + 검증 결과

각 eligible target의 유효 라운드마다 `responses/<base>-r<NN>-<outcome>.json`에 대해: 존재 · JSON 파싱 · `status`↔파일명 outcome · `review_kind`↔로그 · SHA-256 기록 · `review_base_sha` 추출 · **승인 라운드는 `approvals.jsonl` `response_sha256` 대조**.

**검증 결과(2026-07-21, HEAD `20ee23f`):**

| 검사 | 결과 |
|---|---|
| 기대 eligible 아카이브 | **41** (9 series 유효 라운드 합) |
| 존재 / 파싱 | 41/41 · 41/41 ✅ |
| `review_kind` 일치 | 41/41 ✅ |
| `status`↔outcome 일치 | **41/41** ✅ (체커에 `COMPLETE` 매핑 보완 후 재실행) |
| 승인 manifest `response_sha256` 일치 | **8/8 ✅ 0 mismatch** (승인 8: 027-d·027-p2·028-d·028-p2·031-d·034-d·040-p1·044-p1) |
| `review_base_sha` series 내 불변 | 9/9 ✅ |

- **status 어휘 드리프트(실측)**: eligible 41개 status 분포 = `NEEDS_FIX 33 / STEP_COMPLETE 7 / COMPLETE 1`. 초기 raw 40/41은 체커 허용목록에 `COMPLETE` 누락된 오탐이었고, 매핑 보완 후 **41/41**(해당 파일 manifest SHA도 일치=진짜 승인). **데이터 무결성 이상 0건.** → 태깅 프로토콜은 **승인 status 문자열 전체를 열거**해야 함(신규 요구).
- **needs-fix(33개)**: 독립 SHA 기록 없음 → self-SHA + 파싱 + status/kind 일치까지(가능한 최대). **승인(8개)만 manifest 이중검증.**

## 5. Freeze 표 (장기 = R-SEG 세그먼트 유효 라운드 ≥4)

| target (REQ / kind / phase) | rounds | appr/nf/inv/blk | 기대arch | 검증arch | 전이 | 상태 | 사유 |
|---|---:|---|---:|---:|---:|---|---|
| 026 / design | 6 | 0/6/0/0 | 6 | **0** | 0 | **excluded** | 실제 유실(`responses/` 부재) |
| 027 / design | 4 | 1/3/0/0 | 4 | 4 | 3 | eligible | — |
| 027 / phase-2-series-record-and-attempt | 4 | 1/3/0/0 | 4 | 4 | 3 | eligible | — |
| 028 / design | 4 | 1/3/0/0 | 4 | 4 | 3 | eligible | — |
| 028 / phase-2-req-next-g3 | 4 | 1/3/2/0 | 4 | 4 | 3 | eligible | inv 2 → §6 |
| 031 / design | 5 | 1/4/0/0 | 5 | 5 | 4 | eligible | — |
| 032 / design | 6 | 0/6/0/0 | 6 | 6 | 5 | **eligible★** | 유일 온전 비수렴(6R 미승인) |
| 034 / design | 5 | 1/4/0/0 | 5 | 5 | 4 | eligible | — |
| 040 / phase-1-inject-lib | 4 | 1/3/0/0 | 4 | 4 | 3 | eligible | — |
| 041 / design | 6 | 0/6/0/0 | 6 | **0** | 0 | **excluded** | 실제 유실(`responses/` 부재) |
| 044 / design (series-A r1–6) | 6 | 1/5/0/0 | 6 | **1** | 0 | **excluded** | 실제 유실(r01–05 소실) |
| 044 / phase-1-skill-asset | 5 | 1/4/1/0 | 5 | 5 | 4 | eligible | inv 1 → §6 |

**비장기 재분류(R-SEG):** REQ-038 design(3+1) · REQ-044 design series-B(r7–8, 2R).

## 6. 집계 (검증 확정)

- 장기 series(R-SEG) = **12**
- **eligible = 9** · **excluded = 3**
- **eligible 재리뷰 전이(원인분석 분모) = 32 (검증됨)** — design 19 (027·028·031·032·034) / phase 13 (027-p2·028-p2·040·044-p1)
- **operational/invalid 전이(별도 지표)** = 로그 전체 5; eligible 내 3 (028-p2×2·044-p1×1)

## 7. 🔴 선택편향 (결과와 상관된 유실 — 분석 한계)

excluded 3은 **모두 design**이며: **026·041 = terminal 6R non-convergence(끝까지 미승인)**, **044 design series-A = 6R eventual approval(6R 후 승인)**. 즉 **두 terminal 비수렴이 모두 아카이브 부재** — "무엇이 terminal design 비수렴을 만드나"(②/③b 최다 예상)를 구조적으로 관측 못 함. design eligible은 명목 8 중 5.
- **REQ-032**(#7) = 유일 온전 6R design 비수렴 → 심층표본 **필수**.
- "eligible에서 ②가 드묾"이 "재론은 문제 아님"을 **증명하지 않음**(§8 결과 3-값의 근거).

## 8. DEC-1 (LOCKED — 검증된 32-전이 분모)

**분모 = 검증된 eligible 전이 32.** 태깅행 = transition당 **단일 `primary_cause`(①/②/③a/③b/④/hold)** + **복수 `secondary_codes`**(복합 finding). 비율은 `primary_cause`로만 계산(분모 오염 방지). 원인 동일성은 §태깅스키마(finding_index 쌍·변경근거·근거문·2인 라벨·제3검토자/hold).

**후속 REQ 우선화 조건**(자동 구현 트리거 아님):

| 지원 | 기준 |
|---|---|
| B: Review Context Ledger | `primary=②` 전이 **≥8/32** AND 서로 다른 target **≥3** |
| Oracle/도구 위임 | `primary=③b` **≥8/32** AND 다른 primary보다 **엄격히 많음** |
| Builder·테스트·phase분할 | `primary∈{①,③a}` 합 **≥17/32** |
| Human disposition(Ledger) | `primary=④` **≥4/32** AND 서로 다른 target **≥2** |
| **결론 불가(inconclusive)** | 원인분류 coverage **<24/32**(hold/증거부족 과다) |

- target 수 조건 = 분모 혼합 통계 아님. **한 티켓 특이사례로 제품기능 만들지 않는 재현성 가드.**
- 복수 조건 동시 충족 → 억지로 하나 고르지 말고 **복수 후속 REQ 후보**로.
- **어느 조건도 미충족 = "기각" 아님** → stateless 유지 · 계측 지속. (🔴 절대 "기각됨" 결론 두지 않음 — absence of evidence ≠ evidence of absence, 특히 §7 편향 하에서.)

## 9. 계측(phase-2) 한정

`assembled_prompt_sha256` 등은 미래 분석의 **"관측 품질 개선"**일 뿐 미래 코퍼스를 **자동 "완전"으로 만들지 않음**(로그 gitignore·측정전용·기록실패 삼킴). 026·041식 유실은 계측이 아니라 **아카이브 보존 정책** 문제.

## 10. 다음

1. ✅ **§10-1 무결성 검증 완료**(§4) → 분모 32 검증됨 · DEC-1 락됨(§8).
2. `req:new` → 이 freeze를 phase-1 산출물로 편입 → 01-design에서 루브릭·태깅스키마·불일치규칙·DEC-1(§8) 재확인·승인 → phase-2 계측 → phase-3 태깅·결정(§8 3-값).
