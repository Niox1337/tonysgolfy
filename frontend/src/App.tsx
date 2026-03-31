import { startTransition, useDeferredValue, useEffect, useMemo, useState } from 'react'
import type { ChangeEvent } from 'react'
import {
  ApiError,
  calculateCompositeScore,
  changePassword,
  createGuide,
  createUser,
  deleteMail,
  deactivateUser,
  deleteGuides,
  downloadGuidesCsv,
  generateGuide,
  getSession,
  importGuides,
  listGuideScores,
  listMailbox,
  listDuplicateGroups,
  listGuides,
  listUsers,
  login,
  logout,
  previewDuplicates,
  saveDraft,
  sendMail,
  submitScores,
  updateGuide,
  updateUser,
} from './api'
import type {
  DuplicateGroup,
  DuplicatePreviewMatch,
  GuideInput,
  GuideRecord,
  GuideScoreRecord,
  ImportAudit,
  MailFolder,
  MailMessage,
  SearchMode,
  SessionUser,
  SortMode,
  UserRecord,
  UserRole,
} from './api'
import { ChangePasswordModal } from './modules/auth/components/ChangePasswordModal'
import { LoginPage } from './modules/auth/components/LoginPage'
import { COMPOSITE_ROUTE, LOGIN_ROUTE, MAIL_ROUTE, SCORES_ROUTE, TABLE_ROUTE, USERS_ROUTE, navigateTo, normalizeRoute } from './modules/app/routes'
import { CreateGuideModal } from './modules/guides/components/CreateGuideModal'
import { EditGuideModal } from './modules/guides/components/EditGuideModal'
import { GuideDetailPanel } from './modules/guides/components/GuideDetailPanel'
import { GuideFormPanel } from './modules/guides/components/GuideFormPanel'
import { GuideTablePanel } from './modules/guides/components/GuideTablePanel'
import { HeroPanel } from './modules/guides/components/HeroPanel'
import { ComposeMailModal } from './modules/mail/components/ComposeMailModal'
import { MailPage } from './modules/mail/components/MailPage'
import { CompositeScorePage } from './modules/scores/components/CompositeScorePage'
import { ScorePage } from './modules/scores/components/ScorePage'
import type { ScoreRow } from './modules/scores/components/ScorePage'
import type { FormState, RegionFilter, ThemeMode } from './modules/guides/types'
import {
  THEME_KEY,
  convertRowsToGuideInputs,
  emptyGuideMessage,
  initialForm,
  loadTheme,
  parseCsv,
  toFormState,
  toGuideInput,
} from './modules/guides/utils'
import { UserManagementPage } from './modules/users/components/UserManagementPage'
import './App.css'

const initialCreateUserForm = {
  name: '',
  phone: '',
  email: '',
  role: 'employee' as UserRole,
  password: '',
}

const initialEditUserForm = {
  id: null as string | null,
  name: '',
  phone: '',
  email: '',
  role: 'employee' as UserRole,
}

