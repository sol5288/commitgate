# REQ-2026-040 요구사항

기존 파일 Quick Start 백필 — sync 주입 + doctor WARN

## 무엇을 / 왜

REQ-2026-039가 `templates/CLAUDE.template.md`·`AGENTS.template.md` 앞부분에 자립형 Quick Start를
넣었지만, init은 **seed-once**라 기존 `CLAUDE.md`/`AGENTS.md`가 있는 프로젝트에는 **닿지 않는다**
(부재 시에만 생성, `--force`로도 안 덮음). 실제 채택자 상당수는 이미 그 파일을 갖고 있으므로,
온보딩 개선이 **가장 필요한 프로젝트에 도달하지 못한다** — REQ-039가 명시한 비목표(경계)다.

REQ-040은 그 경계를 닫는다: 기존 always-loaded 파일에 Quick Start를 **opt-in·멱등**으로 주입하고,
누락을 **doctor가 WARN**으로 알린다. REQ-2026-038(자산 skew: `sync` + doctor D20)과 같은 패턴이다.

## 완료 기준 (검증 가능)

- 기존 `CLAUDE.md`(quickstart 블록 없음)가 있는 소비 repo에서 **한 opt-in 명령**으로 quickstart 마커
  블록이 주입되고, **블록 밖 유저 내용은 바이트 그대로 보존**된다.
- **멱등**: 재실행 시 이미 최신이면 쓰기 0건(noop). 블록이 shipped와 다르면 in-place 갱신.
- `AGENTS.md`는 **CommitGate 계약(`<!-- commitgate:contract -->` 마커)일 때만** 주입한다. 마커 없는
  AGENTS.md는 CommitGate 계약이 아니므로 건드리지 않는다(기존 `AGENTS.commitgate.md` 병합 경로 소관).
- **부재 파일은 건드리지 않는다**(생성은 init 소관). 백필은 **존재하는** 파일 대상.
- 기본 **plan(dry-run)**, `--apply`에서만 쓴다. 조용히/자동으로 쓰지 않는다.
- `req:doctor`가 기존 파일에 quickstart 블록이 없으면 **WARN**하고 백필 명령을 안내한다.
  **FAIL 아님**(커밋 게이트를 벽돌로 만들지 않음 — D20 선례). dev/dogfood(packageRoot===config root)는 skip.

## 제약

- **seed-once 규율 유지**: 마커 사이 **관리 블록만** 쓴다. 유저의 다른 내용은 불가침. 이것이 이 REQ가
  기존 "유저 파일 미변경" 규율과 만나는 지점이며, 관리-블록 경계로 그 규율을 지킨다.
- **confinement 재구현 금지**: 모든 쓰기는 `statWritableDest`(bin/init.ts) 단일 경로를 탄다(REQ-2026-024
  symlink-escape 결함 재발 방지). `targetRoot===PACKAGE_ROOT` 하드 거부(sync 선례).
- **동기 구현**: launcher가 `runCli`를 await 없이 호출한다(sync/migrate와 동일 — async면 exit code 소실).
- doctor는 **WARN만**. 절대 FAIL 아님.

## 비목표

- **블록 내용 3-way 병합**: 관리 블록은 shipped가 정본이다. 유저가 블록 자체를 고쳤어도 갱신 시 shipped로
  덮는다(커스터마이즈는 블록 **밖**에서). 유저 편집 보존 대상은 블록 밖 내용뿐.
- **신규 설치**: REQ-039가 이미 커버(템플릿에 블록 포함).
- 파일 **생성**: 부재 파일은 init 소관. 백필은 존재 파일만.
- `.cursor/rules`·companion skills 등 다른 진입점: 이 REQ 범위 밖(always-loaded 두 채널만).

## 대표 예시 (정상 경로)

기존 `CLAUDE.md`가 있는 프로젝트(예: hermes) → `commitgate quickstart`(plan 확인) →
`commitgate quickstart --apply` → `CLAUDE.md` 상단에 quickstart 블록 주입(나머지 보존),
`AGENTS.md`는 계약 마커 있으면 함께 주입. 다시 실행하면 noop.

## 예외·실패 경계

- 마커 없는 AGENTS.md: 미접촉(계약 아님).
- symlink/외부 경로 dest: confinement가 거부.
- 파일 부재: 미접촉(백필 대상 아님).
