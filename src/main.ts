import './style.css'
import {
  AuthError,
  createJob,
  deleteJob,
  fetchJobs,
  fetchMe,
  importRemoteJobs,
  login,
  logout,
  updateJob,
  updateJobStatus,
} from './api.ts'
import { jobsFromJson, jobsToJson, loadJobs } from './storage.ts'
import { emptyJob, LIST_STATUS_ORDER, STATUSES, WORK_MODES, type Filters, type Job, type Status, type View } from './types.ts'

type State = {
  jobs: Job[]
  view: View
  filters: Filters
  editingId: string | null
  form: ReturnType<typeof emptyJob>
  error: string | null
  connected: boolean
  loading: boolean
  user: string | null
  loginError: string | null
}

const state: State = {
  jobs: [],
  view: 'board',
  filters: { query: '', status: 'All' },
  editingId: null,
  form: emptyJob(),
  error: null,
  connected: false,
  loading: true,
  user: null,
  loginError: null,
}

const app = document.querySelector<HTMLDivElement>('#app')!

let toastTimer = 0

function toastHost(): HTMLDivElement {
  let el = document.querySelector<HTMLDivElement>('#toast')
  if (!el) {
    el = document.createElement('div')
    el.id = 'toast'
    el.className = 'toast'
    el.setAttribute('role', 'status')
    el.setAttribute('aria-live', 'polite')
    document.body.append(el)
  }
  return el
}

function notify(message: string, kind: 'ok' | 'err' = 'ok'): void {
  const el = toastHost()
  el.textContent = message
  el.className = `toast show ${kind}`
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => el.classList.remove('show'), 3200)
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function startOfWeek(): Date {
  const now = new Date()
  const day = now.getDay()
  const diff = day === 0 ? 6 : day - 1
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  start.setDate(now.getDate() - diff)
  return start
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong talking to MongoDB'
}

function signedOut(error: unknown): boolean {
  if (!(error instanceof AuthError)) return false
  state.user = null
  state.jobs = []
  state.connected = false
  state.loading = false
  state.loginError = error.message
  render()
  return true
}

function compareJobs(a: Job, b: Job): number {
  const byStatus = LIST_STATUS_ORDER[a.status] - LIST_STATUS_ORDER[b.status]
  if (byStatus !== 0) return byStatus
  return (b.dateApplied || '').localeCompare(a.dateApplied || '')
}

function filteredJobs(): Job[] {
  const query = state.filters.query.trim().toLowerCase()
  return state.jobs
    .filter((job) => {
      const matchesStatus = state.filters.status === 'All' || job.status === state.filters.status
      const haystack = `${job.company} ${job.role} ${job.location} ${job.contact} ${job.notes}`.toLowerCase()
      const matchesQuery = query.length === 0 || haystack.includes(query)
      return matchesStatus && matchesQuery
    })
    .sort(compareJobs)
}

function isFollowUpDue(job: Job): boolean {
  if (!job.followUp) return false
  if (job.status === 'Rejected' || job.status === 'Withdrawn' || job.status === 'Offer') return false
  return job.followUp <= today()
}

function stats() {
  const jobs = state.jobs
  const week = startOfWeek().toISOString().slice(0, 10)
  return {
    total: jobs.length,
    appliedWeek: jobs.filter((job) => job.dateApplied && job.dateApplied >= week).length,
    interviews: jobs.filter((job) => job.status === 'Interview' || job.status === 'Screening').length,
    offers: jobs.filter((job) => job.status === 'Offer').length,
    followUps: jobs.filter(isFollowUpDue).length,
  }
}

function openForm(job?: Job): void {
  if (job) {
    state.editingId = job.id
    state.form = {
      company: job.company,
      role: job.role,
      location: job.location,
      workMode: job.workMode,
      salary: job.salary,
      status: job.status,
      dateApplied: job.dateApplied,
      followUp: job.followUp,
      url: job.url,
      contact: job.contact,
      notes: job.notes,
    }
  } else {
    state.editingId = null
    state.form = { ...emptyJob(), dateApplied: today(), status: 'Applied' }
  }
  render()
  app.querySelector<HTMLDialogElement>('#job-dialog')?.showModal()
}

function closeForm(): void {
  app.querySelector<HTMLDialogElement>('#job-dialog')?.close()
  state.editingId = null
  state.form = emptyJob()
}