function createScoreRow(): ScoreRow {
  return {
    id: globalThis.crypto?.randomUUID?.() ?? `score-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    guideId: '',
    courseName: '',
    score: '',
  }
}

function App() {
  const [theme, setTheme] = useState<ThemeMode>(() => loadTheme())
  const [currentRoute, setCurrentRoute] = useState(() => normalizeRoute(window.location.pathname))
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null)
  const [isCheckingSession, setIsCheckingSession] = useState(true)
  const [isLoggingIn, setIsLoggingIn] = useState(false)
  const [loginError, setLoginError] = useState('')
  const [records, setRecords] = useState<GuideRecord[]>([])
  const [allRecords, setAllRecords] = useState<GuideRecord[]>([])
  const [users, setUsers] = useState<UserRecord[]>([])
  const [mailboxAddress, setMailboxAddress] = useState('')
  const [mailFolder, setMailFolder] = useState<MailFolder>('inbox')
  const [mailMessages, setMailMessages] = useState<MailMessage[]>([])
  const [selectedMailIds, setSelectedMailIds] = useState<string[]>([])
  const [activeMailId, setActiveMailId] = useState<string | null>(null)
  const [isComposeOpen, setIsComposeOpen] = useState(false)
  const [mailError, setMailError] = useState('')
  const [composeInitial, setComposeInitial] = useState({
    draftId: undefined as string | undefined,
    to: '',
    subject: '',
    body: '',
    replyToMessageId: undefined as string | undefined,
  })
  const [form, setForm] = useState<FormState>(initialForm)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [isChangePasswordOpen, setIsChangePasswordOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingForm, setEditingForm] = useState<FormState>(initialForm)
  const [createUserForm, setCreateUserForm] = useState(initialCreateUserForm)
  const [editUserForm, setEditUserForm] = useState(initialEditUserForm)
  const [scoreJudgeName, setScoreJudgeName] = useState('')
  const [scoreRows, setScoreRows] = useState<ScoreRow[]>(() => [createScoreRow()])
  const [scoreError, setScoreError] = useState('')
  const [scoreSuccess, setScoreSuccess] = useState('')
  const [isSubmittingScores, setIsSubmittingScores] = useState(false)
  const [selectedCompositeGuideId, setSelectedCompositeGuideId] = useState<string | null>(null)
  const [guideScores, setGuideScores] = useState<GuideScoreRecord[]>([])
  const [selectedGuideScoreIds, setSelectedGuideScoreIds] = useState<string[]>([])
  const [compositeMethod, setCompositeMethod] = useState<'equal' | 'weighted' | 'ai'>('equal')
  const [compositeWeights, setCompositeWeights] = useState<Record<string, string>>({})
  const [compositeAiPrompt, setCompositeAiPrompt] = useState('')
  const [compositeError, setCompositeError] = useState('')
  const [compositeSuccess, setCompositeSuccess] = useState('')
  const [isLoadingGuideScores, setIsLoadingGuideScores] = useState(false)
  const [isCalculatingComposite, setIsCalculatingComposite] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [searchMode, setSearchMode] = useState<SearchMode>('keyword')
  const [regionFilter, setRegionFilter] = useState<RegionFilter>('all')
  const [sortMode, setSortMode] = useState<SortMode>('updated-desc')
  const [guidePrompt, setGuidePrompt] = useState('')
  const [generatedGuide, setGeneratedGuide] = useState(emptyGuideMessage)
  const [importAudits, setImportAudits] = useState<ImportAudit[]>([])
  const [duplicatePreview, setDuplicatePreview] = useState<DuplicatePreviewMatch[]>([])
  const [duplicateGroups, setDuplicateGroups] = useState<DuplicateGroup[]>([])
  const [importMessage, setImportMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [passwordChangeError, setPasswordChangeError] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isGeneratingGuide, setIsGeneratingGuide] = useState(false)
  const [reloadToken, setReloadToken] = useState(0)

  const deferredSearchTerm = useDeferredValue(searchTerm)
  const isAuthenticated = sessionUser !== null
  const isAdmin = sessionUser?.role === 'admin'
  const canUseMail = sessionUser?.role === 'employee' || sessionUser?.role === 'admin'

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem(THEME_KEY, theme)
  }, [theme])

  useEffect(() => {
    function syncRoute() {
      setCurrentRoute(normalizeRoute(window.location.pathname))
    }

    window.addEventListener('popstate', syncRoute)
    return () => window.removeEventListener('popstate', syncRoute)
  }, [])

  useEffect(() => {
    if (!isAuthenticated) {
      setIsSidebarOpen(false)
    }
  }, [isAuthenticated])

  useEffect(() => {
    setIsSidebarOpen(false)
  }, [currentRoute])

  useEffect(() => {
    if (!isSidebarOpen) return

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [isSidebarOpen])

  useEffect(() => {
    let cancelled = false

    async function loadSession() {
      try {
        const session = await getSession()
        if (cancelled) return
        setSessionUser(session.user)
      } catch {
        if (!cancelled) {
          setSessionUser(null)
        }
      } finally {
        if (!cancelled) {
          setIsCheckingSession(false)
        }
      }
    }

    loadSession()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!sessionUser) {
      setScoreJudgeName('')
      return
    }

    setScoreJudgeName(sessionUser.role === 'judge' ? sessionUser.name : '')
  }, [sessionUser])

  useEffect(() => {
    if (isCheckingSession) return

    if (!isAuthenticated) {
      if (currentRoute !== LOGIN_ROUTE) {
        navigateTo(LOGIN_ROUTE, true)
      }
      return
    }

    if (currentRoute === LOGIN_ROUTE) {
      navigateTo(TABLE_ROUTE, true)
      return
    }

    if (currentRoute === USERS_ROUTE && !isAdmin) {
      navigateTo(TABLE_ROUTE, true)
      return
    }

    if (currentRoute === MAIL_ROUTE && !canUseMail) {
      navigateTo(TABLE_ROUTE, true)
    }
  }, [canUseMail, currentRoute, isAdmin, isAuthenticated, isCheckingSession])

  useEffect(() => {
    if (
      isCheckingSession ||
      !isAuthenticated ||
      (currentRoute !== TABLE_ROUTE && currentRoute !== SCORES_ROUTE && currentRoute !== COMPOSITE_ROUTE)
    ) {
      setIsLoading(false)
      return
    }

    let cancelled = false

    async function loadReferenceData() {
      try {
        const guidesResponse = await listGuides()

        if (cancelled) return

        setAllRecords(guidesResponse.guides)
        setSelectedIds((current) =>
          current.filter((id) => guidesResponse.guides.some((record) => record.id === id)),
        )

        if (currentRoute === TABLE_ROUTE) {
          const groupsResponse = await listDuplicateGroups()
          if (cancelled) return
          setDuplicateGroups(groupsResponse)
        }
      } catch (error) {
        if (!cancelled) {
          handleApiError(error, '加载球场数据失败。')
        }
      }
    }

    loadReferenceData()

    return () => {
      cancelled = true
    }
  }, [currentRoute, isAuthenticated, isCheckingSession, reloadToken])

  useEffect(() => {
    if (isCheckingSession || !isAuthenticated || currentRoute !== TABLE_ROUTE) {
      setIsLoading(false)
      return
    }

    let cancelled = false

    async function loadVisibleGuides() {
      setIsLoading(true)

      try {
        const response = await listGuides({
          search: deferredSearchTerm,
          searchMode,
          region: regionFilter,
          sort: sortMode,
        })

        if (!cancelled) {
          setRecords(response.guides)
        }
      } catch (error) {
        if (!cancelled) {
          handleApiError(error, '加载列表失败。')
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    loadVisibleGuides()

    return () => {
      cancelled = true
    }
  }, [currentRoute, deferredSearchTerm, isAuthenticated, isCheckingSession, regionFilter, reloadToken, searchMode, sortMode])

  useEffect(() => {
    if (isCheckingSession || !isAuthenticated || currentRoute !== USERS_ROUTE || !isAdmin) {
      return
    }

    let cancelled = false

    async function loadUserData() {
      try {
        const response = await listUsers()
        if (!cancelled) {
          setUsers(response)
        }
      } catch (error) {
        if (!cancelled) {
          handleApiError(error, '加载用户列表失败。')
        }
      }
    }

    loadUserData()

    return () => {
      cancelled = true
    }
  }, [currentRoute, isAdmin, isAuthenticated, isCheckingSession, reloadToken])

  useEffect(() => {
    if (isCheckingSession || !isAuthenticated || currentRoute !== MAIL_ROUTE || !canUseMail) {
      return
    }

    let cancelled = false

    async function loadMailboxData() {
      try {
        const response = await listMailbox(mailFolder)
        if (cancelled) return
        setMailboxAddress(response.address)
        setMailMessages(response.messages)
        setSelectedMailIds((current) => current.filter((id) => response.messages.some((message) => message.id === id)))
      } catch (error) {
        if (!cancelled) {
          setMailError(error instanceof Error ? error.message : '加载邮箱失败。')
          handleApiError(error, '加载邮箱失败。')
        }
      }
    }

    loadMailboxData()

    return () => {
      cancelled = true
    }
  }, [canUseMail, currentRoute, isAuthenticated, isCheckingSession, mailFolder, reloadToken])

  useEffect(() => {
    if (isCheckingSession || !isAuthenticated || currentRoute !== TABLE_ROUTE) return

    if (!activeId && allRecords.length > 0) {
      setActiveId(allRecords[0].id)
      return
    }

    if (activeId && !allRecords.some((record) => record.id === activeId)) {
      setActiveId(allRecords[0]?.id ?? null)
    }
  }, [activeId, allRecords, currentRoute, isAuthenticated, isCheckingSession])

  useEffect(() => {
    if (currentRoute !== MAIL_ROUTE) return

    if (!activeMailId && mailMessages.length > 0) {
      setActiveMailId(mailMessages[0].id)
      return
    }

    if (activeMailId && !mailMessages.some((message) => message.id === activeMailId)) {
      setActiveMailId(mailMessages[0]?.id ?? null)
    }
  }, [activeMailId, currentRoute, mailMessages])

  useEffect(() => {
    if (isCheckingSession || !isAuthenticated || currentRoute !== TABLE_ROUTE || !isCreateModalOpen) {
      setDuplicatePreview([])
      return
    }

    if (!form.courseName.trim() || !form.courseCode.trim()) {
      setDuplicatePreview([])
      return
    }

    let cancelled = false
    const timeoutId = window.setTimeout(async () => {
      try {
        const preview = await previewDuplicates(toGuideInput(form))
        if (!cancelled) {
          setDuplicatePreview(preview)
        }
      } catch (error) {
        if (!cancelled) {
          handleApiError(error, '重复检查失败。')
        }
      }
    }, 250)

    return () => {
      cancelled = true
      window.clearTimeout(timeoutId)
    }
  }, [currentRoute, form, isAuthenticated, isCheckingSession, isCreateModalOpen])

  useEffect(() => {
    if (!isAuthenticated || currentRoute !== COMPOSITE_ROUTE || !selectedCompositeGuideId) {
      setGuideScores([])
      setSelectedGuideScoreIds([])
      return
    }

    const guideId = selectedCompositeGuideId
    let cancelled = false

    async function loadGuideScores() {
      try {
        setIsLoadingGuideScores(true)
        setCompositeError('')
        const response = await listGuideScores(guideId)
        if (cancelled) return
        setGuideScores(response.scores)
        setSelectedGuideScoreIds((current) => current.filter((id) => response.scores.some((score) => score.id === id)))
      } catch (error) {
        if (!cancelled) {
          setGuideScores([])
          setSelectedGuideScoreIds([])
          setCompositeError(error instanceof Error ? error.message : '加载评分失败。')
        }
      } finally {
        if (!cancelled) {
          setIsLoadingGuideScores(false)
        }
      }
    }

    loadGuideScores()

    return () => {
      cancelled = true
    }
  }, [currentRoute, isAuthenticated, reloadToken, selectedCompositeGuideId])

  const activeRecord = useMemo(
    () => allRecords.find((record) => record.id === activeId) ?? null,
    [activeId, allRecords],
  )
  const editingRecord = useMemo(
    () => allRecords.find((record) => record.id === editingId) ?? null,
    [allRecords, editingId],
  )

  const regionOptions = useMemo(
    () => ['all', ...new Set(allRecords.map((record) => record.region).filter(Boolean))],
    [allRecords],
  )

  const allVisibleSelected =
    records.length > 0 && records.every((record) => selectedIds.includes(record.id))
  const featuredCount = new Set(allRecords.map((record) => record.region.trim().toLowerCase())).size

  function updateForm<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  function updateEditingForm<K extends keyof FormState>(key: K, value: FormState[K]) {
    setEditingForm((current) => ({ ...current, [key]: value }))
  }

  function updateCreateUserForm(field: 'name' | 'phone' | 'email' | 'role' | 'password', value: string) {
    setCreateUserForm((current) => ({ ...current, [field]: value }))
  }

  function updateEditUserForm(field: 'name' | 'phone' | 'email' | 'role', value: string) {
    setEditUserForm((current) => ({ ...current, [field]: value }))
  }

  async function refreshData() {
    startTransition(() => {
      setReloadToken((current) => current + 1)
    })
  }

  function handleApiError(error: unknown, fallbackMessage: string) {
    if (error instanceof ApiError && error.status === 401) {
      setSessionUser(null)
      setLoginError('登录状态已失效，请重新登录。')
      setErrorMessage('')
      setPasswordChangeError('')
      setIsCreateModalOpen(false)
      setEditingId(null)
      setIsChangePasswordOpen(false)
      return true
    }

    if (error instanceof ApiError && error.status === 403 && currentRoute === USERS_ROUTE) {
      navigateTo(TABLE_ROUTE, true)
    }

    if (error instanceof ApiError && error.status === 403 && currentRoute === MAIL_ROUTE) {
      navigateTo(TABLE_ROUTE, true)
    }

    setErrorMessage(error instanceof Error ? error.message : fallbackMessage)
    return false
  }

  async function handleAddItem() {
    if (!form.courseName.trim() || !form.courseCode.trim()) {
      setErrorMessage('至少需要填写球场名称和球场代号。')
      return
    }

    try {
      setErrorMessage('')
      const created = await createGuide(toGuideInput(form))
      setForm(initialForm)
      setIsCreateModalOpen(false)
      setActiveId(created.id)
      await refreshData()
    } catch (error) {
      handleApiError(error, '录入失败。')
    }
  }

  function handleToggleSelect(id: string) {
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    )
  }

  async function handleDeleteSelected() {
    if (selectedIds.length === 0) return

    try {
      setErrorMessage('')
      await deleteGuides(selectedIds)
      setSelectedIds([])
      await refreshData()
    } catch (error) {
      handleApiError(error, '删除失败。')
    }
  }

  function handleSelectAll() {
    const visibleIds = records.map((record) => record.id)
    if (allVisibleSelected) {
      setSelectedIds((current) => current.filter((id) => !visibleIds.includes(id)))
      return
    }

    setSelectedIds((current) => [...new Set([...current, ...visibleIds])])
  }

  function startEditing(record: GuideRecord) {
    setActiveId(record.id)
    setEditingId(record.id)
    setEditingForm(toFormState(record))
  }

  function cancelEditing() {
    setEditingId(null)
    setEditingForm(initialForm)
  }

  async function saveEditing() {
    if (!editingId) return

    if (!editingForm.courseName.trim() || !editingForm.courseCode.trim()) {
      setErrorMessage('编辑时也需要填写球场名称和球场代号。')
      return
    }

    try {
      setErrorMessage('')
      await updateGuide(editingId, toGuideInput(editingForm))
      cancelEditing()
      await refreshData()
    } catch (error) {
      handleApiError(error, '保存修改失败。')
    }
  }

  async function handleImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return

    try {
      setErrorMessage('')
      let imported: GuideInput[] = []

      if (file.name.toLowerCase().endsWith('.csv')) {
        const text = await file.text()
        const [headers, ...lines] = parseCsv(text)
        const rows = lines.map((line) =>
          Object.fromEntries(headers.map((header, index) => [header, line[index] ?? ''])),
        )
        imported = convertRowsToGuideInputs(rows)
      } else if (file.name.toLowerCase().endsWith('.xlsx') || file.name.toLowerCase().endsWith('.xls')) {
        if (!window.XLSX) {
          throw new Error('Excel 解析器尚未就绪，请刷新页面后重试。')
        }

        const buffer = await file.arrayBuffer()
        const workbook = window.XLSX.read(buffer, { type: 'array' })
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]]
        const rows = window.XLSX.utils.sheet_to_json(firstSheet, { defval: '' })
        imported = convertRowsToGuideInputs(rows)
      } else {
        throw new Error('仅支持 CSV、XLSX 或 XLS 文件。')
      }

      if (imported.length === 0) {
        throw new Error('没有找到可导入的球场攻略。')
      }

      const response = await importGuides(imported)
      setImportAudits(response.audits)
      setImportMessage(
        `已读取 ${response.audits.length} 条球场攻略，新增 ${response.insertedCount} 条，跳过 ${response.skippedCount} 条完全重复内容。`,
      )
      event.target.value = ''
      await refreshData()
    } catch (error) {
      handleApiError(error, '导入失败。')
      event.target.value = ''
    }
  }

  async function handleExport() {
    try {
      setErrorMessage('')
      const blob = await downloadGuidesCsv({
        search: searchTerm,
        searchMode,
        region: regionFilter,
        sort: sortMode,
      })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `tonysgolfy-guides-${new Date().toISOString().slice(0, 10)}.csv`
      link.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      handleApiError(error, '导出失败。')
    }
  }

  function handleExportExcel() {
    try {
      setErrorMessage('')

      if (!window.XLSX) {
        throw new Error('Excel 导出组件尚未就绪，请刷新页面后重试。')
      }

      const workbook = window.XLSX.utils.book_new()
      const rows = records.map((record) => ({
        courseName: record.courseName,
        region: record.region,
        courseCode: record.courseCode,
        greenFee: record.greenFee,
        bestSeason: record.bestSeason,
        notes: record.notes,
        updatedAt: record.updatedAt,
      }))
      const sheet = window.XLSX.utils.json_to_sheet(rows)
      window.XLSX.utils.book_append_sheet(workbook, sheet, 'Guides')
      window.XLSX.writeFile(
        workbook,
        `tonysgolfy-guides-${new Date().toISOString().slice(0, 10)}.xlsx`,
      )
    } catch (error) {
      handleApiError(error, '导出 Excel 失败。')
    }
  }

  async function handleGenerateGuide() {
    try {
      setIsGeneratingGuide(true)
      setErrorMessage('')
      setGeneratedGuide('AI 正在根据你的输入和现有球场数据生成旅游攻略，请稍候...')
      const guide = await generateGuide(guidePrompt, {
        search: searchTerm,
        searchMode,
        region: regionFilter,
        sort: sortMode,
      })
      setGeneratedGuide(guide)
    } catch (error) {
      setGeneratedGuide(emptyGuideMessage)
      handleApiError(error, '生成旅游攻略失败。')
    } finally {
      setIsGeneratingGuide(false)
    }
  }

  async function handleLogin(identifier: string, password: string) {
    if (!identifier.trim() || !password.trim()) {
      return '请输入手机号或邮箱，以及密码。'
    }

    try {
      setIsLoggingIn(true)
      setLoginError('')
      setErrorMessage('')
      const session = await login(identifier, password)
      setSessionUser(session.user)
      navigateTo(TABLE_ROUTE)
      return null
    } catch (error) {
      const message = error instanceof Error ? error.message : '登录失败。'
      setLoginError(message)
      return message
    } finally {
      setIsLoggingIn(false)
    }
  }

  async function handleLogout() {
    try {
      await logout()
    } catch {
      // Ignore logout transport errors and clear local state anyway.
    } finally {
      setSessionUser(null)
      setLoginError('')
      setErrorMessage('')
      setPasswordChangeError('')
      setSelectedIds([])
      setSelectedMailIds([])
      setUsers([])
      setScoreError('')
      setScoreSuccess('')
      setScoreRows([createScoreRow()])
      setGuideScores([])
      setSelectedGuideScoreIds([])
      setCompositeError('')
      setCompositeSuccess('')
      setIsCreateModalOpen(false)
      setEditingId(null)
      setIsChangePasswordOpen(false)
      navigateTo(LOGIN_ROUTE)
    }
  }

  async function handleCreateUser() {
    try {
      setErrorMessage('')
      await createUser({
        name: createUserForm.name,
        phone: createUserForm.phone || undefined,
        email: createUserForm.email || undefined,
        role: createUserForm.role,
        password: createUserForm.password,
      })
      setCreateUserForm(initialCreateUserForm)
      await refreshData()
    } catch (error) {
      handleApiError(error, '注册用户失败。')
    }
  }

  function handleStartEditingUser(user: UserRecord) {
    setEditUserForm({
      id: user.id,
      name: user.name,
      phone: user.phone ?? '',
      email: user.email ?? '',
      role: user.role,
    })
  }

  function handleCancelEditingUser() {
    setEditUserForm(initialEditUserForm)
  }

  async function handleSaveEditingUser() {
    if (!editUserForm.id) return

    try {
      setErrorMessage('')
      await updateUser(editUserForm.id, {
        name: editUserForm.name,
        phone: editUserForm.phone || undefined,
        email: editUserForm.email || undefined,
        role: editUserForm.role,
      })
      setEditUserForm(initialEditUserForm)
      await refreshData()
    } catch (error) {
      handleApiError(error, '更新用户失败。')
    }
  }

  async function handleDeactivateUser(id: string) {
    try {
      setErrorMessage('')
      await deactivateUser(id)
      if (editUserForm.id === id) {
        setEditUserForm(initialEditUserForm)
      }
      await refreshData()
    } catch (error) {
      handleApiError(error, '注销用户失败。')
    }
  }

  async function handleChangePassword(currentPassword: string, newPassword: string) {
    try {
      setPasswordChangeError('')
      await changePassword(currentPassword, newPassword)
      return null
    } catch (error) {
      const message = error instanceof Error ? error.message : '修改密码失败。'
      setPasswordChangeError(message)
      return message
    }
  }

  function handleToggleMailSelect(id: string) {
    setSelectedMailIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    )
  }

  function handleComposeMail() {
    setMailError('')
    setComposeInitial({
      draftId: undefined,
      to: '',
      subject: '',
      body: '',
      replyToMessageId: undefined,
    })
    setIsComposeOpen(true)
  }

  function handleReplyMail(message: MailMessage) {
    setMailError('')
    setComposeInitial({
      draftId: undefined,
      to: message.fromAddress,
      subject: message.subject.startsWith('Re:') ? message.subject : `Re: ${message.subject}`,
      body: `\n\n--- 原始邮件 ---\n${message.body}`,
      replyToMessageId: message.id,
    })
    setIsComposeOpen(true)
  }

  function handleEditDraft(message: MailMessage) {
    setMailError('')
    setComposeInitial({
      draftId: message.id,
      to: message.toAddress,
      subject: message.subject,
      body: message.body,
      replyToMessageId: message.replyToMessageId ?? undefined,
    })
    setIsComposeOpen(true)
  }

  async function handleSaveDraft(input: {
    draftId?: string
    to: string
    subject: string
    body: string
    replyToMessageId?: string
  }) {
    try {
      setMailError('')
      const response = await saveDraft(input)
      setMailboxAddress(response.address)
      setMailFolder('drafts')
      setMailMessages(response.messages)
      setIsComposeOpen(false)
      setComposeInitial({
        draftId: undefined,
        to: '',
        subject: '',
        body: '',
        replyToMessageId: undefined,
      })
    } catch (error) {
      setMailError(error instanceof Error ? error.message : '保存草稿失败。')
    }
  }

  async function handleSendMail(input: {
    draftId?: string
    to: string
    subject: string
    body: string
    replyToMessageId?: string
  }) {
    try {
      setMailError('')
      const response = await sendMail(input)
      setMailboxAddress(response.address)
      setMailFolder('sent')
      setMailMessages(response.messages)
      setSelectedMailIds([])
      setIsComposeOpen(false)
      setComposeInitial({
        draftId: undefined,
        to: '',
        subject: '',
        body: '',
        replyToMessageId: undefined,
      })
    } catch (error) {
      setMailError(error instanceof Error ? error.message : '发送邮件失败。')
    }
  }

  async function handleDeleteMail() {
    if (selectedMailIds.length === 0) return

    try {
      setMailError('')
      await deleteMail(selectedMailIds)
      setSelectedMailIds([])
      await refreshData()
    } catch (error) {
      setMailError(error instanceof Error ? error.message : '删除邮件失败。')
    }
  }

  function handleAddScoreRow() {
    setScoreError('')
    setScoreSuccess('')
    setScoreRows((current) => [...current, createScoreRow()])
  }

  function handleRemoveScoreRow(id: string) {
    setScoreError('')
    setScoreSuccess('')
    setScoreRows((current) => (current.length === 1 ? current : current.filter((row) => row.id !== id)))
  }

  function handleChooseScoreGuide(rowId: string, guide: GuideRecord) {
    setScoreError('')
    setScoreSuccess('')
    setScoreRows((current) =>
      current.map((row) =>
        row.id === rowId
          ? {
              ...row,
              guideId: guide.id,
              courseName: guide.courseName,
            }
          : row,
      ),
    )
  }

  function handleScoreValueChange(rowId: string, value: string) {
    setScoreError('')
    setScoreSuccess('')
    setScoreRows((current) => current.map((row) => (row.id === rowId ? { ...row, score: value } : row)))
  }

  async function handleSubmitScores() {
    const judgeName = sessionUser?.role === 'judge' ? sessionUser.name : scoreJudgeName.trim()
    if (!judgeName) {
      setScoreError('评委姓名不能为空。')
      return
    }

    const emptyGuideRow = scoreRows.find((row) => !row.guideId)
    if (emptyGuideRow) {
      setScoreError('每一行都需要选择球场。')
      return
    }

    const invalidScoreRow = scoreRows.find((row) => {
      const score = Number(row.score)
      return !row.score.trim() || Number.isNaN(score) || score < 0 || score > 100
    })
    if (invalidScoreRow) {
      setScoreError('每一行都需要填写 0 到 100 之间的分数。')
      return
    }

    if (new Set(scoreRows.map((row) => row.guideId)).size !== scoreRows.length) {
      setScoreError('同一批提交里不能重复选择同一个球场。')
      return
    }

    try {
      setIsSubmittingScores(true)
      setScoreError('')
      setScoreSuccess('')
      const response = await submitScores({
        judgeName,
        scores: scoreRows.map((row) => ({
          guideId: row.guideId,
          score: Number(row.score),
        })),
      })
      setScoreSuccess(`已提交 ${response.submitted} 条球场评分。`)
      setScoreRows([createScoreRow()])
      if (sessionUser?.role === 'judge') {
        setScoreJudgeName(sessionUser.name)
      } else {
        setScoreJudgeName('')
      }
    } catch (error) {
      setScoreError(error instanceof Error ? error.message : '提交球场评分失败。')
    } finally {
      setIsSubmittingScores(false)
    }
  }

  function updateGuideCaches(updatedGuide: GuideRecord) {
    setAllRecords((current) => current.map((guide) => (guide.id === updatedGuide.id ? updatedGuide : guide)))
    setRecords((current) => current.map((guide) => (guide.id === updatedGuide.id ? updatedGuide : guide)))
  }

  function handleSelectCompositeGuide(guide: GuideRecord) {
    setSelectedCompositeGuideId(guide.id)
    setSelectedGuideScoreIds([])
    setCompositeWeights({})
    setCompositeAiPrompt('')
    setCompositeError('')
    setCompositeSuccess('')
  }

  function handleToggleGuideScore(scoreId: string) {
    setCompositeError('')
    setCompositeSuccess('')
    setSelectedGuideScoreIds((current) =>
      current.includes(scoreId) ? current.filter((id) => id !== scoreId) : [...current, scoreId],
    )
  }

  function handleToggleAllGuideScores() {
    if (guideScores.length === 0) return
    const allSelected = guideScores.every((score) => selectedGuideScoreIds.includes(score.id))
    setSelectedGuideScoreIds(allSelected ? [] : guideScores.map((score) => score.id))
  }

  function handleCompositeWeightChange(scoreId: string, value: string) {
    setCompositeError('')
    setCompositeSuccess('')
    setCompositeWeights((current) => ({ ...current, [scoreId]: value }))
  }

  async function handleCalculateCompositeScore() {
    if (!selectedCompositeGuideId) {
      setCompositeError('请先选择球场。')
      return
    }
    if (selectedGuideScoreIds.length === 0) {
      setCompositeError('请至少选择一条评分。')
      return
    }

    try {
      setIsCalculatingComposite(true)
      setCompositeError('')
      setCompositeSuccess('')

      const response = await calculateCompositeScore({
        guideId: selectedCompositeGuideId,
        scoreIds: selectedGuideScoreIds,
        method: compositeMethod,
        weights:
          compositeMethod === 'weighted'
            ? selectedGuideScoreIds.map((scoreId) => ({
                scoreId,
                weight: Number(compositeWeights[scoreId] ?? ''),
              }))
            : undefined,
        aiPrompt: compositeMethod === 'ai' ? compositeAiPrompt : undefined,
      })

      updateGuideCaches(response.guide)
      setCompositeSuccess(`已写入综合评分 ${response.calculatedScore}。`)
    } catch (error) {
      setCompositeError(error instanceof Error ? error.message : '计算综合评分失败。')
    } finally {
      setIsCalculatingComposite(false)
    }
  }

  if (isCheckingSession) {
    return (
      <main className="auth-shell">
        <section className="login-card loading-card">
          <h2>正在检查登录状态</h2>
          <p className="helper-text">稍候进入 tonysgolfy。</p>
        </section>
      </main>
    )
  }

  if (!isAuthenticated || currentRoute === LOGIN_ROUTE) {
    return (
      <LoginPage
        theme={theme}
        errorMessage={loginError}
        isSubmitting={isLoggingIn}
        onToggleTheme={() => setTheme((current) => (current === 'day' ? 'night' : 'day'))}
        onLogin={handleLogin}
      />
    )
  }

  return (
    <main className="app-shell">
      <button
        className="sidebar-toggle"
        type="button"
        onClick={() => setIsSidebarOpen((current) => !current)}
        aria-expanded={isSidebarOpen}
        aria-label={isSidebarOpen ? '收起侧边栏' : '展开侧边栏'}
      >
        <span aria-hidden="true">{isSidebarOpen ? '✕' : '☰'}</span>
      </button>

      {isSidebarOpen ? <button className="sidebar-backdrop" type="button" onClick={() => setIsSidebarOpen(false)} aria-label="关闭侧边栏" /> : null}

      <HeroPanel
        isOpen={isSidebarOpen}
        theme={theme}
        currentRoute={
          currentRoute === USERS_ROUTE
            ? 'users'
            : currentRoute === MAIL_ROUTE
              ? 'mail'
              : currentRoute === SCORES_ROUTE
                ? 'scores'
                : currentRoute === COMPOSITE_ROUTE
                  ? 'composite'
                : 'table'
        }
        currentUserName={sessionUser.name}
        currentUserRole={sessionUser.role}
        allRecordsCount={allRecords.length}
        featuredCount={featuredCount}
        onToggleTheme={() => setTheme((current) => (current === 'day' ? 'night' : 'day'))}
        onOpenTable={() => {
          setIsSidebarOpen(false)
          navigateTo(TABLE_ROUTE)
        }}
        onOpenScores={() => {
          setIsSidebarOpen(false)
          navigateTo(SCORES_ROUTE)
        }}
        onOpenComposite={() => {
          setIsSidebarOpen(false)
          navigateTo(COMPOSITE_ROUTE)
        }}
        onOpenUsers={() => {
          setIsSidebarOpen(false)
          navigateTo(USERS_ROUTE)
        }}
        onOpenMail={() => {
          setIsSidebarOpen(false)
          navigateTo(MAIL_ROUTE)
        }}
        onOpenChangePassword={() => {
          setPasswordChangeError('')
          setIsChangePasswordOpen(true)
          setIsSidebarOpen(false)
        }}
        onLogout={handleLogout}
      />

      <section className={`app-main${isSidebarOpen ? ' app-main-dimmed' : ''}`}>
        {currentRoute === USERS_ROUTE && isAdmin ? (
          <UserManagementPage
            users={users}
            createForm={createUserForm}
            editForm={editUserForm}
            errorMessage={errorMessage}
            onCreateFormChange={updateCreateUserForm}
            onEditFormChange={updateEditUserForm}
            onCreateUser={handleCreateUser}
            onStartEditing={handleStartEditingUser}
            onSaveEdit={handleSaveEditingUser}
            onCancelEdit={handleCancelEditingUser}
            onDeactivate={handleDeactivateUser}
          />
        ) : currentRoute === MAIL_ROUTE && canUseMail ? (
          <MailPage
            mailboxAddress={mailboxAddress || sessionUser.email || '未配置工作邮箱'}
            folder={mailFolder}
            messages={mailMessages}
            selectedIds={selectedMailIds}
            activeId={activeMailId}
            errorMessage={mailError}
            onFolderChange={(folder) => {
              setMailError('')
              setSelectedMailIds([])
              setActiveMailId(null)
              setMailFolder(folder)
            }}
            onCompose={handleComposeMail}
            onReply={handleReplyMail}
            onEditDraft={handleEditDraft}
            onDeleteSelected={handleDeleteMail}
            onToggleSelect={handleToggleMailSelect}
            onActiveChange={setActiveMailId}
          />
        ) : currentRoute === SCORES_ROUTE ? (
          <ScorePage
            judgeName={sessionUser.role === 'judge' ? sessionUser.name : scoreJudgeName}
            canEditJudgeName={sessionUser.role !== 'judge'}
            guides={allRecords}
            rows={scoreRows}
            errorMessage={scoreError}
            successMessage={scoreSuccess}
            isSubmitting={isSubmittingScores}
            onJudgeNameChange={setScoreJudgeName}
            onAddRow={handleAddScoreRow}
            onRemoveRow={handleRemoveScoreRow}
            onChooseGuide={handleChooseScoreGuide}
            onScoreChange={handleScoreValueChange}
            onSubmit={handleSubmitScores}
          />
        ) : currentRoute === COMPOSITE_ROUTE ? (
          <CompositeScorePage
            guides={allRecords}
            selectedGuideId={selectedCompositeGuideId}
            scores={guideScores}
            selectedScoreIds={selectedGuideScoreIds}
            method={compositeMethod}
            aiPrompt={compositeAiPrompt}
            weights={compositeWeights}
            errorMessage={compositeError}
            successMessage={compositeSuccess}
            isLoadingScores={isLoadingGuideScores}
            isCalculating={isCalculatingComposite}
            onGuideSelect={handleSelectCompositeGuide}
            onToggleScore={handleToggleGuideScore}
            onToggleAllScores={handleToggleAllGuideScores}
            onMethodChange={setCompositeMethod}
            onAiPromptChange={setCompositeAiPrompt}
            onWeightChange={handleCompositeWeightChange}
            onCalculate={handleCalculateCompositeScore}
          />
        ) : (
          <section className="workspace-grid">
            <GuideFormPanel
              guidePrompt={guidePrompt}
              generatedGuide={generatedGuide}
              importMessage={importMessage}
              errorMessage={errorMessage}
              isGeneratingGuide={isGeneratingGuide}
              importAudits={importAudits}
              onGuidePromptChange={setGuidePrompt}
              onOpenCreateModal={() => {
                setErrorMessage('')
                setIsCreateModalOpen(true)
              }}
              onImport={handleImport}
              onExportCsv={handleExport}
              onExportExcel={handleExportExcel}
              onGenerateGuide={handleGenerateGuide}
            />

            <GuideTablePanel
              searchTerm={searchTerm}
              searchMode={searchMode}
              regionFilter={regionFilter}
              sortMode={sortMode}
              regionOptions={regionOptions}
              records={records}
              selectedIds={selectedIds}
              activeId={activeId}
              isLoading={isLoading}
              allVisibleSelected={allVisibleSelected}
              onSearchTermChange={setSearchTerm}
              onSearchModeChange={setSearchMode}
              onRegionFilterChange={setRegionFilter}
              onSortModeChange={setSortMode}
              onSelectAll={handleSelectAll}
              onDeleteSelected={handleDeleteSelected}
              onToggleSelect={handleToggleSelect}
              onActiveChange={setActiveId}
              onStartEditing={startEditing}
            />

            <GuideDetailPanel activeRecord={activeRecord} duplicateGroups={duplicateGroups} />
          </section>
        )}
      </section>

      <ComposeMailModal
        isOpen={isComposeOpen}
        initialValues={composeInitial}
        errorMessage={mailError}
        onClose={() => {
          setIsComposeOpen(false)
          setMailError('')
        }}
        onSaveDraft={handleSaveDraft}
        onSend={handleSendMail}
      />

      <CreateGuideModal
        isOpen={isCreateModalOpen}
        form={form}
        duplicatePreview={duplicatePreview}
        onUpdateForm={updateForm}
        onSave={handleAddItem}
        onCancel={() => {
          setIsCreateModalOpen(false)
          setErrorMessage('')
        }}
      />

      <EditGuideModal
        editingId={editingId}
        editingForm={editingForm}
        compositeScore={editingRecord?.compositeScore ?? null}
        onUpdateEditingForm={updateEditingForm}
        onSave={saveEditing}
        onCancel={cancelEditing}
      />

      <ChangePasswordModal
        isOpen={isChangePasswordOpen}
        errorMessage={passwordChangeError}
        onClose={() => {
          setIsChangePasswordOpen(false)
          setPasswordChangeError('')
        }}
        onSubmit={handleChangePassword}
      />
    </main>
  )
}

export default App
