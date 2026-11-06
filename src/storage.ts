import type { Job } from './types.ts'

const KEY = 'job-tracker.applications.v1'

export function loadJobs(): Job[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isJob)
  } catch {
    return []
  }
}

export function jobsToJson(jobs: Job[]): string {
  return JSON.stringify(jobs, null, 2)
}

export function jobsFromJson(raw: string): Job[] {
  const parsed = JSON.parse(raw) as unknown
  if (!Array.isArray(parsed)) throw new Error('File must contain an array of applications')
  const jobs = parsed.filter(isJob)
  if (jobs.length === 0 && parsed.length > 0) {
    throw new Error('No valid applications found in that file')
  }
  return jobs
}

function isJob(value: unknown): value is Job {
  if (!value || typeof value !== 'object') return false
  const job = value as Partial<Job>
  return typeof job.company === 'string' && typeof job.role === 'string'
}
