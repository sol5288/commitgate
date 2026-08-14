# REQ-2026-154 요구

외부 리뷰가 찾은 5건. **전부 실측 재현·확인했다.** 셋은 P1, 둘은 P2 다.

## 결함 1 (P1) — consume 복구가 결속을 대조하지 않는다

판별자 D(`consumed_state_sha256` 대조)는 **`!ev` checkpoint 분기에만** 있다
(`evidence-recovery.ts`). `resumeFrom: 'consume'` 경로는 `finalizeEvidenceAndConsume` 이
새 state 를 만들어 **대조 없이** 쓴다(`req-commit.ts` 의 `consumed` → `writeState`).

그리고 `req:repolicy` 는 `pending_evidence_for`·`approval_evidence` 가 살아 있어도
`policy_snapshot` 을 바꿔 **checkpoint 커밋**한다(`req-repolicy.ts` — 가드 없음. 실측 확인).

재현:
1. evidence 커밋 직후·state write 전 중단.
2. config 정책을 바꾸고 `req:repolicy <REQ> --run` → HEAD state 가 결속값과 달라진다.
3. `req:commit <REQ> --finalize --run` → consume 경로가 **대조 없이** 새 state 를 쓴다.
4. state write 뒤 checkpoint 전에 다시 중단 → 다음 `--finalize` 는 checkpoint 분기로 가고
   **`state-mismatch` 로 영구 차단**된다.

🔴 REQ-2026-151/152 가 만든 결속이 **한쪽 경로에만 걸려 있어**, 다른 경로가 그것을 깨고 지나간 뒤
그 결과가 첫 경로를 영구히 막는다.

## 결함 2 (P1) — `.gitignore` **완화·삭제**에서 안내가 후속 작업을 다시 막는다

REQ-2026-152 의 안내는 dirty `.gitignore` 를 **종류 구분 없이** 먼저 커밋하게 한다. 규칙을
**추가**하는 경우만 상정했고, **삭제·완화**는 반대로 동작한다.

실측 재현(이 세션):
```
HEAD .gitignore = "node_modules/" · node_modules/ 존재(ignored, 미커밋)
  → 규칙 삭제 → `?? node_modules/` 드러남
  → 안내대로 .gitignore 삭제를 커밋 → stash --include-untracked → 새 브랜치 → stash pop
  → 결과: `?? node_modules/`  ← 새 브랜치에 그대로 남는다
```
새 브랜치에는 **완화가 이미 커밋돼 있으므로** 그 노출은 영구적이고, 다음 `req:review-codex` 가
D10 에서 차단한다.

🔴 안내가 사람의 미커밋 결정(ignore 완화)을 **대신 확정**해 버린 것이 본질이다.

## 결함 3 (P1) — POSIX 역슬래시 파일명이 hard-blocked 안내를 다시 실행 불가로 만든다

`splitDirty` 가 git porcelain 경로에 `\` → `/` 변환을 한다(`hardblocked-facts.ts`).
🔴 **바로 두 줄 위 `toTicketRel` 주석이 금지한 바로 그 변환이다** — REQ-2026-153 이 그 구분을
적어 놓고 정작 같은 파일의 기존 코드를 고치지 않았다.

재현: POSIX 에서 hardCap 상태의 REQ 와 별개로 `mkdir 'workflow\REQ-2026-001'`(리터럴 역슬래시
디렉터리) 후 그 안에 untracked 파일 → `req:review-codex`. git 이 준 `workflow\REQ-2026-001/x` 가
`workflow/REQ-2026-001/x` 로 바뀌어 **티켓 내부로 오분류**된다. 보고는 실제 티켓만 park 하는
명령을 내고, 외부 파일이 남아 `req:new` 가 거부한다.

## 결함 4 (P2) — 대문자 SHA 를 유효로 받아 놓고 비교에서 막는다

`SHA256_RE` 는 `/i` 라 대문자를 통과시키고, 조회도 그대로 `bound` 로 돌려준다. 그런데 대조는
`actual !== binding.sha` **대소문자 구분**이고 `createHash(...).digest('hex')` 는 항상 소문자다.

재현 입력: `consumed_state_sha256: "E".repeat(64)` · 워킹 state 해시 `"e".repeat(64)`
→ 매니페스트 검증은 통과, 복구는 `state-mismatch`.

## 결함 5 (P2) — 새 consume e2e 의 fixture 결속값이 틀렸다

fixture 는 skeleton 기반으로 `consumed_state_sha256` 을 만든다. 실제 `consumeState` 는 pinned
state 에서 `approval_evidence`·`pending_evidence_for` 만 지우고 `review_base_sha`·
`review_diff_hash` 등을 **보존**하므로 바이트가 다르다.

**실측 확인**(probe 로 assert 를 추가해 확인):
```
expected 'bc4eacbcb961…'(실제 커밋된 state) to be '521ee556aee0…'(fixture 결속)
```
e2e 는 `approval_consumed_at` 만 보므로 **결속이 틀린 fixture 로도 green** 이다 —
경로는 타지만 state-commitment 를 증명하지 못한다.

## 범위 밖

- D10 예외 폭 · hardCap · HIGH 확인 · SHA/범위 불일치 — 완화하지 않는다.
- 완료 티켓 reopen 전이 — 여전히 만들지 않는다.
