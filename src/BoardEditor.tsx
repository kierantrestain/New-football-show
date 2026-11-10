import { useEffect, useId, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent } from 'react'
import { BoardVisual, getBallPoint, getBoardBounds, getVisibleBounds } from './BoardVisual'
import type { BoardSelection } from './BoardVisual'
import type { BoardPlayer, Mark, Point, Scene } from './model'
import './boardEditor.css'

export type { BoardSelection } from './BoardVisual'

export type BoardTool = 'select' | 'run' | 'pass' | 'carry' | 'draw' | 'shape' | 'highlight' | 'erase' | 'ball'
export interface BoardOptions {
  colour: string
  style: Mark['style']
  curved: boolean
  drawMode: 'freehand' | 'line'
  shapeMode: 'zone' | 'line'
  group: boolean
}
interface BoardEditorProps {
  scene: Scene
  tool: BoardTool
  options: BoardOptions
  onCommit: (scene: Scene) => void
  resetKey?: string | number
  onSelectionChange?: (selection: BoardSelection) => void
}

interface Bounds extends Point {
  width: number
  height: number
}

type Handle = 'start' | 'end' | 'bend'
type GestureMode =
  | { kind: 'players'; target: string; ids: string[]; wasSelected: boolean; additive: boolean }
  | { kind: 'mark'; mark: Mark; handle?: Handle; origin?: Point }
  | { kind: 'ball'; origin: Point; target?: string; placing: boolean }
  | { kind: 'marquee'; ids: string[] }
  | { kind: 'erase'; ids: Set<string> }
  | { kind: 'create'; mark: Mark; source?: BoardPlayer; samples: Point[]; curved: boolean }

type Gesture = GestureMode & {
  pointerId: number
  start: Point
  screen: Point
  base: Scene
  moved: boolean
}

const emptySelection: BoardSelection = { players: [] }
const arrowKinds = new Set<Mark['kind']>(['run', 'pass', 'carry'])
const markNames: Record<Mark['kind'], string> = {
  run: 'Run arrow', pass: 'Pass arrow', carry: 'Carry arrow', freehand: 'Freehand drawing',
  line: 'Line', zone: 'Zone', highlight: 'Highlight',
}
let markSequence = 0

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)
const deltaBetween = (from: Point, to: Point) => ({ x: to.x - from.x, y: to.y - from.y })
const offset = (point: Point, delta: Point) => ({ x: point.x + delta.x, y: point.y + delta.y })
const midpoint = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
const box = (a: Point, b: Point): Bounds => ({
  x: Math.min(a.x, b.x), y: Math.min(a.y, b.y),
  width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y),
})
const within = (point: Point, bounds: Bounds) =>
  point.x >= bounds.x && point.y >= bounds.y &&
  point.x <= bounds.x + bounds.width && point.y <= bounds.y + bounds.height
const constrain = (point: Point, bounds: Bounds) => ({
  x: clamp(point.x, bounds.x, bounds.x + bounds.width),
  y: clamp(point.y, bounds.y, bounds.y + bounds.height),
})

function constrainedDelta(points: Point[], delta: Point, bounds: Bounds): Point {
  const extents = points.reduce((range, point) => ({
    left: Math.min(range.left, point.x), right: Math.max(range.right, point.x),
    top: Math.min(range.top, point.y), bottom: Math.max(range.bottom, point.y),
  }), { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity })
  const minX = bounds.x - extents.left
  const maxX = bounds.x + bounds.width - extents.right
  const minY = bounds.y - extents.top
  const maxY = bounds.y + bounds.height - extents.bottom
  return {
    x: minX <= maxX ? clamp(delta.x, minX, maxX) : 0,
    y: minY <= maxY ? clamp(delta.y, minY, maxY) : 0,
  }
}

