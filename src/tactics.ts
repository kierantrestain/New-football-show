import type { BoardPlayer, Point, Scene } from './model'

export type Bounds = Point & { width: number; height: number }
export type TeamShape = {
  id: string
  side: 'home' | 'away'
  colour: string
  hull: Point[]
  widthMetres: number
  depthMetres: number
  outfieldCount: number
}

export const pitchMetres = (a: Point, b: Point) =>
  Math.hypot(a.x - b.x, a.y - b.y) / 10

const cross = (a: Point, b: Point, c: Point) =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)

// The convex hull is an editorial view of the shape selected on the board,
// never a claim about measured real-world player tracking.
export function convexHull(points: Point[]): Point[] {
  const unique = [...new Map(points.map(p => [p.x + ':' + p.y, p])).values()]
    .sort((a, b) => a.x - b.x || a.y - b.y)
  if (unique.length <= 2) return unique
  const lower: Point[] = []
  const upper: Point[] = []
  for (const p of unique) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop()
    lower.push(p)
  }
  for (const p of [...unique].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop()
    upper.push(p)
  }
  lower.pop()
  upper.pop()
  return [...lower, ...upper]
}

export function teamShapes(scene: Scene): TeamShape[] {
  if (scene.image || !scene.shapeTeams || scene.shapeTeams === 'off') return []
  const teamIds = [...new Set(scene.players.map(player => player.teamId))].slice(0, 2)
  return teamIds.flatMap((id, index) => {
    const side = index === 0 ? 'home' : 'away'
    if (scene.shapeTeams !== 'both' && scene.shapeTeams !== side) return []
    const members = scene.players.filter(player => player.teamId === id)
    // Exclude the goalkeeper so the occupied outfield block is meaningful.
    const outfield = members.filter(player => player.role !== 'GK')
    const points = outfield.map(player => player.point)
    if (points.length < 3) return []
    const xs = points.map(p => p.x)
    const ys = points.map(p => p.y)
    return [{
      id, side, colour: members[0].colour, hull: convexHull(points),
      widthMetres: (Math.max(...ys) - Math.min(...ys)) / 10,
      depthMetres: (Math.max(...xs) - Math.min(...xs)) / 10,
      outfieldCount: outfield.length,
    }]
  })
}

export function selectedUnit(scene: Scene, side: 'home' | 'away', unit: 'all' | 'defence' | 'midfield' | 'attack'): string[] {
  const teamIds = [...new Set(scene.players.map(player => player.teamId))]
  const id = teamIds[side === 'home' ? 0 : 1]
  if (!id) return []
  const role = unit === 'defence' ? 'DEF' : unit === 'midfield' ? 'MID' : unit === 'attack' ? 'FWD' : null
  return scene.players.filter(player => player.teamId === id && (!role || player.role === role)).map(p => p.id)
}

export function shiftGroup<T extends BoardPlayer>(players: T[], ids: string[], delta: Point, bounds: Bounds): T[] {
  const chosen = players.filter(p => ids.includes(p.id))
  if (!chosen.length) return players
  const minX = Math.min(...chosen.map(p => p.point.x))
  const maxX = Math.max(...chosen.map(p => p.point.x))
  const minY = Math.min(...chosen.map(p => p.point.y))
  const maxY = Math.max(...chosen.map(p => p.point.y))
  const dx = Math.max(bounds.x - minX, Math.min(bounds.x + bounds.width - maxX, delta.x))
  const dy = Math.max(bounds.y - minY, Math.min(bounds.y + bounds.height - maxY, delta.y))
  const moved = new Set(ids)
  return players.map(player => moved.has(player.id)
    ? { ...player, point: { x: player.point.x + dx, y: player.point.y + dy } } : player)
}

// Create target positions, not arrows. Keep group spacing and clamp as one block.
export function setMovementTargets(scene: Scene, ids: string[], delta: Point, bounds: Bounds): Scene {
  const shifted = shiftGroup(scene.players, ids, delta, bounds)
  const targets = { ...(scene.motionTargets ?? {}) }
  const selected = new Set(ids)
  shifted.forEach(player => { if (selected.has(player.id)) targets[player.id] = { ...player.point } })
  return { ...scene, motionTargets: targets }
}

export function clearMovementTargets(scene: Scene, ids?: string[]): Scene {
  if (!scene.motionTargets) return scene
  if (!ids) return { ...scene, motionTargets: {} }
  const targets = { ...scene.motionTargets }
  ids.forEach(id => delete targets[id])
  return { ...scene, motionTargets: targets }
}
