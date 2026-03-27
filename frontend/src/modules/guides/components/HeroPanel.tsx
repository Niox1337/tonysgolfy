import type { ThemeMode } from '../types'

type HeroPanelProps = {
  theme: ThemeMode
  allRecordsCount: number
  featuredCount: number
  onToggleTheme: () => void
}

export function HeroPanel({
  theme,
  allRecordsCount,
  featuredCount,
  onToggleTheme,
}: HeroPanelProps) {
  return (
    <section className="hero-panel">
      <div>
        <p className="eyebrow">tonysgolfy</p>
        <h1>tonysgolfy</h1>
      </div>
      <div className="hero-actions">
        <button className="theme-toggle" type="button" onClick={onToggleTheme}>
          <span aria-hidden="true" className="theme-icon">
            {theme === 'day' ? '🌙' : '☀'}
          </span>
          {theme === 'day' ? '切换夜间模式' : '切换日间模式'}
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
