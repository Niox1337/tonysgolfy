import { startTransition, useEffect, useMemo, useState } from 'react'
import type { ChangeEvent } from 'react'
import './App.css'

type ThemeMode = 'day' | 'night'
type SearchMode = 'keyword' | 'semantic'
type RegionFilter = 'all' | string
type SortMode = 'updated-desc' | 'updated-asc' | 'fee-desc' | 'fee-asc' | 'name-asc'

type GuideRecord = {
  id: string
  courseName: string
  region: string
  courseCode: string
  greenFee: number
  bestSeason: string
  notes: string
  updatedAt: string
}

type ImportAudit = {
  id: string
  courseName: string
  courseCode: string
  region: string
  exactMatches: number
  similarMatches: number
}

type DuplicateGroup = {
  key: string
  items: GuideRecord[]
}

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
}

type SpreadsheetReader = {
  read: (data: ArrayBuffer, options: { type: 'array' }) => SpreadsheetBook
  utils: SpreadsheetUtils
}

declare global {
  interface Window {
    XLSX?: SpreadsheetReader
  }
}

const STORAGE_KEY = 'tonysgolfy-guide-records'
const THEME_KEY = 'tonysgolfy-theme'

const initialForm: FormState = {
  courseName: '',
  region: '',
  courseCode: '',
  greenFee: '1500',
  bestSeason: '',
  notes: '',
}

const seedRecords: GuideRecord[] = [
  {
    id: crypto.randomUUID(),
    courseName: 'Mission Hills Blackstone',
    region: 'Shenzhen, China',
    courseCode: 'CN-SZX-BLK',
    greenFee: 2380,
    bestSeason: 'October to December',
    notes: '适合安排 2 天游玩，球场维护优秀，建议住度假酒店。',
    updatedAt: new Date().toISOString(),
  },
  {
    id: crypto.randomUUID(),
    courseName: 'Sentosa Serapong',
    region: 'Singapore',
    courseCode: 'SG-SEN-SRP',
    greenFee: 3100,
    bestSeason: 'February to April',
    notes: '适合城市高尔夫短途，夜间餐厅选择多，机场交通方便。',
    updatedAt: new Date().toISOString(),
  },
  {
    id: crypto.randomUUID(),
    courseName: 'Cape Kidnappers',
    region: 'Hawke’s Bay, New Zealand',
    courseCode: 'NZ-HKB-CPK',
    greenFee: 4200,
    bestSeason: 'November to March',
    notes: '悬崖海景极强，适合做高端目的地专题，建议自驾。',
    updatedAt: new Date().toISOString(),
  },
  {
    id: crypto.randomUUID(),
    courseName: 'Mission Hills Blackstone',
    region: 'Shenzhen, China',
    courseCode: 'CN-SZX-BLK',
    greenFee: 2280,
    bestSeason: 'October to December',
    notes: '重复样例，用于演示球场攻略去重审计。',
    updatedAt: new Date().toISOString(),
  },
]

function normalizeValue(value: string) {
  return value.trim().toLowerCase()
}

function buildFingerprint(item: Pick<GuideRecord, 'courseName' | 'region' | 'courseCode'>) {
  return [item.courseName, item.region, item.courseCode].map(normalizeValue).join('::')
}

function scoreSimilarity(
  left: Pick<GuideRecord, 'courseName' | 'region' | 'courseCode' | 'bestSeason' | 'notes'>,
  right: Pick<GuideRecord, 'courseName' | 'region' | 'courseCode' | 'bestSeason' | 'notes'>,
) {
  let score = 0
  if (normalizeValue(left.courseName) === normalizeValue(right.courseName)) score += 0.4
  if (normalizeValue(left.courseCode) === normalizeValue(right.courseCode)) score += 0.25
  if (normalizeValue(left.region) === normalizeValue(right.region)) score += 0.15
  if (normalizeValue(left.bestSeason) === normalizeValue(right.bestSeason)) score += 0.1
  if (normalizeValue(left.notes) && normalizeValue(right.notes) && normalizeValue(left.notes) === normalizeValue(right.notes)) {
    score += 0.1
  }
  return score
}

