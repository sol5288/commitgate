# REQ-2026-169 리뷰 요청

## 배경

`req:new` 의 intake 게이트가 티켓 수에 비례해 git 프로세스를 띄운다. 소비자 저장소(티켓 300개)에서
**dry-run 이 603초**로 측정됐고, 원인은 `lib/evidence-ports.ts` 의 `head*` 포트가 **호출 1회당
프로세스 1개**를 쓰고 `scanIntake` 가 그 포트를 **티켓마다** 만들기 때문이다(약 3,000회 스폰).

## 변경 요약

판정 로직은 **전혀 건드리지 않고**, HEAD blob 을 읽는 **IO 만** 배치로 바꾼다.
`ls-tree -r -z` 1회로 `<ticketRoot>/` 하위 blob 의 경로+OID 를 전부 얻고,
`cat-file --batch` 1회로 필요한 blob 을 미리 읽은 뒤, 그 뷰를 `EvidencePorts` **데코레이터**로 주입한다.

## 리뷰 포인트

1. **DEC-3 상위집합 논증이 실제로 성립하는가.** intake 가 요청할 수 있는 모든 경로가
   `<ticket>/state.json` ∪ `<ticket>/responses/**` 안에 있는가? `validateManifest` 의 경로 confinement가
   그것을 보장한다고 봤는데, 그 보장이 미치지 못하는 호출 경로가 남아 있는지 봐 달라.
   (특히 `verifyCommittedDesignEvidence` 의 `archive_inventory` 항목 경로와
   `verifyPhaseArchives` 의 `response_path` — 매니페스트가 손상됐을 때의 값.)

2. **DEC-6 폴백이 옛 동작과 정말 동일한가.** "`<ticketRoot>` 밖이면 실물 포트로 폴백"으로
   바이트 동일성이 유지되는지, 그리고 "`<ticketRoot>` 안인데 열거에 없으면 확정 부재" 라는 단정이
   `ls-tree -r`의 의미(커밋 트리 전량 재귀 열거)로 정당한지.

3. **게이트가 약해지는 경로가 생기지 않았는가.** 특히 배치 읽기 실패를 throw 로 두었는데,
   실패를 "빈 뷰"로 흡수하면 모든 티켓이 legacy 로 보여 게이트가 통째로 우회된다.
   그 실패 경로가 코드 어디에도 남아 있지 않은지.

4. **DEC-7 의 오라클 배치가 충분한가.** 기존 실 git 테스트는 배칭이 폴백으로 되돌아가도 전부
   녹색이다(공허한 오라클). 계수 테스트가 그 사각을 실제로 덮는지, 아니면 계수 지점이
   테스트 지역이라 또 공허해지는지.

5. **phase 분해가 옳은가.** phase-1 이 배선을 하지 않는 것이 리뷰 면적상 이득인지, 아니면
   "쓰이지 않는 코드"를 한 라운드 리뷰하는 낭비인지.
