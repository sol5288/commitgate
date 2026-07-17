# REQ-2026-021 설계 — Companion Skills: gitignore 경고·uninstall 계획

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.
> 실측은 `feat/req-2026-020-companion-skills-bundle@a4fbcb9` 기준.

## 현재 상태(변경 대상)

| 사실 | 실측 근거 |
|---|---|
| companion 4종은 이미 설치된다 | `bin/init.ts` `KIT_COMPANION_SKILLS` → `planCompanionSkills()` (REQ-020 `6e63106e`) |
| 계획은 3분류를 이미 낸다 | `CompanionSkillsPlan { create, ownedSkips, userDiffers }` — **판정 재료가 이미 있다** |
| 🔴 `userDiffers`는 artifacts에 **없다** | `planInstall`이 `userDiffers`를 `skips`로 넣고, `planArtifactPaths`는 `copies + ownedSkips + extras`만 모은다 |
| gitignore 검사는 artifacts만 본다 | `findIgnoredArtifacts(targetRoot, artifacts)` — ignored∧untracked 반환 |
| 계약 포인터 경고 축이 따로 있다 | `CONTRACT_POINTER_RELPATHS` → WARN, `--strict`면 throw |
| `workflow/.gitignore`가 선례다 | `workflowGitignorePolicyAtRisk = (created \|\| ownedSkip \|\| userDiffers) && gitIsIgnored && !gitIsTracked` |
| companion은 계약 포인터 목록에 **없다** | REQ-020 D6 — 의미가 다르므로 별도 목록(`KIT_COMPANION_SKILLS`) |
| uninstall `toolEntries` shape | `{ destRel, srcRel }[]` — `KIT_COMPANION_SKILLS`가 **정확히 그 shape**(`{src, dest}`) |
| uninstall은 읽기 전용 | `node:fs` 조회 API만, `--apply` 없음. `child_process` 미import 구조 테스트 존재 |
| `differs`의 의미 | `ToolArtifact.match` 주석 — *"편집됐거나 **다른 버전**이 설치함일 뿐 사용자 소유 단정이 아니다"* |
| origin 판별 불가 정책 | `AmbiguousArtifact` — *"origin 판별 불가 → **항상 자동 제거 대상에서 제외**"* |

## 핵심 설계 결정

### D1 — companion ignore 위험 판정은 `artifacts`가 아니라 **계획 3분류 전체**를 본다

```
companionPolicyAtRisk = KIT_COMPANION_SKILLS 중
  (create ∪ ownedSkips ∪ userDiffers) ∧ gitIsIgnored(dest) ∧ !gitIsTracked(dest)
```

🔴 **`planArtifactPaths`에 기대면 안 된다.** `userDiffers`는 `skips`로 가서 artifacts에 **없다** →
`findIgnoredArtifacts`가 그 파일을 보지 못한다. 그러면 나머지가 전부 추적된 상태에서 사용자가
`commitgate-tdd/SKILL.md`만 고쳤을 때 **경고 없이 `--strict`가 통과**한다. 팀원 clone엔 그 스킬이 없는데도 R1/R2가 우회된다.

`workflow/.gitignore`가 이미 같은 축을 해결했다 — 소유(created/ownedSkip)든 사용자 파일(userDiffers)이든,
**팀에 전달되지 못하면 안전한 설치 안내를 낼 수 없다**. companion도 동일하게 판정한다.

`CompanionSkillsPlan`이 이미 3분류를 내므로 **새 판정 로직이 아니라 기존 계획의 소비**다.

### D2 — 경고는 companion 자산에 **대해서만** 추가된다 (R5)

- `CONTRACT_POINTER_RELPATHS`에 **넣지 않는다**(REQ-020 D6 유지). 그 상수는 "계약 포인터"를 뜻하고,
  companion은 없어도 핵심 워크플로가 동일하게 동작한다. **의미를 흐리지 않는다.**
- 기존 계약 포인터·`workflow/.gitignore`의 WARN·`--strict` 경로는 **손대지 않는다**. companion 경고는 **추가만** 된다.
- `--no-agent-entrypoints`면 companion이 애초에 설치되지 않으므로 **companion 경고도 없다**(계획이 비어 있다).

### D3 — `--strict`는 preflight에서 throw (R2)

기존 strict 축과 동일하게 **쓰기 전에** 막는다. `bin/`에 rollback이 0줄이므로 Apply 후 실패는 되돌릴 수 없다.
companion 판정은 이미 preflight(`planCompanionSkills`)에서 나오므로, gitignore 검사도 **Apply 전에** 수행한다.

### D4 — 경고 문구는 **동작하는 조치**를 준다

