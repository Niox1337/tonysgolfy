export type SearchMode = 'keyword' | 'semantic'
export type SortMode = 'updated-desc' | 'updated-asc' | 'fee-desc' | 'fee-asc' | 'name-asc'

export type GuideRecord = {
  id: string
  courseName: string
  region: string
  courseCode: string
  greenFee: number
  bestSeason: string
  notes: string
  updatedAt: string
}

export type GuideInput = {
  courseName: string
  region: string
  courseCode: string
  greenFee: number
  bestSeason: string
  notes: string
}

export type ImportAudit = {
  id: string
  courseName: string
  courseCode: string
  region: string
  exactMatches: number
  similarMatches: number
}

export type DuplicatePreviewMatch = {
  guide: GuideRecord
  exact: boolean
  score: number
}

export type DuplicateGroup = {
  key: string
  items: GuideRecord[]
}

export type UserRole = 'judge' | 'employee' | 'admin'
export type MailFolder = 'inbox' | 'sent' | 'drafts' | 'trash'

export type SessionUser = {
  id: string
  name: string
  email: string | null
  role: UserRole
}

export type SessionResponse = {
  authenticated: boolean
  user: SessionUser | null
}

export type UserRecord = {
  id: string
  name: string
  phone: string | null
  email: string | null
  role: UserRole
  active: boolean
  createdAt: string
  updatedAt: string
}

export type MailMessage = {
  id: string
  folder: MailFolder
  fromAddress: string
  toAddress: string
  subject: string
  body: string
  isRead: boolean
  createdAt: string
  updatedAt: string
  sentAt: string | null
  replyToMessageId: string | null
}

export type MailboxResponse = {
  address: string
  folder: MailFolder
  messages: MailMessage[]
}

export type ScoreSubmission = {
  guideId: string
  score: number
}

type GuideListResponse = {
  guides: GuideRecord[]
  total: number
}

type ImportResponse = {
  inserted: GuideRecord[]
  audits: ImportAudit[]
  insertedCount: number
  skippedCount: number
}

type GenerateGuideResponse = {
  guide: string
}

type QueryOptions = {
  search?: string
  searchMode?: SearchMode
  region?: string
  sort?: SortMode
}

export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function requestJson<T>(path: string, init?: RequestInit, timeoutMs = 15000): Promise<T> {
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs)

  let response: Response

  try {
    response = await fetch(path, {
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
      credentials: 'same-origin',
      ...init,
      signal: controller.signal,
    })
  } catch (error) {
    window.clearTimeout(timeoutId)
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('请求超时，请检查后端或外部 AI 服务是否可用。')
    }
    throw error
  }

  window.clearTimeout(timeoutId)

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null
    throw new ApiError(response.status, payload?.error ?? '请求失败。')
  }

  if (response.status === 204) {
    return undefined as T
  }

  return response.json() as Promise<T>
}

function toQueryString(options: QueryOptions) {
  const params = new URLSearchParams()

  if (options.search?.trim()) params.set('search', options.search.trim())
  if (options.searchMode) params.set('searchMode', options.searchMode)
  if (options.region && options.region !== 'all') params.set('region', options.region)
  if (options.sort) params.set('sort', options.sort)

  const query = params.toString()
  return query ? `?${query}` : ''
}

export async function listGuides(options: QueryOptions = {}) {
  return requestJson<GuideListResponse>(`/api/guides${toQueryString(options)}`)
}

export async function getSession() {
  return requestJson<SessionResponse>('/api/auth/session')
}

export async function login(identifier: string, password: string) {
  return requestJson<SessionResponse>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ identifier, password }),
  })
}

export async function logout() {
  return requestJson<SessionResponse>('/api/auth/logout', {
    method: 'POST',
  })
}

export async function changePassword(currentPassword: string, newPassword: string) {
  return requestJson<void>('/api/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword, newPassword }),
  })
}

export async function listUsers() {
  return requestJson<UserRecord[]>('/api/users')
}

export async function createUser(input: {
  name: string
  phone?: string
  email?: string
  role: UserRole
  password: string
}) {
  return requestJson<UserRecord>('/api/users', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export async function updateUser(id: string, input: {
  name: string
  phone?: string
  email?: string
  role: UserRole
}) {
  return requestJson<UserRecord>(`/api/users/${id}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  })
}

export async function deactivateUser(id: string) {
  return requestJson<UserRecord>(`/api/users/${id}/deactivate`, {
    method: 'POST',
  })
}

export async function listMailbox(folder: MailFolder) {
  return requestJson<MailboxResponse>(`/api/mail?folder=${folder}`)
}

export async function sendMail(input: {
  to: string
  subject: string
  body: string
  replyToMessageId?: string
  draftId?: string
}) {
  return requestJson<MailboxResponse>('/api/mail/send', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export async function saveDraft(input: {
  draftId?: string
  to: string
  subject: string
  body: string
  replyToMessageId?: string
}) {
  return requestJson<MailboxResponse>('/api/mail/draft', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export async function deleteMail(ids: string[]) {
  return requestJson<{ updated: number }>('/api/mail/delete', {
    method: 'POST',
    body: JSON.stringify({ ids }),
  })
}

export async function submitScores(input: { judgeName: string; scores: ScoreSubmission[] }) {
  return requestJson<{ submitted: number }>('/api/scores', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export async function createGuide(input: GuideInput) {
  return requestJson<GuideRecord>('/api/guides', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export async function updateGuide(id: string, input: GuideInput) {
  return requestJson<GuideRecord>(`/api/guides/${id}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  })
}

export async function deleteGuides(ids: string[]) {
  return requestJson<{ deleted: number }>('/api/guides/bulk-delete', {
    method: 'DELETE',
    body: JSON.stringify({ ids }),
  })
}

export async function previewDuplicates(input: GuideInput) {
  return requestJson<DuplicatePreviewMatch[]>('/api/guides/duplicate-preview', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export async function listDuplicateGroups() {
  return requestJson<DuplicateGroup[]>('/api/guides/duplicates')
}

export async function importGuides(guides: GuideInput[]) {
  return requestJson<ImportResponse>('/api/guides/import', {
    method: 'POST',
    body: JSON.stringify({ guides }),
  })
}

export async function generateGuide(prompt: string, options: QueryOptions = {}) {
  const response = await requestJson<GenerateGuideResponse>('/api/guides/generate', {
    method: 'POST',
    body: JSON.stringify({
      prompt,
      search: options.search,
      searchMode: options.searchMode,
      region: options.region === 'all' ? undefined : options.region,
      sort: options.sort,
    }),
  }, 50000)

  return response.guide
}

export async function downloadGuidesCsv(options: QueryOptions = {}) {
  const response = await fetch(`/api/guides/export.csv${toQueryString(options)}`, {
    credentials: 'same-origin',
  })

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null
    throw new ApiError(response.status, payload?.error ?? '导出失败。')
  }

  return response.blob()
}
