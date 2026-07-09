# REQ-2026-009 리뷰 요청

## 리뷰 종류/범위
리뷰 종류는 프롬프트의 **REVIEW_KIND**를 따른다. design=설계문서 00/01/02(구현 diff 없음 정상), phase=staged diff. 각 리뷰는 해당 종류의 권위 아티팩트만 심사.

## 배경
`v0.3.0` publish 전 감사에서, 공개 npm payload 안에 사설 프로젝트(`palm-kiosk` / `palm-kiosk-app`) 참조가 **8곳** 남아 있음이 확인됐다(`0.2.2` tarball과 동일 — 누적 부채). 그중 `scripts/req/lib/config.ts:55`의 `DEFAULTS.handoffPath`는 주석이 아니라 **살아 있는 기본값**이다:

```
handoffPath: '../palm-kiosk/docs/evaluation/project-memory/ai-handoff.md',
```

나머지 7곳은 주석(`bin/init.ts:313`, `review-codex.ts:5,7,20`, `req-commit.ts:5`, `req-doctor.ts:5`, `req-new.ts:5`).

## 변경 요약
- **phase-1**: `DEFAULTS.handoffPath` → `null`. `tests/unit/req-config.test.ts:60`이 palm 경로를 pin하고 있어 Test-First로 교체. init 동작 단언은 불변.
- **phase-2**: 주석 7곳에서 사설 프로젝트명·경로 제거(치환이 아니라 삭제). `review-codex.ts:20`의 `--handoff` 기본값 설명은 **사실도 갱신**(기본 없음=비활성). payload 회귀 가드 테스트 신설.
- **phase-3**: `package.json`/`package-lock.json` → `0.3.1` (분리 커밋).
- 과거 `workflow/REQ-2026-00*` 감사 기록은 **수정하지 않는다**(payload 밖).
- `v0.3.1` tag / `npm publish` / GitHub release / main 반영은 **수행하지 않는다**(각각 별도 통제점).

## 이것은 public default 계약 변경이다
`DEFAULTS`는 export되고 `loadConfig`가 병합에 쓴다. 단순 주석 수정이 아니다. 01-design D2에 시나리오별 영향표를 넣었다. 요지:
- `req.config.json` 부재 + `--handoff` 없음 → 기존에도 `existsSync`가 걸러 `handoff = null`이었으므로 **실질 무변경**.
- 예외: 그 palm 경로가 **실재하는 머신**(사실상 원저자 환경)에서는 handoff 블록이 프롬프트에서 사라진다. 복구법은 `req.config.json` 명시 또는 `--handoff`.
- `DEFAULTS`를 직접 import하는 외부 코드가 있다면 값이 바뀐다(타입은 이미 `string | null`).
- 그래서 patch bump(`0.3.1`)와 함께 낸다.

## 리뷰 포인트
- **영향 분석이 옳은가**: `DEFAULTS.handoffPath` 소비자가 정말 `config.ts:148` 하나뿐인가? `handoffPathAbs` 파생과 `review-codex.ts`의 `existsSync` 게이트를 감안할 때 "실질 무변경" 판단이 맞는가? 놓친 소비 경로(예: `DEFAULTS` 직접 import, 테스트 픽스처)가 있는가?
- **init 동작이 정말 불변인가**: 코어 기본값이 `null`이 되어도 init의 시드(`{packageManager, handoffPath:null}`)·누락키 병합·기존 명시값 보존이 그대로인가? `bin/uninstall.ts`의 "init 시드와 동일" 판정(`keys === 'handoffPath,packageManager' && handoffPath === null`)이 깨지지 않는가?
- **계약 주석 갱신**: `config.ts`의 `⚠️ 현재 하드코딩 값 — 변경 시 behavior-preserving 깨짐`을 새 계약으로 바꾸는 것이 타당하고, 바뀐 문구가 정확한가? AJV 스키마(`type: ['string','null']`)와 confinement 면제는 그대로인가?
- **검증의 정본**(PM 지시): exit 증거가 `npm pack --dry-run --json`의 payload 파일 목록 기준인가? 온디스크 `files` 스캔을 정본으로 착각하지 않았는가(그건 보조 가드)? 금지 문자열에 `palm-kiosk`·`palm-kiosk-app`·`../palm-kiosk`·`project-memory/ai-handoff.md`가 모두 포함되는가? npm 호출이 격리된 `npm_config_cache`를 쓰는가?
- **범위 준수**: payload에 포함되는 파일 + 필요한 테스트만 수정했는가? `workflow/REQ-2026-00*` 과거 기록을 건드리지 않았는가? version bump가 phase-3로 분리됐는가? tag/publish/release/main 반영이 수행되지 않았는가?
- **주석 일반화가 사실과 맞는가**: 사설명을 다른 이름으로 치환하지 않고 삭제했는가? `review-codex.ts:20`처럼 **사실이 바뀐 서술**을 새 동작에 맞게 고쳤는가? 남긴 참조가 이 repo 안에서 해소 가능한가?
- 결함 없으면 findings 없이 승인(비차단 의견은 observations).
