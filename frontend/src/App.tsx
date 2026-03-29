import { startTransition, useDeferredValue, useEffect, useMemo, useState } from 'react'
import type { ChangeEvent } from 'react'
import {
  ApiError,
  createGuide,
  deleteGuides,
  downloadGuidesCsv,
  generateGuide,
  getSession,
  importGuides,
  login,
  listDuplicateGroups,
  listGuides,
  logout,
  previewDuplicates,
  updateGuide,
} from './api'
import type {
  DuplicateGroup,
  DuplicatePreviewMatch,
  GuideInput,
  GuideRecord,
  ImportAudit,
  SearchMode,
  SortMode,
} from './api'
import { LoginPage } from './modules/auth/components/LoginPage'
import { LOGIN_ROUTE, TABLE_ROUTE, navigateTo, normalizeRoute } from './modules/app/routes'
import { CreateGuideModal } from './modules/guides/components/CreateGuideModal'
import { EditGuideModal } from './modules/guides/components/EditGuideModal'
import { GuideDetailPanel } from './modules/guides/components/GuideDetailPanel'
import { GuideFormPanel } from './modules/guides/components/GuideFormPanel'
import { GuideTablePanel } from './modules/guides/components/GuideTablePanel'
import { HeroPanel } from './modules/guides/components/HeroPanel'
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
import './App.css'

function App() {
  const [theme, setTheme] = useState<ThemeMode>(() => loadTheme())
  const [currentRoute, setCurrentRoute] = useState(() => normalizeRoute(window.location.pathname))
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [isCheckingSession, setIsCheckingSession] = useState(true)
  const [isLoggingIn, setIsLoggingIn] = useState(false)
  const [loginError, setLoginError] = useState('')
  const [records, setRecords] = useState<GuideRecord[]>([])
  const [allRecords, setAllRecords] = useState<GuideRecord[]>([])
  const [form, setForm] = useState<FormState>(initialForm)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingForm, setEditingForm] = useState<FormState>(initialForm)
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
  const [isLoading, setIsLoading] = useState(true)
  const [isGeneratingGuide, setIsGeneratingGuide] = useState(false)
  const [reloadToken, setReloadToken] = useState(0)

  const deferredSearchTerm = useDeferredValue(searchTerm)

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
    let cancelled = false

    async function loadSession() {
      try {
        const session = await getSession()
        if (cancelled) return
        setIsAuthenticated(session.authenticated)
      } catch {
        if (!cancelled) {
          setIsAuthenticated(false)
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
    if (isCheckingSession) return

    const targetRoute = isAuthenticated ? TABLE_ROUTE : LOGIN_ROUTE
    const routeExists = window.location.pathname === LOGIN_ROUTE || window.location.pathname === TABLE_ROUTE
    const shouldRedirect =
      !routeExists ||
      currentRoute !== targetRoute ||
      (!isAuthenticated && currentRoute === TABLE_ROUTE) ||
      (isAuthenticated && currentRoute === LOGIN_ROUTE)

    if (shouldRedirect) {
      navigateTo(targetRoute, true)
    }
  }, [currentRoute, isAuthenticated, isCheckingSession])

  useEffect(() => {
    if (isCheckingSession || !isAuthenticated || currentRoute !== TABLE_ROUTE) {
      setIsLoading(false)
      return
    }

    let cancelled = false

    async function loadReferenceData() {
      try {
        const [guidesResponse, groupsResponse] = await Promise.all([
          listGuides(),
          listDuplicateGroups(),
        ])

        if (cancelled) return

        setAllRecords(guidesResponse.guides)
        setDuplicateGroups(groupsResponse)
        setSelectedIds((current) =>
          current.filter((id) => guidesResponse.guides.some((record) => record.id === id)),
        )
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

  const activeRecord = useMemo(
    () => allRecords.find((record) => record.id === activeId) ?? null,
    [activeId, allRecords],
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

  async function refreshData() {
    startTransition(() => {
      setReloadToken((current) => current + 1)
    })
  }

  function handleApiError(error: unknown, fallbackMessage: string) {
    if (error instanceof ApiError && error.status === 401) {
      setIsAuthenticated(false)
      setLoginError('登录状态已失效，请重新登录。')
      setErrorMessage('')
      setIsCreateModalOpen(false)
      setEditingId(null)
      return true
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

  async function handleLogin(username: string, password: string) {
    if (!username.trim() || !password.trim()) {
      return '请输入用户名和密码。'
    }

    try {
      setIsLoggingIn(true)
      setLoginError('')
      setErrorMessage('')
      const session = await login(username, password)
      setIsAuthenticated(session.authenticated)
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
      // Even if logout fails server-side, clear the client auth state so the user can re-authenticate.
    } finally {
      setIsAuthenticated(false)
      setLoginError('')
      setErrorMessage('')
      setSelectedIds([])
      setIsCreateModalOpen(false)
      setEditingId(null)
      navigateTo(LOGIN_ROUTE)
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
      <HeroPanel
        theme={theme}
        allRecordsCount={allRecords.length}
        featuredCount={featuredCount}
        onToggleTheme={() => setTheme((current) => (current === 'day' ? 'night' : 'day'))}
        onLogout={handleLogout}
      />

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
        onUpdateEditingForm={updateEditingForm}
        onSave={saveEditing}
        onCancel={cancelEditing}
      />
    </main>
  )
}

export default App
