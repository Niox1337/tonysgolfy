import { useState } from 'react'
import type { FormEvent } from 'react'
import type { ThemeMode } from '../../guides/types'

type LoginPageProps = {
  theme: ThemeMode
  errorMessage: string
  isSubmitting: boolean
  onToggleTheme: () => void
  onLogin: (username: string, password: string) => Promise<string | null>
}

export function LoginPage({ theme, errorMessage, isSubmitting, onToggleTheme, onLogin }: LoginPageProps) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [localError, setLocalError] = useState('')

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const error = await onLogin(username, password)
    setLocalError(error ?? '')
  }

  return (
    <main className="auth-shell">
      <section className="login-panel">
        <div className="login-copy">
          <p className="eyebrow">tonysgolfy</p>
          <h1>tonysgolfy</h1>
          <p className="login-tagline">登录后进入球场攻略管理台。</p>
        </div>

        <div className="login-card">
          <div className="login-card-header">
            <h2>登录</h2>
            <button className="theme-toggle auth-theme-toggle" type="button" onClick={onToggleTheme}>
              <span aria-hidden="true" className="theme-icon">
                {theme === 'day' ? '🌙' : '☀'}
              </span>
              {theme === 'day' ? '切换夜间模式' : '切换日间模式'}
            </button>
          </div>

          <form className="login-form" onSubmit={handleSubmit}>
            <label>
              用户名
              <input
                autoComplete="username"
                disabled={isSubmitting}
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="输入用户名"
              />
            </label>
            <label>
              密码
              <input
                type="password"
                autoComplete="current-password"
                disabled={isSubmitting}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="输入密码"
              />
            </label>
            {errorMessage || localError ? <p className="error-text">{errorMessage || localError}</p> : null}
            <button className="primary login-submit" type="submit" disabled={isSubmitting}>
              {isSubmitting ? '登录中...' : '进入管理台'}
            </button>
          </form>
        </div>
      </section>
    </main>
  )
}
