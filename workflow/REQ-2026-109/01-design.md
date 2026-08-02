# REQ-2026-109 설계

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

| # | 위치 | 현재 |
|---|---|---|
| 1 | `lib/evidence-ports.ts:26` `createEvidencePorts(root, responsesDirRel)` | 정본. **`HEAD` 하드코딩**(`git show HEAD:…`·`cat-file blob HEAD:…`·`ls-tree … HEAD`) |
| 2 | `bin/delivery.ts:331` `refEvidencePorts(ctx, ref)` | 사본. 임의 ref는 되지만 blob을 utf8 문자열로 받아 재인코딩하고, `ls-tree`에 `-z`가 없다 |
| 3 | `bin/delivery.ts:410` | 사본을 `verifyCommittedEvidenceIntegrity`에 주입 → `:304` 차단 사유 |
| 4 | `lib/evidence.ts:991` | 검증기가 요구하는 포트는 `headText`·`headBlobSha256`·`headArchivePaths` **3개뿐** |

## 핵심 설계 결정

### DEC-1 정본에 `ref` 파라미터를 **뒤에** 추가한다(기본 `'HEAD'`)

```ts
export function createEvidencePorts(root: string, responsesDirRel: string, ref = 'HEAD'): EvidencePorts
```

- 세 번째 위치·기본값이라 **기존 호출부는 한 곳도 바뀌지 않는다**(무회귀의 근거).
- `head*` 포트 이름은 유지한다. `ref`가 기본 `HEAD`이므로 이름이 여전히 정확하고, **이름을 바꾸면 8개 호출부와 `EvidencePorts` 인터페이스가 함께 흔들린다** — 이 REQ가 사는 값어치보다 크다. JSDoc에 "`ref`가 주어지면 그 ref 기준"이라고 적는다.

### DEC-2 `refEvidencePorts`를 **삭제**한다(얇은 래퍼도 남기지 않는다)

`bin/delivery.ts:410`이 `createEvidencePorts(ctx.root, `${ticketRel}/responses`, featureRef)`를 직접 부른다.

- 래퍼를 남기면 "delivery용 포트"라는 별도 개념이 살아남아 다음 사람이 거기에 또 특수 로직을 붙인다. **사본이 생긴 경로를 닫는 것이 이 REQ의 목적**이다.
- 🔴 정본은 요구되는 3개보다 **많은 포트**를 준다(`readText`/`writeText`/`sha256` 등). 검증기가 `Pick<…, 3개>`를 받으므로 여분은 무해하다. 굳이 좁히지 않는다 — 좁히려면 또 다른 래퍼가 필요하다.

### DEC-3 재현 테스트가 이 REQ의 **오라클**이다 — 입력은 **비ASCII + `core.quotePath=true`**

"정본을 쓰게 했다"는 것만으로는 무엇이 달라졌는지 증명되지 않는다. 실제 git 저장소로 보인다.

🔴 **설계 r01 P1으로 입력을 정정했다.** 초안은 공백이 든 경로를 쓰려 했으나 **공백은 git의 C-style 인용 대상이 아니다.** 임시 저장소로 실측한 결과:

- `res dir/a.json`(공백) → `core.quotePath` 값과 무관하게 **인용되지 않는다**
- `폴더/b.json`(비ASCII) → `core.quotePath=true`(**git 기본값**)에서 큰따옴표+8진 이스케이프로 **인용된다**

따라서 재현 입력은 **비ASCII 디렉터리**이고, 테스트 저장소에 **`core.quotePath=true`를 명시적으로 설정**한다.

⚠️ **설정을 명시하는 것이 핵심이다.** 이 개발 머신은 전역 `core.quotepath=false`라 처음 관측에서 인용이 보이지 않았다 — **기본값이 아닌 로컬 설정이 결함을 가린다.** 테스트가 전역 설정에 의존하면 어떤 머신에서는 통과하고 어떤 머신에서는 무의미해진다.

검증 항목:

1. 옛 방식(`ls-tree -r --name-only` + `
` 분리)을 **테스트 안에서 직접 실행** → 결과가 **인용된 형태**임을 단언(거짓 차단의 원인). 삭제된 함수를 import할 수 없으므로 방식을 재현한다 — 그래야 "그 방식이 왜 안 되는지"가 저장소 기록으로 남는다.
2. 정본 `headArchivePaths` → **원래 경로**를 낸다.
3. `ref` 인자로 비-HEAD 커밋을 지목하면 그 시점 내용을 읽는다(DEC-1이 실제로 작동).

### DEC-4 utf8 축은 **함께 고쳐지되 주장하지 않는다**

정본을 쓰면 blob 해싱이 Buffer 기반이 되어 그 divergence도 사라진다. 그러나 **현재 도달 불가**이므로(응답은 도구가 UTF-8 JSON으로 쓴다) 재현 테스트를 만들지 않고, CHANGELOG에서도 "버그 수정"으로 말하지 않는다. **재현할 수 없는 것을 고쳤다고 말하지 않는다.**

## Phase별 구현

| phase | 내용 | 파일 |
|---|---|---|
| `phase-1-ports-dedup` | DEC-1~4 + 재현 테스트 + CHANGELOG | 4 |

## 변경 파일

- `scripts/req/lib/evidence-ports.ts`(ref 파라미터) · `bin/delivery.ts`(사본 삭제·정본 호출) · `tests/unit/evidence-ports-ref.test.ts`(신규 재현) · `CHANGELOG.md`

## 하위호환·안전

| 축 | 영향 |
|---|---|
| 기존 `createEvidencePorts` 호출부 | **불변**(ref 기본값 `'HEAD'`) |
| delivery integrate 판정 | 인용이 일어나지 않는 경로(현재 대부분)에서 **동일**. 공백·비ASCII `ticketRoot`에서는 **거짓 차단이 사라진다** |
| `EvidencePorts` 인터페이스 | **불변**(포트 이름·시그니처 유지) |
| 소비자 CLI 표면·state·아카이브 | 미접촉 |

**되돌리기**: 단일 커밋 revert.
