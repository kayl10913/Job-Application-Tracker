import { MongoClient, type Collection, type Document } from 'mongodb'

type GlobalMongo = typeof globalThis & { _jatMongo?: MongoClient }

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
  if (/querySrv|ENOTFOUND|ECONNREFUSED|ServerSelection/i.test(message)) {
    return 'Could not reach MongoDB Atlas from Vercel. Check MONGODB_URI and Atlas Network Access (allow 0.0.0.0/0).'
  }
  return message
}

export async function getCollection<T extends Document>(name: string): Promise<Collection<T>> {
  const uri = mongoUri()
  if (!uri) {
    throw new Error('MONGODB_URI is missing. Add it to your environment variables.')
  }

  const cache = globalThis as GlobalMongo
  if (!cache._jatMongo) {
    cache._jatMongo = new MongoClient(uri, {
      serverSelectionTimeoutMS: 8000,
      connectTimeoutMS: 8000,
    })
    await cache._jatMongo.connect()
  }

  return cache._jatMongo.db(mongoDbName()).collection<T>(name)
}
