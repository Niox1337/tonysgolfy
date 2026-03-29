export const LOGIN_ROUTE = '/login'
export const TABLE_ROUTE = '/table'

export function normalizeRoute(pathname: string) {
  return pathname === TABLE_ROUTE ? TABLE_ROUTE : LOGIN_ROUTE
}

export function navigateTo(pathname: string, replace = false) {
  const nextPath = normalizeRoute(pathname)
  const method = replace ? 'replaceState' : 'pushState'

  window.history[method]({}, '', nextPath)
  window.dispatchEvent(new PopStateEvent('popstate'))
}
