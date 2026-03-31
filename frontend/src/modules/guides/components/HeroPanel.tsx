import type { ThemeMode } from '../types'
import type { UserRole } from '../../../api'

type HeroPanelProps = {
  isOpen: boolean
  theme: ThemeMode
  currentRoute: 'table' | 'users' | 'mail' | 'scores' | 'composite'
  currentUserName: string
  currentUserRole: UserRole
  allRecordsCount: number
  featuredCount: number
  onToggleTheme: () => void
  onOpenTable: () => void
  onOpenScores: () => void
  onOpenComposite: () => void
  onOpenUsers: () => void
  onOpenMail: () => void
  onOpenChangePassword: () => void
  onLogout: () => Promise<void>
}

export function HeroPanel({
  isOpen,
  theme,
  currentRoute,
  currentUserName,
  currentUserRole,
  allRecordsCount,
  featuredCount,
  onToggleTheme,
  onOpenTable,
  onOpenScores,
  onOpenComposite,
  onOpenUsers,
  onOpenMail,
  onOpenChangePassword,
  onLogout,
}: HeroPanelProps) {
  return (
    <aside className={`hero-panel${isOpen ? ' is-open' : ''}`}>
      <div className="hero-brand">
        <p className="eyebrow">tonysgolfy</p>
        <h1>tonysgolfy</h1>
        <p className="helper-text hero-meta">
          {currentUserName} · {currentUserRole === 'admin' ? '管理员' : currentUserRole === 'judge' ? '评委' : '员工'}
        </p>
      </div>

      <div className="hero-actions hero-nav">
        <button className={currentRoute === 'scores' ? 'primary' : 'ghost'} type="button" onClick={onOpenScores}>
          球场评分
        </button>
        {currentUserRole !== 'judge' ? (
          <button className={currentRoute === 'table' ? 'primary' : 'ghost'} type="button" onClick={onOpenTable}>
            球场攻略
          </button>
        ) : null}
        {currentUserRole !== 'judge' ? (
          <button
            className={currentRoute === 'composite' ? 'primary' : 'ghost'}
            type="button"
            onClick={onOpenComposite}
          >
            计算评分
          </button>
        ) : null}
        {currentUserRole !== 'judge' ? (
          <button className={currentRoute === 'mail' ? 'primary' : 'ghost'} type="button" onClick={onOpenMail}>
            邮箱
          </button>
        ) : null}
        {currentUserRole === 'admin' ? (
          <button className={currentRoute === 'users' ? 'primary' : 'ghost'} type="button" onClick={onOpenUsers}>
            用户管理
          </button>
        ) : null}
      </div>

      <div className="hero-actions">
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
      </div>

      <div className="hero-stats">
        <div className="stat-card">
          <span>攻略条目</span>
          <strong>{allRecordsCount}</strong>
        </div>
        <div className="stat-card">
          <span>目的地区域</span>
          <strong>{featuredCount}</strong>
        </div>
      </div>
    </aside>
  )
}
