import type { FormState } from '../types'

type EditGuideModalProps = {
  editingId: string | null
  editingForm: FormState
  compositeScore: number | null
  onUpdateEditingForm: <K extends keyof FormState>(key: K, value: FormState[K]) => void
  onSave: () => Promise<void>
  onCancel: () => void
}

export function EditGuideModal({
  editingId,
  editingForm,
  compositeScore,
  onUpdateEditingForm,
  onSave,
  onCancel,
}: EditGuideModalProps) {
  if (!editingId) return null

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <section className="edit-modal" onClick={(event) => event.stopPropagation()} aria-modal="true" role="dialog">
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
              onChange={(event) => onUpdateEditingForm('courseName', event.target.value)}
            />
          </label>
          <label>
            目的地 / 区域
            <input value={editingForm.region} onChange={(event) => onUpdateEditingForm('region', event.target.value)} />
          </label>
          <label>
            球场代号
            <input
              value={editingForm.courseCode}
              onChange={(event) => onUpdateEditingForm('courseCode', event.target.value)}
            />
          </label>
          <label>
            参考果岭费
            <input
              type="number"
              min="0"
              value={editingForm.greenFee}
              onChange={(event) => onUpdateEditingForm('greenFee', event.target.value)}
            />
          </label>
          <label>
            最佳季节
            <input
              value={editingForm.bestSeason}
              onChange={(event) => onUpdateEditingForm('bestSeason', event.target.value)}
            />
          </label>
          <label>
            综合评分
            <input readOnly value={compositeScore == null ? 'N/A' : compositeScore} />
          </label>
          <label className="wide">
            旅行备注
            <textarea rows={8} value={editingForm.notes} onChange={(event) => onUpdateEditingForm('notes', event.target.value)} />
          </label>
        </div>

        <div className="modal-actions">
          <button className="primary" type="button" onClick={onSave}>
            保存修改
          </button>
          <button className="ghost" type="button" onClick={onCancel}>
            取消
          </button>
        </div>
      </section>
    </div>
  )
}
