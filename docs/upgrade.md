# 업그레이드 (0.x)

런타임을 새 버전으로 올릴 때 **두 가지**를 챙겨야 합니다. `npm update`만으로는 부족합니다.

**① 캐럿 범위가 0.x minor를 막습니다.** `npm install -D commitgate`는 `^0.y.z` 범위를 씁니다. npm semver에서
`^0.7.0`은 `>=0.7.0 <0.8.0`을 뜻하므로 `npm update`/`pnpm update`는 **0.x minor를 넘지 않습니다**(0.7.x 안에 머뭅니다).
minor를 넘으려면 범위를 명시적으로 올려야 합니다:

```sh
npm install -D commitgate@latest     # 또는 특정 버전: commitgate@^0.8.0
```

**② vendored 자산은 런타임과 별개로 갱신됩니다.** 런타임(`node_modules/commitgate`)은 위 명령이 갱신하지만,
프로젝트 `workflow/`에 깔린 계약 자산(`machine.schema.json`·`req.config.schema.json`)은 **그대로 남습니다**.
런타임만 올리고 자산을 두면, 새 런타임이 **옛 계약을 읽어** 새 기능(예: design delta 리뷰의 full-review
에스컬레이션)이 조용히 비활성화될 수 있습니다. `commitgate sync`가 이 자산을 설치된 패키지 사본으로 되돌립니다:

```sh
npx commitgate sync                  # 계획만 출력(dry-run — 무엇이 바뀔지 확인)
npx commitgate sync --apply          # 스키마 축 재동기화
npx commitgate sync --apply --persona  # 페르소나도 함께(부재면 복원, 다르면 diff만 보여주고 보존)
npx commitgate sync --apply --persona --persona-apply  # 위 diff 확인 후 페르소나를 shipped 로 교체(.bak 백업)
```

- `sync`는 **스키마 축만** 되돌립니다(계약이라 항상 최신으로). companion skills·`workflow/.gitignore`·
  `package.json`·`req:*`는 건드리지 않습니다.
- **페르소나(`review-persona.md`)는 `--persona`에서만** 다룹니다. 부재면 복원하고, 내용이 다르면
  **적용 전에 실제 내용 diff를 출력한 뒤 기본적으로는 보존**합니다(dry-run 에서도 diff 를 봅니다).
- **리뷰 정책 업데이트를 받으려면** diff 를 확인한 뒤 `--persona-apply` 를 `--persona` 와 **함께** 주십시오.
  교체 전에 `workflow/review-persona.md.bak` 을 남기며(직전 1세대), **백업이나 diff 생성이 실패하면 교체하지
  않습니다**(fail-closed). 0.9.8 이하가 깐 페르소나에는 kit 마커가 없어 "직접 작성분일 수 있음" 경고가
  붙지만, 교체 경로는 동일합니다 — 무엇을 잃는지는 diff 로 확인하고 판단하십시오.
- 페르소나를 계속 직접 관리하려면 `req.config.json`의 `reviewPersonaPath`를 별도 파일로 지정하세요
  (그 경우 `sync`는 완전히 미접촉입니다).
- `req:doctor`의 **D20**이 vendored 스키마가 설치 사본과 어긋나면 **WARN**으로 알려 줍니다(커밋은 막지 않습니다).

**③ 예전(vendored) 설치본이면** 이어서 아래 `migrate`로 Stage B 전환까지 하세요.

**④ Quick Start 블록도 기존 파일엔 자동으로 안 닿습니다(0.9.2+).** 신규 설치는 `CLAUDE.md`/`AGENTS.md` 앞에
온보딩 Quick Start를 넣지만, init은 seed-once라 **이미 있던 파일**엔 반영되지 않습니다. 업그레이드 후 기존
파일에 넣으려면 `commitgate quickstart`로 백필하세요:

```sh
npx commitgate quickstart              # 계획만 출력(dry-run — 무엇이 바뀔지 확인)
npx commitgate quickstart --apply      # 관리 블록만 주입(블록 밖 내용 보존·멱등)
```

- `AGENTS.md`는 CommitGate 계약 마커가 있을 때만 대상입니다. 부재 파일은 건드리지 않습니다.
- `req:doctor`의 **D21**이 기존 파일에 Quick Start 블록이 없으면 **WARN**으로 알려 줍니다(커밋은 막지 않습니다).

