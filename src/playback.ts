import type { BoardPlayer, Mark, Point, Scene } from './model'

// Presentation-only motion. Never mutates the saved scene.
const MOVING = new Set<Mark['kind']>(['run', 'carry'])
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const between = (a: Point, b: Point, t: number): Point => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) })
const clamp = (t: number) => Math.min(1, Math.max(0, t))
const ballBy = (player: BoardPlayer): Point => ({ x: player.point.x + 23, y: player.point.y + 12 })

function pathPoint(start: Point, mark: Mark, t: number): Point {
  const end = mark.points[mark.points.length - 1]
  if (!end) return start
  if (!mark.control) return between(start, end, t)
  const a = between(start, mark.control, t)
  const b = between(mark.control, end, t)
  return between(a, b, t)
}

// The editor draws arrows just outside a player's marker (about 20 pitch units).
// Recognise that start point, rather than demanding another authoring workflow.
function nearPlayer(players: BoardPlayer[], point: Point | undefined): BoardPlayer | undefined {
  if (!point) return undefined
  const ranked = players.map(player => ({ player, gap: distance(player.point, point) }))
    .sort((a, b) => a.gap - b.gap)
  return ranked[0]?.gap <= 47 ? ranked[0].player : undefined
}

export function hasPlayableMovement(scene: Scene): boolean {
  return !scene.image && (Object.keys(scene.motionTargets ?? {}).some(id => scene.players.some(player => player.id === id)) || scene.marks.some(mark =>
    (MOVING.has(mark.kind) && !!nearPlayer(scene.players, mark.points[0])) ||
    (mark.kind === 'pass' && mark.points.length >= 2)))
}

export function projectPlayback(scene: Scene, position: number): Scene {
  if (scene.image || !scene.players.length) return scene
  const t = clamp(position)
  const motion = new Map<string, Mark>()
  let carry: BoardPlayer | undefined
  let pass: Mark | undefined
  for (const mark of scene.marks) {
    if (mark.points.length < 2) continue
    if (MOVING.has(mark.kind)) {
      const player = nearPlayer(scene.players, mark.points[0])
      if (player && !motion.has(player.id)) motion.set(player.id, mark)
      if (player && mark.kind === 'carry' && !carry) carry = player
    } else if (mark.kind === 'pass' && !pass) {
      pass = mark
    }
  }

  const players = scene.players.map(player => {
    const target = scene.motionTargets?.[player.id]
    if (target) return { ...player, point: between(player.point, target, t) }
    const run = motion.get(player.id)
    return run ? { ...player, point: pathPoint(player.point, run, t) } : player
  })
  let ball = scene.ball

  // A carry automatically demonstrates possession during preview. Saved possession
  // is unchanged and can be assigned explicitly to any player using the Ball tool.
  if (carry && !pass) {
    const carrier = players.find(player => player.id === carry!.id)!
    ball = { point: carrier.point, playerId: carrier.id }
  }

  // Show the pass in flight, then attach it to the receiver if one is near its end.
  if (pass) {
    const source = nearPlayer(scene.players, pass.points[0])
    const receiver = nearPlayer(scene.players, pass.points[pass.points.length - 1])
    const from = source ? ballBy(source) : pass.points[0]
    const end = pass.points[pass.points.length - 1]
    if (t <= 0.12 && source) {
      const holder = players.find(player => player.id === source.id) ?? source
      ball = { point: holder.point, playerId: holder.id }
    } else if (t < 0.88) {
      ball = { point: pathPoint(from, pass, clamp((t - 0.12) / 0.76)) }
    } else if (receiver) {
      const holder = players.find(player => player.id === receiver.id) ?? receiver
      ball = { point: holder.point, playerId: holder.id }
    } else {
      ball = { point: end }
    }
  }
  return { ...scene, players, ball }
}
