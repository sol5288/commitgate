/**
 * 테스트 실행 환경에서 **global/system git config와 환경 유래 identity를 차단**한다 (REQ-2026-049 DEC-1).
 *
 * **왜 필요한가**: REQ-2026-048이 design 승인 시 **자동 evidence commit**을 도입했는데, 테스트 fixture 다수가
 * `git -c user.email=… -c user.name=…`처럼 **호출마다 인라인으로만** identity를 줬다. 인라인 `-c`는 그 호출에만
 * 적용되므로, 피시험 코드(`evidence-ports`의 bare `git commit`)는 identity를 못 찾고 **runner 전역 설정**에
 * 의존하게 된다. 전역 identity가 있는 macOS만 통과하고 ubuntu·windows 6 job이 실패한 것이 그 결과다.
 * 개발자 머신에는 대개 전역 identity가 있어 **로컬에서는 영원히 드러나지 않는다**.
 *
 * 🔴 그래서 원인을 고치는 것(repo-local identity 설정)만으로는 부족하다 — **재발을 막으려면 로컬이 CI와 같은
 *    조건이어야 한다.** 차단하면 repo-local을 빠뜨린 헬퍼는 **로컬에서도 즉시 실패**하고,
 *    "CI에서만 터지는" 상태가 구조적으로 불가능해진다. 이 파일이 완료기준의 오라클이다.
 *
 * **identity가 새어 들어올 수 있는 경로는 넷이고, 넷 다 막는다**:
 *   1. system/global config → `GIT_CONFIG_SYSTEM`·`GIT_CONFIG_GLOBAL`을 우리 파일로 대체(+`GIT_CONFIG_NOSYSTEM`).
 *   2. `HOME`/`USERPROFILE` 아래 `~/.gitconfig` → HOME 계열을 임시 디렉터리로 고정.
 *   3. `GIT_AUTHOR_*`/`GIT_COMMITTER_*`·**`EMAIL`** 환경변수 → 상속분을 **삭제**한다.
 *      🔴 `EMAIL`은 git이 `user.email` 부재 시 쓰는 폴백이다 — 지우지 않으면 개발 셸에서 음성 대조가
 *         통과해 결함이 다시 가려진다(phase-1 리뷰 P1).
 *   4. username@hostname **자동 추론** → 전역 config에 `user.useConfigOnly = true`를 심어 거부하게 한다.
 *
 * ⚠️ identity를 **공급하지는 않는다.** 공급하면(예: `GIT_AUTHOR_NAME` 설정) 결함이 다시 가려진다.
 *    identity는 오직 **repository-local config**로만 제공돼야 한다.
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** git이 identity로 쓸 수 있는 환경변수 — 전부 제거 대상. `EMAIL`은 `user.email`의 공식 폴백이다. */
export const IDENTITY_ENV_VARS = [
  'GIT_AUTHOR_NAME',
  'GIT_AUTHOR_EMAIL',
  'GIT_COMMITTER_NAME',
  'GIT_COMMITTER_EMAIL',
  'EMAIL',
] as const

/** 상속된 identity 환경변수를 제거한다(순수 — 테스트가 합성 env로 직접 구동한다). */
export function scrubIdentityEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  for (const k of IDENTITY_ENV_VARS) delete env[k]
  return env
}

/** 전역 config 내용: identity는 주지 않되, **자동 추론을 거부**하게 만든다. */
export const HERMETIC_GITCONFIG = '[user]\n\tuseConfigOnly = true\n'

// 워커마다 고유 디렉터리 — 병렬 실행에서도 서로의 파일을 건드리지 않는다.
const dir = mkdtempSync(join(tmpdir(), 'cg-gitcfg-'))
const globalCfg = join(dir, 'hermetic-gitconfig')
writeFileSync(globalCfg, HERMETIC_GITCONFIG)

// git ≥2.32: 전역/시스템 config 파일 자체를 우리 파일로 대체한다.
process.env.GIT_CONFIG_GLOBAL = globalCfg
process.env.GIT_CONFIG_SYSTEM = globalCfg
// 구버전 호환 이중 방어(시스템 config 무시).
process.env.GIT_CONFIG_NOSYSTEM = '1'
// `~` 해소가 사용자 홈의 .gitconfig를 다시 물어오지 않도록 HOME 계열도 이 디렉터리로 고정한다.
process.env.HOME = dir
process.env.USERPROFILE = dir
// 🔴 상속된 identity 환경변수 제거(설정하지 않는 것만으로는 부족 — 이미 있으면 그대로 새어 들어온다).
scrubIdentityEnv(process.env)
