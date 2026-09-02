import { describe, expect, it } from 'vitest'
import { canPlaceAt, createInitialState, plannerReducer } from './reducer'
import type {
  LayerId,
  PlacedStructure,
  StructureCatalog,
  StructureCategory,
  StructureDef,
} from '@/data/types'
import type { PlannerState } from './types'

function makeExteriorStructure(
  id: string,
  name: string,
  categoryId: string
): StructureDef {
  return {
    id,
    name,
    size: [2, 2] as const,
    color: '#8866aa',
    categoryId,
    tileLayout: {
      // Two rows of exterior exclusion followed by the actual structure body
      // and its required crew-access row.
      tiles: [
        { x: 0, y: 0, type: 'blocked', walkCost: 255 },
        { x: 1, y: 0, type: 'blocked', walkCost: 255 },
        { x: 0, y: 1, type: 'blocked', walkCost: 255 },
        { x: 1, y: 1, type: 'blocked', walkCost: 255 },
        { x: 0, y: 2, type: 'construction', walkCost: 1 },
        { x: 1, y: 2, type: 'construction', walkCost: 1 },
        { x: 0, y: 3, type: 'access', walkCost: 0 },
        { x: 1, y: 3, type: 'access', walkCost: 0 },
      ],
      width: 2,
      height: 4,
    },
  }
}

function createCatalog(): StructureCatalog {
  const airlock = makeExteriorStructure('test-airlock', 'Test Airlock', 'airlock')
  const cargoPort = makeExteriorStructure('test-cargo-port', 'Cargo Port', 'storage')
  const console: StructureDef = {
    id: 'test-console',
    name: 'Test Console',
    size: [1, 1] as const,
    color: '#cc4444',
    categoryId: 'system',
    tileLayout: {
      tiles: [{ x: 0, y: 0, type: 'construction', walkCost: 1 }],
      width: 1,
      height: 1,
    },
  }

  const categories: StructureCategory[] = [
    {
      id: 'airlock',
      name: 'Airlock',
      defaultLayer: 'Rooms' as LayerId,
      color: '#8866aa',
      items: [airlock],
    },
    {
      id: 'storage',
      name: 'Storage',
      defaultLayer: 'Rooms' as LayerId,
      color: '#888866',
      items: [cargoPort],
    },
    {
      id: 'system',
      name: 'System',
      defaultLayer: 'Systems' as LayerId,
      color: '#cc4444',
      items: [console],
    },
  ]

  return { categories }
}

function createState(): PlannerState {
  return {
    ...createInitialState(),
    gridSize: { width: 8, height: 8 },
    catalog: createCatalog(),
  }
}

function placedExterior(
  id: string,
  structureId = 'test-airlock',
  y = 0
): PlacedStructure {
  return {
    id,
    structureId,
    categoryId: structureId === 'test-cargo-port' ? 'storage' : 'airlock',
    x: 2,
    y,
    rotation: 0,
    layer: 'Rooms' as LayerId,
    orgLayerId: 'layer-default',
    orgGroupId: null,
  }
}

describe('exterior exclusion bounds', () => {
  it('allows airlock exclusion tiles to extend above the planner grid', () => {
    const state = createState()

    // y=-2 puts both blocked/exclusion rows above the canvas while the body
    // remains at y=0 and its access row remains at y=1.
    expect(canPlaceAt(state, 'test-airlock', 2, -2, 0)).toBe(true)
  })

  it('recognizes cargo ports as exterior-clearance structures too', () => {
    const state = createState()
    expect(canPlaceAt(state, 'test-cargo-port', 2, -2, 0)).toBe(true)
  })

  it('still rejects placement when construction or access tiles leave the grid', () => {
    const state = createState()

    // At y=-3, the construction row would be at y=-1.
    expect(canPlaceAt(state, 'test-airlock', 2, -3, 0)).toBe(false)

    // Ordinary structures retain the historical strict bounds rule.
    expect(canPlaceAt(state, 'test-console', 2, -1, 0)).toBe(false)
  })

  it('allows PLACE_STRUCTURE to store a negative anchor when only exclusion is off-grid', () => {
    const state = createState()
    const next = plannerReducer(state, {
      type: 'PLACE_STRUCTURE',
      structure: placedExterior('airlock-1', 'test-airlock', -2),
    })

    expect(next.structures).toHaveLength(1)
    expect(next.structures[0].y).toBe(-2)
  })

  it('allows moving exterior exclusion off-grid but stops before body/access leave the grid', () => {
    let state: PlannerState = {
      ...createState(),
      structures: [placedExterior('airlock-1')],
      selectedStructureIds: new Set(['airlock-1']),
    }

    state = plannerReducer(state, {
      type: 'MOVE_SELECTED_STRUCTURES',
      deltaX: 0,
      deltaY: -2,
    })

    expect(state.structures[0].y).toBe(-2)

    const rejected = plannerReducer(state, {
      type: 'MOVE_SELECTED_STRUCTURES',
      deltaX: 0,
      deltaY: -1,
    })

    expect(rejected.structures[0].y).toBe(-2)
  })

  it('does not bypass normal collision checks at the grid edge', () => {
    const state: PlannerState = {
      ...createState(),
      structures: [
        {
          id: 'console-1',
          structureId: 'test-console',
          categoryId: 'system',
          x: 2,
          y: 0,
          rotation: 0,
          layer: 'Systems' as LayerId,
          orgLayerId: 'layer-default',
          orgGroupId: null,
        },
      ],
    }

    // The airlock construction row would land on the console at (2, 0).
    expect(canPlaceAt(state, 'test-airlock', 2, -2, 0)).toBe(false)
  })
})
