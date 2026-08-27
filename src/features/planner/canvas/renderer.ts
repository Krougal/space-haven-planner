import type {
  GridSize,
  PlacedStructure,
  StructureCatalog,
  StructureTile,
  Rotation,
  UserLayer,
  UserGroup,
  StructureDef,
} from '@/data/types'
import { findStructureById, getRotatedSize } from '@/data'
import { computePerimeterEdges, isInnerHullTile } from './hullPerimeter'

/**
 * Visibility state needed for rendering
 */
export interface VisibilityState {
  userLayers: readonly UserLayer[]
  userGroups: readonly UserGroup[]
}

/**
 * Check if a structure is visible based on its layer and group visibility
 */
function isStructureVisibleForRender(visState: VisibilityState, struct: PlacedStructure): boolean {
  const layer = visState.userLayers.find((l) => l.id === struct.orgLayerId)
  if (!layer || !layer.isVisible) return false

  if (struct.orgGroupId) {
    const group = visState.userGroups.find((g) => g.id === struct.orgGroupId)
    if (group && !group.isVisible) return false
  }

  return true
}

/** Colors for rendering */
const COLORS = {
  background: '#1a1e24',
  gridLine: '#2a3040',
  centerLine: '#1a5a5a',
  previewValid: 'rgba(136, 255, 136, 0.5)',
  previewInvalid: 'rgba(255, 68, 68, 0.4)',
  previewBorderValid: '#88ff88',
  previewBorderInvalid: '#ff4444',
  structureBorder: 'rgba(255, 255, 255, 0.3)',
  structureText: '#ffffff',
  structureTextShadow: '#000000',
  hullTile: '#3a4a5c',
  hullTileInner: '#2a3a4c',
  hullGridLine: 'rgba(255, 255, 255, 0.08)',
  hullWall: '#5a6a7c',
  hullPreview: 'rgba(74, 90, 108, 0.6)',
  hullPreviewBorder: '#6a8a9c',
  selectionFill: 'rgba(130, 200, 255, 0.12)',
  selectionBorder: 'rgba(130, 200, 255, 0.85)',
  selectionEraseFill: 'rgba(255, 68, 68, 0.12)',
  selectionEraseBorder: 'rgba(255, 68, 68, 0.85)',
  selectionHullPlaceFill: 'rgba(74, 90, 108, 0.35)',
  selectionHullEraseFill: 'rgba(180, 60, 60, 0.25)',

  // Access tiles keep the parent structure's category color and use a slash to
  // communicate that the tile is walkable/overlap-compatible.
  accessTileBorder: 'rgba(255, 255, 255, 0.42)',
  accessTileMark: 'rgba(255, 255, 255, 0.78)',

  // Impassable tiles that belong to a normal machine keep the machine's category
  // color. The X communicates blocking without making beds, consoles, etc. look
  // like walls.
  blockedTileBorder: 'rgba(255, 255, 255, 0.48)',
  blockedTileMark: 'rgba(255, 255, 255, 0.48)',

  // Wall-category tiles get their own neutral treatment, deliberately distinct
  // from both the hull floor and blocked machine tiles.
  wallTileFill: 'rgba(104, 118, 134, 0.92)',
  wallTileBorder: 'rgba(222, 228, 236, 0.72)',
  wallTileMark: 'rgba(238, 242, 248, 0.48)',
  doorMark: 'rgba(238, 204, 142, 0.95)',
  windowMark: 'rgba(132, 218, 242, 0.95)',

  // Amber is reserved for exterior/reserved clearance around airlocks, engines,
  // hyperdrives and cargo docking structures.
  exclusionTileFill: 'rgba(204, 136, 68, 0.42)',
  exclusionTileBorder: 'rgba(238, 178, 86, 0.92)',
  exclusionTileMark: 'rgba(255, 214, 132, 0.78)',
}

function colorWithAlpha(color: string, alpha: number): string {
  const hex = color.match(/^#([0-9a-f]{6})$/i)
  if (hex) {
    const value = hex[1]
    const r = parseInt(value.slice(0, 2), 16)
    const g = parseInt(value.slice(2, 4), 16)
    const b = parseInt(value.slice(4, 6), 16)
    return `rgba(${r}, ${g}, ${b}, ${alpha})`
  }

  const hsl = color.match(/^hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)$/i)
  if (hsl) {
    return `hsla(${hsl[1]}, ${hsl[2]}%, ${hsl[3]}%, ${alpha})`
  }

  const rgb = color.match(/^rgb\(([^)]+)\)$/i)
  if (rgb) {
    return `rgba(${rgb[1]}, ${alpha})`
  }

  return color
}

