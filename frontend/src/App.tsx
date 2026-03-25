import { startTransition, useDeferredValue, useEffect, useMemo, useState } from 'react'
import type { ChangeEvent } from 'react'
import {
  createGuide,
  deleteGuides,
  downloadGuidesCsv,
  generateGuide,
  importGuides,
  listDuplicateGroups,
  listGuides,
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
import './App.css'

type ThemeMode = 'day' | 'night'
type RegionFilter = 'all' | string

type FormState = {
  courseName: string
  region: string
  courseCode: string
  greenFee: string
  bestSeason: string
  notes: string
}

type SpreadsheetSheet = unknown

type SpreadsheetBook = {
  SheetNames: string[]
  Sheets: Record<string, SpreadsheetSheet>
}

type SpreadsheetUtils = {
  sheet_to_json: (
    sheet: SpreadsheetSheet,
    options: { defval: string },
  ) => Record<string, string | number | boolean | null>[]
  json_to_sheet: (rows: Record<string, string | number>[]) => SpreadsheetSheet
  book_new: () => SpreadsheetBook
  book_append_sheet: (workbook: SpreadsheetBook, sheet: SpreadsheetSheet, name: string) => void
}

type SpreadsheetReader = {
  read: (data: ArrayBuffer, options: { type: 'array' }) => SpreadsheetBook
  writeFile: (workbook: SpreadsheetBook, filename: string) => void
  utils: SpreadsheetUtils
}

declare global {
  interface Window {
    XLSX?: SpreadsheetReader
  }
}

const THEME_KEY = 'tonysgolfy-theme'

const initialForm: FormState = {
  courseName: '',
  region: '',
  courseCode: '',
  greenFee: '1500',
  bestSeason: '',
  notes: '',
}

const emptyGuideMessage =
  '输入你的旅行偏好，例如“海景球场、适合 3 天行程、预算 3000 内”，然后点击生成。'

function toGuideInput(form: FormState): GuideInput {
  return {
    courseName: form.courseName.trim(),
    region: form.region.trim(),
    courseCode: form.courseCode.trim(),
    greenFee: Number(form.greenFee) || 0,
    bestSeason: form.bestSeason.trim(),
    notes: form.notes.trim(),
  }
}

function toFormState(record: GuideRecord): FormState {
  return {
    courseName: record.courseName,
    region: record.region,
    courseCode: record.courseCode,
    greenFee: String(record.greenFee),
    bestSeason: record.bestSeason,
    notes: record.notes,
  }
}

function loadTheme() {
  return localStorage.getItem(THEME_KEY) === 'night' ? 'night' : 'day'
}

function parseCsv(text: string) {
  const rows: string[][] = []
  let cell = ''
  let row: string[] = []
  let inQuotes = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    const next = text[index + 1]

    if (char === '"') {
      if (inQuotes && next === '"') {
        cell += '"'
        index += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }

    if (char === ',' && !inQuotes) {
      row.push(cell)
      cell = ''
      continue
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') index += 1
      row.push(cell)
      if (row.some((entry) => entry.trim() !== '')) rows.push(row)
      row = []
      cell = ''
      continue
    }

    cell += char
  }

  row.push(cell)
  if (row.some((entry) => entry.trim() !== '')) rows.push(row)

  return rows
}

function mapHeader(value: string) {
  const key = value.trim().toLowerCase().replaceAll(/[\s_-]+/g, '')
  if (['coursename', 'course', 'name', 'title'].includes(key)) return 'courseName'
  if (['region', 'city', 'country', 'destination'].includes(key)) return 'region'
  if (['coursecode', 'code', 'sku', 'courseid'].includes(key)) return 'courseCode'
  if (['greenfee', 'fee', 'price', 'rate'].includes(key)) return 'greenFee'
  if (['bestseason', 'season', 'playseason', 'besttime'].includes(key)) return 'bestSeason'
  if (['notes', 'note', 'tips', 'remark', 'details'].includes(key)) return 'notes'
  return null
}

function convertRowsToGuideInputs(rows: Record<string, string | number | boolean | null>[]) {
  return rows
    .map((row) => {
      const draft: FormState = { ...initialForm }

      Object.entries(row).forEach(([header, rawValue]) => {
        const mapped = mapHeader(header)
        if (!mapped) return
        draft[mapped] = rawValue == null ? '' : String(rawValue)
      })

      if (!draft.courseName.trim() && !draft.courseCode.trim()) return null
      return toGuideInput(draft)
    })
    .filter((guide): guide is GuideInput => guide !== null)
}

function App() {
  const [theme, setTheme] = useState<ThemeMode>(() => loadTheme())
  const [records, setRecords] = useState<GuideRecord[]>([])
  const [allRecords, setAllRecords] = useState<GuideRecord[]>([])
  const [form, setForm] = useState<FormState>(initialForm)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
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
        if (cancelled) return
        setErrorMessage(error instanceof Error ? error.message : '加载球场数据失败。')
      }
    }

    loadReferenceData()

    return () => {
      cancelled = true
    }
  }, [reloadToken])

  useEffect(() => {
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

        if (cancelled) return
        setRecords(response.guides)
      } catch (error) {
        if (cancelled) return
        setErrorMessage(error instanceof Error ? error.message : '加载列表失败。')
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    loadVisibleGuides()

    return () => {
      cancelled = true
    }
  }, [deferredSearchTerm, regionFilter, reloadToken, searchMode, sortMode])

  useEffect(() => {
    if (!activeId && allRecords.length > 0) {
      setActiveId(allRecords[0].id)
      return
    }

    if (activeId && !allRecords.some((record) => record.id === activeId)) {
      setActiveId(allRecords[0]?.id ?? null)
    }
  }, [activeId, allRecords])

  useEffect(() => {
    if (!form.courseName.trim() || !form.courseCode.trim()) {
      setDuplicatePreview([])
      return
    }

    let cancelled = false
    const timeoutId = window.setTimeout(async () => {
      try {
        const preview = await previewDuplicates(toGuideInput(form))
        if (!cancelled) setDuplicatePreview(preview)
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(error instanceof Error ? error.message : '重复检查失败。')
        }
      }
    }, 250)

    return () => {
      cancelled = true
      window.clearTimeout(timeoutId)
    }
  }, [form])

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

  async function handleAddItem() {
    if (!form.courseName.trim() || !form.courseCode.trim()) {
      setErrorMessage('至少需要填写球场名称和球场代号。')
      return
    }

    try {
      setErrorMessage('')
      const created = await createGuide(toGuideInput(form))
      setForm(initialForm)
      setActiveId(created.id)
      await refreshData()
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '录入失败。')
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
      setErrorMessage(error instanceof Error ? error.message : '删除失败。')
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
      setErrorMessage(error instanceof Error ? error.message : '保存修改失败。')
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
      setErrorMessage(error instanceof Error ? error.message : '导入失败。')
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
      setErrorMessage(error instanceof Error ? error.message : '导出失败。')
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
      setErrorMessage(error instanceof Error ? error.message : '导出 Excel 失败。')
    }
  }

  async function handleGenerateGuide() {
    try {
      setIsGeneratingGuide(true)
      setErrorMessage('')
      const guide = await generateGuide(guidePrompt, {
        search: searchTerm,
        searchMode,
        region: regionFilter,
        sort: sortMode,
      })
      setGeneratedGuide(guide)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '生成旅游攻略失败。')
    } finally {
      setIsGeneratingGuide(false)
    }
  }

  return (
    <main className="app-shell">
      <section className="hero-panel">
        <div>
          <p className="eyebrow">tonysgolfy</p>
          <h1>tonysgolfy</h1>
        </div>
        <div className="hero-actions">
          <button
            className="theme-toggle"
            type="button"
            onClick={() => setTheme((current) => (current === 'day' ? 'night' : 'day'))}
          >
            <span aria-hidden="true" className="theme-icon">
              {theme === 'day' ? '🌙' : '☀'}
            </span>
            {theme === 'day' ? '切换夜间模式' : '切换日间模式'}
          </button>
          <div className="stat-card">
            <span>攻略条目</span>
            <strong>{allRecords.length}</strong>
          </div>
          <div className="stat-card">
            <span>目的地区域</span>
            <strong>{featuredCount}</strong>
          </div>
        </div>
      </section>

      <section className="workspace-grid">
        <aside className="panel form-panel">
          <div className="panel-heading">
            <div>
              <h2>新增球场攻略</h2>
            </div>
          </div>

          <div className="field-grid">
            <label>
              球场名称
              <input
                value={form.courseName}
                onChange={(event) => updateForm('courseName', event.target.value)}
              />
            </label>
            <label>
              目的地 / 区域
              <input value={form.region} onChange={(event) => updateForm('region', event.target.value)} />
            </label>
            <label>
              球场代号
              <input
                value={form.courseCode}
                onChange={(event) => updateForm('courseCode', event.target.value)}
              />
            </label>
            <label>
              参考果岭费
              <input
                type="number"
                min="0"
                value={form.greenFee}
                onChange={(event) => updateForm('greenFee', event.target.value)}
              />
            </label>
            <label>
              最佳季节
              <input
                value={form.bestSeason}
                onChange={(event) => updateForm('bestSeason', event.target.value)}
              />
            </label>
            <label className="wide">
              旅行备注
              <textarea value={form.notes} onChange={(event) => updateForm('notes', event.target.value)} rows={4} />
            </label>
          </div>

          <div className="action-row">
            <button className="primary" type="button" onClick={handleAddItem}>
              录入攻略
            </button>
            <label className="file-button">
              导入 Excel / CSV
              <input type="file" accept=".csv,.xlsx,.xls" onChange={handleImport} />
            </label>
            <button className="ghost" type="button" onClick={handleExport}>
              导出 CSV
            </button>
            <button className="ghost" type="button" onClick={handleExportExcel}>
              导出 Excel
            </button>
          </div>

          <p className="helper-text">{importMessage}</p>
          {errorMessage ? <p className="error-text">{errorMessage}</p> : null}

          <div className="subpanel">
            <div className="subpanel-heading">
              <h3>生成旅游攻略</h3>
            </div>
            <label className="wide">
              <textarea
                value={guidePrompt}
                onChange={(event) => setGuidePrompt(event.target.value)}
                rows={4}
                placeholder="例如：海景球场，预算 3000 左右，适合 3 天短途。"
              />
            </label>
            <div className="action-row subpanel-actions">
              <button className="primary" type="button" onClick={handleGenerateGuide} disabled={isGeneratingGuide}>
                {isGeneratingGuide ? '生成中...' : '生成攻略'}
              </button>
            </div>
            <pre className="guide-output">{generatedGuide}</pre>
          </div>

          <div className="subpanel">
            <div className="subpanel-heading">
              <h3>即将录入内容的重复检查</h3>
              <span>{duplicatePreview.length} 条提醒</span>
            </div>
            {duplicatePreview.length === 0 ? (
              <p className="empty-state">当前球场攻略没有明显重复项。</p>
            ) : (
              <ul className="alert-list">
                {duplicatePreview.map(({ guide, exact, score }) => (
                  <li key={guide.id}>
                    <div>
                      <strong>{guide.courseName}</strong>
                      <span>
                        {guide.region} · {guide.courseCode}
                      </span>
                    </div>
                    <b>{exact ? '完全重复' : `相似度 ${Math.round(score * 100)}%`}</b>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="subpanel">
            <div className="subpanel-heading">
              <h3>最近导入审计</h3>
              <span>{importAudits.length} 条</span>
            </div>
            {importAudits.length === 0 ? (
              <p className="empty-state">导入后会显示球场攻略与现有内容的撞库情况。</p>
            ) : (
              <ul className="audit-list">
                {importAudits.slice(0, 6).map((audit) => (
                  <li key={audit.id}>
                    <strong>{audit.courseName}</strong>
                    <span>
                      {audit.region} · {audit.courseCode} · 完全重复 {audit.exactMatches} · 相似项 {audit.similarMatches}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>

        <section className="panel table-panel">
          <div className="panel-heading">
            <div>
              <h2>球场攻略表</h2>
            </div>
          </div>

          <div className="toolbelt">
            <label className="tool-field search-field">
              搜索
              <input
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="搜索球场、地区、季节或备注"
              />
            </label>
            <label className="tool-field">
              搜索方式
              <select value={searchMode} onChange={(event) => setSearchMode(event.target.value as SearchMode)}>
                <option value="keyword">关键词搜索</option>
                <option value="semantic">语义搜索</option>
              </select>
            </label>
            <label className="tool-field">
              Filter
              <select value={regionFilter} onChange={(event) => setRegionFilter(event.target.value)}>
                {regionOptions.map((region) => (
                  <option key={region} value={region}>
                    {region === 'all' ? '全部地区' : region}
                  </option>
                ))}
              </select>
            </label>
            <label className="tool-field">
              Sort
              <select value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)}>
                <option value="updated-desc">最近更新</option>
                <option value="updated-asc">最早更新</option>
                <option value="fee-desc">果岭费从高到低</option>
                <option value="fee-asc">果岭费从低到高</option>
                <option value="name-asc">球场名称 A-Z</option>
              </select>
            </label>
          </div>

          <div className="toolbar">
            <button className="ghost" type="button" onClick={handleSelectAll}>
              {allVisibleSelected ? '取消全选' : '全选'}
            </button>
            <button className="danger" type="button" onClick={handleDeleteSelected} disabled={selectedIds.length === 0}>
              删除选中项 {selectedIds.length > 0 ? `(${selectedIds.length})` : ''}
            </button>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th aria-label="select"></th>
                  <th>球场</th>
                  <th>区域</th>
                  <th>代号</th>
                  <th>果岭费</th>
                  <th>最佳季节</th>
                  <th>更新时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {records.map((record) => {
                  const isSelected = selectedIds.includes(record.id)
                  const isActive = activeId === record.id

                  return (
                    <tr
                      key={record.id}
                      className={isActive ? 'active-row' : undefined}
                      onClick={() => setActiveId(record.id)}
                    >
                      <td onClick={(event) => event.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleToggleSelect(record.id)}
                          aria-label={`select ${record.courseName}`}
                        />
                      </td>
                      <td>{record.courseName}</td>
                      <td>{record.region}</td>
                      <td>{record.courseCode}</td>
                      <td>¥{record.greenFee}</td>
                      <td>{record.bestSeason}</td>
                      <td>{new Date(record.updatedAt).toLocaleString()}</td>
                      <td onClick={(event) => event.stopPropagation()}>
                        <button className="ghost compact row-edit" type="button" onClick={() => startEditing(record)}>
                          修改
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {isLoading ? <div className="table-empty">正在加载球场攻略...</div> : null}
            {!isLoading && records.length === 0 ? (
              <div className="table-empty">当前搜索、筛选条件下没有匹配的球场攻略。</div>
            ) : null}
          </div>
        </section>

        <aside className="panel side-panel">
          <div className="panel-heading">
            <div>
              <h2>球场细节</h2>
            </div>
          </div>

          {activeRecord ? (
            <div className="detail-card">
              <div className="detail-header">
                <div>
                  <p className="eyebrow">精选球场</p>
                  <h3>{activeRecord.courseName}</h3>
                </div>
                <span>¥{activeRecord.greenFee}</span>
              </div>
              <dl>
                <div>
                  <dt>目的地</dt>
                  <dd>{activeRecord.region}</dd>
                </div>
                <div>
                  <dt>球场代号</dt>
                  <dd>{activeRecord.courseCode}</dd>
                </div>
                <div>
                  <dt>最佳季节</dt>
                  <dd>{activeRecord.bestSeason || '待补充'}</dd>
                </div>
                <div>
                  <dt>旅行备注</dt>
                  <dd>{activeRecord.notes || '无'}</dd>
                </div>
              </dl>
            </div>
          ) : (
            <p className="empty-state">请选择一条球场攻略。</p>
          )}

          <div className="subpanel">
            <div className="subpanel-heading">
              <h3>已录入内容的重复检查</h3>
              <span>{duplicateGroups.length} 组</span>
            </div>
            {duplicateGroups.length === 0 ? (
              <p className="empty-state">当前没有完全重复的球场攻略。</p>
            ) : (
              <ul className="duplicate-groups">
                {duplicateGroups.map((group) => (
                  <li key={group.key}>
                    <strong>{group.items[0].courseName}</strong>
                    <span>
                      {group.items[0].region} · {group.items[0].courseCode} · {group.items.length} 条重复
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </section>

      {editingId ? (
        <div className="modal-backdrop" onClick={cancelEditing}>
          <section
            className="edit-modal"
            onClick={(event) => event.stopPropagation()}
            aria-modal="true"
            role="dialog"
          >
            <div className="panel-heading">
              <div>
                <h2>修改球场数据</h2>
              </div>
            </div>

            <div className="field-grid modal-grid">
              <label>
                球场名称
                <input
                  value={editingForm.courseName}
                  onChange={(event) => updateEditingForm('courseName', event.target.value)}
                />
              </label>
              <label>
                目的地 / 区域
                <input
                  value={editingForm.region}
                  onChange={(event) => updateEditingForm('region', event.target.value)}
                />
              </label>
              <label>
                球场代号
                <input
                  value={editingForm.courseCode}
                  onChange={(event) => updateEditingForm('courseCode', event.target.value)}
                />
              </label>
              <label>
                参考果岭费
                <input
                  type="number"
                  min="0"
                  value={editingForm.greenFee}
                  onChange={(event) => updateEditingForm('greenFee', event.target.value)}
                />
              </label>
              <label>
                最佳季节
                <input
                  value={editingForm.bestSeason}
                  onChange={(event) => updateEditingForm('bestSeason', event.target.value)}
                />
              </label>
              <label className="wide">
                旅行备注
                <textarea
                  rows={8}
                  value={editingForm.notes}
                  onChange={(event) => updateEditingForm('notes', event.target.value)}
                />
              </label>
            </div>

            <div className="modal-actions">
              <button className="primary" type="button" onClick={saveEditing}>
                保存修改
              </button>
              <button className="ghost" type="button" onClick={cancelEditing}>
                取消
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  )
}

export default App
