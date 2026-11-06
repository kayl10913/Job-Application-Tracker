import type { Job, Status } from './types.ts'

export class AuthError extends Error {
  constructor(message = 'Please sign in.') {
    super(message)
    this.name = 'AuthError'
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
  if (res.status === 401) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new AuthError(body.error || 'Please sign in.')
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error || `Request failed (${res.status})`)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export function fetchMe(): Promise<{ email: string }> {
  return request<{ email: string }>('/api/me')
}

export function login(email: string, password: string): Promise<{ email: string }> {
  return request<{ email: string }>('/api/login', { method: 'POST', body: JSON.stringify({ email, password }) })
}

export function logout(): Promise<void> {
  return request<void>('/api/logout', { method: 'POST' })
}

export function fetchJobs(): Promise<Job[]> {
  return request<Job[]>('/api/jobs')
}

export function createJob(job: Omit<Job, 'id' | 'createdAt' | 'updatedAt'>): Promise<Job> {
  return request<Job>('/api/jobs', { method: 'POST', body: JSON.stringify(job) })
}

export function updateJob(id: string, job: Omit<Job, 'id' | 'createdAt' | 'updatedAt'>): Promise<Job> {
  return request<Job>(`/api/jobs/${id}`, { method: 'PUT', body: JSON.stringify(job) })
}

export function updateJobStatus(id: string, status: Status): Promise<Job> {
  return request<Job>(`/api/jobs/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) })
}

export function deleteJob(id: string): Promise<void> {
  return request<void>(`/api/jobs/${id}`, { method: 'DELETE' })
}

export function importRemoteJobs(jobs: Job[]): Promise<Job[]> {
  return request<Job[]>('/api/jobs/import', { method: 'POST', body: JSON.stringify(jobs) })
}