function renderAccessTileIndicator(
  ctx: CanvasRenderingContext2D,
  tileX: number,
  tileY: number,
  zoom: number
): void {
  if (zoom < 7) return

  const inset = Math.max(2, zoom * 0.2)
  ctx.strokeStyle = COLORS.accessTileMark
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(tileX + inset, tileY + zoom - inset)
  ctx.lineTo(tileX + zoom - inset, tileY + inset)
  ctx.stroke()
}

function renderBlockedTileIndicator(
  ctx: CanvasRenderingContext2D,
  tileX: number,
  tileY: number,
  zoom: number
): void {
  if (zoom < 7) return

  const inset = Math.max(2, zoom * 0.24)
  ctx.strokeStyle = COLORS.blockedTileMark
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(tileX + inset, tileY + inset)
  ctx.lineTo(tileX + zoom - inset, tileY + zoom - inset)
  ctx.moveTo(tileX + zoom - inset, tileY + inset)
  ctx.lineTo(tileX + inset, tileY + zoom - inset)
  ctx.stroke()
}

function renderWallTileIndicator(
  ctx: CanvasRenderingContext2D,
  tileX: number,
  tileY: number,
  zoom: number
): void {
  if (zoom < 7) return

  const inset = Math.max(2, zoom * 0.22)
  ctx.strokeStyle = COLORS.wallTileMark
  ctx.lineWidth = 1
  ctx.strokeRect(
    tileX + inset,
    tileY + inset,
    Math.max(1, zoom - inset * 2),
    Math.max(1, zoom - inset * 2)
  )
}

function renderExclusionTileIndicator(
  ctx: CanvasRenderingContext2D,
  tileX: number,
  tileY: number,
  zoom: number
): void {
  if (zoom < 7) return

  const inset = Math.max(2, zoom * 0.16)
  const gap = Math.max(2, zoom * 0.24)
  ctx.strokeStyle = COLORS.exclusionTileMark
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(tileX + inset, tileY + zoom - inset)
  ctx.lineTo(tileX + zoom - inset - gap, tileY + inset)
  ctx.moveTo(tileX + inset + gap, tileY + zoom - inset)
  ctx.lineTo(tileX + zoom - inset, tileY + inset + gap)
  ctx.stroke()
}

type WallVisualKind = 'wall' | 'door' | 'window'

function getWallVisualKind(structureDef: StructureDef): WallVisualKind | null {
  if (structureDef.categoryId !== 'wall') return null

  const name = structureDef.name.toLowerCase()
  if (name.includes('window')) return 'window'
  if (name.includes('door')) return 'door'
  return 'wall'
}

/**
 * Add a simple deterministic symbol over wall-family pieces so doors and windows
 * remain recognizable without requiring external icon assets. The symbol follows
 * the piece rotation.
 */
