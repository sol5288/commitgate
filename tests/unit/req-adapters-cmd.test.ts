import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { safeSpawnSync } from '../../scripts/req/lib/adapters'

// Windows 전용: cross-spawn의 **.cmd 래퍼 경로**(codex.cmd·npm.cmd = 실제 공격면) 회귀 검증.
// 기존 [P1] node -e 테스트(전 OS·일반 exec 경로)와 상보적. 비-Windows는 skip(통과 집계).
const winIt = process.platform === 'win32' ? it : it.skip

// child가 실행할 픽스처(.cmd·recorder.js)를 **repo 내부 writable temp**(.tmp/)에 만든다.
// %TEMP%(예: C:\Users\<user>\AppData\Local\Temp) 아래에 두면 격리 sandbox에서 child가 상위 경로(C:\Users\<user>)를
// lstat할 때 EPERM으로 막혀 위양성 실패가 난다(hermetic 아님). repo 내부(.tmp/)는 workspace 루트라 접근 허용.
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const tmpBase = join(repoRoot, '.tmp')

describe('[P1] safeSpawnSync — Windows .cmd 래퍼 주입 방어', () => {
  winIt('.cmd(node recorder 호출)에 shell 메타문자 인자를 넘겨도 주입되지 않고 argv가 리터럴로 도착', () => {
    mkdirSync(tmpBase, { recursive: true })
    const dir = mkdtempSync(join(tmpBase, 'cg-cmd-'))
    try {
      // recorder.cjs: 받은 argv를 자기 디렉터리의 recorded.json에 기록.
      // ⚠️ .cjs 확장자 필수 — 픽스처가 repo(.tmp/) 하위라 package.json "type":"module"의 지배를 받는다.
      //    .js면 ESM으로 해석돼 require가 없어 child가 실패한다(%TEMP% 밖에 둘 때만 나타나는 함정).
      writeFileSync(
        join(dir, 'recorder.cjs'),
        "const fs=require('node:fs'),path=require('node:path');" +
          "fs.writeFileSync(path.join(__dirname,'recorded.json'),JSON.stringify(process.argv.slice(2)),'utf8')",
        'utf8',
      )
      // wrapper.cmd: npm/codex.cmd 동형 — node recorder %* (인자를 그대로 forward).
      // node를 절대경로(process.execPath)로 호출 — child PATH에 node가 없는 환경(nvm-windows·격리 CI)에서의
      // 위양성 실패 제거(주입 방어 검증은 .cmd 래퍼 + cross-spawn 경로를 그대로 통과하므로 의도 보존).
      writeFileSync(join(dir, 'wrapper.cmd'), `@echo off\r\n"${process.execPath}" "%~dp0recorder.cjs" %*\r\n`, 'utf8')

      const injected = join(dir, 'injected.txt')
      // 주입 시도: & | < > 로 2차 명령/리다이렉트를 노림(출력은 tmpDir 하위 절대경로 — 부작용 검사 결정성).
      const args = [`x & echo INJECTED> ${injected}`, 'a | b', 'c > d', 'e < f', 'plain']

      // cwd=dir 고정(주입 부작용이 repo/test cwd로 새지 않게).
      safeSpawnSync(join(dir, 'wrapper.cmd'), args, { cwd: dir })

      // (1) 주입 차단: 2차 명령이 실행됐다면 생겼을 부작용 파일이 없어야 한다.
      expect(existsSync(injected)).toBe(false)
      // (2) 리터럴 전달: recorder가 받은 argv가 원본과 정확히 동일.
      const recorded = JSON.parse(readFileSync(join(dir, 'recorded.json'), 'utf8')) as string[]
      expect(recorded).toEqual(args)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
