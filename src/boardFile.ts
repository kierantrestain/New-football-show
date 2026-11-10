import { FORMATIONS, parseMatch } from './match'
import type { Substitution } from './match'
import { newId, syncPlayers } from './model'
import type { Board, Mark, Point, Scene, Still, View } from './model'

const FORMAT = 'touchline-board'
const MAX_SIZE = 96 * 1024 * 1024
const imageData = /^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/]+={0,2}$/i
const views = new Set<View>(['full', 'attacking', 'defensive', 'penalty', 'own-penalty'])
const markKinds = new Set<Mark['kind']>(['run', 'pass', 'carry', 'freehand', 'line', 'zone', 'highlight', 'distance'])
const styles = new Set<Mark['style']>(['solid', 'dash', 'dot'])

function requireField(condition: unknown, name: string): asserts condition {
  if (!condition) throw new Error(`Invalid board file · ${name}.`)
}

function record(input: unknown, name: string): Record<string, unknown> {
  requireField(input && typeof input === 'object' && !Array.isArray(input), name)
  return input as Record<string, unknown>
}

function list(input: unknown, max: number, name: string): unknown[] {
  requireField(Array.isArray(input) && input.length <= max, name)
  return input
}

function string(input: unknown, max: number, name: string): string {
  requireField(typeof input === 'string' && input.trim() && input.length <= max, name)
  return input
}

function integer(input: unknown, min: number, max: number, name: string): number {
  requireField(typeof input === 'number' && Number.isInteger(input) && input >= min && input <= max, name)
  return input
}

function point(input: unknown): Point {
  const { x, y } = record(input, 'coordinates')
  requireField(typeof x === 'number' && typeof y === 'number' && Number.isFinite(x) && Number.isFinite(y), 'coordinates')
  return { x, y }
}