function renderWallFixtureOverlay(
  ctx: CanvasRenderingContext2D,
  structureDef: StructureDef,
  rotation: Rotation,
  baseX: number,
  baseY: number,
  widthPx: number,
  heightPx: number,
  zoom: number
): void {
  const kind = getWallVisualKind(structureDef)
  if (!kind || kind === 'wall' || zoom < 7) return

  const horizontal = rotation === 0 || rotation === 180
  const centerX = baseX + widthPx / 2
  const centerY = baseY + heightPx / 2
  const inset = Math.max(2, zoom * 0.18)

  ctx.save()
  ctx.lineWidth = Math.max(1.5, zoom * 0.13)
  ctx.lineCap = 'round'

  if (kind === 'window') {
    ctx.strokeStyle = COLORS.windowMark
    const separation = Math.max(2, zoom * 0.18)
    ctx.beginPath()
    if (horizontal) {
      ctx.moveTo(baseX + inset, centerY - separation / 2)
      ctx.lineTo(baseX + widthPx - inset, centerY - separation / 2)
      ctx.moveTo(baseX + inset, centerY + separation / 2)
      ctx.lineTo(baseX + widthPx - inset, centerY + separation / 2)
    } else {
      ctx.moveTo(centerX - separation / 2, baseY + inset)
      ctx.lineTo(centerX - separation / 2, baseY + heightPx - inset)
      ctx.moveTo(centerX + separation / 2, baseY + inset)
      ctx.lineTo(centerX + separation / 2, baseY + heightPx - inset)
    }
    ctx.stroke()
  } else {
    ctx.strokeStyle = COLORS.doorMark
    const gap = Math.max(2, zoom * 0.22)
    ctx.beginPath()
    if (horizontal) {
      ctx.moveTo(baseX + inset, centerY)
      ctx.lineTo(centerX - gap, centerY)
      ctx.moveTo(centerX + gap, centerY)
      ctx.lineTo(baseX + widthPx - inset, centerY)
    } else {
      ctx.moveTo(centerX, baseY + inset)
      ctx.lineTo(centerX, centerY - gap)
      ctx.moveTo(centerX, centerY + gap)
      ctx.lineTo(centerX, baseY + heightPx - inset)
    }
    ctx.stroke()

    // Small handle/datum mark makes doors distinguishable from a generic divider.
    ctx.fillStyle = COLORS.doorMark
    ctx.beginPath()
    ctx.arc(
      horizontal ? centerX + gap * 0.55 : centerX + Math.max(1.5, zoom * 0.09),
      horizontal ? centerY - Math.max(1.5, zoom * 0.09) : centerY + gap * 0.55,
      Math.max(1, zoom * 0.07),
      0,
      Math.PI * 2
    )
    ctx.fill()
  }

  ctx.restore()
}

/**
 * The JAR converter currently flattens both solid walkGridCost=255 tiles and
 * Space restrictions into the same `blocked` tile type. Until that source
 * distinction is retained in the catalog, classify the structures whose blocked
 * regions are known to represent exterior/reserved clearance.
 */
function usesExteriorExclusionStyle(structureDef: StructureDef): boolean {
  const name = structureDef.name.toLowerCase()
  return (
    structureDef.categoryId === 'airlock' ||
    name.includes('airlock') ||
    name.includes('cargo dock') ||
    name.includes('cargo port') ||
    name.includes('engine') ||
    name.includes('hyperdrive') ||
    name.includes('thruster')
  )
}

function usesWallStyle(structureDef: StructureDef): boolean {
  return structureDef.categoryId === 'wall'
}

/**
 * Placement preview currently carries color but not category/name. These catalog
 * colors are stable, so they are sufficient to keep preview styling consistent.
 */
function previewUsesExteriorExclusionStyle(color: string): boolean {
  const normalized = color.toLowerCase()
  return normalized === '#8866aa' || normalized === '#cc4444'
}

function previewUsesWallStyle(color: string): boolean {
  return color.toLowerCase() === '#3a4a5c'
}

export interface RenderContext {
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  gridSize: GridSize
  zoom: number
  dpr: number
}

export interface PreviewInfo {
  x: number
  y: number
  width: number
  height: number
  color: string
  isValid: boolean
  rotation: Rotation
  tileLayout?: {
    tiles: readonly StructureTile[]
    width: number
    height: number
  }
}

export interface HullPreviewInfo {
  x: number
  y: number
}

export type SelectionOverlayMode = 'hull_place' | 'hull_erase' | 'select' | 'erase'

export interface SelectionOverlayRect {
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface SelectionOverlay {
  mode: SelectionOverlayMode
  rect: SelectionOverlayRect
  hullTiles?: ReadonlySet<string>
  structureBounds?: readonly { x: number; y: number; width: number; height: number }[]
}

export function createRenderContext(
  canvas: HTMLCanvasElement,
  gridSize: GridSize,
  zoom: number
): RenderContext {
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('Failed to get 2D context')
  }

  const dpr = window.devicePixelRatio || 1
  const width = gridSize.width * zoom
  const height = gridSize.height * zoom

  canvas.style.width = `${width}px`
  canvas.style.height = `${height}px`
  canvas.width = width * dpr
  canvas.height = height * dpr
  ctx.scale(dpr, dpr)

  return { canvas, ctx, gridSize, zoom, dpr }
}