async function saveForm(): Promise<void> {
  const company = state.form.company.trim()
  const role = state.form.role.trim()
  if (!company || !role) {
    app.querySelector<HTMLElement>('#form-error')?.classList.remove('hidden')
    return
  }

  const payload = { ...state.form, company, role }
  const editing = Boolean(state.editingId)
  try {
    if (state.editingId) {
      const saved = await updateJob(state.editingId, payload)
      state.jobs = state.jobs.map((job) => (job.id === saved.id ? saved : job))
    } else {
      const saved = await createJob(payload)
      state.jobs = [saved, ...state.jobs]
    }
    state.error = null
    closeForm()
    render()
    notify(editing ? 'Application updated.' : 'Application added.')
  } catch (error) {
    if (signedOut(error)) return
    state.error = messageOf(error)
    render()
    app.querySelector<HTMLDialogElement>('#job-dialog')?.showModal()
    notify(state.error, 'err')
  }
}

async function deleteCurrent(): Promise<void> {
  if (!state.editingId) return
  if (!confirm('Remove this application from your tracker?')) return
  try {
    await deleteJob(state.editingId)
    state.jobs = state.jobs.filter((job) => job.id !== state.editingId)
    state.error = null
    closeForm()
    render()
    notify('Application deleted.')
  } catch (error) {
    if (signedOut(error)) return
    state.error = messageOf(error)
    render()
    app.querySelector<HTMLDialogElement>('#job-dialog')?.showModal()
    notify(state.error, 'err')
  }
}

async function moveJob(id: string, status: Status): Promise<void> {
  const previous = state.jobs
  const job = state.jobs.find((item) => item.id === id)
  state.jobs = state.jobs.map((item) =>
    item.id === id ? { ...item, status, updatedAt: new Date().toISOString() } : item,
  )
  render()
  try {
    const saved = await updateJobStatus(id, status)
    state.jobs = state.jobs.map((item) => (item.id === saved.id ? saved : item))
    state.error = null
    notify(`${job?.role ?? 'Application'} updated to ${status}.`)
  } catch (error) {
    if (signedOut(error)) return
    state.jobs = previous
    state.error = messageOf(error)
    render()
    notify(state.error, 'err')
  }
}

