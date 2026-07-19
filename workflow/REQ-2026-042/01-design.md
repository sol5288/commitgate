# REQ-2026-042 설계

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.
> REQ-2026-041 대체: 설계(구조·이동 맵·이중언어·안전 4문구) 재사용, **검증 접근만 도구 위임으로 교체**.

## 현재 상태(변경 대상)

- `README.md`(~620줄, 한국어 정본) + `README.en.md`(완전한 영문 미러). 둘 다 `package.json:files`에 포함(npm payload).
- `docs/`에 개발 문서(RELEASING.md 등) 존재. 사용자용 제품 문서 없음.
- 도구 위임 대상 후보: **`remark-validate-links`**(remark 생태계, 상대 링크·`file#anchor` 유효성 검사 —
  GitHub 호환 slug·Unicode·중복 heading 처리). devDep로 추가.

## 핵심 설계 결정

### D1. README 랜딩 구조 (~100~140줄) — REQ-041 재사용
1. `# CommitGate` + 1줄 설명. 2. 배지(CI·npm·license).
3. **왜 필요한가(핵심 보장)**: ① 리뷰 없인 커밋 불가 · 승인 후 staged 변경 재리뷰 · ④ 애매하면 fail-closed.
4. **⚠️ 주의**: ② staged diff가 외부(Codex/OpenAI)로 전송 · ③ git hook 없음(우회 가능). (전문 `docs/guarantees.md`)
5. **3분 시작**(상세 `docs/quick-start.md`). 6. **작동 방식** 1줄/미니 다이어그램(상세 `docs/workflow.md`).
7. **자주 쓰는 명령** `req:new`·`req:next`·`req:doctor`·`req:commit`. 8. **더 알아보기**(docs 허브). 9. **License**.

### D2. `docs/` 파일 (00 이동 맵) — 한/영 각각
`quick-start` · `agent-prompt` · `workflow` · `guarantees` · `configuration` · `upgrade` · `uninstall` ·
`troubleshooting` · `development` — 각 `.md`(한) + `.en.md`(영). 현 README 상세를 손실 없이 이동.

### D3. 안전 4문구 — 랜딩에 모두, '3분 시작'보다 앞 (REQ-041 계승)
🔴 ①②③④ 네 문구가 **모두** README·README.en 초반에, **각각 '3분 시작' 섹션 heading보다 앞**에 있어야 한다.
①④는 "왜 필요한가"(D1.3), ②③은 "⚠️ 주의"(D1.4) — 두 블록이 랜딩 초반에 함께. → D5 검증이 자동 강제.

### D4. 이중언어 = 완전 이중언어(REQ-041 D4 결정 A 계승)
docs 한/영 미러 + README.md/en.md 랜딩. phase를 한 docs → 한 랜딩 → 영 미러로 나눠 검수 면적 관리.

### D5. 🔴 검증 = 도구 위임 (REQ-041 미수렴 원인 제거)
손수 링크/앵커 oracle을 명세하지 않는다. 대신:
- **(a) 상대 링크·앵커** (docs↔docs · docs→저장소 루트 파일(예: `../AGENTS.md`) · 문서 내부 `#앵커`):
  **`remark-validate-links`(devDep)**로 검사한다. 이 도구가 대상 파일 존재 + fragment(GitHub 호환 slug,
  Unicode·중복 heading 포함)를 정확히 해소한다 — **오라클을 우리가 만들지 않는다**(041의 nitpick 표면 제거).
- **(b) README→docs 절대 URL**: `docs/`가 npm tarball에 없어 README(=npm에 실림)는 docs를 **GitHub 절대 blob
  URL**로 링크한다. remark-validate-links는 이를 external로 보고 검사하지 않으므로, **작은 전용 스크립트/테스트**가
  README·README.en의 각 docs 링크가 **정확히 `https://github.com/sol5288/commitgate/blob/main/docs/<name>.md`**
  형식인지(owner/repo/branch 고정) + 그 `docs/<name>.md`가 **실제 존재**하는지만 확인한다(경계가 좁아 nitpick 없음).
- **(c) 안전 4문구 존재+위치**: 작은 테스트가 README·README.en 각각에서 ①②③④ 문구 존재 + 각 문구 첫 등장 줄이
  '3분 시작' heading 줄보다 **앞**인지 확인.
- (a)(b)(c)를 **phase별 대상에만** 적용(모순 방지): phase-1=docs 한(a만), phase-2=README 한(a·b·c), phase-3=영 전체.

### D6. package-payload 가드 유지
`files[]`에 docs/ 미추가 → payload 축 무변경. 기존 진입점/README 문구 가드 통과 유지.

## Phase별 구현

- **phase-1**: `docs/*.md`(한) 9신설(이동) + `remark-validate-links` devDep·설정. Exit: (a) 링크검사 그린.
- **phase-2**: `README.md`(한) 랜딩 재작성(docs=GitHub 절대 URL) + CHANGELOG. Exit: (a)(b)(c) 그린 · doc 가드.
- **phase-3**: `docs/*.en.md` + `README.en.md` 랜딩. Exit: (a)(b)(c) 영문 그린.
상세는 02-plan.

## 변경 파일

`README.md`·`README.en.md`(재작성) · `docs/*.md`·`docs/*.en.md`(신설) · `package.json`(remark devDep) ·
링크검사 설정/스크립트 · 링크검사 테스트·안전문구 테스트(`tests/`) · `CHANGELOG.md`.

## 하위호환·안전

- 순수 docs 재배치 — 코드·런타임·게이트 무변경. 기존 설치본 무영향. npm payload는 README 2파일만 갱신.
- 위험(내용 손실·링크 깨짐)은 **도구 링크검사 + 안전문구 테스트 + Codex 리뷰**로 방어.
- risk HIGH: 제품 공개 표면 전면 개편 — 매 phase 사람 확인.
