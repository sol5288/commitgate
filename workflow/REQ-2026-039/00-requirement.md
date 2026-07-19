# REQ-2026-039 요구사항

온보딩 Quick Start: always-loaded 템플릿 자립화

## 무엇을 / 왜

신규 프로젝트에 CommitGate를 설치하면, 그 프로젝트의 AI는 CommitGate의 **존재와 계약 위치**는
안다(항상 로드되는 CLAUDE.md·AGENTS.md가 알려 줌). 그러나 **첫 요청을 받았을 때 무엇을 실행해야
하는지**를 항상 읽는 위치에서 충분히 받지 못한다. 현재 CLAUDE.md/AGENTS.md 앞부분은 "AGENTS.md
본문을 읽어라"는 **이정표**에 가깝고, 실제 시작 절차(`req:new` → `req:next` 반복)는 본문 한 홉
건너에 있다. 결과적으로 AI가 계약은 알아도 **첫 조작에서 멈추거나 사람에게 되묻는다.**

실측 근거(hermes, `D:\2_study\1_hermes`): 자산이 100% 정상 설치되고 CLAUDE.md도 CommitGate가
생성했는데도(바닥 채널이 비어 있지 않았다) REQ가 한 건도 착수되지 않았다. 전달 실패가 아니라,
**항상 읽히는 위치의 안내가 조작 가능한 형태가 아니라 이정표**라는 것이 문제였다.

스킬은 **모델 판단으로 로드되는 조건부 채널**이라 "반드시 알아야 하는 최소 절차"의 유일
전달수단이 될 수 없다. 따라서 항상 읽히는 위치(CLAUDE.md·AGENTS.md 앞부분)에 **자립형 Quick
Start**를 두어, 첫 요청에서 올바른 첫 행동을 확실히 고르게 한다.

## 완료 기준 (검증 가능)

- **핵심**: 새 AI가 **첫 기능 요청**에서, 본문을 더 읽지 않고 Quick Start만으로 올바른 첫
  행동(요구 4칸 확인 → `req:new` → `req:next` 루프)을 선택할 수 있다. (목표는 "명령을 많이
  적기"가 아니라 "첫 행동을 확실히 고르게 하기".)
- `templates/CLAUDE.template.md`와 `AGENTS.template.md` **둘 다** 앞부분에 동일한 Quick Start
  블록을 갖는다(크로스-하네스: Claude Code는 CLAUDE.md, Codex·Cursor는 AGENTS.md가 항상 읽히는
  채널).
- 두 블록이 **바이트 동일**함을 단위 테스트가 강제한다.
- **신규 설치**된 CLAUDE.md/AGENTS.md에 Quick Start가 실제로 존재함을 테스트가 확인한다.

## 제약

- Quick Start는 **명령 + 루프 + hard-don't 최소치**만. 규칙·엣지·통제점은 계속 AGENTS.md 본문에
  둔다(내용 복제 = drift 부채).
- 리터럴 명령(`npm run req:new -- ...`)을 복붙 대상처럼 쓰지 않는다 — 패키지매니저별 실행 형식이
  다르므로, "이 저장소 패키지매니저로 실행, 정확한 형태는 도구 출력이 보여 준다"로 유도한다.
- `git commit` 직접 사용 예외는 **닫힌 열거**로만: CommitGate 자체 스캐폴딩(`init`·`migrate`·
  `sync`가 쓴 파일). 셋 다 파일만 쓰고 커밋은 사용자 몫임을 코드로 확인함
  (migrate.ts:150·152–154, sync.ts:161·166–167). "스캐폴딩이니 직접 커밋" 확대 금지.
- AGENTS.template.md 첫 줄 `<!-- commitgate:contract -->` 마커를 보존한다(진입점이 이 마커로
  계약을 판별).

## 비목표 (→ REQ-040 후속)

- **기존** CLAUDE.md/AGENTS.md가 있는 프로젝트에 Quick Start를 **주입**하는 UX. init은 seed-once라
  기존 파일을 보존(덮지 않음)하므로, 템플릿 수정만으로는 기존-파일 프로젝트에 Quick Start가
  도달하지 않는다. 그 주입 경로(병합 안내 / doctor 경고 / merge 옵션)와 init.ts·doctor 변경은
  **REQ-040**에서 다룬다. 039는 그 경계를 **테스트로 명시만** 한다.
- 스킬 신설·개편(별도 트랙, 심화·상황별 안내용).
- hermes 등 특정 프로젝트의 도구↔활동 fit 판단(별도 트랙).

## 대표 예시 (정상 경로)

신규 프로젝트에 `commitgate init` → 설치분을 일반 커밋(clean tree 확보) → 사용자가 "프로필 수정
API 추가" 요청 → AI가 CLAUDE.md의 Quick Start만 보고 요구 4칸 확인 → `req:new` → 이후 `req:next`가
시키는 대로 진행.

## 예외·실패 경계

- 기존 CLAUDE.md/AGENTS.md가 있던 프로젝트: Quick Start 미도달. 039는 이를 결함이 아니라 **명시된
  경계(→ REQ-040)**로 두고 테스트로 규정한다.
