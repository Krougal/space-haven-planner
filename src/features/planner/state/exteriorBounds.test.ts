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
import { BUILTIN_CATALOG } from '@/data/jarCatalog/builtinSnapshot'

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
  const longCargoPort: StructureDef = {
    ...makeExteriorStructure('test-cargo-port-long', 'Cargo Port Long', 'storage'),
    tileLayout: {
      tiles: [
        ...Array.from({ length: 4 }, (_, y) => [
          { x: 0, y, type: 'blocked' as const, walkCost: 255 },
          { x: 1, y, type: 'blocked' as const, walkCost: 255 },
        ]).flat(),
        { x: 0, y: 4, type: 'construction', walkCost: 1 },
        { x: 1, y: 4, type: 'construction', walkCost: 1 },
        { x: 0, y: 5, type: 'access', walkCost: 0 },
        { x: 1, y: 5, type: 'access', walkCost: 0 },
      ],
      width: 2,
      height: 6,
    },
  }
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
      items: [cargoPort, longCargoPort],
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

  it.each([
    { rotation: 0, x: 2, y: -2, badX: 2, badY: -3 },
    { rotation: 90, x: 4, y: 2, badX: 5, badY: 2 },
    { rotation: 180, x: 2, y: 4, badX: 2, badY: 5 },
    { rotation: 270, x: -2, y: 2, badX: -3, badY: 2 },
  ] as const)(
    'limits cargo port exclusion to two off-grid tiles at $rotation degrees',
    ({ rotation, x, y, badX, badY }) => {
      const state = createState()
      expect(canPlaceAt(state, 'test-cargo-port-long', x, y, rotation)).toBe(true)
      expect(canPlaceAt(state, 'test-cargo-port-long', badX, badY, rotation)).toBe(false)
    }
  )

  it('enforces cargo port clearance on moves as well as placement', () => {
    let state: PlannerState = {
      ...createState(),
      structures: [placedExterior('cargo-1', 'test-cargo-port-long', -2)],
      selectedStructureIds: new Set(['cargo-1']),
    }
    const rejected = plannerReducer(state, {
      type: 'MOVE_SELECTED_STRUCTURES',
      deltaX: 0,
      deltaY: -1,
    })
    expect(rejected.structures[0].y).toBe(-2)
  })

  it('uses the real JAR cargo port geometry at the left boundary', () => {
    const state: PlannerState = {
      ...createState(),
      gridSize: { width: 32, height: 32 },
      catalog: BUILTIN_CATALOG,
    }
    // At x=-2 its construction starts at x=0; one tile farther
    // would push construction off-grid.
    expect(canPlaceAt(state, 'mid_3543', -2, 4, 0)).toBe(true)
    expect(canPlaceAt(state, 'mid_3543', -3, 4, 0)).toBe(false)
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
