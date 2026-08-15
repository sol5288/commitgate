# REQ-2026-155 요구

외부 리뷰 4건. **전부 실측 확인했다.** 하나는 P1, 둘은 P2, 하나는 P3 다.

## 결함 1 (P1) — `req:confirm` 이 복구 결속을 깨뜨린다

REQ-2026-154 는 복구 창에서 `req:repolicy` 만 막았다("관측된 것만 막는다"). 그런데
`req:confirm` 도 같은 창에서 `user_commit_confirmed` 를 쓰고 **checkpoint 커밋**한다
(`req-confirm.ts:187-197` — 가드 없음, 실측 확인).

재현:
1. source 커밋 + evidence-finalize 까지 끝나 `pending_evidence_for` 와 결속 해시가 있는 상태에서 중단.
2. `npx commitgate req:confirm REQ-… --scope req --method "재확인" --run`
3. state 가 바뀌어 checkpoint 커밋된다.
4. `req:commit REQ-… --finalize --run` → 소비 state 바이트가 결속과 달라 **영구 차단**.

🔴 `user_commit_confirmed` 는 `consumeState` 의 출력에 **직접 들어간다**(`scope:'req'` 는 보존,
그 밖은 `null` 로 설정 — **어느 쪽이든 키 순서·값이 달라진다**). 결속에 포함되는 필드다.

🔴 **"관측된 것만 막는다"가 부족했다.** 판정 근거를 verb 이름이 아니라 **동작**으로 옮겨야 한다.
`commitStateCheckpoint` 호출부는 6곳이다(`req-commit` 2 · `req-confirm` · `req-repolicy` ·
`req-review-exception` · `review-codex`).

## 결함 2 (P2) — 복구 계획은 Ready 인데 실제 `--finalize` 가 D10 에서 막힌다

`planEvidenceRecovery` 는 porcelain 경로를 `norm()`(`\`→`/`)으로 바꿔 비교하는데
(`evidence-recovery.ts:327`), D10(`findUnstagedOrUntracked`)은 **raw 경로**를 allowlist 와
직접 비교한다(`review-codex.ts:2494-2504`).

POSIX 에서 리터럴 역슬래시를 포함한 더러운 경로
(`workflow\REQ-2026-001/responses/phase-x-r01-approved.json`)를 만들면:
- plan 은 `/` 로 바꿔 allowlist 와 같다고 보고 **`ready`** 를 돌려준다.
- D10 은 raw 경로를 비교하므로 **allowlist 밖**으로 보고 차단한다.
- 결과: **도구가 복구 가능하다고 판정한 명령이 실행 불가**다 — 이 저장소가 반복해 밟은 부류다.

## 결함 3 (P2) — staged 경로 변환이 phase 면적 게이트를 우회시킨다

`stagedNames()`(`req-commit.ts:690`)와 `lib/scratch.ts:97`, `phaseCodeFiles`
(`review-codex.ts:1461`)가 staged 경로에 `\`→`/` 변환을 한다.

POSIX 에서 `max_files: 1` 인 phase 에 다음 둘을 stage 하면:
- `src/one.ts`
- **티켓 밖** 경로인 `workflow\REQ-2026-001/large.ts`

후자는 변환 뒤 티켓 내부로 보여 `phaseCodeFiles()` 에서 **제외**된다. 면적 게이트는 1개만 센 것으로
승인하고, `sourceCommitForbiddenStaged()` 도 state/responses 가 아니라 통과시켜 **둘 다 커밋**된다.

🔴 `scratch.ts` 는 바로 그 줄 위에 "**`trim()` 을 쓰지 않는다 — 앞뒤 공백은 Git 경로의 일부다**"라고
적어 두고, 같은 부류의 `\`→`/` 변환을 하고 있다. REQ-2026-153·154 와 **세 번째** 같은 자기모순이다.

## 결함 4 (P3) — 선행 공백 패턴을 부정으로 오인한다

`isNegation` 이 `trim().startsWith('!')` 다(`gitignore-coverage.ts:20`). gitignore 는 **후행** 공백만
버리고 **선행 공백은 패턴의 일부**다.

**실측**(`git check-ignore -v`):
```
.gitignore = "*.log\n !keep.log\n"
→ .gitignore:1:*.log   keep.log      ← 여전히 1행 `*.log` 가 이긴다 = ` !keep.log` 는 부정이 아니다
```

그런데 현재 판정은 이것을 부정으로 보고 **완료 티켓의 후속 작업 안내를 통째로 막는다**.
🔴 **현재 테스트도 틀린 동작을 정답으로 고정**하고 있다(`gitignore-coverage.test.ts` 의
"앞뒤 공백 무시" 케이스).

## 공통 원인

결함 2·3·4 는 **같은 부류**다: **바깥이 준 입력을 도구가 임의로 다듬는다.**
git 이 준 경로, gitignore 의 줄 — 둘 다 정본이고 변환하면 판정이 갈린다.

## 범위 밖

- D10 예외 폭 · hardCap · HIGH 확인 · SHA/범위 불일치 — 완화하지 않는다.
- `toTicketRel` 의 `\`→`/` — 그것은 win32 `relative()` **산출물**의 구분자 변환이지 git 경로가 아니다.