export function clearCanvas(rc: RenderContext): void {
  rc.ctx.fillStyle = COLORS.background
  rc.ctx.fillRect(0, 0, rc.gridSize.width * rc.zoom, rc.gridSize.height * rc.zoom)
}

export function renderGrid(rc: RenderContext): void {
  const { ctx, gridSize, zoom } = rc

  ctx.strokeStyle = COLORS.gridLine
  ctx.lineWidth = 1

  for (let x = 0; x <= gridSize.width; x++) {
    ctx.beginPath()
    ctx.moveTo(x * zoom + 0.5, 0)
    ctx.lineTo(x * zoom + 0.5, gridSize.height * zoom)
    ctx.stroke()
  }

  for (let y = 0; y <= gridSize.height; y++) {
    ctx.beginPath()
    ctx.moveTo(0, y * zoom + 0.5)
    ctx.lineTo(gridSize.width * zoom, y * zoom + 0.5)
    ctx.stroke()
  }
}

export function renderCenterLines(rc: RenderContext): void {
  const { ctx, gridSize, zoom } = rc

  ctx.strokeStyle = COLORS.centerLine
  ctx.lineWidth = 3

  const centerX = Math.floor(gridSize.width / 2) * zoom
  const centerY = Math.floor(gridSize.height / 2) * zoom

  ctx.beginPath()
  ctx.moveTo(centerX + 0.5, 0)
  ctx.lineTo(centerX + 0.5, gridSize.height * zoom)
  ctx.stroke()

  ctx.beginPath()
  ctx.moveTo(0, centerY + 0.5)
  ctx.lineTo(gridSize.width * zoom, centerY + 0.5)
  ctx.stroke()
}

function rotateTilePosition(
  tile: StructureTile,
  rotation: Rotation,
  layoutWidth: number,
  layoutHeight: number
): { x: number; y: number } {
  const { x, y } = tile

  switch (rotation) {
    case 0:
      return { x, y }
    case 90:
      return { x: layoutHeight - 1 - y, y: x }
    case 180:
      return { x: layoutWidth - 1 - x, y: layoutHeight - 1 - y }
    case 270:
      return { x: y, y: layoutWidth - 1 - x }
    default:
      return { x, y }
  }
}

/**
 * Render a single placed structure.
 * - Construction: solid category color
 * - Access: category-color tint + slash
 * - Blocked machine body: category-color tint + X
 * - Wall category: distinct neutral wall tile
 * - Doors/windows: wall base plus a unique rotation-aware overlay
 * - Exterior exclusion: amber hazard marking
 */
