import { defineConfig } from 'vitest/config'

// 이 패키지의 req:* 단위 테스트는 순수(DB·네트워크 무의존).
// palm-kiosk-app의 setupFiles(.env·DB 가드)·alias는 불필요 → 최소 config.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    reporters: ['default'],
    // REQ-2026-049: 전역/시스템 git config 차단. 테스트가 만드는 저장소는 **repo-local identity**로만
    // 커밋해야 한다 — 전역에 기대면 로컬은 통과하고 CI(전역 identity 없는 러너)에서만 터진다.
    setupFiles: ['tests/setup/git-hermetic.ts'],
    // REQ-2026-044: init/uninstall/migrate 테스트는 임시 repo에서 `commitgate` 프로세스를 스폰한다.
    // 그때 파일 병렬을 **기본값(= CPU 코어 수만큼 동시)**으로 두면 스폰들이 겹쳐, 리소스가 빠듯한
    // 러너(CI macos·node18·로컬 Windows)에서 `npm test`가 hang한다(어서션 실패가 아니라 교착).
    //
    // REQ-2026-075: 그 해결이 `fileParallelism: false`(병렬 0)였는데, **그 사이의 값**이 시도되지 않았다.
    // hang 조건은 `동시 워커 수 × 워커당 스폰`이고 **워커 상한이 그 곱을 묶는다.**
    // GitHub 러너는 4 vCPU이므로 그 **절반**에서 멈춘다 — 코어 수에 닿으면 위 hang 조건으로 되돌아간다.
    //
    // 실측(2026-07-27 · 로컬 12코어 win32 · 47파일 2237 tests):
    //   fileParallelism:false  507초 · maxWorkers:2  310초(1.64×) — 둘 다 pass, hang 없음.
    //
    // 🔴 되돌리려면 이 두 줄을 지우고 `fileParallelism: false`로 복귀하면 현행 동작과 정확히 같아진다.
    maxWorkers: 2,
    minWorkers: 1,
    /**
     * REQ-2026-079: 워커를 **프로세스가 아니라 스레드**로 띄운다.
     *
     * 🔴 **왜**: REQ-2026-077이 `macos-latest · node 18`에서 20% 확률로 나는 교착의 원인을 특정했다 —
     *    테스트가 하나도 실행되기 전 **워커 프로세스**(`node (vitest 1)`)가 JS 루프에서 회전하고,
     *    본체는 `kevent`에서 그 응답을 영원히 기다린다. 기본 풀은 `forks`이고, threads 에는
     *    그 **별도 프로세스가 없다.**
     *
     * ⚠️ **연역이 아니라 가설이다.** 같은 JS가 스레드 안에서 회전할 가능성도 남아 있다 —
     *    프로브 31회 실측으로만 판정한다(기저율 20%에서 10회 0건은 우연히도 10.7% 확률로 나온다).
     *
     * 🔴 **트레이드오프**: forks 는 파일마다 별도 프로세스라 격리가 강하고, threads 는 한 프로세스를
     *    공유한다. 이 저장소에서 안전한 근거 — `tests/setup/git-hermetic.ts` 가 `mkdtempSync` 로
     *    호출마다 고유 디렉터리를 만들고, Node worker_threads 는 생성 시 `process.env` 를 **복사**받으며
     *    (`SHARE_ENV` 미사용), 한 스레드 안에서 파일은 순차 실행된다. 실측으로 2237건 전부 통과했다.
     *    앞으로 전역 상태에 기대는 테스트가 추가돼 간섭이 나면 **이 설정이 첫 번째 의심 지점**이다.
     */
    pool: 'threads',
    /**
     * 테스트당 상한. 기본값(5초)이 이 저장소에는 **너무 빠듯했다**(REQ-2026-079).
     *
     * 🔴 실측(2026-07-28): `delivery-verbs` 의 한 테스트가 **단독 실행에서 4740ms** — 기본 상한의 95%다.
     *    임시 저장소를 만들고 `commitgate` 프로세스를 여러 번 스폰하는 테스트라 원래 그 정도가 든다.
     *    병렬 부하나 느린 러너에서는 그대로 넘어간다 — 즉 **부하 변동이 곧 거짓 red**가 된다.
     *
     * 🔴 이것은 **기대값이 아니라 인프라 값**이다. 테스트가 검사하는 내용은 그대로이고,
     *    진짜로 멈춘 테스트는 이 상한에 걸려 결국 실패한다. 값의 근거는 REQ-2026-076의 CI
     *    `timeout-minutes` 와 같다 — **정상 실행을 죽이지 않는 쪽으로 틀린다.**
     */
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
