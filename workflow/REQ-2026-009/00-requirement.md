# REQ-2026-009 요구사항 — 공개 패키지 payload에서 사설 프로젝트 참조 제거 + `DEFAULTS.handoffPath = null`

## 무엇을
공개 npm 패키지 `commitgate`의 **publish payload**에 남아 있는 사설 프로젝트(`palm-kiosk` / `palm-kiosk-app`) 이름과 경로 참조를 제거한다. 특히 `scripts/req/lib/config.ts`의 `DEFAULTS.handoffPath`가 살아 있는 기본값으로 사설 경로를 가리키는 문제를 고친다.

## 왜
`v0.3.0` publish 전 감사에서 확인된 사실(격리 캐시로 `commitgate@0.2.2` tarball을 받아 대조):

- 배포 payload 안에 `palm` 언급이 **8곳**. `0.2.2`에도 **동일하게 8곳** — 이번 릴리즈의 회귀가 아니라 **누적된 부채**다.
- 그중 [scripts/req/lib/config.ts:55](../../scripts/req/lib/config.ts)의 `DEFAULTS.handoffPath`는 주석이 아니라 **실제로 동작하는 기본값**이다:
  ```
  handoffPath: '../palm-kiosk/docs/evaluation/project-memory/ai-handoff.md',
  ```
- 나머지 7곳은 주석: `bin/init.ts:313`, `scripts/req/review-codex.ts:5,7,20`, `req-commit.ts:5`, `req-doctor.ts:5`, `req-new.ts:5`.

공개 패키지 소스를 읽는 누구나 무관한 사설 프로젝트의 이름과 내부 문서 디렉터리 구조를 알게 된다. 보안·자격증명 영향은 없으나 정보 위생 문제이고, `handoffPath`는 기능적으로도 의미 없는 기본값이다.

## 목표
1. `DEFAULTS.handoffPath` 기본값을 `null`로 바꾼다.
2. init이 생성·병합하는 `req.config.json`의 `handoffPath: null` 정책과 **코어 기본값을 일치**시킨다(현재는 코어가 palm 경로, init이 null을 덮어쓰는 이중 구조).
3. published package payload 안에 사설 프로젝트명·사설 경로가 **0건**이 되게 한다.
4. 과거 REQ 티켓의 역사 기록은 payload가 아니면 **수정하지 않는다.**

## 제약 (PM 지시, 승인 범위)
- 수정 대상은 **`npm pack` 결과에 포함되는 파일**과 그에 필요한 테스트뿐이다.
- `workflow/REQ-2026-00*` 등 과거 감사 기록은 **수정 금지**.
- `package.json` version은 **`0.3.1` patch**로 올린다(공개 패키지 hygiene + 기본값 버그 수정). **phase-3에서 분리 커밋.**
- `v0.3.1` tag, `npm publish`, GitHub release는 **수행하지 않는다.** 각각 `R1`·`R2`·`R3` 별도 통제점.
- main 반영 방식(PR 경유 `I1`/`I2` vs `B1` direct push)은 이 REQ 완료 후 다시 결정한다. **지금은 merge/push 금지.**
- 비목표: `DEFAULTS.packageManager: 'pnpm'`(palm 유래 기본값이지만 사설 참조가 아니고, 바꾸면 동작 변경 범위가 커진다). `DEC-WF-*`·`D-016-*`·`REQ-2026-017` 같은 사설 의사결정 ID 주석(감사에서 `note`로 분류, PM 필수 문자열 목록 밖) — 후속 티켓 여지로 남긴다.

## `DEFAULTS.handoffPath = null` 은 public default 계약 변경이다
단순 주석 수정이 아니다. `DEFAULTS`는 `export`되고 `loadConfig`가 병합에 쓰므로, 이 값 변경은 **`req.config.json`이 없는 모든 소비자**의 해소 결과를 바꾼다. 기존 사용자 영향은 01-design에서 경로별로 분석한다.

또한 [config.ts:51](../../scripts/req/lib/config.ts)에는 `⚠️ 현재 하드코딩 값 — 변경 시 behavior-preserving(수용기준 #1) 깨짐`이라는 **명시적 계약 주석**이 있고, [tests/unit/req-config.test.ts:60](../../tests/unit/req-config.test.ts)이 그 값을 **고정(pin)** 하고 있다. 두 계약을 의도적으로 갱신하는 것이 이 티켓의 일부다.

## 필수 검증 (PM 지시)
1. **최종 exit 증거는 `npm pack --dry-run --json` 결과의 실제 payload 파일 목록 기준이어야 한다.** 온디스크 `files` 스캔으로 대체하지 않는다.
2. payload 검사 대상 문자열은 최소 `palm-kiosk`, `palm-kiosk-app`, `../palm-kiosk`, `project-memory/ai-handoff.md`를 포함한다.
3. `DEFAULTS.handoffPath === null` 테스트를 갱신·추가한다.
4. init이 계속 `handoffPath: null`을 생성·병합하는지 확인한다.
5. `npm run typecheck`
6. `npm test`
7. `npm run smoke`
8. `npm run req:doctor -- 2026-009`

## 완료 기준
- `npm pack --dry-run --json`이 나열한 payload 파일 전체에서 위 4개 문자열 검색 결과 **0건**.
- `DEFAULTS.handoffPath === null`, `loadConfig()`가 config 부재 시 `handoffPath: null` / `handoffPathAbs: null` 반환.
- init의 시드·병합 동작(`handoffPath: null` 생성, 기존 명시값 보존) 불변 — 테스트로 확인.
- `--handoff <path>` CLI와 `req.config.json`의 명시 `handoffPath`는 계속 동작.
- typecheck 0 · vitest 그린 · smoke 그린 · `req:doctor` PASS · Codex design/phase 승인.
- version `0.3.1` (phase-3, 분리 커밋). tag·publish·release 미수행.
