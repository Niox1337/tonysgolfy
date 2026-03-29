import { useEffect, useState } from 'react'

type ComposeMailModalProps = {
  isOpen: boolean
  initialValues: {
    draftId?: string
    to: string
    subject: string
    body: string
    replyToMessageId?: string
  }
  errorMessage: string
  onClose: () => void
  onSaveDraft: (input: {
    draftId?: string
    to: string
    subject: string
    body: string
    replyToMessageId?: string
  }) => Promise<void>
  onSend: (input: {
    draftId?: string
    to: string
    subject: string
    body: string
    replyToMessageId?: string
  }) => Promise<void>
}

export function ComposeMailModal({
  isOpen,
  initialValues,
  errorMessage,
  onClose,
  onSaveDraft,
  onSend,
}: ComposeMailModalProps) {
  const [draftId, setDraftId] = useState<string | undefined>(initialValues.draftId)
  const [to, setTo] = useState(initialValues.to)
  const [subject, setSubject] = useState(initialValues.subject)
  const [body, setBody] = useState(initialValues.body)
  const [replyToMessageId, setReplyToMessageId] = useState<string | undefined>(initialValues.replyToMessageId)

  useEffect(() => {
    if (!isOpen) return
    setDraftId(initialValues.draftId)
    setTo(initialValues.to)
    setSubject(initialValues.subject)
    setBody(initialValues.body)
    setReplyToMessageId(initialValues.replyToMessageId)
  }, [initialValues, isOpen])

  if (!isOpen) return null

  const payload = { draftId, to, subject, body, replyToMessageId }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section className="edit-modal" onClick={(event) => event.stopPropagation()} aria-modal="true" role="dialog">
        <div className="panel-heading">
          <div>
            <h2>{draftId ? '编辑草稿' : '写邮件'}</h2>
          </div>
        </div>

        <div className="field-grid modal-grid">
          <label className="wide">
            收件人
            <input value={to} onChange={(event) => setTo(event.target.value)} placeholder="输入员工或管理员邮箱" />
          </label>
          <label className="wide">
            主题
            <input value={subject} onChange={(event) => setSubject(event.target.value)} />
          </label>
          <label className="wide">
            正文
            <textarea rows={12} value={body} onChange={(event) => setBody(event.target.value)} />
          </label>
        </div>

        {errorMessage ? <p className="error-text modal-feedback">{errorMessage}</p> : null}

        <div className="modal-actions">
          <button className="ghost" type="button" onClick={() => onSaveDraft(payload)}>
            保存草稿
          </button>
          <button className="primary" type="button" onClick={() => onSend(payload)}>
            发送
          </button>
          <button className="ghost" type="button" onClick={onClose}>
            关闭
          </button>
        </div>
      </section>
    </div>
  )
}