function visibleMarks(scene: Scene, bounds: Bounds) {
  if (!scene.showAnnotations) return []
  return scene.marks.filter(mark => {
    const points = mark.control ? [...mark.points, mark.control] : mark.points
    return points.some(point => point.x >= bounds.x)
      && points.some(point => point.x <= bounds.x + bounds.width)
      && points.some(point => point.y >= bounds.y)
      && points.some(point => point.y <= bounds.y + bounds.height)
  })
}

function eventPoint(event: PointerEvent<SVGSVGElement>): Point | undefined {
  const matrix = event.currentTarget.getScreenCTM()
  if (!matrix) return
  const point = event.currentTarget.createSVGPoint()
  point.x = event.clientX
  point.y = event.clientY
  return point.matrixTransform(matrix.inverse())
}

function hitAt(event: PointerEvent<SVGSVGElement>) {
  const target = event.currentTarget.ownerDocument.elementFromPoint(event.clientX, event.clientY)
  return target && event.currentTarget.contains(target) ? target : null
}

function hitId(target: Element | null, attribute: 'player' | 'annotation') {
  return target?.closest(`[data-${attribute}]`)?.getAttribute(`data-${attribute}`) ?? undefined
}

function hitPlayer(event: PointerEvent<SVGSVGElement>, players: BoardPlayer[]) {
  const svg = event.currentTarget
  const targets = svg.ownerDocument.elementsFromPoint(event.clientX, event.clientY)
  for (const target of targets) {
    if (!svg.contains(target)) continue
    const id = hitId(target, 'player')
    if (id) return players.find(player => player.id === id)
  }
}

function defaultBend(start: Point, end: Point, bounds: Bounds): Point {
  const mid = midpoint(start, end)
  const length = distance(start, end)
  if (!length) return mid
  const depth = Math.min(length * 0.28, 130)
  return constrain({
    x: mid.x + (end.y - start.y) * depth / length,
    y: mid.y - (end.x - start.x) * depth / length,
  }, bounds)
}

function outsideMarker(center: Point, toward: Point) {
  const length = distance(center, toward)
  if (!length) return center
  const fraction = Math.min(20 / length, 0.43)
  return { x: center.x + (toward.x - center.x) * fraction, y: center.y + (toward.y - center.y) * fraction }
}

function newMark(tool: BoardTool, options: BoardOptions, point: Point): Mark {
  let kind: Mark['kind'] = 'highlight'
  if (tool === 'run' || tool === 'pass' || tool === 'carry') kind = tool
  if (tool === 'draw') kind = options.drawMode
  if (tool === 'shape') kind = options.shapeMode
  return {
    id: globalThis.crypto?.randomUUID?.() ?? `mark-${Date.now()}-${++markSequence}`,
    kind, points: [point, point], colour: options.colour, style: options.style,
  }
}

function replaceMark(scene: Scene, mark: Mark) {
  if (scene.marks.includes(mark)) return scene
  return { ...scene, marks: scene.marks.map(current => current.id === mark.id ? mark : current) }
}

export function restyleMark(scene: Scene, id: string, style: Partial<Pick<BoardOptions, 'colour' | 'style' | 'curved'>>): Scene {
  const mark = scene.marks.find(item => item.id === id)
  if (!mark) return scene
  const colour = style.colour ?? mark.colour
  const dash = style.style ?? mark.style
  let control = mark.control
  if (style.curved !== undefined && arrowKinds.has(mark.kind)) {
    control = style.curved ? control ?? defaultBend(mark.points[0], mark.points[1], getBoardBounds(scene)) : undefined
  }
  if (colour === mark.colour && dash === mark.style && control === mark.control) return scene
  return replaceMark(scene, { ...mark, colour, style: dash, control })
}

function translateMark(mark: Mark, delta: Point, bounds: Bounds): Mark {
  const points = mark.control ? [...mark.points, mark.control] : mark.points
  const movement = constrainedDelta(points, delta, bounds)
  if (!movement.x && !movement.y) return mark
  return {
    ...mark,
    points: mark.points.map(point => offset(point, movement)),
    control: mark.control ? offset(mark.control, movement) : undefined,
  }
}

