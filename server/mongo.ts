import { MongoClient, type Collection, type Document } from 'mongodb'

type GlobalMongo = typeof globalThis & {
  _jatMongo?: MongoClient
  _jatMongoPromise?: Promise<MongoClient>
}

function envValue(name: string): string {
  return (process.env[name] ?? '').replace(/\r/g, '').trim()
}

export function mongoUri(): string {
  return envValue('MONGODB_URI')
}

export function mongoDbName(): string {
  return envValue('MONGODB_DB') || 'job-ledger'
}

export function explainMongoError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Database unavailable'
  if (/MONGODB_URI is missing/i.test(message)) {
    return 'MONGODB_URI is missing on Vercel. Add it in Project Settings → Environment Variables, then redeploy.'
  }
  if (/whitelist|not authorized from this IP|IP address/i.test(message)) {
    return 'MongoDB Atlas blocked Vercel. In Atlas → Network Access, add 0.0.0.0/0, then retry.'
  }
  if (/authentication failed|bad auth/i.test(message)) {
    return 'MongoDB authentication failed. Check the username and password in MONGODB_URI on Vercel.'
  }
  if (/Topology is closed/i.test(message)) {
    return 'MongoDB dropped the serverless connection. Retry the page; if it persists, check Atlas Network Access (0.0.0.0/0).'
  }
  if (/querySrv|ENOTFOUND|ECONNREFUSED|ServerSelection/i.test(message)) {
    return 'Could not reach MongoDB Atlas from Vercel. Check MONGODB_URI and Atlas Network Access (allow 0.0.0.0/0).'
  }
  return message
}

async function getClient(): Promise<MongoClient> {
  const uri = mongoUri()
  if (!uri) {
    throw new Error('MONGODB_URI is missing. Add it to your environment variables.')
  }

  const cache = globalThis as GlobalMongo

  const connect = async (): Promise<MongoClient> => {
    const client = new MongoClient(uri, {
      maxPoolSize: 1,
      minPoolSize: 0,
      maxIdleTimeMS: 5000,
      serverSelectionTimeoutMS: 8000,
      connectTimeoutMS: 8000,
    })
    await client.connect()
    return client
  }

  if (!cache._jatMongoPromise) {
    cache._jatMongoPromise = connect()
  }

  try {
    const client = await cache._jatMongoPromise
    await client.db(mongoDbName()).command({ ping: 1 })
    cache._jatMongo = client
    return client
  } catch {
    cache._jatMongo = undefined
    cache._jatMongoPromise = connect()
    const client = await cache._jatMongoPromise
    cache._jatMongo = client
    return client
  }
}

export async function getCollection<T extends Document>(name: string): Promise<Collection<T>> {
  const client = await getClient()
  return client.db(mongoDbName()).collection<T>(name)
}
