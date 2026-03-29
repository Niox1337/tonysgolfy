import { useState } from 'react'

type ChangePasswordModalProps = {
  isOpen: boolean
  errorMessage: string
  onClose: () => void
  onSubmit: (currentPassword: string, newPassword: string) => Promise<string | null>
}

export function ChangePasswordModal({
  isOpen,
  errorMessage,
  onClose,
  onSubmit,
}: ChangePasswordModalProps) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [localError, setLocalError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  if (!isOpen) return null

  async function handleSubmit() {
    if (!currentPassword || !newPassword) {
      setLocalError('请填写当前密码和新密码。')
      return
    }

    if (newPassword !== confirmPassword) {
      setLocalError('两次输入的新密码不一致。')
      return
    }

    setIsSubmitting(true)
    const error = await onSubmit(currentPassword, newPassword)
    setIsSubmitting(false)

    if (error) {
      setLocalError(error)
      return
    }

    setCurrentPassword('')
    setNewPassword('')
    setConfirmPassword('')
    setLocalError('')
    onClose()
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section className="edit-modal" onClick={(event) => event.stopPropagation()} aria-modal="true" role="dialog">
        <div className="panel-heading">
          <div>
            <h2>修改密码</h2>
          </div>
        </div>

        <div className="field-grid modal-grid">
          <label className="wide">
            当前密码
            <input
              type="password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
            />
          </label>
          <label className="wide">
            新密码
            <input
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
            />
          </label>
          <label className="wide">
            确认新密码
            <input
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
            />
          </label>
        </div>

        {errorMessage || localError ? <p className="error-text modal-feedback">{errorMessage || localError}</p> : null}

        <div className="modal-actions">
          <button className="primary" type="button" onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting ? '提交中...' : '更新密码'}
          </button>
          <button className="ghost" type="button" onClick={onClose}>
            取消
          </button>
        </div>
      </section>
    </div>
  )
}