export function renderStructure(
  rc: RenderContext,
  structure: PlacedStructure,
  catalog: StructureCatalog,
  renderedAccessTiles?: Set<string>
): void {
  const found = findStructureById(catalog, structure.structureId)
  if (!found) return

  const { ctx, zoom } = rc
  const structureDef = found.structure
  const structureColor = structureDef.color
  const exclusionStyle = usesExteriorExclusionStyle(structureDef)
  const wallStyle = usesWallStyle(structureDef)
  const [width, height] = getRotatedSize(structureDef.size, structure.rotation)

  const baseX = structure.x * zoom
  const baseY = structure.y * zoom
  const w = width * zoom
  const h = height * zoom

  if (structureDef.tileLayout && structureDef.tileLayout.tiles.length > 0) {
    const { tiles, width: layoutWidth, height: layoutHeight } = structureDef.tileLayout

    for (const tile of tiles) {
      const rotatedPos = rotateTilePosition(tile, structure.rotation, layoutWidth, layoutHeight)
      const worldX = structure.x + rotatedPos.x
      const worldY = structure.y + rotatedPos.y
      const tileKey = `${worldX},${worldY}`
      const tileX = worldX * zoom
      const tileY = worldY * zoom

      if (tile.type === 'access') {
        if (renderedAccessTiles?.has(tileKey)) continue
        renderedAccessTiles?.add(tileKey)

        ctx.fillStyle = colorWithAlpha(structureColor, 0.46)
        ctx.fillRect(tileX, tileY, zoom, zoom)

        ctx.setLineDash([2, 2])
        ctx.strokeStyle = COLORS.accessTileBorder
        ctx.lineWidth = 1
        ctx.strokeRect(tileX + 0.5, tileY + 0.5, zoom - 1, zoom - 1)
        ctx.setLineDash([])
        renderAccessTileIndicator(ctx, tileX, tileY, zoom)
      } else if (tile.type === 'blocked') {
        if (exclusionStyle) {
          ctx.fillStyle = COLORS.exclusionTileFill
          ctx.fillRect(tileX, tileY, zoom, zoom)
          ctx.strokeStyle = COLORS.exclusionTileBorder
          ctx.lineWidth = 1
          ctx.strokeRect(tileX + 0.5, tileY + 0.5, zoom - 1, zoom - 1)
          renderExclusionTileIndicator(ctx, tileX, tileY, zoom)
        } else if (wallStyle) {
          ctx.fillStyle = COLORS.wallTileFill
          ctx.fillRect(tileX, tileY, zoom, zoom)
          ctx.strokeStyle = COLORS.wallTileBorder
          ctx.lineWidth = 1
          ctx.strokeRect(tileX + 0.5, tileY + 0.5, zoom - 1, zoom - 1)
          renderWallTileIndicator(ctx, tileX, tileY, zoom)
        } else {
          ctx.fillStyle = colorWithAlpha(structureColor, 0.78)
          ctx.fillRect(tileX, tileY, zoom, zoom)
          ctx.strokeStyle = COLORS.blockedTileBorder
          ctx.lineWidth = 1
          ctx.strokeRect(tileX + 0.5, tileY + 0.5, zoom - 1, zoom - 1)
          renderBlockedTileIndicator(ctx, tileX, tileY, zoom)
        }
      } else {
        ctx.fillStyle = structureColor
        ctx.fillRect(tileX, tileY, zoom, zoom)
        ctx.strokeStyle = COLORS.structureBorder
        ctx.lineWidth = 1
        ctx.strokeRect(tileX + 0.5, tileY + 0.5, zoom - 1, zoom - 1)
      }
    }
  } else {
    ctx.fillStyle = structureColor
    ctx.fillRect(baseX, baseY, w, h)
    ctx.strokeStyle = COLORS.structureBorder
    ctx.lineWidth = 1
    ctx.strokeRect(baseX + 0.5, baseY + 0.5, w - 1, h - 1)
  }

  renderWallFixtureOverlay(ctx, structureDef, structure.rotation, baseX, baseY, w, h, zoom)

  const hullRelatedNames = ['wall', 'door', 'window', 'hull']
  const isHullRelated = hullRelatedNames.some((name) =>
    structureDef.name.toLowerCase().includes(name)
  )

  if (zoom >= 10 && !isHullRelated) {
    let solidMinX = Infinity,
      solidMaxX = -Infinity,
      solidMinY = Infinity,
      solidMaxY = -Infinity
    let hasSolidTiles = false

    if (structureDef.tileLayout && structureDef.tileLayout.tiles.length > 0) {
      const { tiles, width: layoutWidth, height: layoutHeight } = structureDef.tileLayout

      for (const tile of tiles) {
        if (tile.type === 'construction' || tile.type === 'blocked') {
          const rotatedPos = rotateTilePosition(tile, structure.rotation, layoutWidth, layoutHeight)
          const worldX = structure.x + rotatedPos.x
          const worldY = structure.y + rotatedPos.y

          solidMinX = Math.min(solidMinX, worldX)
          solidMaxX = Math.max(solidMaxX, worldX)
          solidMinY = Math.min(solidMinY, worldY)
          solidMaxY = Math.max(solidMaxY, worldY)
          hasSolidTiles = true
        }
      }
    }

    if (!hasSolidTiles) {
      solidMinX = structure.x
      solidMaxX = structure.x + width - 1
      solidMinY = structure.y
      solidMaxY = structure.y + height - 1
    }

    const solidCenterX = ((solidMinX + solidMaxX + 1) / 2) * zoom
    const solidCenterY = ((solidMinY + solidMaxY + 1) / 2) * zoom

    const fontSize = Math.min(zoom * 0.6, 10)
    ctx.font = `${fontSize}px monospace`
    ctx.fillStyle = COLORS.structureText
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.shadowColor = COLORS.structureTextShadow
    ctx.shadowBlur = 2
    ctx.shadowOffsetX = 1
    ctx.shadowOffsetY = 1
    ctx.fillText(structureDef.name, solidCenterX, solidCenterY)
    ctx.shadowColor = 'transparent'
    ctx.shadowBlur = 0
    ctx.shadowOffsetX = 0
    ctx.shadowOffsetY = 0
  }
}

