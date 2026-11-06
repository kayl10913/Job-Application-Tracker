import { config as loadEnv } from 'dotenv'
import express from 'express'
import { existsSync } from 'node:fs'
import { ObjectId, type WithId } from 'mongodb'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { authConfigured, clearSession, loginAllowed, readSession, requireAuth, setSession } from './auth.ts'
import { explainMongoError, getCollection, mongoDbName } from './mongo.ts'

if (!process.env.VERCEL) {
  loadEnv({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../.env') })
}

const STATUSES = ['Saved', 'Applied', 'Screening', 'Interview', 'Offer', 'Rejected', 'Withdrawn'] as const
const WORK_MODES = ['On-site', 'Hybrid', 'Remote'] as const

type Status = (typeof STATUSES)[number]
type WorkMode = (typeof WORK_MODES)[number]

type JobDoc = {
  company: string
  role: string
  location: string
  workMode: WorkMode | ''
  salary: string
  status: Status
  dateApplied: string
  followUp: string
  url: string
  contact: string
  notes: string
  createdAt: string
  updatedAt: string
}

type Job = JobDoc & { id: string }

const dbName = mongoDbName()

function isStatus(value: unknown): value is Status {
  return typeof value === 'string' && (STATUSES as readonly string[]).includes(value)
}

function isWorkMode(value: unknown): value is WorkMode {
  return value === '' || (typeof value === 'string' && (WORK_MODES as readonly string[]).includes(value))
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function toJob(doc: WithId<JobDoc>): Job {
  return {
    id: String(doc._id),
    company: doc.company,
    role: doc.role,
    location: doc.location ?? '',
    workMode: isWorkMode(doc.workMode) ? doc.workMode : '',
    salary: doc.salary ?? '',
    status: isStatus(doc.status) ? doc.status : 'Saved',
    dateApplied: doc.dateApplied ?? '',
    followUp: doc.followUp ?? '',
    url: doc.url ?? '',
    contact: doc.contact ?? '',
    notes: doc.notes ?? '',
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  }
}

function parseObjectId(id: string): ObjectId | null {
  if (!ObjectId.isValid(id)) return null
  const objectId = new ObjectId(id)
  return String(objectId) === id ? objectId : null
}

function fromBody(body: unknown, fallback?: Partial<JobDoc>): JobDoc {
  const data = body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
  const company = asString(data.company).trim() || asString(fallback?.company).trim()
  const role = asString(data.role).trim() || asString(fallback?.role).trim()
  if (!company || !role) {
    throw new Error('Company and role are required')
  }

  const status = isStatus(data.status) ? data.status : fallback?.status || 'Saved'
  const workMode = isWorkMode(data.workMode) ? data.workMode : fallback?.workMode || ''
  const now = new Date().toISOString()

  return {
    company,
    role,
    location: asString(data.location ?? fallback?.location),
    workMode,
    salary: asString(data.salary ?? fallback?.salary),
    status,
    dateApplied: asString(data.dateApplied ?? fallback?.dateApplied),
    followUp: asString(data.followUp ?? fallback?.followUp),
    url: asString(data.url ?? fallback?.url),
    contact: asString(data.contact ?? fallback?.contact),
    notes: asString(data.notes ?? fallback?.notes),
    createdAt: fallback?.createdAt || asString(data.createdAt) || now,
    updatedAt: now,
  }
}

async function jobs() {
  return getCollection<JobDoc>('applications')
}

export const app = express()
app.set('trust proxy', 1)
app.use((req, _res, next) => {
  const original = req.originalUrl || req.url
  if (original.startsWith('/api')) {
    req.url = original.split('?')[0]
  }
  next()
})
app.use(express.json({ limit: '2mb' }))

app.get('/api/health', async (_req, res) => {
  try {
    const collection = await jobs()
    await collection.estimatedDocumentCount()
    res.json({ ok: true, db: dbName })
  } catch (error) {
    res.status(503).json({ ok: false, error: explainMongoError(error) })
  }
})

app.post('/api/login', (req, res) => {
  try {
    if (!authConfigured()) {
      res.status(500).json({ error: 'Login is not configured. Set AUTH_EMAIL, AUTH_PASSWORD, and SESSION_SECRET.' })
      return
    }
    const email = asString(req.body?.email)
    const password = asString(req.body?.password)
    if (!loginAllowed(email, password)) {
      res.status(401).json({ error: 'Email or password is incorrect.' })
      return
    }
    setSession(res, email.trim().toLowerCase())
    res.json({ email: email.trim().toLowerCase() })
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Could not sign in' })
  }
})

app.post('/api/logout', (_req, res) => {
  clearSession(res)
  res.status(204).send()
})

app.get('/api/me', (req, res) => {
  const session = readSession(req)
  res.json({ email: session?.email ?? null })
})

app.use('/api/jobs', requireAuth)

app.post('/api/jobs/import', async (req, res) => {
  try {
    const incoming = Array.isArray(req.body) ? req.body : req.body?.jobs
    if (!Array.isArray(incoming)) {
      res.status(400).json({ error: 'File must contain an array of applications' })
      return
    }
    const collection = await jobs()
    const saved: Job[] = []
    for (const item of incoming) {
      const existingId = typeof item?.id === 'string' ? parseObjectId(item.id) : null
      if (existingId) {
        const existing = await collection.findOne({ _id: existingId })
        const doc = fromBody(item, existing ?? undefined)
        await collection.replaceOne({ _id: existingId }, doc, { upsert: true })
        saved.push(toJob({ _id: existingId, ...doc }))
      } else {
        const doc = fromBody(item)
        const result = await collection.insertOne(doc)
        saved.push(toJob({ _id: result.insertedId, ...doc }))
      }
    }
    res.json(saved)
  } catch (error) {
    const message = explainMongoError(error)
    res.status(500).json({ error: message })
  }
})

app.get('/api/jobs', async (_req, res) => {
  try {
    const collection = await jobs()
    const docs = await collection.find().sort({ updatedAt: -1 }).toArray()
    res.json(docs.map(toJob))
  } catch (error) {
    res.status(500).json({ error: explainMongoError(error) })
  }
})

app.post('/api/jobs', async (req, res) => {
  try {
    const doc = fromBody(req.body)
    const collection = await jobs()
    const result = await collection.insertOne(doc)
    res.status(201).json(toJob({ _id: result.insertedId, ...doc }))
  } catch (error) {
    const message = explainMongoError(error)
    res.status(message.includes('required') ? 400 : 500).json({ error: message })
  }
})

app.put('/api/jobs/:id', async (req, res) => {
  try {
    const id = parseObjectId(String(req.params.id))
    if (!id) {
      res.status(400).json({ error: 'Invalid application id' })
      return
    }
    const collection = await jobs()
    const existing = await collection.findOne({ _id: id })
    if (!existing) {
      res.status(404).json({ error: 'Application not found' })
      return
    }
    const doc = fromBody(req.body, existing)
    await collection.replaceOne({ _id: id }, doc)
    res.json(toJob({ _id: id, ...doc }))
  } catch (error) {
    const message = explainMongoError(error)
    res.status(message.includes('required') ? 400 : 500).json({ error: message })
  }
})

app.patch('/api/jobs/:id', async (req, res) => {
  try {
    const id = parseObjectId(String(req.params.id))
    if (!id) {
      res.status(400).json({ error: 'Invalid application id' })
      return
    }
    const status = req.body?.status
    if (!isStatus(status)) {
      res.status(400).json({ error: 'Invalid status' })
      return
    }
    const collection = await jobs()
    const updatedAt = new Date().toISOString()
    const result = await collection.findOneAndUpdate(
      { _id: id },
      { $set: { status, updatedAt } },
      { returnDocument: 'after' },
    )
    if (!result) {
      res.status(404).json({ error: 'Application not found' })
      return
    }
    res.json(toJob(result))
  } catch (error) {
    res.status(500).json({ error: explainMongoError(error) })
  }
})

app.delete('/api/jobs/:id', async (req, res) => {
  try {
    const id = parseObjectId(String(req.params.id))
    if (!id) {
      res.status(400).json({ error: 'Invalid application id' })
      return
    }
    const collection = await jobs()
    const result = await collection.deleteOne({ _id: id })
    if (result.deletedCount === 0) {
      res.status(404).json({ error: 'Application not found' })
      return
    }
    res.status(204).send()
  } catch (error) {
    res.status(500).json({ error: explainMongoError(error) })
  }
})

const distDir = resolve(dirname(fileURLToPath(import.meta.url)), '../dist')
if (existsSync(distDir)) {
  app.use(express.static(distDir))
  app.use((req, res, next) => {
    if (req.path.startsWith('/api')) {
      next()
      return
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      next()
      return
    }
    res.sendFile(resolve(distDir, 'index.html'))
  })
}

export default app