function exportJobs(): void {
  const blob = new Blob([jobsToJson(state.jobs)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `job-application-tracker-${today()}.json`
  a.click()
  URL.revokeObjectURL(url)
}

function importJobs(file: File): void {
  const reader = new FileReader()
  reader.onload = () => {
    void (async () => {
      try {
        const incoming = jobsFromJson(String(reader.result))
        const saved = await importRemoteJobs(incoming)
        const byId = new Map(state.jobs.map((job) => [job.id, job]))
        for (const job of saved) byId.set(job.id, job)
        state.jobs = [...byId.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        state.error = null
        render()
        notify(`Imported ${saved.length} application${saved.length === 1 ? '' : 's'}.`)
      } catch (error) {
        if (signedOut(error)) return
        state.error = error instanceof Error ? error.message : 'Could not import that file'
        render()
        notify(state.error, 'err')
      }
    })()
  }
  reader.readAsText(file)
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function cardMarkup(job: Job): string {
  const due = isFollowUpDue(job)
  return `
    <button class="card" type="button" data-open="${job.id}" draggable="true" data-id="${job.id}">
      <h3>${escapeHtml(job.role)}</h3>
      <p class="meta">${escapeHtml(job.company)}${job.location ? ` · ${escapeHtml(job.location)}` : ''}</p>
      <div class="tags">
        ${job.workMode ? `<span class="tag">${escapeHtml(job.workMode)}</span>` : ''}
        ${job.dateApplied ? `<span class="tag">Applied ${escapeHtml(job.dateApplied)}</span>` : ''}
        ${due ? `<span class="tag due">Follow up</span>` : ''}
      </div>
    </button>
  `
}

function boardMarkup(jobs: Job[]): string {
  return `
    <section class="board" aria-label="Application board">
      ${STATUSES.map((status) => {
        const columnJobs = jobs.filter((job) => job.status === status)
        return `
          <article class="column" data-drop-status="${status}">
            <div class="column-head">
              <h2>${status}</h2>
              <span class="count">${columnJobs.length}</span>
            </div>
            <div class="cards">
              ${columnJobs.map(cardMarkup).join('') || '<p class="empty">Drop here</p>'}
            </div>
          </article>
        `
      }).join('')}
    </section>
  `
}

function listMarkup(jobs: Job[]): string {
  if (jobs.length === 0) {
    return `<section class="table-wrap"><div class="empty"><h2>Nothing matches</h2><p>Try a different search or status filter.</p></div></section>`
  }
  return `
    <section class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Role</th>
            <th>Company</th>
            <th>Status</th>
            <th>Location</th>
            <th>Applied</th>
            <th>Follow-up</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${jobs
            .map(
              (job) => `
            <tr>
              <td><button class="linkish" type="button" data-open="${job.id}">${escapeHtml(job.role)}</button></td>
              <td>${escapeHtml(job.company)}</td>
              <td>
                <select class="status-select" data-status-id="${job.id}" aria-label="Update status for ${escapeHtml(job.role)}">
                  ${STATUSES.map((status) => `<option ${job.status === status ? 'selected' : ''}>${status}</option>`).join('')}
                </select>
              </td>
              <td>${escapeHtml(job.location || '—')}</td>
              <td>${escapeHtml(job.dateApplied || '—')}</td>
              <td>${isFollowUpDue(job) ? `<strong>${escapeHtml(job.followUp)}</strong>` : escapeHtml(job.followUp || '—')}</td>
              <td>${job.url ? `<a class="linkish" href="${escapeHtml(job.url)}" target="_blank" rel="noreferrer">Posting</a>` : ''}</td>
            </tr>
          `,
            )
            .join('')}
        </tbody>
      </table>
    </section>
  `
}

function formValue(field: keyof ReturnType<typeof emptyJob>): string {
  return escapeHtml(String(state.form[field] ?? ''))
}

function dialogMarkup(): string {
  const isEdit = Boolean(state.editingId)
  return `
    <dialog id="job-dialog">
      <form class="modal" id="job-form">
        <h2>${isEdit ? 'Edit application' : 'New application'}</h2>
        <p id="form-error" class="hidden" style="color: var(--danger); margin-top: 0;">Company and role are required.</p>
        <div class="grid">
          <label class="field">
            <span>Company</span>
            <input name="company" value="${formValue('company')}" required />
          </label>
          <label class="field">
            <span>Role</span>
            <input name="role" value="${formValue('role')}" required />
          </label>
          <label class="field">
            <span>Location</span>
            <input name="location" value="${formValue('location')}" />
          </label>
          <label class="field">
            <span>Work mode</span>
            <select name="workMode">
              <option value=""></option>
              ${WORK_MODES.map((mode) => `<option ${state.form.workMode === mode ? 'selected' : ''}>${mode}</option>`).join('')}
            </select>
          </label>
          <label class="field">
            <span>Status</span>
            <select name="status">
              ${STATUSES.map((status) => `<option ${state.form.status === status ? 'selected' : ''}>${status}</option>`).join('')}
            </select>
          </label>
          <label class="field">
            <span>Salary</span>
            <input name="salary" value="${formValue('salary')}" placeholder="e.g. 95k–110k" />
          </label>
          <label class="field">
            <span>Date applied</span>
            <input name="dateApplied" type="date" value="${formValue('dateApplied')}" />
          </label>
          <label class="field">
            <span>Follow-up</span>
            <input name="followUp" type="date" value="${formValue('followUp')}" />
          </label>
          <label class="field">
            <span>Job URL</span>
            <input name="url" type="url" value="${formValue('url')}" placeholder="https://" />
          </label>
          <label class="field">
            <span>Contact</span>
            <input name="contact" value="${formValue('contact')}" placeholder="Recruiter or hiring manager" />
          </label>
          <label class="field wide">
            <span>Notes</span>
            <textarea name="notes">${formValue('notes')}</textarea>
          </label>
        </div>
        <div class="modal-actions">
          <div>${isEdit ? `<button class="btn ghost" type="button" id="delete-job">Delete</button>` : ''}</div>
          <div>
            <button class="btn ghost" type="button" id="cancel-job">Cancel</button>
            <button class="btn primary" type="submit">Save</button>
          </div>
        </div>
      </form>
    </dialog>
  `
}

function loginMarkup(): string {
  return `
    <div class="shell login-shell">
      <form class="login-card" id="login-form">
        <div class="brand">
          <div class="mark">JA</div>
          <div>
            <h1>Job Application Tracker</h1>
            <p>Sign in with your email and password.</p>
          </div>
        </div>
        ${state.loginError ? `<p class="banner">${escapeHtml(state.loginError)}</p>` : ''}
        <label class="field">
          <span>Email</span>
          <input name="email" type="email" autocomplete="username" required />
        </label>
        <label class="field">
          <span>Password</span>
          <input name="password" type="password" autocomplete="current-password" required />
        </label>
        <button class="btn primary" type="submit">Sign in</button>
      </form>
    </div>
  `
}

function render(): void {
  if (!state.loading && !state.user) {
    app.innerHTML = loginMarkup()
    app.querySelector('#login-form')?.addEventListener('submit', (event) => {
      event.preventDefault()
      const form = event.currentTarget as HTMLFormElement
      const data = new FormData(form)
      void signIn(String(data.get('email') ?? ''), String(data.get('password') ?? ''))
    })
    return
  }

  const snapshot = stats()
  const jobs = filteredJobs()
  const empty = state.jobs.length === 0

  app.innerHTML = `
    <div class="shell">
      <header class="topbar">
        <div class="brand">
          <div class="mark">JA</div>
          <div>
            <h1>Job Application Tracker</h1>
            <p>Track roles from saved to offer without losing the thread.</p>
          </div>
        </div>
        <div class="toolbar">
          <span class="db-pill ${state.connected ? 'ok' : 'bad'}" title="${state.connected ? 'Connected' : escapeHtml(state.error || 'MongoDB offline')}">${state.connected ? 'MongoDB connected' : 'MongoDB offline'}</span>
          ${state.user ? `<span class="db-pill">${escapeHtml(state.user)}</span>` : ''}
          <button class="btn ghost" type="button" id="logout">Log out</button>
          <button class="btn ghost" type="button" id="export-jobs">Export</button>
          <button class="btn ghost" type="button" id="import-jobs">Import</button>
          <input class="file-input" id="import-file" type="file" accept="application/json" />
          <button class="btn primary" type="button" id="add-job">Add application</button>
        </div>
      </header>

      ${state.error ? `<div class="banner">${escapeHtml(state.error)}</div>` : ''}

      <section class="stats">
        <article class="stat"><span>Total</span><strong>${snapshot.total}</strong></article>
        <article class="stat"><span>Applied this week</span><strong>${snapshot.appliedWeek}</strong></article>
        <article class="stat"><span>In process</span><strong>${snapshot.interviews}</strong></article>
        <article class="stat"><span>Offers</span><strong>${snapshot.offers}</strong></article>
        <article class="stat ${snapshot.followUps ? 'alert' : ''}"><span>Follow-ups due</span><strong>${snapshot.followUps}</strong></article>
      </section>

      <div class="controls">
        <input class="search" id="search" placeholder="Search company, role, notes…" value="${escapeHtml(state.filters.query)}" />
        <select id="status-filter" class="search" style="flex: 0 0 160px">
          <option ${state.filters.status === 'All' ? 'selected' : ''}>All</option>
          ${STATUSES.map((status) => `<option ${state.filters.status === status ? 'selected' : ''}>${status}</option>`).join('')}
        </select>
        <div class="segmented" role="tablist">
          <button type="button" data-view="board" class="${state.view === 'board' ? 'active' : ''}">Board</button>
          <button type="button" data-view="list" class="${state.view === 'list' ? 'active' : ''}">List</button>
        </div>
      </div>

      ${
        state.loading
          ? `<section class="table-wrap"><div class="empty"><h2>Loading</h2><p>Checking your session…</p></div></section>`
          : empty
            ? `<section class="table-wrap"><div class="empty"><h2>Your tracker is empty</h2><p>Add the first role you’re chasing. New entries are saved to MongoDB.</p></div></section>`
            : state.view === 'board'
              ? boardMarkup(jobs)
              : listMarkup(jobs)
      }
      ${dialogMarkup()}
    </div>
  `

  bind()
}

function readForm(form: HTMLFormElement): void {
  const data = new FormData(form)
  state.form.company = String(data.get('company') ?? '')
  state.form.role = String(data.get('role') ?? '')
  state.form.location = String(data.get('location') ?? '')
  state.form.workMode = (String(data.get('workMode') ?? '') as Job['workMode']) || ''
  state.form.status = String(data.get('status') ?? 'Saved') as Status
  state.form.salary = String(data.get('salary') ?? '')
  state.form.dateApplied = String(data.get('dateApplied') ?? '')
  state.form.followUp = String(data.get('followUp') ?? '')
  state.form.url = String(data.get('url') ?? '')
  state.form.contact = String(data.get('contact') ?? '')
  state.form.notes = String(data.get('notes') ?? '')
}

function bind(): void {
  app.querySelector('#logout')?.addEventListener('click', () => {
    void signOut()
  })
  app.querySelector('#add-job')?.addEventListener('click', () => openForm())
  app.querySelector('#export-jobs')?.addEventListener('click', exportJobs)
  app.querySelector('#import-jobs')?.addEventListener('click', () => {
    app.querySelector<HTMLInputElement>('#import-file')?.click()
  })
  app.querySelector('#import-file')?.addEventListener('change', (event) => {
    const file = (event.target as HTMLInputElement).files?.[0]
    if (file) importJobs(file)
  })

  app.querySelector('#search')?.addEventListener('input', (event) => {
    state.filters.query = (event.target as HTMLInputElement).value
    const jobs = filteredJobs()
    const target = app.querySelector('.board, .table-wrap')
    if (!target) return
    target.outerHTML = state.view === 'board' ? boardMarkup(jobs) : listMarkup(jobs)
    bindBoard()
    bindOpeners()
    bindStatusSelects()
  })

  app.querySelector('#status-filter')?.addEventListener('change', (event) => {
    const value = (event.target as HTMLSelectElement).value
    state.filters.status = value === 'All' ? 'All' : (value as Status)
    render()
  })

  app.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((button) => {
    button.addEventListener('click', () => {
      state.view = button.dataset.view as View
      render()
    })
  })

  bindOpeners()
  bindBoard()
  bindStatusSelects()

  const form = app.querySelector<HTMLFormElement>('#job-form')
  form?.addEventListener('submit', (event) => {
    event.preventDefault()
    readForm(form)
    void saveForm()
  })
  app.querySelector('#cancel-job')?.addEventListener('click', closeForm)
  app.querySelector('#delete-job')?.addEventListener('click', () => {
    void deleteCurrent()
  })
  app.querySelector('#job-dialog')?.addEventListener('close', () => {
    state.editingId = null
  })
}

function bindStatusSelects(): void {
  app.querySelectorAll<HTMLSelectElement>('[data-status-id]').forEach((select) => {
    select.addEventListener('change', () => {
      const id = select.dataset.statusId
      const status = select.value as Status
      if (id) void moveJob(id, status)
    })
  })
}

function bindOpeners(): void {
  app.querySelectorAll<HTMLElement>('[data-open]').forEach((el) => {
    el.addEventListener('click', () => {
      const job = state.jobs.find((item) => item.id === el.dataset.open)
      if (job) openForm(job)
    })
  })
}

function bindBoard(): void {
  app.querySelectorAll<HTMLElement>('[draggable="true"]').forEach((card) => {
    card.addEventListener('dragstart', (event) => {
      event.dataTransfer?.setData('text/plain', card.dataset.id ?? '')
      event.dataTransfer?.setDragImage(card, 20, 20)
    })
  })

  app.querySelectorAll<HTMLElement>('[data-drop-status]').forEach((column) => {
    column.addEventListener('dragover', (event) => {
      event.preventDefault()
      column.classList.add('drop-target')
    })
    column.addEventListener('dragleave', () => column.classList.remove('drop-target'))
    column.addEventListener('drop', (event) => {
      event.preventDefault()
      column.classList.remove('drop-target')
      const id = event.dataTransfer?.getData('text/plain')
      const status = column.dataset.dropStatus as Status
      if (id) void moveJob(id, status)
    })
  })
}

async function loadTracker(): Promise<void> {
  const remote = await fetchJobs()
  const local = loadJobs()
  state.jobs = remote.length === 0 && local.length > 0 ? await importRemoteJobs(local) : remote
  state.connected = true
  state.error = null
}

async function signIn(email: string, password: string): Promise<void> {
  try {
    const me = await login(email, password)
    state.user = me.email
    state.loginError = null
    state.loading = true
    render()
    await loadTracker()
  } catch (error) {
    if (state.user) {
      state.connected = false
      state.error = messageOf(error)
    } else {
      state.loginError = messageOf(error)
    }
  } finally {
    state.loading = false
    render()
  }
}

async function signOut(): Promise<void> {
  try {
    await logout()
  } catch {
    // Still clear the local session.
  }
  state.user = null
  state.jobs = []
  state.connected = false
  state.loginError = null
  render()
  notify('Signed out.')
}

async function boot(): Promise<void> {
  render()
  try {
    const me = await fetchMe()
    state.user = me.email
    await loadTracker()
  } catch (error) {
    if (error instanceof AuthError) {
      state.user = null
    } else {
      state.connected = false
      state.error = messageOf(error)
    }
  } finally {
    state.loading = false
    render()
  }
}

void boot()
