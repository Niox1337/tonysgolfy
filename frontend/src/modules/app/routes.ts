export const LOGIN_ROUTE = '/login'
export const TABLE_ROUTE = '/table'
export const USERS_ROUTE = '/users'
export const MAIL_ROUTE = '/mail'

export function normalizeRoute(pathname: string) {
  if (pathname === TABLE_ROUTE) return TABLE_ROUTE
  if (pathname === USERS_ROUTE) return USERS_ROUTE
  if (pathname === MAIL_ROUTE) return MAIL_ROUTE
  return LOGIN_ROUTE
}

export function navigateTo(pathname: string, replace = false) {
  const nextPath = normalizeRoute(pathname)
  const method = replace ? 'replaceState' : 'pushState'

  window.history[method]({}, '', nextPath)
  window.dispatchEvent(new PopStateEvent('popstate'))
}