export function renderStructures(
  rc: RenderContext,
  structures: readonly PlacedStructure[],
  catalog: StructureCatalog,
  visibilityState: VisibilityState
): void {
  const renderedAccessTiles = new Set<string>()

  for (const structure of structures) {
    if (isStructureVisibleForRender(visibilityState, structure)) {
      renderStructure(rc, structure, catalog, renderedAccessTiles)
    }
  }
}

export function renderHullTiles(rc: RenderContext, hullTiles: ReadonlySet<string>): void {
  if (hullTiles.size === 0) return

  const { ctx, zoom } = rc
  const wallThickness = Math.max(2, Math.floor(zoom * 0.15))
  const edges = computePerimeterEdges(hullTiles)

  for (const key of hullTiles) {
    const [xStr, yStr] = key.split(',')
    const tileX = parseInt(xStr, 10)
    const tileY = parseInt(yStr, 10)
    const x = tileX * zoom
    const y = tileY * zoom
    const isInner = isInnerHullTile(hullTiles, tileX, tileY)
    ctx.fillStyle = isInner ? COLORS.hullTileInner : COLORS.hullTile
    ctx.fillRect(x, y, zoom, zoom)
  }

  ctx.strokeStyle = COLORS.hullGridLine
  ctx.lineWidth = 1
  for (const key of hullTiles) {
    const [xStr, yStr] = key.split(',')
    const tileX = parseInt(xStr, 10)
    const tileY = parseInt(yStr, 10)
    const x = tileX * zoom
    const y = tileY * zoom

    if (hullTiles.has(`${tileX + 1},${tileY}`)) {
      ctx.beginPath()
      ctx.moveTo(x + zoom + 0.5, y)
      ctx.lineTo(x + zoom + 0.5, y + zoom)
      ctx.stroke()
    }

    if (hullTiles.has(`${tileX},${tileY + 1}`)) {
      ctx.beginPath()
      ctx.moveTo(x, y + zoom + 0.5)
      ctx.lineTo(x + zoom, y + zoom + 0.5)
      ctx.stroke()
    }
  }

  ctx.fillStyle = COLORS.hullWall
  for (const edge of edges) {
    const x = edge.x * zoom
    const y = edge.y * zoom

    switch (edge.direction) {
      case 'north':
        ctx.fillRect(x, y, zoom, wallThickness)
        break
      case 'south':
        ctx.fillRect(x, y + zoom - wallThickness, zoom, wallThickness)
        break
      case 'west':
        ctx.fillRect(x, y, wallThickness, zoom)
        break
      case 'east':
        ctx.fillRect(x + zoom - wallThickness, y, wallThickness, zoom)
        break
    }
  }
}

export function renderHullPreview(rc: RenderContext, preview: HullPreviewInfo): void {
  const { ctx, zoom } = rc
  const x = preview.x * zoom
  const y = preview.y * zoom

  ctx.fillStyle = COLORS.hullPreview
  ctx.fillRect(x, y, zoom, zoom)
  ctx.setLineDash([3, 3])
  ctx.strokeStyle = COLORS.hullPreviewBorder
  ctx.lineWidth = 2
  ctx.strokeRect(x + 1, y + 1, zoom - 2, zoom - 2)
  ctx.setLineDash([])
}

