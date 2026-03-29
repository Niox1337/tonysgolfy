import type { DuplicatePreviewMatch } from '../../../api'
import type { FormState } from '../types'

type CreateGuideModalProps = {
  isOpen: boolean
  form: FormState
  duplicatePreview: DuplicatePreviewMatch[]
  onUpdateForm: <K extends keyof FormState>(key: K, value: FormState[K]) => void
  onSave: () => Promise<void>
  onCancel: () => void
}

export function CreateGuideModal({
  isOpen,
  form,
  duplicatePreview,
  onUpdateForm,
  onSave,
  onCancel,
}: CreateGuideModalProps) {
  if (!isOpen) return null

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <section className="edit-modal" onClick={(event) => event.stopPropagation()} aria-modal="true" role="dialog">
        <div className="panel-heading">
          <div>
            <h2>新增球场攻略</h2>
          </div>
        </div>

        <div className="field-grid modal-grid">
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
            <input value={form.bestSeason} onChange={(event) => onUpdateForm('bestSeason', event.target.value)} />
          </label>
          <label className="wide">
            旅行备注
            <textarea rows={8} value={form.notes} onChange={(event) => onUpdateForm('notes', event.target.value)} />
          </label>
        </div>

        <div className="subpanel modal-subpanel">
          <div className="subpanel-heading">
            <h3>录入前重复检查</h3>
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

        <div className="modal-actions">
          <button className="primary" type="button" onClick={onSave}>
            录入攻略
          </button>
          <button className="ghost" type="button" onClick={onCancel}>
            取消
          </button>
        </div>
      </section>
    </div>
  )
}
