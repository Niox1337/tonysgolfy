import type { MailFolder, MailMessage } from '../../../api'

type MailPageProps = {
  mailboxAddress: string
  folder: MailFolder
  messages: MailMessage[]
  selectedIds: string[]
  activeId: string | null
  errorMessage: string
  onFolderChange: (folder: MailFolder) => void
  onCompose: () => void
  onReply: (message: MailMessage) => void
  onEditDraft: (message: MailMessage) => void
  onDeleteSelected: () => Promise<void>
  onToggleSelect: (id: string) => void
  onActiveChange: (id: string) => void
}

const folders: Array<{ value: MailFolder; label: string }> = [
  { value: 'inbox', label: '收件箱' },
  { value: 'sent', label: '已发送' },
  { value: 'drafts', label: '草稿' },
  { value: 'trash', label: '回收站' },
]

export function MailPage({
  mailboxAddress,
  folder,
  messages,
  selectedIds,
  activeId,
  errorMessage,
  onFolderChange,
  onCompose,
  onReply,
  onEditDraft,
  onDeleteSelected,
  onToggleSelect,
  onActiveChange,
}: MailPageProps) {
  const activeMessage = messages.find((message) => message.id === activeId) ?? null

  return (
    <section className="mail-layout">
      <aside className="panel mail-sidebar">
        <div className="panel-heading">
          <div>
            <h2>工作邮箱</h2>
            <p className="helper-text">{mailboxAddress}</p>
          </div>
        </div>
        <div className="mail-folder-list">
          {folders.map((item) => (
            <button
              key={item.value}
              className={folder === item.value ? 'primary' : 'ghost'}
              type="button"
              onClick={() => onFolderChange(item.value)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="action-row">
          <button className="primary" type="button" onClick={onCompose}>
            写邮件
          </button>
          <button className="danger" type="button" onClick={onDeleteSelected} disabled={selectedIds.length === 0}>
            删除选中 {selectedIds.length > 0 ? `(${selectedIds.length})` : ''}
          </button>
        </div>
        {errorMessage ? <p className="error-text">{errorMessage}</p> : null}
      </aside>

      <section className="panel mail-list-panel">
        <div className="panel-heading">
          <div>
            <h2>{folders.find((item) => item.value === folder)?.label}</h2>
          </div>
        </div>
        <div className="table-wrap mail-table-wrap">
          <table>
            <thead>
              <tr>
                <th aria-label="select"></th>
                <th>{folder === 'sent' ? '收件人' : '发件人'}</th>
                <th>主题</th>
                <th>时间</th>
              </tr>
            </thead>
            <tbody>
              {messages.map((message) => (
                <tr
                  key={message.id}
                  className={activeId === message.id ? 'active-row' : undefined}
                  onClick={() => onActiveChange(message.id)}
                >
                  <td onClick={(event) => event.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(message.id)}
                      onChange={() => onToggleSelect(message.id)}
                    />
                  </td>
                  <td>{folder === 'sent' ? message.toAddress : message.fromAddress}</td>
                  <td>{message.subject}</td>
                  <td>{new Date(message.updatedAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {messages.length === 0 ? <div className="table-empty">当前文件夹没有邮件。</div> : null}
        </div>
      </section>

      <aside className="detail-card mail-detail-card">
        <div className="detail-header">
          <div>
            <h3>{activeMessage?.subject ?? '选择一封邮件'}</h3>
          </div>
          {activeMessage ? (
            <button
              className="ghost compact"
              type="button"
              onClick={() => (activeMessage.folder === 'drafts' ? onEditDraft(activeMessage) : onReply(activeMessage))}
            >
              {activeMessage.folder === 'drafts' ? '编辑草稿' : '回复'}
            </button>
          ) : null}
        </div>

        {activeMessage ? (
          <dl>
            <div>
              <dt>发件人</dt>
              <dd>{activeMessage.fromAddress}</dd>
            </div>
            <div>
              <dt>收件人</dt>
              <dd>{activeMessage.toAddress}</dd>
            </div>
            <div>
              <dt>时间</dt>
              <dd>{new Date(activeMessage.updatedAt).toLocaleString()}</dd>
            </div>
            <div>
              <dt>正文</dt>
              <dd className="mail-body">{activeMessage.body}</dd>
            </div>
          </dl>
        ) : (
          <p className="empty-state">从左侧列表选择邮件后在这里查看详情。</p>
        )}
      </aside>
    </section>
  )
}
