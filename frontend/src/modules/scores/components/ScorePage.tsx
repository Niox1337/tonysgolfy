import { useMemo, useState } from 'react'

import type { GuideRecord } from '../../../api'

export type ScoreRow = {
  id: string
  guideId: string
  courseName: string
  score: string
}

type ScorePageProps = {
  judgeName: string
  canEditJudgeName: boolean
  guides: GuideRecord[]
  rows: ScoreRow[]
  errorMessage: string
  successMessage: string
  isSubmitting: boolean
  onJudgeNameChange: (value: string) => void
  onAddRow: () => void
  onRemoveRow: (id: string) => void
  onChooseGuide: (rowId: string, guide: GuideRecord) => void
  onScoreChange: (rowId: string, value: string) => void
  onSubmit: () => Promise<void>
}

export function ScorePage({
  judgeName,
  canEditJudgeName,
  guides,
  rows,
  errorMessage,
  successMessage,
  isSubmitting,
  onJudgeNameChange,
  onAddRow,
  onRemoveRow,
  onChooseGuide,
  onScoreChange,
  onSubmit,
}: ScorePageProps) {
  const [pickerRowId, setPickerRowId] = useState<string | null>(null)
  const [pickerSearch, setPickerSearch] = useState('')

  const filteredGuides = useMemo(() => {
    const search = pickerSearch.trim().toLowerCase()
    if (!search) return guides

    return guides.filter((guide) =>
      [guide.courseName, guide.region, guide.courseCode].some((value) =>
        value.toLowerCase().includes(search),
      ),
    )
  }, [guides, pickerSearch])

  return (
    <>
      <section className="score-shell">
        <section className="panel score-panel">
          <div className="panel-heading">
            <div>
              <h2>球场评分</h2>
              <p className="helper-text">每次可提交多条球场评分。</p>
            </div>
          </div>

          <div className="field-grid">
            <label className="wide">
              评委姓名
              <input
                value={judgeName}
                readOnly={!canEditJudgeName}
                onChange={(event) => onJudgeNameChange(event.target.value)}
                placeholder="输入评委姓名"
              />
            </label>
          </div>

          <div className="score-table">
            <div className="score-row score-row-header">
              <span>球场</span>
              <span>分数</span>
              <span>操作</span>
            </div>
            {rows.map((row, index) => (
              <div className="score-row" key={row.id}>
                <button className="ghost score-picker-button" type="button" onClick={() => setPickerRowId(row.id)}>
                  {row.courseName || `选择球场 ${index + 1}`}
                </button>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  value={row.score}
                  onChange={(event) => onScoreChange(row.id, event.target.value)}
                  placeholder="0-100"
                />
                <button
                  className="ghost compact"
                  type="button"
                  onClick={() => onRemoveRow(row.id)}
                  disabled={rows.length === 1}
                >
                  删除
                </button>
              </div>
            ))}
          </div>

          <div className="action-row">
            <button className="ghost" type="button" onClick={onAddRow}>
              增加球场评分
            </button>
            <button className="primary" type="button" onClick={onSubmit} disabled={isSubmitting}>
              {isSubmitting ? '提交中...' : '提交评分'}
            </button>
          </div>

          {errorMessage ? <p className="error-text">{errorMessage}</p> : null}
          {successMessage ? <p className="success-text">{successMessage}</p> : null}
        </section>
      </section>

      {pickerRowId ? (
        <div
          className="modal-backdrop"
          onClick={() => {
            setPickerRowId(null)
            setPickerSearch('')
          }}
        >
          <section
            className="edit-modal picker-modal"
            onClick={(event) => event.stopPropagation()}
            aria-modal="true"
            role="dialog"
          >
            <div className="panel-heading">
              <div>
                <h2>选择球场</h2>
              </div>
            </div>

            <label className="tool-field search-field picker-search">
              搜索球场
              <input
                value={pickerSearch}
                onChange={(event) => setPickerSearch(event.target.value)}
                placeholder="搜索球场名、区域或代号"
              />
            </label>

            <div className="picker-list">
              {filteredGuides.map((guide) => (
                <button
                  key={guide.id}
                  className="ghost picker-option"
                  type="button"
                  onClick={() => {
                    onChooseGuide(pickerRowId, guide)
                    setPickerRowId(null)
                    setPickerSearch('')
                  }}
                >
                  <strong>{guide.courseName}</strong>
                  <span>
                    {guide.region} · {guide.courseCode}
                  </span>
                </button>
              ))}
              {filteredGuides.length === 0 ? <p className="empty-state">没有匹配的球场。</p> : null}
            </div>
          </section>
        </div>
      ) : null}
    </>
  )
}