export function renderSelectionOverlay(rc: RenderContext, overlay: SelectionOverlay): void {
  const { ctx, zoom } = rc

  const minX = Math.min(overlay.rect.x1, overlay.rect.x2)
  const maxX = Math.max(overlay.rect.x1, overlay.rect.x2)
  const minY = Math.min(overlay.rect.y1, overlay.rect.y2)
  const maxY = Math.max(overlay.rect.y1, overlay.rect.y2)

  const px = minX * zoom
  const py = minY * zoom
  const pw = (maxX - minX + 1) * zoom
  const ph = (maxY - minY + 1) * zoom

  if (overlay.mode === 'hull_place') {
    ctx.fillStyle = COLORS.selectionHullPlaceFill
    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        ctx.fillRect(x * zoom, y * zoom, zoom, zoom)
      }
    }
  } else if (overlay.mode === 'hull_erase') {
    ctx.fillStyle = COLORS.selectionHullEraseFill
    if (overlay.hullTiles) {
      for (let x = minX; x <= maxX; x++) {
        for (let y = minY; y <= maxY; y++) {
          const key = `${x},${y}`
          if (overlay.hullTiles.has(key)) ctx.fillRect(x * zoom, y * zoom, zoom, zoom)
        }
      }
    } else {
      ctx.fillRect(px, py, pw, ph)
    }
  } else {
    ctx.fillStyle = overlay.mode === 'erase' ? COLORS.selectionEraseFill : COLORS.selectionFill
    ctx.fillRect(px, py, pw, ph)

    if (overlay.hullTiles) {
      ctx.fillStyle =
        overlay.mode === 'erase' ? COLORS.selectionHullEraseFill : COLORS.selectionFill
      for (let x = minX; x <= maxX; x++) {
        for (let y = minY; y <= maxY; y++) {
          const key = `${x},${y}`
          if (overlay.hullTiles.has(key)) ctx.fillRect(x * zoom, y * zoom, zoom, zoom)
        }
      }
    }

    if (overlay.structureBounds && overlay.structureBounds.length > 0) {
      ctx.fillStyle = overlay.mode === 'erase' ? COLORS.selectionEraseFill : COLORS.selectionFill
      ctx.strokeStyle =
        overlay.mode === 'erase' ? COLORS.selectionEraseBorder : COLORS.selectionBorder
      ctx.lineWidth = 2
      ctx.setLineDash([4, 2])
      for (const b of overlay.structureBounds) {
        const x = b.x * zoom
        const y = b.y * zoom
        const w = b.width * zoom
        const h = b.height * zoom
        ctx.fillRect(x, y, w, h)
        ctx.strokeRect(x + 1, y + 1, w - 2, h - 2)
      }
      ctx.setLineDash([])
    }
  }

  ctx.setLineDash([4, 4])
  ctx.strokeStyle =
    overlay.mode === 'hull_place'
      ? COLORS.hullPreviewBorder
      : overlay.mode === 'hull_erase' || overlay.mode === 'erase'
        ? COLORS.selectionEraseBorder
        : COLORS.selectionBorder
  ctx.lineWidth = 2
  ctx.strokeRect(px + 1, py + 1, pw - 2, ph - 2)
  ctx.setLineDash([])
}

/**
 * Render placement preview ghost with tile-level detail.
 */
