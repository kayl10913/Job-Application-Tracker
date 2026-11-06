import type { IncomingMessage, ServerResponse } from 'node:http'
import { app } from './app.ts'

type VercelReq = IncomingMessage & {
  url?: string
  originalUrl?: string
  query?: Record<string, string | string[] | undefined>
}

function parts(value: string | string[] | undefined): string[] {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

export function runApi(req: VercelReq, res: ServerResponse) {
  const query = req.query ?? {}
  const pathParts = parts(query.path)
  const id = parts(query.id)[0] ?? ''
  const raw = req.url || '/'
  const qsIndex = raw.indexOf('?')
  const qs = qsIndex >= 0 ? raw.slice(qsIndex) : ''

  if (pathParts.length > 0) {
    req.url = `/api/${pathParts.join('/')}${qs}`
  } else if (id) {
    req.url = `/api/jobs/${id}${qs}`
  } else if (!raw.split('?')[0].startsWith('/api')) {
    const path = raw.split('?')[0]
    req.url = `/api${path.startsWith('/') ? path : `/${path}`}${qs}`
  } else {
    req.url = raw.split('?')[0] + qs
  }

  req.originalUrl = req.url
  return app(req as never, res as never)
}
