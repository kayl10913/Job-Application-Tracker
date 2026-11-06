export const STATUSES = [
  'Saved',
  'Applied',
  'Screening',
  'Interview',
  'Offer',
  'Rejected',
  'Withdrawn',
] as const

export const LIST_STATUS_ORDER: Record<Status, number> = {
  Offer: 0,
  Interview: 1,
  Screening: 2,
  Applied: 3,
  Saved: 4,
  Withdrawn: 5,
  Rejected: 6,
}

export type Status = (typeof STATUSES)[number]

export const WORK_MODES = ['On-site', 'Hybrid', 'Remote'] as const
export type WorkMode = (typeof WORK_MODES)[number]

export type Job = {
  id: string
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

export type View = 'board' | 'list'

export type Filters = {
  query: string
  status: Status | 'All'
}

export const emptyJob = (): Omit<Job, 'id' | 'createdAt' | 'updatedAt'> => ({
  company: '',
  role: '',
  location: '',
  workMode: '',
  salary: '',
  status: 'Saved',
  dateApplied: '',
  followUp: '',
  url: '',
  contact: '',
  notes: '',
})