> 정리: `commitgate@latest` 설치 → `commitgate sync --apply` → `commitgate quickstart --apply` → (필요 시) `commitgate migrate`.

## 버전별 주의사항

새 버전으로 넘어갈 때 **그 버전에서만** 챙겨야 하는 것을 여기 모읍니다. 지나온 버전의 절은 지우지 않으니,
예전 버전에서 올라온다면 **자기 버전 이후의 절을 순서대로** 읽으세요.

### 0.20/0.21 → 0.22 — caret는 minor를 넘지 않습니다: 명시 설치 + gitignore 백필

**① 자동으로 올라가지 않습니다.** npm semver에서 `^0.20.0`은 `>=0.20.0 <0.21.0`이므로
`npm update`는 0.21/0.22로 넘어가지 않습니다. 범위를 명시적으로 올리세요(lockfile도 이 명령이 함께 갱신합니다 —
`package-lock.json` 변경이 커밋에 포함됐는지 확인하세요):

```sh
npm install -D commitgate@^0.22.0
npx commitgate sync --apply --gitignore   # vendored 스키마 재동기화 + workflow/.gitignore 누락 kit 규칙 백필
npx commitgate check                      # 준비 상태 진단(읽기 전용)
npx commitgate report                     # 로컬 관측 요약(읽기 전용) — 정상 동작 확인용
```

**② `sync --apply --gitignore`가 필요한 이유.** 0.21에서 로컬 로그 `workflow/.verify-runs.jsonl`이
새로 생겼습니다(gitignored). 기존 설치본의 `workflow/.gitignore`에는 그 규칙이 없어, 백필하지 않으면
verify-range가 기록을 건너뛰고 경고만 냅니다(동작은 정상 — 관측 로그만 안 쌓입니다).
`--apply` 없는 `sync`는 계획만 출력하는 dry-run이라 파일을 바꾸지 않습니다.

**③ 0.21에서 온 동작 변화(0.20에서 올라올 때 해당).**

- **secretScan 기본 `block`** — 리뷰 전송 전에 고신뢰 비밀 패턴이 staged에 있으면 전송을 막습니다.
  오탐이면 `req.config.json`에 `"secretScan": "warn"` 또는 `"off"`.
- **D31은 WARN 전용** — 민감 경로 패턴 경고는 커밋을 막지 않습니다.
- **GitHub CI는 선택 사항** — CommitGate는 CI를 요구하지도 자동 실행하지도 않습니다. verify-range의
  CI 조회는 opt-in([y/N] 기본 No)이며, 기존 결과를 읽을 뿐 워크플로를 실행하지 않습니다.
  GitHub 인증·네트워크 없이 로컬 검증 경로가 전부 동작합니다.
- **0.22 신설: `commitgate integrate`** — 통합 직전 절차(strict 증거 검증·CI 실행 opt-in·사람 확인·
  로컬 merge·push 없음)를 소유하는 seam입니다. CI **실행**(조회와 별개)은 `req.config.json`의
  `"githubCi": { "workflow": "ci.yml" }` 설정 + 명시 요청(`integrate --run --run-github-ci`)에서만 일어납니다 — 설정이 없으면 제안조차
  하지 않습니다. 새 로컬 로그 `workflow/.integrate-runs.jsonl`(gitignored)이 생기며, 위의
  `sync --apply --gitignore` 백필이 이 규칙도 함께 넣습니다.

**④ 로그 하위호환.** 기존 로컬 로그(`.doctor-runs.jsonl`·`.review-calls.jsonl`)와 커밋된
원장(`review-ledger.jsonl`·`approvals.jsonl`)은 그대로 읽힙니다 — 스키마 변경은 additive이고,
구버전 행은 새 필드 없이도 유효합니다. 새 버전이 기존 로그를 다시 쓰거나 변환하지 않습니다.

**⑤ 소비자 파일을 자동으로 덮어쓰지 않습니다.** `AGENTS.md`·`CLAUDE.md`·`req.config.json`·
`workflow/.gitignore`의 기존 행은 어떤 명령도 임의 수정하지 않습니다 — `sync`/`quickstart`는
opt-in 축과 관리 블록만 다룹니다.

