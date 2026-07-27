import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { sceneApi } from '../api/scene-api'
import { apiClient } from '@/shared/api-client'
import { SceneService } from './scene.service'
import { WorkspaceService } from './workspace.service'

// ── Context ──

interface Services {
  scene: SceneService
  workspace: WorkspaceService
}

const ServicesContext = createContext<Services | null>(null)

// ── Provider ──

export function ServicesProvider({ children }: { children: ReactNode }) {
  const services = useMemo(
    () => ({
      scene: new SceneService(sceneApi),
      workspace: new WorkspaceService(apiClient),
    }),
    [],
  )

  return (
    <ServicesContext.Provider value={services}>
      {children}
    </ServicesContext.Provider>
  )
}

// ── Hooks ──

export function useSceneService(): SceneService {
  const ctx = useContext(ServicesContext)
  if (!ctx) throw new Error('useSceneService must be used within <ServicesProvider>')
  return ctx.scene
}

export function useWorkspaceService(): WorkspaceService {
  const ctx = useContext(ServicesContext)
  if (!ctx) throw new Error('useWorkspaceService must be used within <ServicesProvider>')
  return ctx.workspace
}
