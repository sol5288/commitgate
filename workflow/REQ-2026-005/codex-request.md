# REQ-2026-005 리뷰 요청

## 리뷰 종류/범위
리뷰 종류는 프롬프트의 **REVIEW_KIND**를 따른다. `--kind design`이면 권위 아티팩트는 설계 문서 00/01/02(구현 diff 없음이 정상), `--kind phase`이면 권위 아티팩트는 staged diff(구현 코드)이다. 각 리뷰는 해당 종류의 권위 아티팩트만 심사한다.

## 배경
REQ-2026-004 R10은 `commit_approved=yes + findings 있음`을 모순(invalid)으로 막았다(안전). 그러나 승인 시 비차단 코멘트를 담을 채널이 없어 "승인+사소한 코멘트"가 exit 1 churn이 될 수 있다. 이를 위해 optional `observations` 채널을 추가한다.

## 설계·구현 결정 요약 (01-design 참조)
- **검증 SSOT 스키마**(`workflow/machine.schema.json`)에 `observations`는 **optional**(root required 아님 → 기존 archive 하위호환). items `{detail, file}`, **severity 없음**(`additionalProperties:false`로 severity 붙은 항목 구조적 거부). version **1.1 유지**.
- **Codex strict output-schema 제약 대응**: OpenAI structured-outputs strict mode는 root `required`가 properties 전체를 요구한다. 그래서 codex 호출 직전에만 원본에서 **strict copy를 runtime 파생**(root required=properties 전체)하여 `--output-schema`로 넘긴다. 원본(검증/archive용)은 불변. 별도 수동 schema 파일 없음(drift 방지).
- **defaulting layer**: 검증(원본, optional) 이후 결측/비배열 `observations`를 `[]`로 정규화 → strict 출력(항상 emit)과 optional 검증(구 archive 결측 허용)의 계약을 내부적으로 일관화. 하류는 항상 배열로 취급.
- `classifyReview`(findings 존재 기반) **불변** — observations는 승인/차단 판정에 영향 없음. `printOutcomeDetails`가 observations를 approved에서도 표출.

## 리뷰 포인트
- Codex strict output-schema와 optional 검증 schema의 분리(+defaulting layer)가 fail-closed·하위호환을 훼손하지 않는가.
- `no + findings=[] + observations`가 여전히 blocked인가(observations가 findings를 대체하지 않음).
- severity 미허용으로 blocking/non-blocking 경계가 유지되는가.
- 승인 시 `commit_approved=yes`, `merge_ready=no`. 결함 없으면 findings 없이 승인(비차단 의견은 observations로).
