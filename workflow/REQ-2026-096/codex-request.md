# REQ-2026-096 리뷰 요청 — phase-1-charset-parity

## 배경

소비자 저장소(yammy-sales, commitgate 0.16.0) 버그 리포트. **phase id 가 `_`·`.` 를 포함하면 도구가 쓴
승인 아카이브를 도구 자신이 인식하지 못해, 승인이 나도 커밋할 수 없는 교착**이 났다.
`PHASE_ID_RE`(= `CLI_SAFE_ARG_RE`, `.`·`_` 허용)와 `ARCHIVE_NAME_RE`(불허)의 문자 집합이 어긋났고
`archiveBaseName` 은 phase id 를 무해화 없이 파일명 base 로 쓴다.

설계는 r01 에서 승인됐다(findings 0). 배경·실측·결정의 전문은 `00-requirement.md`·`01-design.md` 에 있다.

## 변경 요약 (이번 staged diff)

| 파일 | 변경 |
|---|---|
| `scripts/req/lib/scratch.ts` | **DEC-1** — `ARCHIVE_BASE_BODY`(모듈 내부 리터럴) 하나에서 `ARCHIVE_BASE_RE`(신규 export)와 `ARCHIVE_NAME_RE` 를 파생. 두 술어가 갈라질 수 없게. |
| `scripts/req/req-next.ts` | **DEC-2** — `PHASE_ID_RE` 를 `CLI_SAFE_ARG_RE` 별칭에서 `ARCHIVE_BASE_RE` 파생으로 전환. **DEC-5** — `phaseModelProblems` 문구에 아카이브 사유·복구 절차 추가. `CLI_SAFE_ARG_RE`·`REQ_ID_RE` 는 무변경(**DEC-3**). |
| `scripts/req/review-codex.ts` | **DEC-4** — `resolvePhaseTarget` 에 문자 집합 가드. `ok:false` → 호출부가 throw → **codex 호출·state 변경·아카이브 쓰기 이전**에 멈춘다. |
| `tests/unit/scratch.test.ts` | **DEC-6** — 왕복 property(전 구간 인식)·포함관계(아카이브 안전 ⊂ CLI 안전)·음성·호출전차단·design/레거시 base 무영향. |
| `tests/unit/req-next.test.ts` | **DEC-6** — 결함을 고정하던 `phase-3b.entrypoint_uninstall` 케이스를 거부 방향으로 정정. 기존 CLI-불안전 케이스의 메시지 단언을 새 문구로 갱신. |
| `docs/ssot-design/00·03·08` | base 문자 집합 명시, scratch 공개 심볼 목록 전수 검증(누락돼 있던 `sourceCommitForbiddenStaged`·`REVIEW_LEDGER_RELNAME` 포함). |
| `CHANGELOG.md` | Unreleased 항목(좁아지는 변경임을 명시, `sync` 불요). |

## 실측 검증

수정 전후를 같은 스크립트로 측정했다(순수 함수 직접 호출):

| phase id | 수정 전 `PHASE_ID_RE` | 수정 후 | 수정 후 호출 전 차단 | 아카이브 인식(전 구간) |
|---|---|---|---|---|
| `phase-1-ok` | true | true | 아니오 | 전부 true (무회귀) |
| `phase_1` | **true** | **false** | **예** | 해당 없음 |
| `phase.1` | **true** | **false** | **예** | 해당 없음 |

`CLI_SAFE_ARG_RE.test('gpt-5.6-terra')` 는 여전히 true(무변경 확인).

게이트: `tsc --noEmit` 0 · `npm test` **2435/2435 통과(49파일)** · `npm run docs:lint` 0.

아카이브 쓰기 지점이 하나뿐임을 확인했다 — `grep -rn "archiveFileName(" scripts/ bin/` 결과가
`review-codex.ts:2860` 단 하나다. 따라서 `resolvePhaseTarget` 가드는 **완전한 병목**이며
`req:rebind`·`req:review-exception`·`close-migrate` 에는 우회 쓰기 경로가 없다(설계 리뷰 포인트 4의 실측 답).

## 리뷰 포인트

1. **DEC-1 의 정규식 조립.** `new RegExp(\`^${ARCHIVE_BASE_BODY}$\`)` 와
   `new RegExp(\`^${ARCHIVE_BASE_BODY}-r\\\\d{2,}-...\`)` 가 기존 리터럴과 **정확히 같은 언어**를 받는가.
   특히 이스케이프(`\\d`)와 앵커가 옳은가. 기존 아카이브를 하나라도 인식하지 못하게 되면 회귀다.

2. **DEC-4 가드의 배치.** 멤버십 검사 **뒤**에 뒀다. 근거는 `phases[]` 에 있는 id 를 `--phase` 로
   지정하는 것이 실제 경로이기 때문이다. 레거시 분기는 `phaseId` 를 non-null 로 확정하지 않으므로
   (그 분기의 모든 반환이 `phaseId:null`) 단일 지점 가드로 전 경로를 덮는다고 판단했다 — 맞는가.

3. **문구(DEC-5)의 정확성.** 두 메시지가 "고아 아카이브를 지우고 다시 리뷰받으라"고 안내한다.
   더 싼 복구(파일명·`state.json`·`02-plan.md` 동시 개명)가 실제로 성립하는지, 성립한다면
   `state.json` 손편집을 권하는 것이 위조 경로를 여는지 판단해달라. 후자면 현 안내가 옳다.

4. **테스트가 tautology 가 아닌가.** `scratch.test.ts` 의 샘플은 테스트 내부 리터럴이고 기대값을
   SUT 상수로 만들지 않았다. 그럼에도 왕복 property 가 실제로 결함을 잡는지 — 즉 `ARCHIVE_BASE_RE`
   를 되돌리면 이 테스트가 실패하는지(변이 검사 관점) 봐달라.

5. **하위호환.** 좁히는 변경이다. "그런 id 로는 애초에 커밋 가능한 승인을 만들 수 없었으므로 무회귀"
   라는 주장에 반례가 있는가.

6. **문서 정확성.** `08-architecture-and-module-spec.md` §2.4 의 공개 심볼 목록을 전수 검증해
   두 개를 추가했다(`sourceCommitForbiddenStaged`·`REVIEW_LEDGER_RELNAME`). 실제 export 와 일치하는가.
