import { useMemo, useState } from 'react'

import type { CompositeScoreMethod, GuideRecord, GuideScoreRecord } from '../../../api'

type CompositeScorePageProps = {
  guides: GuideRecord[]
  selectedGuideId: string | null
  scores: GuideScoreRecord[]
  selectedScoreIds: string[]
  method: CompositeScoreMethod
  aiPrompt: string
  weights: Record<string, string>
  errorMessage: string
  successMessage: string
  isLoadingScores: boolean
  isCalculating: boolean
  onGuideSelect: (guide: GuideRecord) => void
  onToggleScore: (scoreId: string) => void
  onToggleAllScores: () => void
  onMethodChange: (value: CompositeScoreMethod) => void
  onAiPromptChange: (value: string) => void
  onWeightChange: (scoreId: string, value: string) => void
  onCalculate: () => Promise<void>
}

export function CompositeScorePage({
  guides,
  selectedGuideId,
  scores,
  selectedScoreIds,
  method,
  aiPrompt,
  weights,
  errorMessage,
  successMessage,
  isLoadingScores,
  isCalculating,
  onGuideSelect,
  onToggleScore,
  onToggleAllScores,
  onMethodChange,
  onAiPromptChange,
  onWeightChange,
  onCalculate,
}: CompositeScorePageProps) {
  const [isPickerOpen, setIsPickerOpen] = useState(false)
  const [pickerSearch, setPickerSearch] = useState('')

  const selectedGuide = guides.find((guide) => guide.id === selectedGuideId) ?? null
  const filteredGuides = useMemo(() => {
    const search = pickerSearch.trim().toLowerCase()
    if (!search) return guides
    return guides.filter((guide) =>
      [guide.courseName, guide.region, guide.courseCode].some((value) =>
        value.toLowerCase().includes(search),
      ),
    )
  }, [guides, pickerSearch])

  const allSelected = scores.length > 0 && scores.every((score) => selectedScoreIds.includes(score.id))

  return (
    <>
      <section className="score-shell">
        <section className="panel composite-panel">
          <div className="panel-heading">
            <div>
              <h2>计算综合评分</h2>
              <p className="helper-text">先选择球场，再从现有评分中勾选参与计算的记录。</p>
            </div>
          </div>

          <div className="field-grid">
            <label className="wide">
              球场
              <button className="ghost score-picker-button" type="button" onClick={() => setIsPickerOpen(true)}>
                {selectedGuide ? selectedGuide.courseName : '选择或搜索球场'}
              </button>
            </label>
          </div>

          <div className="toolbar">
            <button className="ghost" type="button" onClick={onToggleAllScores} disabled={scores.length === 0}>
              {allSelected ? '取消全选评分' : '全选评分'}
            </button>
          </div>

          <div className="table-wrap composite-table-wrap">
            <table>
              <thead>
                <tr>
                  <th aria-label="select"></th>
                  <th>评委</th>
                  <th>操作人</th>
                  <th>分数</th>
                  <th>录入时间</th>
                  {method === 'weighted' ? <th>权重</th> : null}
                </tr>
              </thead>
              <tbody>
                {scores.map((score) => {
                  const checked = selectedScoreIds.includes(score.id)
                  return (
                    <tr key={score.id}>
                      <td>
                        <input type="checkbox" checked={checked} onChange={() => onToggleScore(score.id)} />
                      </td>
                      <td>{score.judgeName}</td>
                      <td>{score.operatorName}</td>
                      <td>{score.score}</td>
                      <td>{new Date(score.createdAt).toLocaleString()}</td>
                      {method === 'weighted' ? (
                        <td>
                          <input
                            type="number"
                            min="0"
                            max="1"
                            step="0.01"
                            value={weights[score.id] ?? ''}
                            disabled={!checked}
                            onChange={(event) => onWeightChange(score.id, event.target.value)}
                            placeholder="0.00"
                          />
                        </td>
                      ) : null}
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {isLoadingScores ? <div className="table-empty">正在加载评分记录...</div> : null}
            {!isLoadingScores && selectedGuide && scores.length === 0 ? (
              <div className="table-empty">这个球场还没有评分记录。</div>
            ) : null}
            {!isLoadingScores && !selectedGuide ? (
              <div className="table-empty">先选择球场，再查看评分记录。</div>
            ) : null}
          </div>

          <div className="field-grid composite-method-grid">
            <label>
              计算方式
              <select value={method} onChange={(event) => onMethodChange(event.target.value as CompositeScoreMethod)}>
                <option value="equal">平局评分</option>
                <option value="weighted">加权评分</option>
                <option value="ai">AI 计算</option>
              </select>
            </label>
            <label>
              当前综合评分
              <input readOnly value={selectedGuide?.compositeScore == null ? 'N/A' : selectedGuide.compositeScore} />
            </label>
            {method === 'ai' ? (
              <label className="wide">
                AI 计算说明
                <textarea
                  rows={5}
                  value={aiPrompt}
                  onChange={(event) => onAiPromptChange(event.target.value)}
                  placeholder="用文字说明你希望如何从这些评分中得出综合评分"
                />
              </label>
            ) : null}
          </div>

          <div className="action-row">
            <button className="primary" type="button" onClick={onCalculate} disabled={isCalculating}>
              {isCalculating ? '计算中...' : '计算并写入综合评分'}
            </button>
          </div>

          {errorMessage ? <p className="error-text">{errorMessage}</p> : null}
          {successMessage ? <p className="success-text">{successMessage}</p> : null}
        </section>
      </section>

      {isPickerOpen ? (
        <div
          className="modal-backdrop"
          onClick={() => {
            setIsPickerOpen(false)
            setPickerSearch('')
          }}
        >
          <section className="edit-modal picker-modal" onClick={(event) => event.stopPropagation()} aria-modal="true" role="dialog">
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
                    onGuideSelect(guide)
                    setIsPickerOpen(false)
                    setPickerSearch('')
                  }}
                >
                  <strong>{guide.courseName}</strong>
                  <span>
                    {guide.region} · {guide.courseCode} · 综合评分 {guide.compositeScore == null ? 'N/A' : guide.compositeScore}
                  </span>
                </button>
              ))}
            </div>
          </section>
        </div>
      ) : null}
    </>
  )
}
