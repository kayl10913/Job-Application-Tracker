import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, shell } from 'electron'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PORT = process.env.PORT || '3001'
const origin = `http://127.0.0.1:${PORT}`

let serverProcess = null

function startServer() {
  const tsxCli = path.join(root, 'node_modules/tsx/dist/cli.mjs')
  serverProcess = spawn(process.execPath, [tsxCli, 'server/index.ts'], {
    cwd: root,
    env: { ...process.env, NODE_ENV: 'production', PORT: String(PORT) },
    stdio: 'inherit',
    windowsHide: true,
  })
}

function stopServer() {
  if (!serverProcess?.pid) return
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(serverProcess.pid), '/T', '/F'], {
      shell: true,
      windowsHide: true,
    })
  } else {
    serverProcess.kill()
  }
  serverProcess = null
}

async function waitForApi() {
  const deadline = Date.now() + 20000
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${origin}/api/health`)
      if (res.ok) return
    } catch {
      // Server is still booting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('Job Application Tracker could not start its local server.')
}

async function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    title: 'Job Application Tracker',
    backgroundColor: '#efe8d8',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  win.once('ready-to-show', () => win.show())
  await win.loadURL(origin)
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.focus()
  })

  app.whenReady().then(async () => {
    startServer()
    await waitForApi()
    await createWindow()
  })

  app.on('window-all-closed', () => {
    stopServer()
    app.quit()
  })

  app.on('before-quit', () => {
    stopServer()
  })
}
