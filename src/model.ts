import { activeLineup, mergeMatchEvents } from './match'
import type { Formation, Match, Player, Side, Substitution } from './match'

export type Point = { x: number; y: number }
export type View = 'full' | 'attacking' | 'defensive' | 'penalty' | 'own-penalty'
export type MarkStyle = 'solid' | 'dash' | 'dot'
export type Mark = {
  id: string
  kind: 'run' | 'pass' | 'carry' | 'freehand' | 'line' | 'zone' | 'highlight'
  points: Point[]
  control?: Point
  colour: string
  style: MarkStyle
}
export type BoardPlayer = Player & {
  teamId: string
  colour: string
  point: Point
  slotId: string
}
export type Ball = { point: Point; playerId?: string }
export type Still = { src: string; width: number; height: number; fit: 'fit' | 'crop' }
type Layer = { view: View; marks: Mark[]; showAnnotations: boolean }
export type Scene = Layer & {
  id: string
  name: string
  image?: Still
  showPlayerNames?: boolean
  pitchLayer?: Layer
  players: BoardPlayer[]
  ball: Ball | null
  formations: Record<Side, Formation>
  minute: number
  addedTime: number
  substitutions: Substitution[]
}
export type Board = {
  version: 1
  id: string
  name: string
  match: Match | null
  scenes: Scene[]
  activeScene: string
  updatedAt: number
}

export const newId = () => globalThis.crypto.randomUUID?.()
  ?? Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), (value) => value.toString(16).padStart(2, '0')).join('')

export function makeScene(name: string, match: Match | null = null): Scene {
  const scene: Scene = {
    id: newId(), name, view: 'full', showAnnotations: true, marks: [], players: [],
    ball: null, formations: {
      home: match?.home.formation ?? '4-3-3',
      away: match?.away.formation ?? '4-3-3',
    },
    minute: 0, addedTime: 0, substitutions: [],
  }
  return syncPlayers(scene, match)
}

export function makeBoard(): Board {
  const scene = makeScene('Scene 1')
  return {
    version: 1, id: newId(), name: 'Untitled board', match: null,
    scenes: [scene], activeScene: scene.id, updatedAt: 0,
  }
}

const depth = {
  2: [205, 405],
  3: [185, 315, 445],
  4: [170, 260, 350, 445],
} as const

export function formationPoints(formation: Formation, side: Side): Point[] {
  const rows = formation.split('-').map(Number)
  const layers = depth[rows.length as keyof typeof depth]
  const orient = (x: number, y: number) => side === 'home' ? { x, y } : { x: 1050 - x, y: 680 - y }
  return [
    orient(64, 340),
    ...rows.flatMap((count, row) => {
      const spacing = count === 5 ? 107 : count === 4 ? 131 : count === 3 ? 156 : 162
      return Array.from({ length: count }, (_, index) => {
        const lateral = index - (count - 1) / 2
        const wide = count >= 3 && Math.abs(lateral) === (count - 1) / 2
        const stagger = wide ? (row === 0 ? 18 : -16) : 0
        return orient(layers[row] + stagger, 340 + lateral * spacing)
      })
    }),
  ]
}

export function syncPlayers(scene: Scene, match: Match | null, resetSide?: Side): Scene {
  const events = mergeMatchEvents(match?.substitutions ?? [], scene.substitutions)
  const players: BoardPlayer[] = []
  if (match) {
    for (const side of ['home', 'away'] as const) {
      const team = match[side]
      const previous = scene.players.filter((player) => player.teamId === team.id)
      const points = formationPoints(scene.formations[side], side)
      const starters = activeLineup(team, [], 0)
      const keeper = starters.find(({ player }) => player.role === 'GK')
      const slots = keeper ? [keeper, ...starters.filter((slot) => slot !== keeper)] : starters
      for (const { player, slotId } of activeLineup(team, events, scene.minute, scene.addedTime)) {
        const oldPlayer = previous.find((item) => item.id === player.id)
        const oldSlot = previous.find((item) => item.slotId === slotId)
        const fallback = points[slots.findIndex((slot) => slot.slotId === slotId)]
        const point = (resetSide === side ? undefined : oldPlayer?.point ?? oldSlot?.point) ?? fallback
        if (point) players.push({ ...player, teamId: team.id, colour: team.colour, slotId, point })
      }
    }
  }
  let ball = scene.ball
  if (ball?.playerId && !players.some((player) => player.id === ball?.playerId)) {
    const carrier = scene.players.find((player) => player.id === ball?.playerId)
    ball = { point: carrier ? { x: carrier.point.x + 23, y: carrier.point.y + 12 } : ball.point }
  }
  return { ...scene, players, ball }
}

export function updateMatch(board: Board, match: Match | null): Board {
  if (board.match === match) return board
  const different = board.match?.id !== match?.id
  const scenes = board.scenes.map((scene) => {
    if (!different) {
      const formations = { ...scene.formations }
      for (const side of ['home', 'away'] as const) {
        const previous = board.match?.[side]
        const imported = match?.[side].formation
        if (imported && !previous?.xi.length && formations[side] === (previous?.formation ?? '4-3-3')) {
          formations[side] = imported
        }
      }
      return syncPlayers({ ...scene, formations }, match)
    }
    return syncPlayers({
      ...scene, minute: 0, addedTime: 0, substitutions: [], players: [], ball: null,
      formations: {
        home: match?.home.formation ?? '4-3-3',
        away: match?.away.formation ?? '4-3-3',
      },
    }, match)
  })
  return { ...board, match, scenes }
}

export function importStill(scene: Scene, image: Still): Scene {
  const pitchLayer = scene.pitchLayer ?? { view: scene.view, marks: scene.marks, showAnnotations: scene.showAnnotations }
  return { ...scene, image, pitchLayer, marks: [], showAnnotations: true }
}

export function removeStill(scene: Scene): Scene {
  const { image, pitchLayer, ...pitch } = scene
  return { ...pitch, ...pitchLayer }
}