function layer(input: unknown): Pick<Scene, 'view' | 'marks' | 'showAnnotations'> {
  const raw = record(input, 'annotation layer')
  const view = raw.view as View
  requireField(views.has(view) && typeof raw.showAnnotations === 'boolean', 'pitch view or annotation visibility')
  const marks = list(raw.marks, 5000, 'annotations').map((item): Mark => {
    const mark = record(item, 'annotation')
    const id = string(mark.id, 128, 'annotation ID')
    const kind = mark.kind as Mark['kind']
    const style = mark.style as Mark['style']
    const colour = string(mark.colour, 7, 'annotation colour')
    requireField(markKinds.has(kind) && styles.has(style) && /^#(?:[a-f0-9]{3}|[a-f0-9]{6})$/i.test(colour), 'annotation style')
    const points = list(mark.points, 25000, 'annotation points').map(point)
    requireField(points.length >= 2 && (kind === 'freehand' || points.length === 2), 'annotation geometry')
    return { id, kind, style, colour, points, control: mark.control === undefined ? undefined : point(mark.control) }
  })
  requireField(new Set(marks.map(({ id }) => id)).size === marks.length, 'duplicate annotation ID')
  return { view, showAnnotations: raw.showAnnotations, marks }
}

function sceneChanges(input: unknown): Substitution[] {
  return list(input, 30, 'scene substitutions').map((item) => {
    const event = record(item, 'substitution')
    const teamId = string(event.teamId, 128, 'substitution team')
    const off = string(event.off, 128, 'outgoing player')
    const on = string(event.on, 128, 'incoming player')
    requireField(off !== on, 'substitution players')
    const minute = integer(event.minute, 1, 120, 'substitution minute')
    const addedTime = event.addedTime === undefined ? undefined : integer(event.addedTime, 0, 30, 'added time')
    const verification = event.verification
    requireField(verification === 'manual' || verification === 'verified', 'substitution verification')
    const source = event.source === undefined ? undefined : string(event.source, 2048, 'substitution source')
    requireField(verification === 'manual' || (source && /^https?:\/\//i.test(source)), 'substitution source')
    return { teamId, off, on, minute, addedTime, verification, source }
  })
}

export function serialiseBoard(board: Board) {
  const images = new Map<string, number>()
  const scenes = board.scenes.map(({ image, ...scene }) => {
    if (!image) return scene
    const { src, ...settings } = image
    if (!images.has(src)) images.set(src, images.size)
    return { ...scene, image: { ...settings, asset: images.get(src) } }
  })
  return JSON.stringify({ format: FORMAT, version: 1, board: { ...board, scenes }, images: [...images.keys()] })
}

export function parseBoardFile(input: unknown, id: string, updatedAt: number): Board {
  const archive = record(input, 'file format')
  requireField(archive.format === FORMAT && archive.version === 1, 'unsupported file format')
  const images = list(archive.images, 200, 'image assets').map((item) => {
    requireField(typeof item === 'string' && item.length <= 42 * 1024 * 1024 && imageData.test(item), 'embedded still')
    return item
  })
  const board = record(archive.board, 'board')
  const match = board.match === null ? null : parseMatch(board.match)
  const scenes = list(board.scenes, 200, 'scenes').map((item): Scene => {
    const raw = record(item, 'scene')
    const formations = record(raw.formations, 'formations')
    const home = FORMATIONS.find((formation) => formation === formations.home)
    const away = FORMATIONS.find((formation) => formation === formations.away)
    requireField(home && away, 'formations')
    const base: Scene = {
      ...layer(raw), id: string(raw.id, 128, 'scene ID'), name: string(raw.name, 70, 'scene name'),
      formations: { home, away }, players: [], ball: null,
      minute: integer(raw.minute, 0, 120, 'match minute'), addedTime: integer(raw.addedTime, 0, 30, 'added time'),
      substitutions: sceneChanges(raw.substitutions),
    }
    if (raw.shapeTeams !== undefined) {
      requireField(['off', 'home', 'away', 'both'].includes(String(raw.shapeTeams)), 'team shape visibility')
      base.shapeTeams = raw.shapeTeams as Scene['shapeTeams']
    }
    if (raw.showPlayerNames !== undefined) {
      requireField(typeof raw.showPlayerNames === 'boolean', 'player name visibility')
      base.showPlayerNames = raw.showPlayerNames
    }
    if (raw.image !== undefined) {
      const image = record(raw.image, 'still settings')
      const fit = image.fit
      requireField(fit === 'fit' || fit === 'crop', 'still framing')
      const asset = integer(image.asset, 0, images.length - 1, 'still reference')
      base.image = {
        src: images[asset], fit, width: integer(image.width, 1, 32768, 'still width'),
        height: integer(image.height, 1, 32768, 'still height'),
      }
    }
    if (raw.pitchLayer !== undefined) base.pitchLayer = layer(raw.pitchLayer)
    const positions = new Map(list(raw.players, 22, 'players').map((item) => {
      const player = record(item, 'player position')
      return [string(player.id, 128, 'player ID'), point(player.point)] as const
    }))
    const placed = syncPlayers(base, match)
    placed.players = placed.players.map((player) => ({ ...player, point: positions.get(player.id) ?? player.point }))
    if (raw.motionTargets !== undefined) {
      const targets = record(raw.motionTargets, 'movement targets')
      requireField(Object.keys(targets).length <= 22, 'movement target count')
      const ids = new Set(placed.players.map(player => player.id))
      placed.motionTargets = Object.fromEntries(Object.entries(targets).map(([id, target]) => {
        requireField(ids.has(id), 'movement target player')
        const destination = point(target)
        requireField(destination.x >= 0 && destination.x <= 1050 && destination.y >= 0 && destination.y <= 680, 'movement target bounds')
        return [id, destination]
      }))
    }
    if (raw.ball !== null) {
      const ball = record(raw.ball, 'ball')
      const holder = placed.players.find((player) => player.id === ball.playerId)
      placed.ball = { point: point(ball.point), playerId: holder?.id }
    }
    return placed
  })
  const activeScene = string(board.activeScene, 128, 'active scene')
  requireField(new Set(scenes.map((scene) => scene.id)).size === scenes.length && scenes.some((scene) => scene.id === activeScene), 'scene order or selection')
  return { version: 1, id, updatedAt, name: string(board.name, 70, 'board name'), match, scenes, activeScene }
}

export async function readBoardFile(file: File): Promise<Board> {
  if (file.size > MAX_SIZE) throw new Error('Choose a Touchline board file under 96 MB.')
  let input: unknown
  try { input = JSON.parse(await file.text()) }
  catch { throw new Error('This file could not be read as a Touchline board.') }
  const board = parseBoardFile(input, newId(), Date.now())
  const images = new Map<string, Still>()
  for (const { image } of board.scenes) {
    if (!image) continue
    const stored = images.get(image.src)
    requireField(!stored || (stored.width === image.width && stored.height === image.height), 'still dimensions')
    images.set(image.src, image)
  }
  await Promise.all([...images.values()].map(async (still) => {
    const image = new Image()
    image.src = still.src
    await image.decode().catch(() => { throw new Error('The board contains a still that could not be opened.') })
    requireField(image.naturalWidth === still.width && image.naturalHeight === still.height, 'still dimensions')
  }))
  return board
}

export function downloadBoardFile(board: Board) {
  const blob = new Blob([serialiseBoard(board)], { type: 'application/json' })
  if (blob.size > MAX_SIZE) throw new Error('This board is too large to transfer as one file.')
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${board.name.replace(/[\\/:*?"<>|]/g, '-').trim() || 'Touchline'}.touchline.json`
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1500)
}
