import type { ChangeEvent } from 'react'
import type { ImportAudit } from '../../../api'

type GuideFormPanelProps = {
  guidePrompt: string
  generatedGuide: string
  importMessage: string
  errorMessage: string
  isGeneratingGuide: boolean
  importAudits: ImportAudit[]
  onGuidePromptChange: (value: string) => void
  onOpenCreateModal: () => void
  onImport: (event: ChangeEvent<HTMLInputElement>) => Promise<void>
  onExportCsv: () => Promise<void>
  onExportExcel: () => void
  onGenerateGuide: () => Promise<void>
}

export function GuideFormPanel({
  guidePrompt,
  generatedGuide,
  importMessage,
  errorMessage,
  isGeneratingGuide,
  importAudits,
  onGuidePromptChange,
  onOpenCreateModal,
  onImport,
  onExportCsv,
  onExportExcel,
  onGenerateGuide,
}: GuideFormPanelProps) {
  return (
    <aside className="panel form-panel">
      <div className="panel-heading">
        <div>
          <h2>球场攻略操作台</h2>
        </div>
      </div>

      <div className="action-row">
        <button className="primary" type="button" onClick={onOpenCreateModal}>
          新增球场攻略
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
