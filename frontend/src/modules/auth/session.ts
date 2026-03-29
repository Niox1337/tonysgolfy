export const AUTH_STORAGE_KEY = 'tonysgolfy-authenticated'

export function readAuthState() {
  return localStorage.getItem(AUTH_STORAGE_KEY) === 'true'
}

export function writeAuthState(isAuthenticated: boolean) {
  if (isAuthenticated) {
    localStorage.setItem(AUTH_STORAGE_KEY, 'true')
    return
  }

  localStorage.removeItem(AUTH_STORAGE_KEY)
}
