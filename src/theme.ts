import { useCallback, useEffect, useState } from 'react'

export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'inpaint-theme'

function isTheme(value: string | null): value is Theme {
  return value === 'light' || value === 'dark'
}

function systemTheme(): Theme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
}

function initialTheme(): Theme {
  const documentTheme = document.documentElement.dataset.theme ?? null
  if (isTheme(documentTheme)) {
    return documentTheme
  }

  try {
    const storedTheme = window.localStorage.getItem(STORAGE_KEY)
    if (isTheme(storedTheme)) {
      return storedTheme
    }
  } catch {
    // Storage can be unavailable in privacy-restricted contexts.
  }

  return systemTheme()
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme
  document.documentElement.style.colorScheme = theme
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(initialTheme)

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const handleSystemThemeChange = () => {
      try {
        if (window.localStorage.getItem(STORAGE_KEY)) {
          return
        }
      } catch {
        // Fall through to the live system preference.
      }
      setTheme(media.matches ? 'dark' : 'light')
    }

    media.addEventListener('change', handleSystemThemeChange)
    return () => media.removeEventListener('change', handleSystemThemeChange)
  }, [])

  const toggleTheme = useCallback(() => {
    setTheme(currentTheme => {
      const nextTheme = currentTheme === 'dark' ? 'light' : 'dark'
      try {
        window.localStorage.setItem(STORAGE_KEY, nextTheme)
      } catch {
        // Applying the theme still works without persistence.
      }
      return nextTheme
    })
  }, [])

  return { theme, toggleTheme }
}
