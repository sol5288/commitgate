# REQ-2026-089 리뷰 요청

## 배경

REQ-2026-086이 phase 검수 면적 판정을 리뷰 직전으로 옮겼는데, 그 판정 결과가 **`console.warn` 한 줄로
휘발**된다. 소비 repo 감사에서 phase 3개가 임계를 넘은 것을 확인했지만 **경고가 실제로 떴는지 로그로
확인할 수 없었고**, 파일 수는 커밋을 사후에 역산해야 했다.

그 결과 "정책이 효과가 있는가"에 답할 수 없다. 실제로 임계값의 타당성이 흔들린 상태다 —
0.11.0 구간은 >8파일 2.39R vs ≤8파일 1.38R이었는데, 0.13.1 구간은 1.00R vs 1.13R로 **상관이 반대**였다.

## 변경 요약

`.review-calls.jsonl`(REQ-2026-045 측정 전용 로그)에 세 값을 추가한다.

```
code_file_count   : number | null
granularity_over  : boolean | null
granularity_limit : number | null
```

판정은 이미 하고 있고 버려질 뿐이라, preflight의 verdict를 보존해 로그까지 흘린다. **판정 로직·임계·게이트
동작은 손대지 않는다.**

## 리뷰 포인트

- **재계산 금지**: preflight가 만든 verdict를 그대로 흘리는가. 로그 시점에 다시 계산하면 그 사이 인덱스가 바뀌었을 때 "그때 무엇으로 판정했는가"를 못 나타낸다.
- **재현 가능성**: `granularity_limit`가 있어야 나중에 임계가 바뀌어도 당시 판정을 재현할 수 있다. `count`만으로는 안 되는 이유가 설계에 맞게 반영됐는가(임계는 `phases[].max_files`로 phase마다 다를 수 있다).
- 🔴 **내용배제 계약**: 행에 파일 **경로·이름**이 들어가지 않는가. REQ-2026-045가 세운 "개수/해시만" 계약을 깨면 이 로그가 측정 로그가 아니라 코드 이력이 된다.
- **null vs 0**: design 리뷰에서 세 값이 `null`인가(`0`이면 "면적 0"과 "측정 대상 아님"이 구별되지 않는다).
- **하위호환**: 신규 필드가 옵셔널이고, 인자 미지정(legacy 호출)·옛 행이 그대로 동작하는가.
- **fail-safe 유지**: 로그 쓰기 실패가 여전히 리뷰 판정·종료 코드를 바꾸지 않는가.

## 🔴 진행 상태 — 이 diff는 phase-2만 담는다

| phase | 상태 | 커밋 | 확인할 파일 |
|---|---|---|---|
| phase-1 log-area | ✅ 커밋됨 | `6bfd13ab` | `scripts/req/review-codex.ts`의 `ReviewCallLogRow` 3필드·`buildReviewCallLogRow`의 `phaseArea` 인자·phase preflight의 `phaseArea` 보존 · `tests/unit/req-review-codex.test.ts` |
| **phase-2 changelog** | **🔎 지금 리뷰 대상** | (이 diff) | `CHANGELOG.md` |

phase-1은 1라운드 승인됐고, 커밋 직후 이 도구 자신의 리뷰 호출이 `{"count":2,"over":false,"limit":8}`로 기록되는 것을 확인했다.
