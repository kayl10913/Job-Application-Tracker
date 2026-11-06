import { app } from './app.ts'

const PORT = Number(process.env.PORT || 3001)
const uri = process.env.MONGODB_URI?.trim()

app.listen(PORT, '127.0.0.1', () => {
  if (!uri) {
    console.warn('MONGODB_URI is empty. Put your MongoDB connection string in .env')
  }
  const email = (process.env.AUTH_EMAIL ?? '').replace(/\r/g, '').trim()
  const password = (process.env.AUTH_PASSWORD ?? '').replace(/\r/g, '')
  const sessionSecret = (process.env.SESSION_SECRET ?? '').replace(/\r/g, '').trim()
  if (!email || !password || !sessionSecret) {
    console.warn('Set AUTH_EMAIL, AUTH_PASSWORD, and SESSION_SECRET in .env before signing in.')
  } else {
    console.log('Login is configured.')
  }
  console.log(`Job Application Tracker running on http://127.0.0.1:${PORT}`)
})