function reshapeMark(mark: Mark, handle: Handle, point: Point): Mark {
  if (handle === 'bend') return { ...mark, control: point }
  const first = handle === 'start'
  const last = mark.points.length - 1
  const target = first ? 0 : last
  if (mark.kind !== 'freehand') {
    return { ...mark, points: mark.points.map((value, index) => index === target ? point : value) }
  }

  const anchor = mark.points[first ? last : 0]
  const previous = deltaBetween(anchor, mark.points[target])
  const next = deltaBetween(anchor, point)
  const lengthSquared = previous.x ** 2 + previous.y ** 2
  if (lengthSquared < 0.01) {
    const movement = deltaBetween(mark.points[target], point)
    return { ...mark, points: mark.points.map((value, index) => {
      const fraction = first ? 1 - index / last : index / last
      return offset(value, { x: movement.x * fraction, y: movement.y * fraction })
    }) }
  }

  const scale = (next.x * previous.x + next.y * previous.y) / lengthSquared
  const rotation = (next.y * previous.x - next.x * previous.y) / lengthSquared
  return { ...mark, points: mark.points.map(value => {
    const vector = deltaBetween(anchor, value)
    return { x: anchor.x + scale * vector.x - rotation * vector.y, y: anchor.y + rotation * vector.x + scale * vector.y }
  }) }
}

function movePlayers(scene: Scene, ids: string[], delta: Point, bounds: Bounds): Scene {
  const moving = new Set(ids)
  const points = scene.players.filter(player => moving.has(player.id)).map(player => player.point)
  const movement = constrainedDelta(points, delta, bounds)
  if (!movement.x && !movement.y) return scene
  return {
    ...scene,
    players: scene.players.map(player => moving.has(player.id)
      ? { ...player, point: offset(player.point, movement) }
      : player),
  }
}

function drawMark(gesture: Gesture & { kind: 'create' }, point: Point, bounds: Bounds, destination?: BoardPlayer) {
  const { mark, start, moved } = gesture
  if (mark.kind === 'freehand') {
    const samples = gesture.samples
    if (distance(samples[samples.length - 1], point) > 1.3) samples.push(point)
    return samples.length > 1 ? { ...mark, points: [...samples] } : undefined
  }
  if (mark.kind === 'highlight' && !moved) {
    return {
      ...mark,
      points: [
        constrain({ x: start.x - 33, y: start.y - 33 }, bounds),
        constrain({ x: start.x + 33, y: start.y + 33 }, bounds),
      ],
    }
  }
  if (!moved || distance(start, point) < 2) return
  if (!arrowKinds.has(mark.kind)) return { ...mark, points: [start, point] }

  const from = gesture.source?.point ?? start
  const to = destination?.point ?? point
  if (distance(from, to) < 2) return
  const control = gesture.curved ? defaultBend(from, to, bounds) : undefined
  return {
    ...mark,
    points: [
      gesture.source ? outsideMarker(from, control ?? to) : from,
      destination ? outsideMarker(to, control ?? from) : to,
    ],
    control,
  }
}

