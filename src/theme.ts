import { useCallback, useEffect, useRef, useState } from 'react'

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

function themeDataset() {
  return document.documentElement.dataset as DOMStringMap & { theme?: string }
}

function initialTheme(): Theme {
  const documentTheme = themeDataset().theme ?? null
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
  themeDataset().theme = theme
  document.documentElement.style.colorScheme = theme
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(initialTheme)
  const manuallySelected = useRef(false)

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const handleSystemThemeChange = () => {
      if (manuallySelected.current) return
      try {
        if (isTheme(window.localStorage.getItem(STORAGE_KEY))) {
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
    manuallySelected.current = true
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
