import type { ThemeMode } from '../types'
import type { UserRole } from '../../../api'

type HeroPanelProps = {
  theme: ThemeMode
  currentRoute: 'table' | 'users'
  currentUserName: string
  currentUserRole: UserRole
  allRecordsCount: number
  featuredCount: number
  onToggleTheme: () => void
  onOpenTable: () => void
  onOpenUsers: () => void
  onOpenChangePassword: () => void
  onLogout: () => Promise<void>
}

export function HeroPanel({
  theme,
  currentRoute,
  currentUserName,
  currentUserRole,
  allRecordsCount,
  featuredCount,
  onToggleTheme,
  onOpenTable,
  onOpenUsers,
  onOpenChangePassword,
  onLogout,
}: HeroPanelProps) {
  return (
    <section className="hero-panel">
      <div>
        <p className="eyebrow">tonysgolfy</p>
        <h1>tonysgolfy</h1>
        <p className="helper-text hero-meta">
          {currentUserName} · {currentUserRole === 'admin' ? '管理员' : currentUserRole === 'judge' ? '评委' : '员工'}
        </p>
      </div>
      <div className="hero-actions">
        <button className={currentRoute === 'table' ? 'primary' : 'ghost'} type="button" onClick={onOpenTable}>
          球场攻略
        </button>
        {currentUserRole === 'admin' ? (
          <button className={currentRoute === 'users' ? 'primary' : 'ghost'} type="button" onClick={onOpenUsers}>
            用户管理
          </button>
        ) : null}
        <button className="theme-toggle" type="button" onClick={onToggleTheme}>
          <span aria-hidden="true" className="theme-icon">
            {theme === 'day' ? '🌙' : '☀'}
          </span>
          {theme === 'day' ? '切换夜间模式' : '切换日间模式'}
        </button>
        <button className="ghost" type="button" onClick={onOpenChangePassword}>
          修改密码
        </button>
        <button className="ghost logout-button" type="button" onClick={onLogout}>
          退出登录
        </button>
        <div className="stat-card">
          <span>攻略条目</span>
          <strong>{allRecordsCount}</strong>
        </div>
        <div className="stat-card">
          <span>目的地区域</span>
          <strong>{featuredCount}</strong>
        </div>
      </div>
    </section>
  )
}
