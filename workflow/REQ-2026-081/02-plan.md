# REQ-2026-081 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

## Phase 1 — 소비자 문서 (`phase-1-consumer-docs`)

범위(DEC-1~DEC-5): `docs/upgrade` · `docs/guarantees` · `docs/troubleshooting` 각 ko/en (6파일).

순서:
1. **G1** `upgrade` ko/en — `## 버전별 주의사항` 신설 + `### 0.11 → 0.12` 절(DEC-1).
   - 🔴 **실측 출력**(`EBADENGINE` 블록)을 그대로 넣는다(DEC-2).
   - 🔴 기본 설치(경고만)와 `--engine-strict`(설치 실패)의 **차이**를 명시한다 — 실측된 사실이다.
   - 🔴 **선택지 세 갈래를 표로 준다**(DEC-4b): ①Node 20+ 로 올린다(권장) ②`commitgate@^0.11`에
     머문다(0.12 기능 없음 · **교착은 그대로**) ③18에서 강행(**미지원**).
     🔴 ②에 "0.11로 내려가도 교착은 고쳐지지 않는다"를 명시한다 — 이것이 가장 오해하기 쉬운 지점이다.
2. **G2** `guarantees` ko/en — 지원 범위 표 **맨 위**에 런타임 행(DEC-4).
   🔴 행이 담을 것: **Node 20·22·24 매 릴리스 CI 검증** · **Node 18 미지원**(설치 경고/실패) ·
   **20은 EOL이지만 의도적으로 지원**. "Node 20+"처럼 뭉뚱그리지 않는다.
   기존 진술은 건드리지 않고 **행 추가**만 한다.
3. **G3** `troubleshooting` ko/en — `EBADENGINE` 항목. 기존 12개 항목과 같은
   **증상 문장으로 시작하는 형식**을 지킨다(DEC-5).

Exit: `docs:lint` green · 수용기준 1·2·3·5 · Codex 승인.

## Phase 2 — 기여자 문서·CHANGELOG (`phase-2-dev-docs`)

범위(DEC-6): `docs/development` ko/en · `CHANGELOG.md`. **이 두 가지뿐이다.**

🔴 **`upgrade`·`guarantees`·`troubleshooting`(각 ko/en)은 phase-1에서 이미 착륙했다**(커밋 `0e6a365`).
phase 리뷰는 `git diff --cached`만 보므로 이 phase의 staged diff에 그 6파일이 **없는 것이 정상**이다.
CHANGELOG가 그 문서들을 언급·링크하는데 diff에 없다고 지적이 나오면 다음으로 확인한다:

```sh
git log --oneline -1 -- docs/upgrade.md docs/guarantees.md docs/troubleshooting.md
git show HEAD:docs/upgrade.md | grep -c EBADENGINE      # 5
```

(REQ-2026-071·080에서 같은 오탐이 각각 두 번 났다 — 리뷰어는 stateless이고 앞 phase의 커밋을 보지 않는다.)

순서:
1. **G4** `development` ko/en — `testTimeout: 30초`와 `hang-probe.yml`.
   🔴 값만 적지 않고 **근거**를 적는다(한 테스트가 단독 4740ms = 기본 상한의 95%).
2. CHANGELOG — 이번 문서 보강을 적되, 🔴 **무엇이 없었는지**를 적는다
   ("업그레이드 문서에 breaking change 안내가 없었다").

Exit: `docs:lint` green · `npm test` green · 수용기준 4·6 · Codex 승인.

## 완료
- 게이트 해당분 · 사용자 main 통합(통제점 승인 필요).
- 🔴 후속 판단: 문서 보강만이므로 **즉시 릴리스가 필요하지는 않다.** 다음 릴리스에 함께 나간다
  (npm 페이지의 README는 이미 0.12.0에 반영돼 있고, `docs/`는 GitHub에서 읽힌다).