function semanticScore(record: GuideRecord, query: string) {
  const terms = normalizeValue(query)
    .split(/\s+/)
    .filter(Boolean)

  if (terms.length === 0) return 1

  const haystacks = {
    courseName: normalizeValue(record.courseName),
    region: normalizeValue(record.region),
    courseCode: normalizeValue(record.courseCode),
    bestSeason: normalizeValue(record.bestSeason),
    notes: normalizeValue(record.notes),
  }

  let score = 0

  terms.forEach((term) => {
    if (haystacks.courseName.includes(term)) score += 0.35
    if (haystacks.region.includes(term)) score += 0.25
    if (haystacks.courseCode.includes(term)) score += 0.15
    if (haystacks.bestSeason.includes(term)) score += 0.15
    if (haystacks.notes.includes(term)) score += 0.1
    if (term === '海景' && (haystacks.notes.includes('海') || haystacks.notes.includes('悬崖'))) score += 0.35
    if (term === '度假' && (haystacks.notes.includes('酒店') || haystacks.notes.includes('度假'))) score += 0.35
    if (term === '短途' && (haystacks.region.includes('singapore') || haystacks.notes.includes('机场'))) score += 0.35
  })

  return score / terms.length
}

function toRecord(form: FormState): GuideRecord {
  return {
    id: crypto.randomUUID(),
    courseName: form.courseName.trim(),
    region: form.region.trim(),
    courseCode: form.courseCode.trim(),
    greenFee: Number(form.greenFee) || 0,
    bestSeason: form.bestSeason.trim(),
    notes: form.notes.trim(),
    updatedAt: new Date().toISOString(),
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
  const key = normalizeValue(value).replaceAll(/[\s_-]+/g, '')
  if (['coursename', 'course', 'name', 'title'].includes(key)) return 'courseName'
  if (['region', 'city', 'country', 'destination'].includes(key)) return 'region'
  if (['coursecode', 'code', 'sku', 'courseid'].includes(key)) return 'courseCode'
  if (['greenfee', 'fee', 'price', 'rate'].includes(key)) return 'greenFee'
  if (['bestseason', 'season', 'playseason', 'besttime'].includes(key)) return 'bestSeason'
  if (['notes', 'note', 'tips', 'remark', 'details'].includes(key)) return 'notes'
  return null
}

function convertRowsToRecords(rows: Record<string, string | number | boolean | null>[]) {
  return rows
    .map((row) => {
      const draft: FormState = { ...initialForm }

      Object.entries(row).forEach(([header, rawValue]) => {
        const mapped = mapHeader(header)
        if (!mapped) return
        draft[mapped] = rawValue == null ? '' : String(rawValue)
      })

      if (!draft.courseName.trim() && !draft.courseCode.trim()) return null
      return toRecord(draft)
    })
    .filter((item): item is GuideRecord => item !== null)
}

function getCsvExport(records: GuideRecord[]) {
  const headers = ['courseName', 'region', 'courseCode', 'greenFee', 'bestSeason', 'notes', 'updatedAt']
  const escape = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`
  const lines = records.map((record) =>
    [
      record.courseName,
      record.region,
      record.courseCode,
      record.greenFee,
      record.bestSeason,
      record.notes,
      record.updatedAt,
    ]
      .map(escape)
      .join(','),
  )

  return [headers.join(','), ...lines].join('\n')
}

function loadInitialRecords() {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (!stored) return seedRecords

  try {
    const parsed = JSON.parse(stored) as GuideRecord[]
    return parsed.length > 0 ? parsed : seedRecords
  } catch {
    return seedRecords
  }
}

function loadTheme() {
  return localStorage.getItem(THEME_KEY) === 'night' ? 'night' : 'day'
}

function buildTravelGuide(prompt: string, records: GuideRecord[]) {
  if (!prompt.trim()) {
    return '输入你的旅行偏好，例如“海景球场、适合 3 天行程、预算 3000 内”，系统会基于当前球场库生成一段攻略建议。'
  }

  const ranked = [...records]
    .map((record) => ({ record, score: semanticScore(record, prompt) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 3)

  if (ranked.length === 0) {
    return `没有在当前库里找到和“${prompt}”高度相关的球场。可以先补充更多目的地资料，再重新生成攻略。`
  }

  const picks = ranked
    .map(
      ({ record }, index) =>
        `${index + 1}. ${record.courseName}，位于 ${record.region}，参考果岭费约 ¥${record.greenFee}，建议季节为 ${record.bestSeason || '待补充'}。${record.notes}`,
    )
    .join('\n')

  return `根据“${prompt}”，建议优先关注以下球场：\n${picks}\n\n行程建议：优先选择同一地区或航班直达的组合，先确认 tee time，再根据旺季情况安排酒店与交通。`
}

function App() {
  const [theme, setTheme] = useState<ThemeMode>(() => loadTheme())
  const [records, setRecords] = useState<GuideRecord[]>(() => loadInitialRecords())
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
  const [importAudits, setImportAudits] = useState<ImportAudit[]>([])
  const [importMessage, setImportMessage] = useState('导入球场攻略 CSV 或 Excel，批量建立旅行资料库。')
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem(THEME_KEY, theme)
  }, [theme])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records))
  }, [records])

  useEffect(() => {
    if (!activeId && records.length > 0) setActiveId(records[0].id)
    if (activeId && !records.some((record) => record.id === activeId)) {
      setActiveId(records[0]?.id ?? null)
    }
  }, [activeId, records])

  const activeRecord = useMemo(
    () => records.find((record) => record.id === activeId) ?? null,
    [activeId, records],
  )

  const pendingRecord = useMemo(() => toRecord(form), [form])

  const duplicatePreview = useMemo(() => {
    const fingerprint = buildFingerprint(pendingRecord)
    return records
      .map((record) => ({
        record,
        exact: buildFingerprint(record) === fingerprint,
        score: scoreSimilarity(record, pendingRecord),
      }))
      .filter((entry) => entry.exact || entry.score >= 0.45)
      .sort((left, right) => Number(right.exact) - Number(left.exact) || right.score - left.score)
      .slice(0, 5)
  }, [pendingRecord, records])

  const duplicateGroups = useMemo<DuplicateGroup[]>(() => {
    const groups = new Map<string, GuideRecord[]>()

    records.forEach((record) => {
      const key = buildFingerprint(record)
      const list = groups.get(key) ?? []
      list.push(record)
      groups.set(key, list)
    })

    return [...groups.entries()]
      .filter(([, items]) => items.length > 1)
      .map(([key, items]) => ({ key, items }))
      .sort((left, right) => right.items.length - left.items.length)
  }, [records])

  const regionOptions = useMemo(
    () => ['all', ...new Set(records.map((record) => record.region).filter(Boolean))],
    [records],
  )

  const visibleRecords = useMemo(() => {
    let next = [...records]

    if (regionFilter !== 'all') {
      next = next.filter((record) => record.region === regionFilter)
    }

    if (searchTerm.trim()) {
      const query = searchTerm.trim()
      if (searchMode === 'keyword') {
        const normalized = normalizeValue(query)
        next = next.filter((record) =>
          [record.courseName, record.region, record.courseCode, record.bestSeason, record.notes]
            .map(normalizeValue)
            .some((value) => value.includes(normalized)),
        )
      } else {
        next = next
          .map((record) => ({ record, score: semanticScore(record, query) }))
          .filter((entry) => entry.score >= 0.22)
          .sort((left, right) => right.score - left.score)
          .map((entry) => entry.record)
      }
    }

    next.sort((left, right) => {
      switch (sortMode) {
        case 'updated-asc':
          return left.updatedAt.localeCompare(right.updatedAt)
        case 'fee-desc':
          return right.greenFee - left.greenFee
        case 'fee-asc':
          return left.greenFee - right.greenFee
        case 'name-asc':
          return left.courseName.localeCompare(right.courseName)
        case 'updated-desc':
        default:
          return right.updatedAt.localeCompare(left.updatedAt)
      }
    })

    return next
  }, [records, regionFilter, searchMode, searchTerm, sortMode])

  const allVisibleSelected =
    visibleRecords.length > 0 && visibleRecords.every((record) => selectedIds.includes(record.id))
  const featuredCount = new Set(records.map((record) => normalizeValue(record.region))).size
  const generatedGuide = useMemo(() => buildTravelGuide(guidePrompt, visibleRecords), [guidePrompt, visibleRecords])

  function updateForm<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  function updateEditingForm<K extends keyof FormState>(key: K, value: FormState[K]) {
    setEditingForm((current) => ({ ...current, [key]: value }))
  }

  function handleAddItem() {
    if (!form.courseName.trim() || !form.courseCode.trim()) {
      setErrorMessage('至少需要填写球场名称和球场代号。')
      return
    }

    setErrorMessage('')

    startTransition(() => {
      const record = toRecord(form)
      setRecords((current) => [record, ...current])
      setForm(initialForm)
      setActiveId(record.id)
    })
  }

  function handleToggleSelect(id: string) {
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    )
  }

  function handleDeleteSelected() {
    if (selectedIds.length === 0) return

    startTransition(() => {
      setRecords((current) => current.filter((record) => !selectedIds.includes(record.id)))
      setSelectedIds([])
    })
  }

  function handleSelectAll() {
    const visibleIds = visibleRecords.map((record) => record.id)
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

  function saveEditing() {
    if (!editingId) return
    if (!editingForm.courseName.trim() || !editingForm.courseCode.trim()) {
      setErrorMessage('编辑时也需要填写球场名称和球场代号。')
      return
    }

    setErrorMessage('')

    startTransition(() => {
      setRecords((current) =>
        current.map((record) =>
          record.id === editingId
            ? {
                ...record,
                ...toRecord(editingForm),
                id: record.id,
                updatedAt: new Date().toISOString(),
              }
            : record,
        ),
      )
    })

    cancelEditing()
  }

  async function handleImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return

    setErrorMessage('')

    try {
      let imported: GuideRecord[] = []

      if (file.name.toLowerCase().endsWith('.csv')) {
        const text = await file.text()
        const [headers, ...lines] = parseCsv(text)
        const rows = lines.map((line) =>
          Object.fromEntries(headers.map((header, index) => [header, line[index] ?? ''])),
        )
        imported = convertRowsToRecords(rows)
      } else if (file.name.toLowerCase().endsWith('.xlsx') || file.name.toLowerCase().endsWith('.xls')) {
        if (!window.XLSX) {
          throw new Error('Excel 解析器尚未就绪，请刷新页面后重试。')
        }

        const buffer = await file.arrayBuffer()
        const workbook = window.XLSX.read(buffer, { type: 'array' })
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]]
        const rows = window.XLSX.utils.sheet_to_json(firstSheet, { defval: '' })
        imported = convertRowsToRecords(rows)
      } else {
        throw new Error('仅支持 CSV、XLSX 或 XLS 文件。')
      }

      const audits = imported.map((record) => {
        const fingerprint = buildFingerprint(record)
        const comparisons = records.map((existing) => ({
          exact: buildFingerprint(existing) === fingerprint,
          similar: scoreSimilarity(existing, record) >= 0.45,
        }))

        return {
          id: record.id,
          courseName: record.courseName,
          courseCode: record.courseCode,
          region: record.region,
          exactMatches: comparisons.filter((entry) => entry.exact).length,
          similarMatches: comparisons.filter((entry) => entry.similar).length,
        }
      })

      const filtered = imported.filter((record) =>
        !records.some((existing) => buildFingerprint(existing) === buildFingerprint(record)),
      )

      startTransition(() => {
        setImportAudits(audits)
        setRecords((current) => [...filtered, ...current])
      })

      setImportMessage(
        `已读取 ${imported.length} 条球场攻略，新增 ${filtered.length} 条，跳过 ${
          imported.length - filtered.length
        } 条完全重复内容。`,
      )
      event.target.value = ''
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '导入失败。')
      event.target.value = ''
    }
  }

  function handleExport() {
    const blob = new Blob([getCsvExport(records)], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `tonysgolfy-guides-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
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
            <strong>{records.length}</strong>
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
              导出攻略库
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
                {duplicatePreview.map(({ record, exact, score }) => (
                  <li key={record.id}>
                    <div>
                      <strong>{record.courseName}</strong>
                      <span>
                        {record.region} · {record.courseCode}
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
                {visibleRecords.map((record) => {
                  const isSelected = selectedIds.includes(record.id)
                  const isActive = activeId === record.id
                  const isEditing = editingId === record.id

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
                      {isEditing ? (
                        <>
                          <td>{record.courseName}</td>
                          <td>{record.region}</td>
                          <td>{record.courseCode}</td>
                          <td>¥{record.greenFee}</td>
                          <td>{record.bestSeason}</td>
                          <td>{new Date(record.updatedAt).toLocaleString()}</td>
                          <td onClick={(event) => event.stopPropagation()}>
                            <div className="row-actions">
                              <button className="primary compact" type="button" onClick={() => setEditingId(record.id)}>编辑中</button>
                            </div>
                          </td>
                        </>
                      ) : (
                        <>
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
                        </>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {visibleRecords.length === 0 ? (
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
