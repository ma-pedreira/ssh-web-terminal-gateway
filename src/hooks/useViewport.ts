'use client'

import { useEffect, useState } from 'react'

export interface VisibleArea {
  readonly height: number
  readonly offsetTop: number
}

/**
 * Height actually visible to the user. On iOS the on-screen keyboard does not
 * shrink the layout viewport, only the visual one: without following it, the
 * prompt ends up hidden behind the keyboard.
 */
export function useVisibleArea(): VisibleArea | null {
  const [area, setArea] = useState<VisibleArea | null>(null)

  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return

    const update = (): void => {
      setArea((current) => {
        const height = Math.round(viewport.height)
        const offsetTop = Math.round(viewport.offsetTop)
        if (current && current.height === height && current.offsetTop === offsetTop) return current
        return { height, offsetTop }
      })
    }

    update()
    viewport.addEventListener('resize', update)
    viewport.addEventListener('scroll', update)
    return () => {
      viewport.removeEventListener('resize', update)
      viewport.removeEventListener('scroll', update)
    }
  }, [])

  return area
}

/** True on touch-first devices (phones, tablets), where the key bar is shown. */
export function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(false)

  useEffect(() => {
    const query = window.matchMedia('(pointer: coarse)')
    const update = (): void => setCoarse(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  return coarse
}
