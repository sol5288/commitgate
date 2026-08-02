# REQ-2026-109 요구사항

delivery의 증거 포트 중복 제거 — 정본을 ref로 매개변수화

## 배경

2026-08-02 자체 감사 B트랙 3번째. 감사는 이것을 "우선순위 1 — evidence ports 통합"으로 꼽았다.

### 무엇이 중복인가

`verifyCommittedEvidenceIntegrity`(승인 증거 무결성 정본 검증기)는 포트 3개를 요구한다: `Pick<EvidencePorts, 'headText' | 'headBlobSha256' | 'headArchivePaths'>`(`lib/evidence.ts:991`).

이 3개의 구현이 **두 벌** 있다.

| | 정본 `lib/evidence-ports.ts` | 사본 `bin/delivery.ts:331` `refEvidencePorts` |
|---|---|---|
| 대상 ref | `HEAD` 고정 | 임의 ref(`featureRef`) |
| blob 읽기 | `execFileSync`(encoding 미지정) → **Buffer 그대로** 해싱 | `safeSpawnSyncStatus`가 **utf8로 디코딩한 문자열**을 `Buffer.from(…,'utf8')`로 되돌려 해싱 |
| 아카이브 목록 | `ls-tree -r **-z** --name-only` → `\0` 분리 | `ls-tree -r --name-only`(**`-z` 없음**) → `\n` 분리 |

정본은 두 함정을 **주석으로 명시해 두었다**("바이트 그대로 읽어야 한다", "`--name-only` 기본 출력은 특수문자를 인용해 경로가 변형된다"). **사본은 그 둘을 그대로 밟았다.**

### 이것이 게이트 경로다

`refEvidencePorts`는 `bin/delivery.ts:410`에서 `verifyCommittedEvidenceIntegrity`에 주입되고, 그 결과는 `:304-305`에서 **`승인 증거 무결성 검증 실패`로 delivery integrate를 차단**한다. 즉 두 구현의 차이가 곧 게이트 판정의 차이다 — 감사가 X-1·X-5로 분류한 "게이트 A는 막는데 B는 통과가 구조적으로 가능한" 형태다.

### 도달 가능성 — 정직하게

착수 전에 실측했다. 두 divergence의 성격이 다르다.

| divergence | 도달 가능성 | 근거 |
|---|---|---|
| **`-z` 부재(경로 인용)** | 🔴 **도달 가능 — 조건 2개** | 아래 실측 참조 |
| **utf8 디코딩(바이트 손실)** | ⚪ 현재 도달 불가 | 응답 아카이브는 도구가 UTF-8 JSON으로 쓰므로 디코딩→재인코딩이 무손실이다. 비-UTF8 바이트가 추적 증거 파일에 들어갈 경로가 지금은 없다 |

### `-z` 축의 실측(설계 r01 P1으로 정정)

초안은 "공백이나 한글이 든 `ticketRoot`면 인용된다"고 적었다. **절반이 틀렸다.** 임시 저장소로 직접 확인했다:

| 입력 | `core.quotePath=true`(git 기본) | `core.quotePath=false` |
|---|---|---|
| `res dir/a.json`(공백) | `res dir/a.json` — **인용 안 됨** | 인용 안 됨 |
| `폴더/b.json`(비ASCII) | 큰따옴표로 감싼 **8진 이스케이프 형태**로 변형됨 — **인용됨** | `폴더/b.json` |

즉 도달 조건은 **① 비ASCII(또는 제어문자·`"`·`\`)가 든 경로 + ② `core.quotePath`가 참(git 기본값)** 둘 다다. 공백은 재현 입력이 아니다.

(참고: 이 개발 머신은 `core.quotepath=false`로 전역 설정돼 있어 첫 관측에서 인용이 보이지 않았다. **기본값이 아닌 로컬 설정이 결함을 가릴 수 있다** — 재현 테스트는 저장소 설정을 명시적으로 세워야 한다.)

아카이브 **파일명**은 phase id가 `[A-Za-z0-9][A-Za-z0-9-]*`로 제약돼 안전하지만, **디렉터리 축인 `ticketRoot`는 스키마상 `string, minLength: 1`뿐 — 문자집합 제약이 없다**(`workflow/req.config.schema.json:5-8`). 한글 `ticketRoot`를 쓰는 소비자는 git 기본 설정에서 delivery integrate가 **거짓 차단**된다.

**따라서 이 REQ를 "버그 2건 수정"이라고 말하지 않는다.** 하나는 실재하는 거짓 차단 경로이고, 하나는 현재 도달 불가다. **이 REQ의 값어치는 게이트 술어의 사본을 없애는 것**이고, 위 divergence 두 건은 "사본은 갈라진다"는 것의 증거다.

## 요구

1. **정본 `createEvidencePorts`를 ref로 매개변수화한다**(기본 `HEAD` — 기존 호출부 무변경).
2. **`refEvidencePorts`를 제거하고** delivery가 정본을 쓴다.
3. **`-z` 부재 결함의 재현 테스트를 남긴다** — **비ASCII가 든 `responsesDirRel`** 에서, 저장소에 **`core.quotePath=true`를 명시적으로 설정**한 뒤, 옛 방식(`\n` 분리)은 **인용된 경로**를 내고 정본은 원래 경로를 낸다는 것을 실제 git 저장소로 보인다. 재현 없이 "고쳤다"고 하지 않는다.
   - 🔴 **공백은 재현 입력이 아니다**(위 실측). 설정을 명시하는 이유도 위와 같다 — 로컬 `quotepath=false`가 결함을 가린다.

## 비요구

- **`safeSpawnSyncStatus`의 utf8 디코딩 자체 수정**: 그 함수는 다른 곳에서도 쓰이고 문자열 반환이 계약이다. 이 REQ는 **증거 포트가 그것을 쓰지 않게** 할 뿐이다.
- **`ticketRoot` 문자집합 제약 추가**: 스키마를 좁히면 기존 소비자를 깰 수 있다. 별도 판단.
- **X-6 진단 공백·doctor 병합**: 각각 별도 REQ.

## 완료 기준

- `bin/delivery.ts`에 증거 포트 구현이 **없다**(정본 호출만).
- 재현 테스트: 비ASCII 디렉터리 + `core.quotePath=true`에서 옛 방식은 인용된 경로를, 정본은 원래 경로를 낸다.
- 기존 호출부(`HEAD` 사용) 판정 불변 — 전체 스위트 그린.
