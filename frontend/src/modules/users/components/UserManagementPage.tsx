import type { UserRecord, UserRole } from '../../../api'

type UserManagementPageProps = {
  users: UserRecord[]
  createForm: {
    name: string
    phone: string
    email: string
    role: UserRole
    password: string
  }
  editForm: {
    id: string | null
    name: string
    phone: string
    email: string
    role: UserRole
  }
  errorMessage: string
  onCreateFormChange: (field: 'name' | 'phone' | 'email' | 'role' | 'password', value: string) => void
  onEditFormChange: (field: 'name' | 'phone' | 'email' | 'role', value: string) => void
  onCreateUser: () => Promise<void>
  onStartEditing: (user: UserRecord) => void
  onSaveEdit: () => Promise<void>
  onCancelEdit: () => void
  onDeactivate: (id: string) => Promise<void>
}

const roleLabel: Record<UserRole, string> = {
  judge: '评委',
  employee: '员工',
  admin: '管理员',
}

export function UserManagementPage({
  users,
  createForm,
  editForm,
  errorMessage,
  onCreateFormChange,
  onEditFormChange,
  onCreateUser,
  onStartEditing,
  onSaveEdit,
  onCancelEdit,
  onDeactivate,
}: UserManagementPageProps) {
  return (
    <section className="workspace-grid users-grid">
      <aside className="panel form-panel">
        <div className="panel-heading">
          <div>
            <h2>注册用户</h2>
          </div>
        </div>

        <div className="field-grid">
          <label>
            姓名
            <input value={createForm.name} onChange={(event) => onCreateFormChange('name', event.target.value)} />
          </label>
          <label>
            用户组
            <select value={createForm.role} onChange={(event) => onCreateFormChange('role', event.target.value)}>
              <option value="judge">评委</option>
              <option value="employee">员工</option>
              <option value="admin">管理员</option>
            </select>
          </label>
          <label>
            手机号
            <input value={createForm.phone} onChange={(event) => onCreateFormChange('phone', event.target.value)} />
          </label>
          <label>
            电子邮箱
            <input value={createForm.email} onChange={(event) => onCreateFormChange('email', event.target.value)} />
          </label>
          <label className="wide">
            初始密码
            <input
              type="password"
              value={createForm.password}
              onChange={(event) => onCreateFormChange('password', event.target.value)}
            />
          </label>
        </div>

        <div className="action-row">
          <button className="primary" type="button" onClick={onCreateUser}>
            注册用户
          </button>
        </div>
        {errorMessage ? <p className="error-text">{errorMessage}</p> : null}
      </aside>

      <section className="panel users-table-panel">
        <div className="panel-heading">
          <div>
            <h2>用户管理</h2>
          </div>
        </div>

        <div className="table-wrap users-table-wrap">
          <table>
            <thead>
              <tr>
                <th>姓名</th>
                <th>用户组</th>
                <th>手机号</th>
                <th>电子邮箱</th>
                <th>状态</th>
                <th>更新时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => {
                const isEditing = editForm.id === user.id
                return (
                  <tr key={user.id}>
                    <td>
                      {isEditing ? (
                        <input value={editForm.name} onChange={(event) => onEditFormChange('name', event.target.value)} />
                      ) : (
                        user.name
                      )}
                    </td>
                    <td>
                      {isEditing ? (
                        <select value={editForm.role} onChange={(event) => onEditFormChange('role', event.target.value)}>
                          <option value="judge">评委</option>
                          <option value="employee">员工</option>
                          <option value="admin">管理员</option>
                        </select>
                      ) : (
                        roleLabel[user.role]
                      )}
                    </td>
                    <td>
                      {isEditing ? (
                        <input value={editForm.phone} onChange={(event) => onEditFormChange('phone', event.target.value)} />
                      ) : (
                        user.phone || '—'
                      )}
                    </td>
                    <td>
                      {isEditing ? (
                        <input value={editForm.email} onChange={(event) => onEditFormChange('email', event.target.value)} />
                      ) : (
                        user.email || '—'
                      )}
                    </td>
                    <td>{user.active ? '启用' : '已注销'}</td>
                    <td>{new Date(user.updatedAt).toLocaleString()}</td>
                    <td>
                      <div className="row-actions">
                        {isEditing ? (
                          <>
                            <button className="primary compact" type="button" onClick={onSaveEdit}>
                              保存
                            </button>
                            <button className="ghost compact" type="button" onClick={onCancelEdit}>
                              取消
                            </button>
                          </>
                        ) : (
                          <>
                            <button className="ghost compact" type="button" onClick={() => onStartEditing(user)}>
                              编辑
                            </button>
                            <button
                              className="danger compact"
                              type="button"
                              onClick={() => onDeactivate(user.id)}
                              disabled={!user.active}
                            >
                              注销
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {users.length === 0 ? <div className="table-empty">当前还没有用户。</div> : null}
        </div>
      </section>
    </section>
  )
}
