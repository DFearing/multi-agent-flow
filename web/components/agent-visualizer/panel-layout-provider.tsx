'use client'

import { type ReactNode } from 'react'
import { PanelLayoutContext, usePanelLayoutState } from '@/hooks/use-panel-layout'

export function PanelLayoutProvider({ children }: { children: ReactNode }) {
  const api = usePanelLayoutState()
  return (
    <PanelLayoutContext.Provider value={api}>
      {children}
    </PanelLayoutContext.Provider>
  )
}
