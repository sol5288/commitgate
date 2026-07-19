# REQ-2026-038 리뷰 요청

## 배경

소비 프로젝트가 commitgate 런타임을 minor 넘어(0.7.0→0.8.1) 업그레이드할 때 두 함정이 있다.
(1) **캐럿 범위**: `^0.7.0`=`>=0.7.0 <0.8.0`이라 `npm/pnpm update`가 0.x minor를 못 넘음. 범위는 소비자
package.json에 있고 PM이 갱신 코드 존재 전에 강제 → 코드로 자가치유 불가, 문서만이 레버. README는 반대로
"update 한 번"·"복사본 안 갈라짐"을 단언(거짓).
(2) **자산 skew**: 런타임이 스키마·persona를 소비 repo의 **vendored 사본**에서만 읽음(config.ts:288 schemaPathAbs,
review-codex.ts:1802/1937/1969). `pnpm update`는 node_modules만 바꿔 vendored는 stale로 남음. `machine_schema_version`이
0.7.0/0.8.1 **둘 다 "1.1"**이라 버전 검사로는 못 잡고, stale 스키마가 `full_review_requested`를 조용히 없애 delta 리뷰
full-review 에스컬레이션(review-codex.ts:1364)이 죽음 → **content-hash로만 감지 가능**. SSOT G-10/STR-06에 이미 미구현 갭으로 등록됨.

이 REQ는 **MVP manifest-free**로 두 함정을 닫는다: `commitgate sync`(스키마 재동기화) + doctor D20(content-hash WARN) + 문서.

## 변경 요약

- **phase-1**: `bin/init.ts`의 confinement 헬퍼 3종 export(동작 무변경) — sync가 재사용.
- **phase-2**: `bin/sync.ts` 신규 verb(동기 runCli·plan/apply·`--dir`·`--persona`). 스키마 축만 `statWritableDest` 경유 재동기화,
  `targetRoot===PACKAGE_ROOT` 하드 가드, persona는 opt-in이며 custom/null 불가침. dispatch 등록.
- **phase-3**: `req:doctor` D20 — shipped(packageRoot) vs vendored(cfg.schemaPathAbs) `machine.schema.json` content-hash 비교,
  상이 시 WARN(절대 FAIL 아님 — req:commit이 doctor를 하드 게이트로 spawn). 회귀망 2개.
- **phase-4**: README(ko/en) 거짓 주장 교정 + 업그레이드 절, CHANGELOG, SSOT.

## 리뷰 포인트

- **confinement 무결성**: sync의 모든 쓰기가 init의 `statWritableDest` 단일 경로를 타는가? 두 번째 구현이 생기지 않았는가(REQ-2026-024 결함 재발 방지)?
- **packageRoot 가드**: `targetRoot===PACKAGE_ROOT` 하드 거부 + `loadConfig({root})` 명시가 resolveRoot→packageRoot fallback(config.ts:207)을 확실히 막는가?
- **persona 보존**: custom 경로·`null`·기본 경로 사용자 편집이 절대 훼손되지 않는가? opt-in 없이 persona가 써지는 경로가 있는가?
- **D20 강도**: WARN이 맞는가(FAIL이면 skew난 소비자 커밋 벽돌)? dogfood(packageRoot===cfg.root)·custom·미설치에서 OK로 빠지는가? content-hash라 037의 req.config.schema.json 변경에 오탐이 없는가?
- **무회귀**: review/commit hot path·machine.schema.json·CONFIG_SCHEMA 무변경 확인. 기존 doctor 검사(D2~D19)·REQ 아카이브 검증 불변?
- **세 축**: KIT_COPY/KIT_SCHEMA/tarball files[] 구분이 유지되고, sync가 seed-once(companion·.gitignore) 자산을 안 건드리는가?
- **범위 적정성**: manifest·persona 3-way·rollback을 STR-06 후속으로 미룬 것이 두 함정을 닫는 데 충분한가?