export function renderPreview(rc: RenderContext, preview: PreviewInfo): void {
  const { ctx, zoom } = rc
  const structureColor = preview.color
  const exclusionStyle = previewUsesExteriorExclusionStyle(preview.color)
  const wallStyle = previewUsesWallStyle(preview.color)

  if (preview.tileLayout && preview.tileLayout.tiles.length > 0) {
    const { tiles, width: layoutWidth, height: layoutHeight } = preview.tileLayout

    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity

    for (const tile of tiles) {
      const rotatedPos = rotateTilePosition(tile, preview.rotation, layoutWidth, layoutHeight)

      minX = Math.min(minX, rotatedPos.x)
      maxX = Math.max(maxX, rotatedPos.x)
      minY = Math.min(minY, rotatedPos.y)
      maxY = Math.max(maxY, rotatedPos.y)

      const tileX = (preview.x + rotatedPos.x) * zoom
      const tileY = (preview.y + rotatedPos.y) * zoom

      if (tile.type === 'construction') {
        ctx.fillStyle = colorWithAlpha(structureColor, 0.6)
        ctx.fillRect(tileX, tileY, zoom, zoom)
        ctx.strokeStyle = COLORS.structureBorder
        ctx.lineWidth = 1
        ctx.strokeRect(tileX + 0.5, tileY + 0.5, zoom - 1, zoom - 1)
      } else if (tile.type === 'blocked') {
        if (exclusionStyle) {
          ctx.fillStyle = COLORS.exclusionTileFill
          ctx.fillRect(tileX, tileY, zoom, zoom)
          ctx.strokeStyle = COLORS.exclusionTileBorder
          ctx.lineWidth = 1
          ctx.strokeRect(tileX + 0.5, tileY + 0.5, zoom - 1, zoom - 1)
          renderExclusionTileIndicator(ctx, tileX, tileY, zoom)
        } else if (wallStyle) {
          ctx.fillStyle = COLORS.wallTileFill
          ctx.fillRect(tileX, tileY, zoom, zoom)
          ctx.strokeStyle = COLORS.wallTileBorder
          ctx.lineWidth = 1
          ctx.strokeRect(tileX + 0.5, tileY + 0.5, zoom - 1, zoom - 1)
          renderWallTileIndicator(ctx, tileX, tileY, zoom)
        } else {
          ctx.fillStyle = colorWithAlpha(structureColor, 0.78)
          ctx.fillRect(tileX, tileY, zoom, zoom)
          ctx.strokeStyle = COLORS.blockedTileBorder
          ctx.lineWidth = 1
          ctx.strokeRect(tileX + 0.5, tileY + 0.5, zoom - 1, zoom - 1)
          renderBlockedTileIndicator(ctx, tileX, tileY, zoom)
        }
      } else {
        ctx.fillStyle = colorWithAlpha(structureColor, 0.46)
        ctx.fillRect(tileX, tileY, zoom, zoom)
        ctx.setLineDash([2, 2])
        ctx.strokeStyle = COLORS.accessTileBorder
        ctx.lineWidth = 1
        ctx.strokeRect(tileX + 0.5, tileY + 0.5, zoom - 1, zoom - 1)
        ctx.setLineDash([])
        renderAccessTileIndicator(ctx, tileX, tileY, zoom)
      }
    }

    const x = (preview.x + minX) * zoom
    const y = (preview.y + minY) * zoom
    const w = (maxX - minX + 1) * zoom
    const h = (maxY - minY + 1) * zoom

    ctx.setLineDash([4, 4])
    ctx.strokeStyle = preview.isValid ? COLORS.previewBorderValid : COLORS.previewBorderInvalid
    ctx.lineWidth = 2
    ctx.strokeRect(x + 1, y + 1, w - 2, h - 2)
    ctx.setLineDash([])
  } else {
    const x = preview.x * zoom
    const y = preview.y * zoom
    const w = preview.width * zoom
    const h = preview.height * zoom

    ctx.fillStyle = preview.isValid ? colorWithAlpha(structureColor, 0.53) : COLORS.previewInvalid
    ctx.fillRect(x, y, w, h)

    ctx.setLineDash([4, 4])
    ctx.strokeStyle = preview.isValid ? COLORS.previewBorderValid : COLORS.previewBorderInvalid
    ctx.lineWidth = 2
    ctx.strokeRect(x + 1, y + 1, w - 2, h - 2)
    ctx.setLineDash([])
  }
}

export function getTileFromMouse(
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
  zoom: number
): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect()
  const x = Math.floor((clientX - rect.left) / zoom)
  const y = Math.floor((clientY - rect.top) / zoom)
  return { x, y }
}

export function renderScene(
  rc: RenderContext,
  structures: readonly PlacedStructure[],
  hullTiles: ReadonlySet<string>,
  catalog: StructureCatalog,
  visibilityState: VisibilityState,
  showGrid: boolean,
  preview: PreviewInfo | null,
  hullPreview: HullPreviewInfo | null
): void {
  clearCanvas(rc)

  if (showGrid) {
    renderGrid(rc)
    renderCenterLines(rc)
  }

  renderHullTiles(rc, hullTiles)
  renderStructures(rc, structures, catalog, visibilityState)

  if (preview) renderPreview(rc, preview)
  if (hullPreview) renderHullPreview(rc, hullPreview)
}

export function exportToPNG(
  gridSize: GridSize,
  structures: readonly PlacedStructure[],
  hullTiles: ReadonlySet<string>,
  catalog: StructureCatalog,
  visibilityState: VisibilityState,
  scale: number
): string {
  const canvas = document.createElement('canvas')
  canvas.width = gridSize.width * scale
  canvas.height = gridSize.height * scale

  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('Failed to get 2D context for export')
  }

  const rc: RenderContext = {
    canvas,
    ctx,
    gridSize,
    zoom: scale,
    dpr: 1,
  }

  clearCanvas(rc)
  renderGrid(rc)
  renderCenterLines(rc)
  renderHullTiles(rc, hullTiles)
  renderStructures(rc, structures, catalog, visibilityState)

  return canvas.toDataURL('image/png')
}
