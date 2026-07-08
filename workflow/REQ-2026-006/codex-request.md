# REQ-2026-006 리뷰 요청

## 리뷰 종류/범위
리뷰 종류는 프롬프트의 **REVIEW_KIND**를 따른다. design=설계문서 00/01/02(구현 diff 없음 정상), phase=staged diff(구현 코드). 각 리뷰는 해당 종류의 권위 아티팩트만 심사.

## 배경 (R9)
Codex 리뷰 어댑터는 exec(1라운드)에만 `--sandbox read-only`를 붙이고 resume에는 안 붙였다. spike 결과 resume은 `-s/--sandbox` 플래그를 거부하지만 `-c sandbox_mode="read-only"` config override는 수용·강제한다. 행동 검증에서 resume(무 `-c`)은 실제 파일 write에 성공(갭 실재), resume(`-c sandbox_mode=read-only`)은 write가 sandbox에 차단됨(enforced) 확인.

## 변경 요약
- resume args에만 `-c sandbox_mode="read-only"` 추가(리뷰어 권한 축소=안전 강화). exec 경로 불변.
- "resume에 sandbox 없음" 고정 테스트를 "resume에 `-c sandbox_mode=read-only` 있음"으로 교체.

## 리뷰 포인트
- resume에만 read-only를 강제하고 exec은 불변인가(권한 축소만, 승인/바인딩 로직 불변).
- `-c`가 향후 CLI에서 거부되면 resume 실패=fail-closed로 안전한가.
- 테스트가 새 동작(resume에 `-c sandbox_mode=read-only`)을 정확히 고정하는가.
- 결함 없으면 findings 없이 승인(비차단 의견은 observations).