export function BoardEditor({ scene, tool, options, onCommit, resetKey, onSelectionChange }: BoardEditorProps) {
  const [selection, setSelection] = useState<BoardSelection>(emptySelection)
  const [preview, setPreview] = useState<Scene>()
  const [marquee, setMarquee] = useState<Bounds>()
  const interaction = useRef<Gesture | null>(null)
  const instructionsId = useId()
  const activeSelection = tool === 'select' || (tool === 'ball' && selection.ball) ? selection : emptySelection
  const selectedPlayer = activeSelection.players.length === 1
    ? scene.players.find(player => player.id === activeSelection.players[0]) : undefined
  const selectedMark = scene.marks.find(mark => mark.id === activeSelection.annotation)
  const selectionStatus = selectedPlayer
    ? `Selected ${selectedPlayer.number}, ${selectedPlayer.name}${scene.ball?.playerId === selectedPlayer.id ? ', with the ball' : ''}.`
    : activeSelection.players.length > 1 ? `${activeSelection.players.length} players selected.`
      : selectedMark ? `${markNames[selectedMark.kind]} selected.`
        : activeSelection.ball ? 'Ball selected.' : 'No object selected.'

  function resetGesture() {
    interaction.current = null
    setPreview(undefined)
    setMarquee(undefined)
  }

  useEffect(() => {
    resetGesture()
    setSelection(emptySelection)
  }, [scene.id, resetKey])

  useEffect(() => {
    if (interaction.current) resetGesture()
  }, [tool])

  useEffect(() => {
    if (interaction.current && interaction.current.base !== scene) resetGesture()
    setSelection(previous => {
      const visible = getVisibleBounds(scene)
      const players = scene.image ? [] : previous.players.filter(id => scene.players.some(player => player.id === id && within(player.point, visible)))
      const annotation = scene.showAnnotations && scene.marks.some(mark => mark.id === previous.annotation)
        ? previous.annotation : undefined
      const ball = scene.ball && !scene.image ? previous.ball : undefined
      if (players.length === previous.players.length && annotation === previous.annotation && ball === previous.ball) return previous
      return { players, annotation, ball }
    })
  }, [scene])

  useEffect(() => {
    onSelectionChange?.(activeSelection)
  }, [activeSelection, onSelectionChange])

  function begin(event: PointerEvent<SVGSVGElement>) {
    if (interaction.current || !event.isPrimary || event.button !== 0 || (scene.image && tool === 'ball')) return
    const point = eventPoint(event)
    if (!point) return
    const bounds = getVisibleBounds(scene)
    const start = constrain(point, bounds)
    const onCanvas = within(point, bounds)
    const target = event.target as Element
    const player = scene.players.find(item => item.id === hitId(target, 'player'))
    const mark = scene.showAnnotations ? scene.marks.find(item => item.id === hitId(target, 'annotation')) : undefined
    const ball = target.closest('[data-ball]') ? getBallPoint(scene.ball, scene.players) : null
    let mode: GestureMode
    let origin = point

    if (tool === 'select') {
      if (player) {
        const additive = options.group || event.shiftKey
        const wasSelected = selection.players.includes(player.id)
        const ids = wasSelected ? selection.players : additive ? [...selection.players, player.id] : [player.id]
        mode = { kind: 'players', target: player.id, ids, wasSelected, additive }
        setSelection({ players: ids })
      } else if (mark) {
        const hit = target.closest('[data-handle]')?.getAttribute('data-handle')
        const handle = hit === 'start' || hit === 'end' || hit === 'bend' ? hit : undefined
        let handlePoint: Point | undefined
        if (handle === 'start') handlePoint = mark.points[0]
        if (handle === 'end') handlePoint = mark.points[mark.points.length - 1]
        if (handle === 'bend') handlePoint = mark.control ?? midpoint(mark.points[0], mark.points[1])
        mode = { kind: 'mark', mark, handle, origin: handlePoint }
        setSelection({ players: [], annotation: mark.id })
      } else if (ball) {
        mode = { kind: 'ball', origin: ball, placing: false }
        setSelection({ players: [], ball: true })
      } else {
        const ids = options.group || event.shiftKey ? selection.players : []
        setSelection({ players: ids })
        if (!onCanvas || scene.image) return
        mode = { kind: 'marquee', ids }
      }
    } else if (tool === 'erase') {
      if (!scene.showAnnotations || (!mark && !onCanvas)) return
      mode = { kind: 'erase', ids: new Set(mark ? [mark.id] : []) }
      setSelection(emptySelection)
      if (mark) setPreview({ ...scene, marks: scene.marks.filter(item => item.id !== mark.id) })
    } else if (tool === 'ball') {
      if (!player && !ball && !onCanvas) return
      mode = { kind: 'ball', origin: ball ?? start, target: player?.id, placing: !ball }
      setSelection({ players: [], ball: true })
    } else {
      if (!onCanvas && !player) return
      origin = tool === 'highlight' && player ? player.point : start
      mode = {
        kind: 'create', mark: newMark(tool, options, origin),
        samples: [origin], source: player, curved: options.curved,
      }
      setSelection(emptySelection)
    }

    interaction.current = { ...mode, base: scene, pointerId: event.pointerId, start: origin, screen: { x: event.clientX, y: event.clientY }, moved: false }
    event.currentTarget.setPointerCapture(event.pointerId)
    event.currentTarget.focus({ preventScroll: true })
    event.preventDefault()
  }

  function update(event: PointerEvent<SVGSVGElement>, finished: boolean) {
    const gesture = interaction.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    const raw = eventPoint(event)
    if (!raw) {
      if (finished) resetGesture()
      return
    }
    const base = gesture.base
    const bounds = getVisibleBounds(base)
    const point = constrain(raw, bounds)
    const delta = deltaBetween(gesture.start, raw)
    const moved = gesture.moved ||= distance(gesture.screen, { x: event.clientX, y: event.clientY }) > (event.pointerType === 'touch' ? 5 : 2)
    let next: Scene | undefined

    switch (gesture.kind) {
      case 'players':
        if (moved) next = movePlayers(base, gesture.ids, delta, bounds)
        else if (finished) {
          const players = gesture.additive
            ? gesture.wasSelected ? gesture.ids.filter(id => id !== gesture.target) : gesture.ids
            : [gesture.target]
          setSelection({ players })
        }
        break
      case 'mark':
        if (moved) {
          const mark = gesture.handle && gesture.origin
            ? reshapeMark(gesture.mark, gesture.handle, constrain(offset(gesture.origin, delta), bounds))
            : translateMark(gesture.mark, delta, getBoardBounds(base))
          next = replaceMark(base, mark)
        }
        break
      case 'ball': {
        if (!moved && !gesture.placing) break
        const placement = constrain(offset(gesture.origin, delta), bounds)
        const player = moved
          ? finished ? hitPlayer(event, base.players) : undefined
          : base.players.find(item => item.id === gesture.target)
        next = { ...base, ball: player ? { playerId: player.id, point: player.point } : { point: placement } }
        break
      }
      case 'marquee':
        if (moved) {
          const rectangle = box(gesture.start, point)
          if (finished) {
            const selected = base.players.filter(player => within(player.point, rectangle) && within(player.point, getVisibleBounds(base)))
            setSelection({ players: [...new Set([...gesture.ids, ...selected.map(player => player.id)])] })
          } else {
            setMarquee(rectangle)
          }
        }
        break
      case 'erase': {
        const markId = moved ? hitId(hitAt(event), 'annotation') : undefined
        if (markId) gesture.ids.add(markId)
        if (gesture.ids.size) next = { ...base, marks: base.marks.filter(mark => !gesture.ids.has(mark.id)) }
        break
      }
      case 'create': {
        const target = arrowKinds.has(gesture.mark.kind) ? hitPlayer(event, base.players) : undefined
        const mark = drawMark(gesture, point, bounds, target)
        if (mark) {
          next = { ...base, showAnnotations: true, marks: [...base.marks, mark] }
          if (finished) setSelection({ players: [], annotation: mark.id })
        }
        break
      }
    }

    if (finished) {
      resetGesture()
      if (next && next !== base) onCommit(next)
    } else {
      setPreview(next)
    }
  }

  function cancel(event: PointerEvent<SVGSVGElement>) {
    if (interaction.current?.pointerId === event.pointerId) resetGesture()
  }

  function keyDown(event: KeyboardEvent<SVGSVGElement>) {
    if (event.key === 'Escape') {
      resetGesture()
      setSelection(emptySelection)
      return
    }
    if (event.metaKey || event.ctrlKey || event.altKey || interaction.current) return
    const visible = getVisibleBounds(scene)
    if (event.key === 'Enter' && tool === 'select') {
      const players = scene.image ? [] : scene.players.filter(player => within(player.point, visible))
      const marks = visibleMarks(scene, visible)
      const ball = scene.image ? null : getBallPoint(scene.ball, scene.players)
      const choices: BoardSelection[] = [
        ...players.map(player => ({ players: [player.id] })),
        ...marks.map(mark => ({ players: [], annotation: mark.id })),
        ...(ball && within(ball, visible) ? [{ players: [], ball: true }] : []),
      ]
      if (!choices.length) return
      const index = choices.findIndex(choice => choice.annotation
        ? choice.annotation === selection.annotation
        : choice.ball ? selection.ball
          : choice.players[0] === selection.players[0])
      const direction = event.shiftKey ? -1 : 1
      const start = index < 0 && event.shiftKey ? 0 : index
      setSelection(choices[(start + direction + choices.length) % choices.length])
      event.preventDefault()
      return
    }
    if (event.key === ' ' && selectedPlayer && !scene.image) {
      event.preventDefault()
      if (event.repeat) return
      const current = getBallPoint(scene.ball, scene.players)
      const ball = current && scene.ball?.playerId === selectedPlayer.id
        ? { point: current }
        : { playerId: selectedPlayer.id, point: selectedPlayer.point }
      onCommit({ ...scene, ball })
      return
    }
    if (event.key === 'Backspace' || event.key === 'Delete') {
      if (selectedMark) onCommit({ ...scene, marks: scene.marks.filter(item => item.id !== selectedMark.id) })
      else if (activeSelection.ball && scene.ball) onCommit({ ...scene, ball: null })
      else return
      setSelection(emptySelection)
      event.preventDefault()
      return
    }

    const step = event.shiftKey ? 10 : 2
    const directions: Record<string, Point> = {
      ArrowLeft: { x: -step, y: 0 }, ArrowRight: { x: step, y: 0 },
      ArrowUp: { x: 0, y: -step }, ArrowDown: { x: 0, y: step },
    }
    const delta = directions[event.key]
    if (!delta) return
    const bounds = getBoardBounds(scene)
    const ball = activeSelection.ball ? getBallPoint(scene.ball, scene.players) : null
    if (activeSelection.players.length) onCommit(movePlayers(scene, activeSelection.players, delta, visible))
    else if (selectedMark) onCommit(replaceMark(scene, translateMark(selectedMark, delta, bounds)))
    else if (ball) onCommit({ ...scene, ball: { point: constrain(offset(ball, delta), visible) } })
    else return
    event.preventDefault()
  }

  return (
    <>
      <BoardVisual
        scene={preview ?? scene}
        selection={activeSelection}
        marquee={marquee}
        className={`board-editor board-editor--${tool}`}
        role="application"
        aria-label={scene.image ? 'Still image tactics editor' : 'Pitch tactics editor'}
        aria-describedby={instructionsId}
        tabIndex={0}
        onPointerDown={begin}
        onPointerMove={event => update(event, false)}
        onPointerUp={event => update(event, true)}
        onPointerCancel={cancel}
        onLostPointerCapture={cancel}
        onKeyDown={keyDown}
      />
      <span className="board-editor-a11y" id={instructionsId}>
        In Select mode, use Enter or Shift and Enter to select the next or previous object.
        Arrow keys move it. Hold Shift for larger moves. Delete removes a selected annotation or ball.
        {!scene.image && ' Space attaches or detaches the ball on the selected player.'}
        {' Escape clears the selection.'}
      </span>
      <span className="board-editor-a11y" role="status" aria-atomic="true">{selectionStatus}</span>
    </>
  )
}
