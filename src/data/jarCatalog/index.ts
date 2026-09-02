/**
 * JAR Catalog module - parses Space Haven game data from spacehaven.jar
 */

import type { StructureCatalog } from '@/data/types'
import type { ParsedJarData as ParsedJarDataType } from './types'
import {
  convertToStructureCatalog as convertToStructureCatalogRaw,
  mergeCatalogs as mergeCatalogsRaw,
  generateStructureId,
} from './converter'
import {
  BUILTIN_CATALOG as BUILTIN_CATALOG_RAW,
  BUILTIN_SOURCE_INFO,
  BUILTIN_GAME_VERSION,
  BUILTIN_GENERATED_AT,
  hasRealJarSnapshot,
} from './builtinSnapshot'

// Types
export type {
  RawJarStructure,
  RawJarCategory,
  TextEntry,
  ParsedJarData,
  JarSourceInfo,
  JarCatalogData,
  JarCatalogSource,
} from './types'

// Parser
export { parseJarFile, parseJarBytes, extractTextEntries } from './parser'

/**
 * The JAR marks two detached Cargo Port docking struts as construction tiles.
 * They are real exterior hardware, but they are not part of the ship-side body
 * that must remain inside the planner grid. For planner placement semantics,
 * treat those detached struts like the surrounding exterior Space restriction.
 *
 * The hull-side body remains construction (x=8..9 in the reference footprint)
 * and the crew interaction strip remains access (x=10), so neither can leave
 * the grid.
 */
function normalizeExteriorPlannerFootprints(catalog: StructureCatalog): StructureCatalog {
  return {
    ...catalog,
    categories: catalog.categories.map((category) => ({
      ...category,
      items: category.items.map((item) => {
        if (item.id !== 'mid_3543' || !item.tileLayout) return item

        return {
          ...item,
          tileLayout: {
            ...item.tileLayout,
            tiles: item.tileLayout.tiles.map((tile) =>
              tile.type === 'construction' && tile.x === 2 && (tile.y === 1 || tile.y === 5)
                ? { ...tile, type: 'blocked' as const, walkCost: 255 }
                : tile
            ),
          },
        }
      }),
    })),
  }
}

// Converter
export function convertToStructureCatalog(jarData: ParsedJarDataType): StructureCatalog {
  return normalizeExteriorPlannerFootprints(convertToStructureCatalogRaw(jarData))
}

export function mergeCatalogs(
  jarCatalog: StructureCatalog,
  staticCatalog: StructureCatalog
): StructureCatalog {
  return normalizeExteriorPlannerFootprints(mergeCatalogsRaw(jarCatalog, staticCatalog))
}

export { generateStructureId }

// Manual hull structures
export { MANUAL_HULL_STRUCTURES, HULL_CATEGORY } from './hullStructures'

// Cache
export {
  loadCachedJarCatalog,
  saveJarCatalogCache,
  clearJarCatalogCache,
  hasJarCatalogCache,
  getCachedJarSourceInfo,
} from './cache'

// Built-in snapshot
export const BUILTIN_CATALOG = normalizeExteriorPlannerFootprints(BUILTIN_CATALOG_RAW)
export { BUILTIN_SOURCE_INFO, BUILTIN_GAME_VERSION, BUILTIN_GENERATED_AT, hasRealJarSnapshot }

export function getBuiltinCatalog(): StructureCatalog {
  return BUILTIN_CATALOG
}
