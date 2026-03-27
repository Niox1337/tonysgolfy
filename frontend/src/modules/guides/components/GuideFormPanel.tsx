import type { ChangeEvent } from 'react'
import type { DuplicatePreviewMatch, ImportAudit } from '../../../api'
import type { FormState } from '../types'

type GuideFormPanelProps = {
  form: FormState
  guidePrompt: string
  generatedGuide: string
  importMessage: string
  errorMessage: string
  isGeneratingGuide: boolean
  duplicatePreview: DuplicatePreviewMatch[]
  importAudits: ImportAudit[]
  onUpdateForm: <K extends keyof FormState>(key: K, value: FormState[K]) => void
  onGuidePromptChange: (value: string) => void
  onAddItem: () => void
  onImport: (event: ChangeEvent<HTMLInputElement>) => Promise<void>
  onExportCsv: () => Promise<void>
  onExportExcel: () => void
  onGenerateGuide: () => Promise<void>
}

export function GuideFormPanel({
  form,
  guidePrompt,
  generatedGuide,
  importMessage,
  errorMessage,
  isGeneratingGuide,
  duplicatePreview,
  importAudits,
  onUpdateForm,
  onGuidePromptChange,
  onAddItem,
  onImport,
  onExportCsv,
  onExportExcel,
  onGenerateGuide,
}: GuideFormPanelProps) {
  return (
    <aside className="panel form-panel">
      <div className="panel-heading">
        <div>
          <h2>新增球场攻略</h2>
        </div>
      </div>

      <div className="field-grid">
        <label>
          球场名称
          <input value={form.courseName} onChange={(event) => onUpdateForm('courseName', event.target.value)} />
        </label>
        <label>
          目的地 / 区域
          <input value={form.region} onChange={(event) => onUpdateForm('region', event.target.value)} />
        </label>
        <label>
          球场代号
          <input value={form.courseCode} onChange={(event) => onUpdateForm('courseCode', event.target.value)} />
        </label>
        <label>
          参考果岭费
          <input
            type="number"
            min="0"
            value={form.greenFee}
            onChange={(event) => onUpdateForm('greenFee', event.target.value)}
          />
        </label>
        <label>
          最佳季节
          <input
            value={form.bestSeason}
            onChange={(event) => onUpdateForm('bestSeason', event.target.value)}
          />
        </label>
        <label className="wide">
          旅行备注
          <textarea value={form.notes} onChange={(event) => onUpdateForm('notes', event.target.value)} rows={4} />
        </label>
      </div>

      <div className="action-row">
        <button className="primary" type="button" onClick={onAddItem}>
          录入攻略
        </button>
        <label className="file-button">
          导入 Excel / CSV
          <input type="file" accept=".csv,.xlsx,.xls" onChange={onImport} />
        </label>
        <button className="ghost" type="button" onClick={onExportCsv}>
          导出 CSV
        </button>
        <button className="ghost" type="button" onClick={onExportExcel}>
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
            onChange={(event) => onGuidePromptChange(event.target.value)}
            rows={4}
            placeholder="例如：海景球场，预算 3000 左右，适合 3 天短途。"
          />
        </label>
        <div className="action-row subpanel-actions">
          <button className="primary" type="button" onClick={onGenerateGuide} disabled={isGeneratingGuide}>
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
                  {audit.region} · {audit.courseCode} · 完全重复 {audit.exactMatches} · 相似项{' '}
                  {audit.similarMatches}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  )
}
