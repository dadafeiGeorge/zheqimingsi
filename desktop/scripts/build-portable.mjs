import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const desktopDir = path.resolve(__dirname, '..')
const outDir = path.resolve(desktopDir, '../dist-releases/windows-build')
const unpackedDir = path.join(outDir, 'win-unpacked')
const outExe = path.join(outDir, '哲启明思-Windows便携版.exe')
const iconSrc = path.join(desktopDir, 'assets', 'icon.ico')
const nsiTemplatePath = path.join(__dirname, 'portable-fast.nsi')

if (!fs.existsSync(path.join(unpackedDir, '哲启明思.exe'))) {
  throw new Error(`win-unpacked missing at ${unpackedDir}`)
}

function findCachedTool(subdirPattern, relTarget) {
  const localAppData = process.env.LOCALAPPDATA || ''
  const cacheRoot = path.join(localAppData, 'electron-builder', 'Cache', 'nsis')
  if (!fs.existsSync(cacheRoot)) {
    throw new Error(`electron-builder NSIS cache not found at ${cacheRoot}`)
  }
  const match = fs
    .readdirSync(cacheRoot)
    .filter((n) => subdirPattern.test(n))
    .sort()
    .reverse()[0]
  if (!match) throw new Error(`Missing NSIS cache folder matching ${subdirPattern}`)
  const full = path.join(cacheRoot, match, relTarget)
  if (!fs.existsSync(full)) throw new Error(`Missing NSIS tool: ${full}`)
  return full
}

function computeBuildId() {
  const hash = crypto.createHash('sha256')
  const keyFiles = [
    path.join(unpackedDir, '哲启明思.exe'),
    path.join(unpackedDir, 'resources', 'app.asar'),
    path.join(unpackedDir, 'resources', 'web', 'index.html'),
    path.join(unpackedDir, 'resources', 'library', 'catalog.json'),
  ]
  const webAssetsDir = path.join(unpackedDir, 'resources', 'web', 'assets')
  if (fs.existsSync(webAssetsDir)) {
    for (const f of fs.readdirSync(webAssetsDir).sort()) {
      keyFiles.push(path.join(webAssetsDir, f))
    }
  }
  for (const fp of keyFiles) {
    if (!fs.existsSync(fp)) continue
    const st = fs.statSync(fp)
    hash.update(`${path.relative(unpackedDir, fp)}:${st.size}:`)
    if (st.size < 2 * 1024 * 1024) {
      hash.update(fs.readFileSync(fp))
    } else {
      hash.update(String(Math.floor(st.mtimeMs)))
    }
  }
  return hash.digest('hex').slice(0, 12)
}

const sevenZa = path.join(desktopDir, 'node_modules', '7zip-bin', 'win', 'x64', '7za.exe')
const makensis = findCachedTool(/^nsis-\d/, 'makensis.exe')
const nsisExtraPlugins = findCachedTool(/^nsis-resources-/, path.join('plugins', 'x86-unicode'))
const buildId = computeBuildId()

// 使用纯 ASCII 临时目录承载 makensis 输入输出，彻底规避 NSIS 3.0 CLI 中文路径编码限制
const workDir = path.join(os.tmpdir(), 'zheqimingsi-portable-build')
fs.rmSync(workDir, { recursive: true, force: true })
fs.mkdirSync(workDir, { recursive: true })

const payload7z = path.join(workDir, 'app-payload.7z')
const tmpIcon = path.join(workDir, 'icon.ico')
const tmpOutExe = path.join(workDir, 'portable-out.exe')
const tmpNsi = path.join(workDir, 'build.nsi')

try {
  fs.copyFileSync(iconSrc, tmpIcon)

  // 精简 Electron 无关小语种 locale 包（仅保留简体/繁体/英文），减少约 35MB 解压体量
  const localesDir = path.join(unpackedDir, 'locales')
  if (fs.existsSync(localesDir)) {
    const keep = new Set(['zh-CN.pak', 'zh-TW.pak', 'en-US.pak'])
    for (const f of fs.readdirSync(localesDir)) {
      if (!keep.has(f)) {
        try {
          fs.unlinkSync(path.join(localesDir, f))
        } catch {}
      }
    }
  }

  console.log(`[portable-fast] BUILD_ID=${buildId}`)
  console.log(`[portable-fast] Packing ${unpackedDir} -> ${payload7z} (7z mx=5 multi-thread)...`)
  execFileSync(sevenZa, ['a', '-t7z', '-mx=5', '-mmt=on', '-bd', payload7z, '.'], {
    cwd: unpackedDir,
    stdio: 'inherit',
  })

  const template = fs.readFileSync(nsiTemplatePath, 'utf8')
  const header = [
    `!define BUILD_ID "${buildId}"`,
    `!define ICON_PATH "${tmpIcon}"`,
    `!define OUT_FILE "${tmpOutExe}"`,
    `!define PAYLOAD_7Z "${payload7z}"`,
    `!define NSIS_EXTRA_PLUGINS "${nsisExtraPlugins}"`,
    '',
  ].join('\r\n')
  // UTF-8 BOM 让 NSIS 3.0.4 稳定识别 Unicode 中文脚本
  fs.writeFileSync(tmpNsi, '\uFEFF' + header + template, 'utf8')

  console.log(`[portable-fast] Compiling fast cached portable EXE via makensis (BUILD_ID=${buildId})...`)
  execFileSync(makensis, ['/V2', '/INPUTCHARSET', 'UTF8', tmpNsi], { stdio: 'inherit' })

  fs.mkdirSync(outDir, { recursive: true })
  fs.copyFileSync(tmpOutExe, outExe)
  const st = fs.statSync(outExe)
  console.log(`[portable-fast] Done: ${outExe} (${(st.size / 1024 / 1024).toFixed(2)} MB)`)
} finally {
  fs.rmSync(workDir, { recursive: true, force: true })
}
