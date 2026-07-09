# REQ-2026-009 설계 — payload 사설 참조 제거 + `DEFAULTS.handoffPath = null`

> 정본 결정은 00-requirement의 "목표"·"제약". 본 문서는 그 결정을 현재 코드에 어떻게 반영할지, 그리고 **public default 계약 변경의 영향**을 기록.

## 현재 상태(변경 대상)

payload 내 사설 참조 8곳 (직접 세어 확인, `0.2.2` tarball과 동일):

| # | 위치 | 종류 |
|---|---|---|
| 1 | [config.ts:55](../../scripts/req/lib/config.ts) `DEFAULTS.handoffPath: '../palm-kiosk/docs/evaluation/project-memory/ai-handoff.md'` | **살아 있는 기본값** |
| 2 | [config.ts:51](../../scripts/req/lib/config.ts) `⚠️ 현재 하드코딩 값 — 변경 시 behavior-preserving(수용기준 #1) 깨짐.` | 계약 주석(값 자체엔 palm 없음, #1과 연동) |
| 3 | [bin/init.ts:313](../../bin/init.ts) `코어 DEFAULTS의 palm 고유값(handoffPath)이 …` | 주석 |
| 4–6 | [review-codex.ts:5,7,20](../../scripts/req/review-codex.ts) `SSOT 설계: palm-kiosk/…`, `0차 실측: palm-kiosk-app/…`, `--handoff 기본: ../palm-kiosk/…` | 주석 |
| 7 | [req-commit.ts:5](../../scripts/req/req-commit.ts) `SSOT 설계: ../palm-kiosk/…` | 주석 |
| 8 | [req-doctor.ts:5](../../scripts/req/req-doctor.ts) `SSOT: palm-kiosk/…` | 주석 |
| 9 | [req-new.ts:5](../../scripts/req/req-new.ts) `SSOT: palm-kiosk/…` | 주석 |

테스트(payload 아님, 그러나 pin이 구현을 막음):
- [tests/unit/req-config.test.ts:60](../../tests/unit/req-config.test.ts) — `DEFAULTS.handoffPath`를 palm 경로로 **고정**. 이 pin을 갱신하지 않으면 phase-1이 Red로 남는다.
- [tests/unit/init.test.ts:49,102](../../tests/unit/init.test.ts) — 주석에 "palm 경로 미상속/resurface 차단" 표현.

## 핵심 설계 결정

### D1. `DEFAULTS.handoffPath`의 소비자는 **단 한 곳**이다
전체 코드베이스에서 `DEFAULTS.handoffPath`를 읽는 곳은 [config.ts:148](../../scripts/req/lib/config.ts) 하나뿐이다(grep 확인):
```ts
handoffPath: raw.handoffPath !== undefined ? raw.handoffPath : DEFAULTS.handoffPath,   // null = 명시적 비활성
```
그리고 [config.ts:166](../../scripts/req/lib/config.ts)에서 `handoffPathAbs = merged.handoffPath ? resolve(...) : null`.
따라서 값을 `null`로 바꾸는 것만으로 파생 경로가 전부 `null`이 된다. `raw.handoffPath !== undefined ? … : …` 형태는 **그대로 둔다**(`?? null`로 바꾸면 의미는 같지만 diff가 커지고 "명시 null vs 부재" 의도 주석이 흐려진다).

### D2. 기존 사용자 영향 분석 — **public default 계약 변경**

`DEFAULTS`는 `export`되므로 외부에서 직접 import할 수도 있다. 경로별로:

| 시나리오 | 변경 전 | 변경 후 | 영향 |
|---|---|---|---|
| `req.config.json` 부재 + `--handoff` 없음 | `handoffPathAbs = <root>/../palm-kiosk/docs/evaluation/project-memory/ai-handoff.md` → [review-codex.ts:971](../../scripts/req/review-codex.ts)이 `existsSync`로 걸러 `handoff = null` | `handoffPathAbs = null` → 같은 코드가 `handoff = null` | **없음.** 그 경로가 실재하는 머신이 아니면 결과 동일 |
| 위와 같으나 그 palm 경로가 **실재**하는 머신(사실상 원저자 환경) | 그 파일 내용이 Codex 프롬프트 맨 앞에 handoff 블록으로 삽입됨 | 삽입되지 않음 | **있음.** 프롬프트에서 handoff 블록이 사라진다. 복구법: `req.config.json`에 `handoffPath` 명시 또는 `--handoff <path>` |
| `req.config.json`에 `handoffPath` 명시(문자열) | 그 값 사용 | 동일 | 없음 |
| `req.config.json`에 `handoffPath: null` 명시 | 비활성 | 동일 | 없음 |
| `--handoff <path>` 지정 | opts 우선 | 동일 | 없음 |
| `npx commitgate`로 설치한 사용자 | init이 `handoffPath: null` 시드 → DEFAULTS 미도달 | 동일 | 없음 |
| `DEFAULTS`를 직접 import하는 외부 코드 | palm 문자열 | `null` | **있음.** 타입은 `string | null`로 이미 `null` 허용이라 컴파일은 통과. 이 패키지는 `bin` CLI 용도이고 `DEFAULTS`는 문서화된 공개 API가 아님 |

**결론: 실질 영향은 원저자 환경 한 곳뿐이고, 그마저 `req.config.json`/`--handoff`로 복구 가능하다.** 그럼에도 이는 semver상 **동작 변경**이므로 patch bump(`0.3.1`)와 함께 릴리즈하고, 이 표를 리뷰 근거로 남긴다.

### D3. 코어와 init의 이중 구조를 해소한다
현재는 **코어 DEFAULTS가 palm 경로**이고, **init이 `handoffPath: null`을 시드/병합해 그것을 덮는** 이중 방어 구조다([init.ts:312-325](../../bin/init.ts)). 코어 기본값이 `null`이 되면 init의 시드·병합은 "기본값 방어"가 아니라 **"명시적 비활성을 config에 기록"** 이라는 본래 의미만 남는다.

init의 **동작은 바꾸지 않는다** — `configToWrite = { packageManager, handoffPath: null }`, 누락 시 `patch.handoffPath = null`. 명시 기록은 여전히 유용하고(암묵 < 명시), [uninstall.ts:239](../../bin/uninstall.ts)의 "init 시드와 동일" 판정이 `keys === 'handoffPath,packageManager' && handoffPath === null`에 의존한다. 주석만 갱신한다.

### D4. 주석 일반화 원칙
`palm-kiosk/docs/evaluation/ai-req-workflow-design.md` 같은 **사설 문서 경로**는 지우고, 그 자리에 **이 repo 안에서 해소 가능한 참조**(티켓 문서)나 중립 서술을 넣는다. 사설 프로젝트 이름을 다른 이름으로 치환하지 않는다 — 그냥 없앤다.

`review-codex.ts:20`의 `--handoff` 기본값 설명은 **사실도 바뀐다**(기본값이 null이 됨) → 문구를 새 동작에 맞춘다.

### D5. 검증의 정본은 `npm pack --dry-run --json` 이다 (PM 지시 #1)
- **exit 증거**: `npm pack --dry-run --json`이 반환한 `files[].path` 목록을 정본으로 삼아, 그 파일들만 읽어 금지 문자열을 스캔한다. 온디스크 `files` 배열 해석으로 대체하지 않는다.
- **교차 확인**: 추가로 실제 tarball(`npm pack --pack-destination <tmp>`)을 만들어 추출 후 같은 스캔을 돌려 두 결과가 일치하는지 본다. `npm pack`이 네트워크를 쓰지 않지만, 캐시를 건드릴 수 있으므로 **격리된 `npm_config_cache`**만 사용한다(실제 사용자 캐시 미접촉).
- **금지 문자열(최소)**: `palm-kiosk`, `palm-kiosk-app`, `../palm-kiosk`, `project-memory/ai-handoff.md`. 대소문자 무시.
- **보조 가드**: `tests/unit/package-payload.test.ts` — `package.json`의 `files` 집합을 온디스크로 스캔해 같은 문자열 0건을 단언. **npm에 의존하지 않아 CI 전 플랫폼에서 빠르게 회귀를 잡는다.** 이건 어디까지나 보조이며, exit 판정은 D5의 pack 기반 스캔이 한다.

## Phase별 구현

- **phase-1-core-default**: 기본값 `null` + pin 테스트 갱신 (동작 변경 phase, Test-First)
- **phase-2-comment-scrub**: 주석 7곳 일반화 + payload 회귀 가드 테스트 신설
- **phase-3-version-bump**: `0.3.1` (분리 커밋)

## 변경 파일

phase-1: [scripts/req/lib/config.ts](../../scripts/req/lib/config.ts) · [tests/unit/req-config.test.ts](../../tests/unit/req-config.test.ts) · [tests/unit/init.test.ts](../../tests/unit/init.test.ts)
phase-2: [bin/init.ts](../../bin/init.ts) · [scripts/req/review-codex.ts](../../scripts/req/review-codex.ts) · [scripts/req/req-commit.ts](../../scripts/req/req-commit.ts) · [scripts/req/req-doctor.ts](../../scripts/req/req-doctor.ts) · [scripts/req/req-new.ts](../../scripts/req/req-new.ts) · [tests/unit/package-payload.test.ts](../../tests/unit/package-payload.test.ts)(신규)
phase-3: [package.json](../../package.json) · [package-lock.json](../../package-lock.json)

## 하위호환·안전

- **AJV 스키마 불변**: `handoffPath: { type: ['string','null'] }` — `null`은 이미 유효. 기존 `req.config.json` 전부 계속 통과.
- **confinement 불변**: `handoffPath`는 원래 `assertRelative`/`assertUnderRoot` 면제(읽기 전용 참조). 변경 없음.
- **init 동작 불변**: 시드·병합·기존 명시값 보존. [tests/unit/init.test.ts](../../tests/unit/init.test.ts)의 세 테스트가 그대로 green이어야 한다(수정은 주석뿐).
- **uninstall 판정 불변**: `handoffPath: null` 시드 판정 로직 유지.
- **`--handoff` CLI 불변**: `opts.handoff` 우선순위 그대로.
- **과거 티켓 기록 무수정**: `workflow/REQ-2026-00*`는 payload 밖이며 감사 증거다(PM 지시 #3).
- **버전**: phase-3에서만 `0.3.1`. tag·publish·release 미수행. main 반영 방식은 REQ 완료 후 재결정(PM 지시 #5·#6).
