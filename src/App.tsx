import { useEffect, useReducer, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import {
  ArrowDownToLine, ArrowLeft, ArrowRight, ArrowUpRight, ChevronDown, CircleDot, Copy,
  Eraser, Eye, EyeOff, FolderOpen, ImagePlus, Layers2, Maximize, MousePointer2, PanelRight,
  Pencil, Plus, Radio, Redo2, Route, Save, Scan, Send, Square, Trash2, Undo2, UsersRound, X,
} from 'lucide-react'
import { BoardEditor, restyleMark } from './BoardEditor'
import type { BoardOptions, BoardSelection, BoardTool } from './BoardEditor'
import { BoardVisual } from './BoardVisual'
import { MatchPanel, MatchSelector } from './MatchPanel'
import { Modal } from './Modal'
import { mergeMatchEvents } from './match'
import type { Substitution } from './match'
import { exportBoard } from './export'
import { importStill, makeBoard, makeScene, newId, removeStill, syncPlayers, updateMatch } from './model'
import type { Board, Scene, View } from './model'
import { deleteBoard, lastBoardId, listBoards, openBoard, readStill, rememberBoard, saveBoard } from './storage'

const tools = [
  { id: 'select', label: 'Select', icon: MousePointer2, hint: 'Drag to move · Shift to select multiple players' },
  { id: 'run', label: 'Run', icon: ArrowUpRight, hint: 'Drag from the start to the end of the run' },
  { id: 'pass', label: 'Pass', icon: Send, hint: 'Drag between players or open spaces' },
  { id: 'carry', label: 'Carry', icon: Route, hint: 'Drag to show movement with the ball' },
  { id: 'draw', label: 'Draw', icon: Pencil, hint: 'Draw directly on the board' },
  { id: 'shape', label: 'Shape', icon: Square, hint: 'Drag to draw a zone or defensive line' },
  { id: 'highlight', label: 'Highlight', icon: Scan, hint: 'Tap to spotlight, or drag to resize' },
  { id: 'erase', label: 'Erase', icon: Eraser, hint: 'Tap a mark to erase it' },
  { id: 'ball', label: 'Ball', icon: CircleDot, hint: 'Tap a player to attach · Drag the ball to move it' },
] as const

const views: { id: View; label: string }[] = [
  { id: 'full', label: 'Full pitch' }, { id: 'attacking', label: 'Attacking half' },
  { id: 'defensive', label: 'Defensive half' }, { id: 'penalty', label: 'Attacking area' },
  { id: 'own-penalty', label: 'Defensive area' },
]

const inks = [
  { name: 'White', colour: '#f7f9ec' }, { name: 'Yellow', colour: '#f8dc63' },
  { name: 'Mint', colour: '#77e6c1' }, { name: 'Blue', colour: '#7ec8ff' },
  { name: 'Red', colour: '#ff7373' }, { name: 'Lilac', colour: '#d1aeff' },
]

type History = { board: Board; past: Board[]; future: Board[]; revision: number }
type HistoryAction =
  | { type: 'change' | 'navigate'; edit: (board: Board) => Board }
  | { type: 'open'; board: Board }
  | { type: 'undo' | 'redo' }

function start(board = makeBoard()): History {
  return { board, past: [], future: [], revision: 0 }
}

function historyReducer(state: History, action: HistoryAction): History {
  switch (action.type) {
    case 'open': return start(action.board)
    case 'navigate': return { ...state, board: action.edit(state.board) }
    case 'change': {
      const board = action.edit(state.board)
      if (board === state.board) return state
      return { ...state, board, past: [...state.past.slice(-49), state.board], future: [] }
    }
    case 'undo': {
      const board = state.past.at(-1)
      if (!board) return state
      return { board, past: state.past.slice(0, -1), future: [state.board, ...state.future], revision: state.revision + 1 }
    }
    case 'redo': {
      const [board, ...future] = state.future
      if (!board) return state
      return { board, past: [...state.past, state.board], future, revision: state.revision + 1 }
    }
  }
}

function changeScene(board: Board, id: string, edit: (scene: Scene) => Scene) {
  const current = board.scenes.find((scene) => scene.id === id)
  if (!current) return board
  const next = edit(current)
  if (current === next) return board
  return { ...board, scenes: board.scenes.map((scene) => scene.id === id ? next : scene) }
}

function IconButton({ label, onClick, children, disabled }: {
  label: string; onClick: () => void; children: ReactNode; disabled?: boolean
}) {
  return <button type="button" className="icon-button" title={label} aria-label={label} onClick={onClick} disabled={disabled}>{children}</button>
}

function RenameDialog({ title, value, onClose, onRename }: {
  title: string; value: string; onClose: () => void; onRename: (name: string) => void
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const name = String(new FormData(event.currentTarget).get('name') ?? '').trim()
    if (name) onRename(name)
  }
  return (
    <Modal title={title} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <label className="field">Name<input name="name" defaultValue={value} maxLength={70} required autoFocus onFocus={(event) => event.currentTarget.select()} /></label>
        <div className="dialog-actions"><button className="button subtle" type="button" onClick={onClose}>Cancel</button><button className="button primary">Rename</button></div>
      </form>
    </Modal>
  )
}

export function App() {
  const [history, dispatch] = useReducer(historyReducer, undefined, () => start())
  const { board } = history
  const sceneIndex = board.scenes.findIndex((item) => item.id === board.activeScene)
  const scene = board.scenes[sceneIndex]
  const [saved, setSaved] = useState<Board>()
  const [ready, setReady] = useState(false)
  const [notice, setNotice] = useState('')
  const [library, setLibrary] = useState<Awaited<ReturnType<typeof listBoards>> | null>(null)
  const [rename, setRename] = useState<'board' | 'scene' | null>(null)
  const [teamPanel, setTeamPanel] = useState(() => window.matchMedia('(min-width: 1100px)').matches)
  const [tool, setTool] = useState<BoardTool>('select')
  const [selection, setSelection] = useState<BoardSelection>({ players: [] })
  const [options, setOptions] = useState<BoardOptions>({
    colour: inks[0].colour, style: 'solid', curved: false, drawMode: 'freehand', shapeMode: 'zone', group: false,
  })
  const [onAir, setOnAir] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [saving, setSaving] = useState(false)
  const frame = useRef<HTMLDivElement>(null)
  const imageInput = useRef<HTMLInputElement>(null)
  const fullscreenStarted = useRef(false)
  const lastTap = useRef(0)
  const dirty = board !== saved && (saved !== undefined || history.past.length > 0 || board.updatedAt > 0)
  const selectedMark = scene.marks.find((mark) => mark.id === selection.annotation)
  const activeTool = tools.find((item) => item.id === tool)!
  const optionsVisible = !['ball', 'erase'].includes(tool)
  const arrowTool = tool === 'run' || tool === 'pass' || tool === 'carry'
  const arrowSelected = tool === 'select' && (selectedMark?.kind === 'run' || selectedMark?.kind === 'pass' || selectedMark?.kind === 'carry')

  useEffect(() => {
    let live = true
    const id = lastBoardId()
    if (!id) { setReady(true); return }
    openBoard(id).then((restored) => {
      if (!live || !restored) return
      dispatch({ type: 'open', board: restored })
      setSaved(restored)
    }).catch(() => { if (live) setNotice('Could not restore the last saved board.') })
      .finally(() => { if (live) setReady(true) })
    return () => { live = false }
  }, [])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(''), 4500)
    return () => window.clearTimeout(timer)
  }, [notice])

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault() }
    if (dirty) window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [dirty])

  useEffect(() => {
    function onFullscreenChange() {
      if (document.fullscreenElement === frame.current) fullscreenStarted.current = true
      else if (fullscreenStarted.current) {
        fullscreenStarted.current = false
        setOnAir(false)
      }
    }
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange)
  }, [])

  const edit = (update: (board: Board) => Board) => dispatch({ type: 'change', edit: update })
  const editScene = (update: (scene: Scene) => Scene) => edit((current) => changeScene(current, scene.id, update))

  function navigate(index: number) {
    const next = board.scenes[index]
    if (next && next.id !== scene.id) dispatch({ type: 'navigate', edit: (current) => ({ ...current, activeScene: next.id }) })
  }

  function chooseTool(next: BoardTool) {
    setTool(next)
    if (next === 'run' || next === 'pass' || next === 'carry') {
      setOptions((previous) => ({
        ...previous, colour: next === 'run' ? inks[1].colour : next === 'carry' ? inks[2].colour : inks[0].colour,
        style: next === 'pass' ? 'dash' : 'solid',
      }))
    }
  }

  function changeInk(patch: Partial<Pick<BoardOptions, 'colour' | 'style' | 'curved'>>) {
    if (tool === 'select' && selectedMark) editScene((item) => restyleMark(item, selectedMark.id, patch))
    else setOptions((previous) => ({ ...previous, ...patch }))
  }

  function createScene(duplicate: boolean) {
    const next = duplicate
      ? { ...scene, id: newId(), name: `${scene.name.slice(0, 64)} copy` }
      : makeScene(`Scene ${board.scenes.length + 1}`, board.match)
    edit((current) => {
      return {
        ...current, activeScene: next.id,
        scenes: [...current.scenes.slice(0, sceneIndex + 1), next, ...current.scenes.slice(sceneIndex + 1)],
      }
    })
  }

  function removeScene() {
    edit((current) => {
      if (current.scenes.length <= 1) return current
      const scenes = current.scenes.filter((item) => item.id !== scene.id)
      return { ...current, scenes, activeScene: scenes[Math.max(0, sceneIndex - 1)].id }
    })
  }

  function applySubstitution(event: Substitution) {
    edit((current) => {
      if (!current.match) return current
      const moment = { minute: event.minute, addedTime: event.addedTime ?? 0 }
      if (event.verification === 'verified') {
        const match = {
          ...current.match,
          substitutions: mergeMatchEvents([...current.match.substitutions, event], []),
        }
        return {
          ...current, match,
          scenes: current.scenes.map((item) => syncPlayers(item.id === scene.id ? { ...item, ...moment } : item, match)),
        }
      }
      return changeScene(current, scene.id, (item) => syncPlayers({
        ...item, ...moment, substitutions: [...item.substitutions, event],
      }, current.match))
    })
  }

  async function save() {
    if (saving) return
    setSaving(true)
    try {
      await saveBoard({ ...board, updatedAt: Date.now() })
      setSaved(board)
      setNotice('Board saved on this device.')
    } catch {
      setNotice('Could not save the board. Check available browser storage.')
    } finally {
      setSaving(false)
    }
  }

  async function showLibrary() {
    try { setLibrary(await listBoards()) }
    catch { setNotice('Could not open the board library.') }
  }

  function loadBoard(next: Board) {
    dispatch({ type: 'open', board: next })
    setSaved(next.updatedAt ? next : undefined)
    rememberBoard(next.updatedAt ? next.id : null)
    setLibrary(null)
    setSelection({ players: [] })
  }

  async function openSaved(id: string) {
    if (id === board.id && !dirty) { setLibrary(null); return }
    if (dirty && !window.confirm('Open this board and discard unsaved changes?')) return
    try {
      const next = await openBoard(id)
      if (!next) throw new Error('Board unavailable')
      loadBoard(next)
    } catch { setNotice('Could not open this board.') }
  }

  async function duplicateBoard() {
    try {
      const next = { ...board, id: newId(), name: `${board.name.slice(0, 64)} copy`, updatedAt: Date.now() }
      await saveBoard(next)
      loadBoard(next)
      setNotice('Board duplicated.')
    } catch { setNotice('Could not duplicate the board.') }
  }

  async function removeSaved(id: string, name: string) {
    if (!window.confirm(`Delete “${name}” from this device?`)) return
    try {
      await deleteBoard(id)
      if (board.id === id) {
        dispatch({ type: 'open', board: makeBoard() })
        setSaved(undefined)
        setSelection({ players: [] })
      }
      await showLibrary()
    } catch { setNotice('Could not delete the board.') }
  }

  async function loadImage(file?: File) {
    if (!file) return
    if (scene.image && scene.marks.length && !window.confirm('Replace this still and its annotations?')) return
    try {
      const image = await readStill(file)
      edit((current) => current.id === board.id
        ? changeScene(current, scene.id, (item) => importStill(item, image)) : current)
      chooseTool('select')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not open the image.')
    }
  }

  async function download(width: 1920 | 3840) {
    if (exporting) return
    setExporting(true)
    try {
      await exportBoard(scene, width, `${board.name} - ${scene.name}`)
      setNotice(`PNG exported · ${width} × ${width * 9 / 16}`)
    } catch { setNotice('Could not export this scene as a PNG.') }
    finally { setExporting(false) }
  }

  function startAir() {
    lastTap.current = 0
    setOnAir(true)
    frame.current?.requestFullscreen?.().catch(() => { /* Use the viewport when fullscreen is unavailable. */ })
  }

  function stopAir() {
    setOnAir(false)
    if (document.fullscreenElement === frame.current) void document.exitFullscreen().catch(() => {})
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      if (onAir) {
        if (event.key === 'Escape') stopAir()
        if (event.key === 'ArrowLeft') navigate(sceneIndex - 1)
        if (event.key === 'ArrowRight') navigate(sceneIndex + 1)
        return
      }
      if (!ready || document.querySelector('dialog[open]')) return
      const modifier = event.metaKey || event.ctrlKey
      const key = event.key.toLowerCase()
      if (modifier && key === 's') { event.preventDefault(); void save(); return }
      if ((event.target as HTMLElement | null)?.closest('input, textarea, select, [contenteditable]')) return
      if (modifier && (key === 'z' || key === 'y')) {
        event.preventDefault()
        dispatch({ type: key === 'y' || event.shiftKey ? 'redo' : 'undo' })
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  return (
    <div ref={frame} className={onAir ? 'air-frame' : 'app-frame'}>
      {onAir ? (
        <div className="on-air-stage" aria-label="On-air presentation" onPointerUp={() => {
          const now = Date.now()
          if (now - lastTap.current < 400) stopAir()
          lastTap.current = now
        }}>
          <BoardVisual scene={scene} clean />
        </div>
      ) : (
        <>
          <header className="topbar">
            <div className="brand"><img src="/touchline.svg" alt="" /><span>Touchline<small>TACTICS BOARD</small></span></div>
            <div className="match-control">
              <MatchSelector match={board.match} onChange={(match) => edit((current) => updateMatch(current, match))} />
            </div>
            <div className="top-actions">
              <button className="button subtle top-action" type="button" title="Open Board" aria-label="Open Board" onClick={showLibrary}><FolderOpen size={17} /><span>Open</span></button>
              <button className="button subtle top-action" type="button" title="Save Board" aria-label="Save Board" disabled={!ready || saving} onClick={save}><Save size={17} /><span>Save</span></button>
              <span className="toolbar-divider" />
              <button className="button subtle top-action" type="button" title="Import Image" aria-label="Import Image" onClick={() => imageInput.current?.click()}><ImagePlus size={17} /><span>Import image</span></button>
              <details className="export-menu">
                <summary className="button subtle top-action" title="Export PNG" aria-label="Export PNG"><ArrowDownToLine size={17} /><span>Export</span><ChevronDown size={12} /></summary>
                <div className="popover">
                  {([1920, 3840] as const).map((width) => (
                    <button key={width} className="button subtle" type="button" disabled={exporting} onClick={(event) => {
                      event.currentTarget.closest('details')?.removeAttribute('open')
                      void download(width)
                    }}>PNG <span>{width} × {width * 9 / 16}</span></button>
                  ))}
                </div>
              </details>
              <button className="air-button" type="button" title="Enter full-screen presentation" onClick={startAir}><Radio size={19} /> ON AIR</button>
            </div>
            <input type="file" ref={imageInput} accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" hidden onChange={(event) => {
              void loadImage(event.currentTarget.files?.[0])
              event.currentTarget.value = ''
            }} />
          </header>

          <main className={teamPanel ? 'workspace panel-open' : 'workspace'} inert={!ready}>
            <aside className="tool-rail" aria-label="Tactical tools">
              <div className="rail-tools">
                {tools.map(({ id, label, icon: ToolIcon }) => (
                  <button key={id} className="tool-button" type="button" aria-pressed={tool === id} aria-label={label} title={label}
                    disabled={id === 'ball' && !!scene.image} onClick={() => chooseTool(id)}>
                    <ToolIcon size={20} strokeWidth={1.85} /><span>{label}</span>
                  </button>
                ))}
              </div>
              <div className="rail-history">
                <IconButton label="Undo" disabled={!history.past.length} onClick={() => dispatch({ type: 'undo' })}><Undo2 size={18} /></IconButton>
                <IconButton label="Redo" disabled={!history.future.length} onClick={() => dispatch({ type: 'redo' })}><Redo2 size={18} /></IconButton>
                <IconButton label="Clear annotations" disabled={!scene.marks.length} onClick={() => editScene((item) => ({ ...item, marks: [] }))}><Trash2 size={17} /></IconButton>
              </div>
            </aside>

            <section className="stage-column" aria-label="Tactics workspace">
              <div className="stage-toolbar">
                <div className="board-identity">
                  <button className="board-name" type="button" title="Rename Board" onClick={() => setRename('board')}>{board.name}<Pencil size={13} /></button>
                  <span className="board-status">{dirty ? 'Unsaved changes' : saved ? 'Saved locally' : 'Local board'}{!scene.image && scene.players.length > 0 && ' · Editorial positions'}</span>
                </div>
                <div className="stage-actions">
                  {scene.image ? (
                    <>
                      <div className="segmented" aria-label="Image framing">
                        {(['fit', 'crop'] as const).map((fit) => <button key={fit} aria-pressed={scene.image?.fit === fit} type="button"
                          onClick={() => editScene((item) => ({ ...item, image: { ...item.image!, fit } }))}>{fit === 'fit' ? 'Fit' : 'Crop'}</button>)}
                      </div>
                      <button className="button subtle compact" type="button" onClick={() => editScene(removeStill)} title="Return to pitch" aria-label="Return to pitch"><X size={15} /><span>Still</span></button>
                    </>
                  ) : (
                    <label className="select-shell" title="Pitch view">
                      <Maximize size={14} />
                      <select aria-label="Pitch view" value={scene.view} onChange={(event) => {
                        const view = event.currentTarget.value as View
                        editScene((item) => ({ ...item, view }))
                      }}>
                        {views.map((view) => <option key={view.id} value={view.id}>{view.label}</option>)}
                      </select>
                      <ChevronDown size={12} />
                    </label>
                  )}
                  <IconButton label={scene.showAnnotations ? 'Hide annotations' : 'Show annotations'} onClick={() => editScene((item) => ({
                    ...item, showAnnotations: !item.showAnnotations,
                  }))}>{scene.showAnnotations ? <Eye size={17} /> : <EyeOff size={17} />}</IconButton>
                  <button className="button subtle compact team-toggle" type="button" aria-pressed={teamPanel} aria-label="Teams panel"
                    title={teamPanel ? 'Hide teams' : 'Show teams'} onClick={() => setTeamPanel(!teamPanel)}><PanelRight size={17} /><span>Teams</span></button>
                </div>
              </div>
              <div className="stage-frame">
                <div className="stage-surface" data-tool={tool}>
                  <BoardEditor scene={scene} tool={scene.image && tool === 'ball' ? 'select' : tool} options={options}
                    onCommit={(next) => editScene(() => next)}
                    onSelectionChange={setSelection} resetKey={`${board.id}:${scene.id}:${history.revision}`} />
                </div>
              </div>

              <div className="options-bar" aria-label="Tool options">
                <div className="tool-context"><activeTool.icon size={15} /><strong>{activeTool.label}</strong><span>{selection.players.length > 1 ? `${selection.players.length} players selected` : activeTool.hint}</span></div>
                <div className="option-controls">
                  {(arrowTool || arrowSelected) && (
                    <button type="button" className="button subtle compact" aria-label="Curved arrow"
                      aria-pressed={arrowSelected ? !!selectedMark?.control : options.curved}
                      onClick={() => changeInk({ curved: !(arrowSelected ? selectedMark?.control : options.curved) })}>Curve</button>
                  )}
                  {tool === 'draw' && <select aria-label="Drawing mode" value={options.drawMode} onChange={(event) => setOptions({ ...options, drawMode: event.target.value as BoardOptions['drawMode'] })}><option value="freehand">Freehand</option><option value="line">Line</option></select>}
                  {tool === 'shape' && <select aria-label="Shape mode" value={options.shapeMode} onChange={(event) => setOptions({ ...options, shapeMode: event.target.value as BoardOptions['shapeMode'] })}><option value="zone">Zone</option><option value="line">Line</option></select>}
                  {tool === 'select' && <button className="button subtle compact" type="button" aria-pressed={options.group} onClick={() => setOptions({ ...options, group: !options.group })}><UsersRound size={15} /> Group</button>}
                  {optionsVisible && (tool !== 'select' || !!selectedMark) && (
                    <>
                      <select aria-label="Line style" value={tool === 'select' && selectedMark ? selectedMark.style : options.style} onChange={(event) => changeInk({ style: event.target.value as BoardOptions['style'] })}>
                        <option value="solid">Solid</option><option value="dash">Dashed</option><option value="dot">Dotted</option>
                      </select>
                      <div className="ink-picker" aria-label="Annotation colour">
                        {inks.map(({ name, colour }) => <button className="ink" key={colour} type="button" title={name} aria-label={`${name} ink`}
                          aria-pressed={(tool === 'select' && selectedMark ? selectedMark.colour : options.colour) === colour}
                          onClick={() => changeInk({ colour })}><span style={{ background: colour }} /></button>)}
                      </div>
                    </>
                  )}
                  {tool === 'ball' && scene.ball && <button type="button" className="button subtle compact" onClick={() => editScene((item) => ({ ...item, ball: null }))}>Remove ball</button>}
                </div>
              </div>
            </section>

            {teamPanel && <aside className="team-panel" aria-label="Teams and lineups">
              <div className="panel-heading"><UsersRound size={17} /><h2>Teams</h2><IconButton label="Close Teams panel" onClick={() => setTeamPanel(false)}><X size={17} /></IconButton></div>
              <MatchPanel match={board.match} formations={scene.formations} minute={scene.minute} addedTime={scene.addedTime}
                substitutions={scene.substitutions}
                onFormation={(side, formation) => edit((current) => changeScene(current, scene.id,
                  (item) => syncPlayers({ ...item, formations: { ...item.formations, [side]: formation } }, current.match, side)))}
                onTeamChange={(side, team) => edit((current) => current.match ? updateMatch(current, { ...current.match, [side]: team }) : current)}
                onMinute={(minute, addedTime = 0) => edit((current) => changeScene(current, scene.id,
                  (item) => syncPlayers({ ...item, minute, addedTime }, current.match)))}
                onSubstitution={applySubstitution} />
            </aside>}

            <section className="scenes" aria-label="Scenes">
              <div className="scene-heading"><Layers2 size={17} /><span>Scenes</span><small>{String(sceneIndex + 1).padStart(2, '0')} / {String(board.scenes.length).padStart(2, '0')}</small></div>
              <div className="scene-navigation">
                <IconButton label="Previous scene" disabled={sceneIndex === 0} onClick={() => navigate(sceneIndex - 1)}><ArrowLeft size={17} /></IconButton>
                <IconButton label="Next scene" disabled={sceneIndex === board.scenes.length - 1} onClick={() => navigate(sceneIndex + 1)}><ArrowRight size={17} /></IconButton>
              </div>
              <div className="scene-list">
                {board.scenes.map((item, index) => <button key={item.id} type="button" aria-current={item.id === scene.id ? 'step' : undefined}
                  className="scene-chip" onClick={() => navigate(index)} title={item.name}>
                  <span className={item.image ? 'scene-symbol still' : 'scene-symbol'} aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
                  <span>{item.name}</span>
                </button>)}
              </div>
              <div className="scene-actions">
                <button className="button subtle compact" type="button" onClick={() => createScene(false)} title="Add Scene" aria-label="Add Scene"><Plus size={17} /><span>Add scene</span></button>
                <IconButton label="Duplicate Scene" onClick={() => createScene(true)}><Copy size={17} /></IconButton>
                <IconButton label="Rename Scene" onClick={() => setRename('scene')}><Pencil size={16} /></IconButton>
                <IconButton label="Delete Scene" disabled={board.scenes.length < 2} onClick={removeScene}><Trash2 size={17} /></IconButton>
              </div>
            </section>
          </main>

          {notice && <div className="notice" role="status">{notice}</div>}
          {library && (
            <Modal title="Open Board" onClose={() => setLibrary(null)}>
              <div className="board-library stack">
                {library.length === 0 && <p className="data-message">No saved boards on this device.</p>}
                {library.map((item) => (
                  <div key={item.id} className="library-row">
                    <button type="button" className="library-open" onClick={() => { void openSaved(item.id) }}><FolderOpen size={17} /><span>{item.name}<small>{item.sceneCount} {item.sceneCount === 1 ? 'scene' : 'scenes'} · {new Date(item.updatedAt).toLocaleDateString('en-GB')}</small></span></button>
                    <IconButton label={`Delete ${item.name}`} onClick={() => { void removeSaved(item.id, item.name) }}><Trash2 size={17} /></IconButton>
                  </div>
                ))}
              </div>
              <div className="dialog-actions library-actions">
                <button className="button subtle" type="button" onClick={() => { void duplicateBoard() }}><Copy size={16} /> Duplicate board</button>
                <button className="button primary" type="button" onClick={() => {
                  if (!dirty || window.confirm('Start a new board and discard unsaved changes?')) loadBoard(makeBoard())
                }}><Plus size={16} /> New board</button>
              </div>
            </Modal>
          )}
          {rename && (
            <RenameDialog title={rename === 'board' ? 'Rename Board' : 'Rename Scene'} value={rename === 'board' ? board.name : scene.name}
              onClose={() => setRename(null)} onRename={(name) => {
                if (rename === 'board') edit((current) => ({ ...current, name }))
                else editScene((item) => ({ ...item, name }))
                setRename(null)
              }} />
          )}
        </>
      )}
    </div>
  )
}
