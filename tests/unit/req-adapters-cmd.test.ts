import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { safeSpawnSync } from '../../scripts/req/lib/adapters'

// Windows 전용: cross-spawn의 **.cmd 래퍼 경로**(codex.cmd·npm.cmd = 실제 공격면) 회귀 검증.
// 기존 [P1] node -e 테스트(전 OS·일반 exec 경로)와 상보적. 비-Windows는 skip(통과 집계).
const winIt = process.platform === 'win32' ? it : it.skip

describe('[P1] safeSpawnSync — Windows .cmd 래퍼 주입 방어', () => {
  winIt('.cmd(node recorder 호출)에 shell 메타문자 인자를 넘겨도 주입되지 않고 argv가 리터럴로 도착', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cg-cmd-'))
    try {
      // recorder.js: 받은 argv를 자기 디렉터리의 recorded.json에 기록.
      writeFileSync(
        join(dir, 'recorder.js'),
        "const fs=require('node:fs'),path=require('node:path');" +
          "fs.writeFileSync(path.join(__dirname,'recorded.json'),JSON.stringify(process.argv.slice(2)),'utf8')",
        'utf8',
      )
      // wrapper.cmd: npm/codex.cmd 동형 — node recorder %* (인자를 그대로 forward).
      writeFileSync(join(dir, 'wrapper.cmd'), '@echo off\r\nnode "%~dp0recorder.js" %*\r\n', 'utf8')

      const injected = join(dir, 'injected.txt')
      // 주입 시도: & | < > 로 2차 명령/리다이렉트를 노림(출력은 tmpDir 하위 절대경로 — 부작용 검사 결정성).
      const args = [`x & echo INJECTED> ${injected}`, 'a | b', 'c > d', 'e < f', 'plain']

      // cwd=tmpDir 고정(주입 부작용이 repo/test cwd로 새지 않게).
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