**⑥ 되돌리기.** 문제가 생기면 `npm install -D commitgate@0.20.0`(또는 `@0.21.0`)으로 내리면 됩니다.
vendored 자산은 그대로 둬도 되고(구버전은 모르는 필드를 무시), 새 로컬 로그 파일은 구버전이 읽지
않으므로 지울 필요가 없습니다.

### 0.11 → 0.12 — Node 20 이상이 필요합니다

`engines.node`가 `>=18.17`에서 **`>=20`**으로 올라갔습니다. **Node 18에서는 더 이상 지원되지 않습니다.**

Node 18에서 `commitgate@latest`를 설치하면 이런 경고가 나옵니다.

```text
npm warn EBADENGINE Unsupported engine {
npm warn EBADENGINE   package: 'commitgate@0.12.0',
npm warn EBADENGINE   required: { node: '>=20' },
npm warn EBADENGINE   current: { node: 'v18.20.4', npm: '10.7.0' }
```

**설치가 되는지 안 되는지는 npm 설정에 달려 있습니다.**

| 설정 | 결과 |
|---|---|
| 기본값 | **경고만** — 설치는 됩니다(동작은 보장하지 않습니다) |
| `--engine-strict` (또는 `.npmrc`의 `engine-strict=true`) | 🔴 **설치 실패** — `npm error code EBADENGINE`, 종료 코드 1 |

**선택지는 셋입니다.**

| 선택지 | 결과 | |
|---|---|---|
| **Node 20 이상으로 올린다** | 정상 동작합니다. CI는 Node **20·22·24**에서 매 릴리스 검증합니다 | ✅ **권장** |
| **`commitgate@^0.11`에 머문다** | 0.12 이후 기능을 받지 못합니다. 🔴 그리고 **macOS + Node 18 조합에서 테스트 스위트가 간헐적으로 멈추는 문제가 그대로 남습니다** — 0.11도 그것을 고치지 못했습니다 | 임시책 |
| Node 18에서 0.12를 강행한다(경고 무시) | 🔴 **지원하지 않습니다.** 위 멈춤 현상이 그대로이고, 저희가 검증하지도 않습니다 | ❌ |

> 🔴 **오해하기 쉬운 지점**: 0.11로 내려간다고 멈춤 현상이 해결되지 않습니다.
> 그 문제는 **어느 버전에서도 고쳐지지 않았습니다.** 0.12는 원인을 고친 것이 아니라
> **문제가 나타나던 조건(Node 18)을 지원 대상에서 뺀 것**입니다.
> 근본 원인은 아직 밝혀지지 않았고, Node 18로 돌아가면 현상도 함께 돌아옵니다.

## 예전 설치본에서 옮겨오기 (`migrate`)

`scripts/req/`가 프로젝트에 복사돼 있고 `req:*`가 `tsx scripts/req/*.ts`를 가리킨다면 **예전(vendored) 설치본**입니다. `init`은 이 상태를 감지하면 조용히 섞이지 않도록 **중단하고** 이 명령을 안내합니다.

```sh
npm install -D commitgate      # 아직 devDependency가 아니라면 먼저
npx commitgate migrate         # 계획만 출력 — 아무것도 쓰지 않습니다
npx commitgate migrate --apply # package.json 의 req:* 만 전환
```

`migrate`가 하는 일은 **하나**입니다: `req:*` 중 **현재 값이 정확히 예전 주입값인 키만** `commitgate <verb>`로 바꿉니다.

- **아무것도 삭제하지 않습니다.** `scripts/req/`·스키마·persona·설정·진입점·`workflow/REQ-*` 증거를 전부 그대로 둡니다. 남은 `scripts/req/`는 더 이상 실행되지 않으니, 정리하려면 `npx commitgate uninstall` 계획을 먼저 확인하세요.
- **직접 고친 스크립트는 덮어쓰지 않습니다.** 값이 한 글자라도 다르면 사용자 값으로 보고 보존한 뒤 수동 조치를 안내합니다.
- **커밋하지 않습니다.** `package.json` 한 파일만 쓰고, 검토는 사용자 몫입니다.

`req:doctor`도 설치 모드(예전/현재/혼합)를 진단해 알려 줍니다.
