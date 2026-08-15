import { describe, it, expect, vi, beforeEach } from 'vitest'
import { listDemos, getDemoScene, getDemoProgram } from './api'
import type { DemoCatalogEntry, SceneFile } from '@/shared/contracts'

/**
 * Demos catalog API client tests (demos-workspace spec, D10 catalog authority).
 * Pins every method to its exact GET /api/v1/demos route — GET-only per D12
 * (no POST/PUT/PATCH for scenes or programs). Errors pass through the shared
 * api-client error normalization (network/404 → coded ApiError) unchanged.
 */

const apiMocks = vi.hoisted(() => ({ get: vi.fn() }))

vi.mock('@/shared/api-client', () => ({
  apiClient: { get: apiMocks.get },
}))

const sceneFixture: SceneFile = {
  schema_version: '1',
  robot: { name: 'icebot', urdf: 'docs/robot/icebot.urdf' },
  objects: [{ id: 'box-1', kind: 'box', pose: { position: [0.2, 0.1, 0], orientation: [1, 0, 0, 0] } }],
  fixtures: [],
  locations: [{ id: 'tray-1', kind: 'placement_target', pose: { position: [0.2, -0.1, 0], orientation: [1, 0, 0, 0] } }],
  home_pose: { position: [0.2, 0, 0.1], orientation: [1, 0, 0, 0] },
  approach_height: 0.05,
}

beforeEach(() => {
  apiMocks.get.mockReset()
  apiMocks.get.mockResolvedValue({ data: [] })
})

describe('listDemos — GET /api/v1/demos', () => {
  it('fetches the catalog and returns the entries verbatim', async () => {
    const catalog: DemoCatalogEntry[] = [
      { id: 'happy-path', title: 'Happy Path', category: 'pick-place', narrative: 'A pick and place' },
      { id: 'multi-object', title: 'Multi Object', category: 'pick-place' },
    ]
    apiMocks.get.mockResolvedValue({ data: catalog })

    await expect(listDemos()).resolves.toEqual(catalog)
    expect(apiMocks.get).toHaveBeenCalledWith('/demos')
  })

  it('returns an empty list when the catalog is empty (spec: empty → [])', async () => {
    apiMocks.get.mockResolvedValue({ data: [] })

    await expect(listDemos()).resolves.toEqual([])
  })
})

describe('getDemoScene — GET /api/v1/demos/{id}/scene', () => {
  it('fetches the SceneFile for the given demo id', async () => {
    apiMocks.get.mockResolvedValue({ data: sceneFixture })

    await expect(getDemoScene('happy-path')).resolves.toEqual(sceneFixture)
    expect(apiMocks.get).toHaveBeenCalledWith('/demos/happy-path/scene')
  })

  it('resolves a different demo id to its own scene route', async () => {
    apiMocks.get.mockResolvedValue({ data: { ...sceneFixture, schema_version: '1' } })

    await getDemoScene('multi-object')
    expect(apiMocks.get).toHaveBeenCalledWith('/demos/multi-object/scene')
  })
})

describe('getDemoProgram — GET /api/v1/demos/{id}/program', () => {
  it('fetches the program text for the given demo id', async () => {
    const program = 'pick box-1\nplace box-1 at tray-1\nhome'
    apiMocks.get.mockResolvedValue({ data: program })

    await expect(getDemoProgram('happy-path')).resolves.toBe(program)
    expect(apiMocks.get).toHaveBeenCalledWith('/demos/happy-path/program')
  })
})

describe('catalog client — error passthrough', () => {
  it('propagates a 404 rejection (demo not found) to the caller', async () => {
    const notFound = new Error('demo not found: nope')
    apiMocks.get.mockRejectedValue(notFound)

    await expect(getDemoScene('nope')).rejects.toBe(notFound)
    await expect(getDemoProgram('nope')).rejects.toBe(notFound)
  })
})
