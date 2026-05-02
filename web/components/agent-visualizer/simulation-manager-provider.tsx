'use client'

import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react'
import { createSimulationManager, type SimulationManager } from '@/lib/simulation-manager'

const SimulationManagerContext = createContext<SimulationManager | null>(null)

export function SimulationManagerProvider({ children }: { children: ReactNode }) {
  const manager = useMemo(() => createSimulationManager(), [])

  useEffect(() => {
    manager.start()
    return () => manager.destroy()
  }, [manager])

  return (
    <SimulationManagerContext.Provider value={manager}>
      {children}
    </SimulationManagerContext.Provider>
  )
}

export function useSimulationManager(): SimulationManager {
  const ctx = useContext(SimulationManagerContext)
  if (!ctx) throw new Error('useSimulationManager must be used inside <SimulationManagerProvider>')
  return ctx
}