`.claude/`가 ignore되어 companion skills가 팀원 clone에 전달되지 않는다고 알리고, 추적 방법을 제시한다
(`git add -f <경로>` 또는 ignore 규칙 조정). 기존 gitignore 경고 문구 관례를 따른다 —
"동작하는 패턴을 제시해야 한다"(`bin/init.ts` 주석).

### D5 — uninstall `toolEntries`에 4종 추가 (R4)

```ts
...KIT_COMPANION_SKILLS.map((e) => ({ destRel: e.dest, srcRel: e.src })),
```

`KIT_AGENT_ENTRYPOINTS`와 동일한 한 줄이다 — `KIT_COMPANION_SKILLS`가 이미 `{src, dest}` shape다.

**읽기 전용 유지.** `bin/uninstall.ts`는 `node:fs` 조회 API만 쓰고 `--apply`가 없다. 이 REQ도 그 성질을 바꾸지 않는다 —
`child_process` 미import 구조 테스트가 계속 그린이어야 한다.

⚠️ **정직성(R6)**: `differs`는 **"수정됨 또는 다른 버전이 깐 것"**이고, origin 판별 불가 파일은
byte-identical이어도 자동 제거 대상에서 빠질 수 있다(`AmbiguousArtifact` 정책).
**"byte-identical이면 정리 후보"라고 단정하지 않는다.** companion도 기존 분류 규칙을 그대로 탄다 — 새 예외를 만들지 않는다.

### D6 — 강제력의 정직한 수준

경고는 **안내**이지 강제가 아니다. `--strict`만 fail-closed다. 사용자가 `.claude/`를 ignore한 채 경고를 무시하면
companion skills는 그 사람 머신에만 남는다 — CommitGate는 그걸 막지 않는다(막을 수단이 없다).
**절대 표현을 쓰지 않는다.**

## Phase별 구현

**작게 유지한다**(REQ-020의 리뷰 과밀 회피):

1. `phase-1-companion-ignore-warn` — D1·D2·D3·D4 (`bin/init.ts` + `tests/unit/init.test.ts`)
2. `phase-1b-create-isolation-oracle` — D7 (`tests/unit/init.test.ts` 1파일, 구현 무변경)
3. `phase-2-companion-uninstall` — D5 (`bin/uninstall.ts` + `tests/unit/uninstall.test.ts`)

### D7 — 3개 계획 상태를 **각각** 격리해 증명한다 (phase-1b 보정)

`create`·`ownedSkip`·`userDiffers`는 판정식의 **독립된 항**이다. 하나만 증명하면 나머지 항의 누락을 못 잡는다.

🔴 **격리 없는 strict 테스트는 공허하다.** `.claude/`를 ignore하면 **기존 계약 포인터**
(`KIT_AGENT_ENTRYPOINTS`의 `.claude/` 2종)가 먼저 strict 오류를 내므로,
`companionAtRisk`에서 그 항을 빼도 `--strict`가 여전히 throw해 테스트가 초록이다.

→ **각 상태 fixture는** ① 나머지 companion과 `.claude` 포인터를 **강제 추적**해 at-risk 원인에서 빼고,
② **thrown error·WARN이 대상 경로를 포함**하는지 단언하고, ③ 그 항을 판정식에서 뺀 **변이에서 실패**해야 한다.

phase-1이 `ownedSkip`·`userDiffers`를 격리했으나 **`create`의 strict만 비대칭으로 빠졌다** → phase-1b가 메운다.

세부는 [02-plan.md](02-plan.md).

## 변경 파일

| phase | 파일 |
|---|---|
| 1 | `bin/init.ts` · `tests/unit/init.test.ts` |
| 1b | `tests/unit/init.test.ts` (create 격리 oracle — 1파일, 구현 무변경) |
| 2 | `bin/uninstall.ts` · `tests/unit/uninstall.test.ts` |

## 하위호환·안전

- **기존 경고 축 무변경**(R5) — companion 경고는 별도 판정으로 **추가만** 된다. 기존 계약 포인터·`workflow/.gitignore`
  WARN·`--strict` 회귀가 그대로 그린이어야 한다.
- **companion 설치 동작 무변경** — seed-once·D4-1 confinement·D4-3 leaf lstat(REQ-020)을 건드리지 않는다.
- **uninstall 읽기 전용 무변경** — 계획 항목만 늘어난다. 대상 tree 전후 snapshot 동일.
- **트랜잭션성 미약속** — preflight에서 막고 Apply엔 rollback이 없다.
- **`--no-agent-entrypoints` 무변경** — companion 미설치 → 경고 없음.
