import { createHmac, timingSafeEqual } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'

const COOKIE = 'jat_session'
const MAX_AGE_SEC = 60 * 60 * 24 * 30

function envValue(name: string): string {
  return (process.env[name] ?? '').replace(/\r/g, '').trim()
}

function secret(): string {
  const value = envValue('SESSION_SECRET')
  if (!value) throw new Error('SESSION_SECRET is missing. Add it to your environment variables.')
  return value
}

function authEmail(): string {
  return envValue('AUTH_EMAIL').toLowerCase()
}

function authPassword(): string {
  return (process.env.AUTH_PASSWORD ?? '').replace(/\r/g, '')
}

function sign(email: string): string {
  const payload = Buffer.from(JSON.stringify({ email, exp: Date.now() + MAX_AGE_SEC * 1000 })).toString('base64url')
  const sig = createHmac('sha256', secret()).update(payload).digest('base64url')
  return `${payload}.${sig}`
}

function verifyToken(token: string): { email: string } | null {
  const [payload, sig] = token.split('.')
  if (!payload || !sig) return null
  const expected = createHmac('sha256', secret()).update(payload).digest('base64url')
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { email?: string; exp?: number }
    if (!data.email || typeof data.exp !== 'number' || data.exp < Date.now()) return null
    return { email: data.email }
  } catch {
    return null
  }
}

function cookies(req: Request): Record<string, string> {
  const header = req.headers.cookie
  if (!header) return {}
  const out: Record<string, string> = {}
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (!key) continue
    out[key] = decodeURIComponent(rest.join('='))
  }
  return out
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  if (left.length !== right.length) {
    timingSafeEqual(left, Buffer.alloc(left.length))
    return false
  }
  return timingSafeEqual(left, right)
}

function cookieOptions(): string {
  const secure = process.env.VERCEL === '1' ? '; Secure' : ''
  return `HttpOnly; Path=/; Max-Age=${MAX_AGE_SEC}; SameSite=Lax${secure}`
}

export function setSession(res: Response, email: string): void {
  res.append('Set-Cookie', `${COOKIE}=${sign(email)}; ${cookieOptions()}`)
}

export function clearSession(res: Response): void {
  const secure = process.env.VERCEL === '1' ? '; Secure' : ''
  res.append('Set-Cookie', `${COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax${secure}`)
}

export function readSession(req: Request): { email: string } | null {
  const token = cookies(req)[COOKIE]
  if (!token) return null
  try {
    return verifyToken(token)
  } catch {
    return null
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const session = readSession(req)
  if (!session) {
    res.status(401).json({ error: 'Please sign in.' })
    return
  }
  res.locals.email = session.email
  next()
}

export function loginAllowed(email: string, password: string): boolean {
  const expectedEmail = authEmail()
  const expectedPassword = authPassword()
  if (!expectedEmail || !expectedPassword) return false
  return safeEqual(email.trim().toLowerCase(), expectedEmail) && safeEqual(password, expectedPassword)
}

export function authConfigured(): boolean {
  return Boolean(authEmail() && authPassword() && process.env.SESSION_SECRET?.trim())
}
