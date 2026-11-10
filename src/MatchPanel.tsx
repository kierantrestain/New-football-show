import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { AlertCircle, ArrowLeft, ArrowRight, ArrowRightLeft, CalendarDays, ChevronDown, ChevronRight, ExternalLink, FileUp, RefreshCw, Search, Users } from 'lucide-react'
import { Modal } from './Modal'
import { loadOpenFootball, londonInput, londonKickoff, OpenFootballFeedError } from './openFootball'
import type { OpenFootballCatalog } from './openFootball'
import {
  FORMATIONS, TEAM_COLOURS, activeLineup, fixtureMatch, mergeMatchEvents, minuteLabel, minuteOrder, parseMatch,
} from './match'
import type { FixtureCatalog, Formation, Match, Player, Side, Substitution, Team, Verification } from './match'

const matchDate = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London',
})
const roleOrder = ['GK', 'DEF', 'MID', 'FWD']
const dateLabel = (kickoff: string | null) => kickoff && Number.isFinite(Date.parse(kickoff))
  ? matchDate.format(new Date(kickoff)) : 'Kick-off TBC'
const verificationLabel = (status: Verification) => status === 'verified' ? 'Source verified' : status === 'manual' ? 'Manually selected' : 'Unavailable'
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'The match could not be saved.'

type SelectorProps = { match: Match | null; onChange: (match: Match) => void }
type DatedFixture = FixtureCatalog['fixtures'][number] & { date?: string }
type TimedFixtureCatalog = Omit<FixtureCatalog, 'fixtures'> & {
  fixtures: DatedFixture[]
  checkedAt: string
  latestUpdatedAt?: string | null
  freshnessSec: number
  coverage?: OpenFootballCatalog['coverage']
}
type FixtureFeed = { state: 'loading' } | { state: 'error'; message: string } |
  { state: 'ready'; catalog: TimedFixtureCatalog; expiresAt: number }

const fixtureCategories = [
  { status: 'scheduled', label: 'Upcoming fixtures' },
  { status: 'finished', label: 'Completed results' },
  { status: 'live', label: 'Live' },
] as const
const dateOnly = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' })
const formatFixtureDate = (fixture: DatedFixture) => fixture.kickoff || !fixture.date
  ? dateLabel(fixture.kickoff)
  : `${dateOnly.format(new Date(fixture.date))} · Kick-off TBC`
const PAGE_SIZE = 20
const connectionError = 'Could not connect to the fixture feed. Retry, enter a match or import JSON.'
const validTimestamp = (value?: string | null): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value))

export function MatchSelector({ match, onChange }: SelectorProps) {
  const [open, setOpen] = useState(false)
  return <>
    <button type="button" className="button match-trigger" onClick={() => setOpen(true)} aria-label="Choose Premier League match">
      <CalendarDays size={16} />
      {match ? <span className="match-trigger-label">
        <span>{match.home.name}</span><strong>{match.score ? match.score.join('–') : 'v'}</strong><span>{match.away.name}</span>
      </span> : <span>Choose match</span>}
      <ChevronDown size={14} className="match-chevron" />
    </button>
    {open && <MatchDialog match={match} onChange={(selection) => { onChange(selection); setOpen(false) }} onClose={() => setOpen(false)} />}
  </>
}

function MatchDialog({ match, onChange, onClose }: SelectorProps & { onClose: () => void }) {
  const [mode, setMode] = useState<'fixtures' | 'manual' | 'json'>('fixtures')
  const [newFixture, setNewFixture] = useState(false)
  const [feed, setFeed] = useState<FixtureFeed>({ state: 'loading' })
  const [requestVersion, setRequestVersion] = useState(0)
  const [selectedCategory, setCategory] = useState<Match['status']>()
  const [query, setQuery] = useState('')
  const [clubFilter, setClubFilter] = useState('')
  const [weekFilter, setWeekFilter] = useState('')
  const [shown, setShown] = useState(PAGE_SIZE)
  const [json, setJson] = useState('')
  const [error, setError] = useState('')
  const refresh = useCallback(() => {
    setFeed({ state: 'loading' })
    setRequestVersion((version) => version + 1)
  }, [])
  useEffect(() => {
    if (mode !== 'fixtures') return
    const request = new AbortController()
    let expiryTimer: number | undefined
    const timeout = window.setTimeout(() => {
      setFeed({ state: 'error', message: connectionError })
      request.abort()
    }, 12_000)

    function showCatalogue(catalog: TimedFixtureCatalog, serverDate: string | null) {
      const { freshnessSec, checkedAt } = catalog
      if (!validTimestamp(checkedAt) || typeof freshnessSec !== 'number' || !Number.isFinite(freshnessSec) || freshnessSec <= 0) {
        setFeed({ state: 'error', message: 'Fixture data freshness could not be verified. Retry, enter a match or import JSON.' })
        return
      }
      const now = Date.now()
      const feedNow = validTimestamp(serverDate) ? Date.parse(serverDate) : now
      const age = Math.max(0, feedNow - Date.parse(checkedAt))
      const expiresAt = now + freshnessSec * 1000 - age
      if (expiresAt <= now) {
        setFeed({ state: 'error', message: 'Fixture data has expired. Retry, enter a match or import JSON.' })
        return
      }
      setFeed({ state: 'ready', catalog, expiresAt })
      expiryTimer = window.setTimeout(refresh, expiresAt - now)
    }

    fetch('/api/fixtures', { signal: request.signal, cache: 'no-store' })
      .then(async (response) => {
        const data = await response.json().catch(() => null)
        if (request.signal.aborted) return
        if (response.status === 503 && data?.code === 'NO_PROVIDER') {
          const catalog = await loadOpenFootball(request.signal)
          if (!request.signal.aborted) showCatalogue(catalog, null)
          return
        }
        if (!response.ok || !data || typeof data.source !== 'string' || !Array.isArray(data.fixtures) || !Array.isArray(data.clubs)) {
          setFeed({ state: 'error', message: typeof data?.message === 'string' ? data.message : connectionError })
          return
        }
        showCatalogue(data, response.headers.get('Date'))
      })
      .catch((error: unknown) => {
        if (!request.signal.aborted) setFeed({
          state: 'error',
          message: error instanceof OpenFootballFeedError
            ? `${error.message} Retry, enter a match or import JSON.` : connectionError,
        })
      })
      .finally(() => window.clearTimeout(timeout))
    return () => {
      request.abort()
      window.clearTimeout(timeout)
      window.clearTimeout(expiryTimer)
    }
  }, [mode, refresh, requestVersion])

  const catalog = feed.state === 'ready' ? feed.catalog : null
  const hasLive = catalog?.fixtures.some((fixture) => fixture.status === 'live') ?? false
  const preferredCategory = selectedCategory ?? catalog?.fixtures.find((fixture) => fixture.id === match?.id)?.status ??
    match?.status ?? (match?.score ? 'finished' : 'scheduled')
  const category = preferredCategory === 'live' && !hasLive ? 'scheduled' : preferredCategory
  const clubs = new Map(catalog?.clubs.map((club) => [club.id, club.name]))
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const weeks = Array.from(new Set(catalog?.fixtures.map((fixture) => fixture.week).filter((week): week is number => typeof week === 'number') ?? [])).sort((a, b) => a - b)
  const filtered = catalog?.fixtures.filter((fixture) => {
    if (fixture.status !== category) return false
    if (clubFilter && fixture.homeId !== clubFilter && fixture.awayId !== clubFilter) return false
    if (weekFilter && fixture.week !== Number(weekFilter)) return false
    const text = [clubs.get(fixture.homeId), clubs.get(fixture.awayId), formatFixtureDate(fixture), 'MW ' + fixture.week].join(' ').toLowerCase()
    return words.every((word) => text.includes(word))
  }).sort((a, b) => {
    const current = Number(b.id === match?.id) - Number(a.id === match?.id)
    const dateA = a.kickoff ?? a.date ?? ''
    const dateB = b.kickoff ?? b.date ?? ''
    const undated = Number(!dateA) - Number(!dateB)
    const byDate = dateA.localeCompare(dateB)
    return current || undated || (category === 'scheduled' ? byDate : -byDate)
  }) ?? []
  const switchMode = (next: typeof mode) => {
    setError('')
    if (next === 'fixtures' && mode !== 'fixtures') setFeed({ state: 'loading' })
    setMode(next)
  }

  const loadJson = async (file: File | undefined) => {
    if (!file) return
    if (file.size > 1_000_000) { setError('Choose a match JSON file smaller than 1 MB.'); return }
    try {
      setJson(await file.text())
      setError('')
    } catch { setError('The JSON file could not be opened.') }
  }
  const importJson = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    try { onChange(parseMatch(JSON.parse(json))) }
    catch (error) { setError(error instanceof SyntaxError ? 'Check that the file contains valid JSON.' : errorMessage(error)) }
  }

  const chooseCategory = (next: Match['status']) => {
    switchMode('fixtures')
    setCategory(next)
    setShown(PAGE_SIZE)
  }
  const countFor = (status: Match['status']) => catalog?.fixtures.filter((fixture) => fixture.status === status).length ?? 0

  return <Modal title="Choose a match" kind="match" onClose={onClose}>
    <div className="match-browser">
      <nav className="match-browser-sidebar" aria-label="Match navigation">
        <div className="match-browser-navheading">PREMIER LEAGUE</div>
        <button type="button" className="match-browser-navitem" aria-current={mode === 'fixtures' && category === 'scheduled' ? 'page' : undefined} onClick={() => chooseCategory('scheduled')}>
          <CalendarDays size={17} /><span>Fixtures</span>{catalog && <small>{countFor('scheduled')}</small>}
        </button>
        <button type="button" className="match-browser-navitem" aria-current={mode === 'fixtures' && category === 'finished' ? 'page' : undefined} onClick={() => chooseCategory('finished')}>
          <CalendarDays size={17} /><span>Results</span>{catalog && <small>{countFor('finished')}</small>}
        </button>
        {hasLive && <button type="button" className="match-browser-navitem" aria-current={mode === 'fixtures' && category === 'live' ? 'page' : undefined} onClick={() => chooseCategory('live')}>
          <span className="match-live-indicator" /><span>Live</span><small>{countFor('live')}</small>
        </button>}
        <div className="match-browser-sidebar-spacer" />
        <div className="match-browser-navheading">OTHER OPTIONS</div>
        <button type="button" className="match-browser-navitem" aria-current={mode === 'manual' ? 'page' : undefined} onClick={() => { setNewFixture(false); switchMode('manual') }}>
          <Users size={17} /><span>{match ? 'Edit match' : 'Enter match'}</span>
        </button>
        <button type="button" className="match-browser-navitem" aria-current={mode === 'json' ? 'page' : undefined} onClick={() => switchMode('json')}>
          <FileUp size={17} /><span>Import JSON</span>
        </button>
      </nav>
      <section className="match-browser-main" aria-label="Match browser">
        {mode === 'fixtures' && <>
          <header className="match-browser-heading">
            <div>
              <h3>{category === 'scheduled' ? 'Upcoming fixtures' : category === 'finished' ? 'Completed results' : 'Live matches'}</h3>
              <p>Premier League · 2026/27</p>
            </div>
            <button type="button" className="button subtle compact" onClick={refresh} disabled={feed.state === 'loading'}>
              <RefreshCw size={14} /> Refresh
            </button>
          </header>
          {feed.state === 'loading' && <div className="match-browser-state" role="status">Loading match data…</div>}
          {feed.state === 'error' && <div className="match-browser-state" role="alert">
            <AlertCircle size={20} />
            <strong>Fixtures unavailable</strong>
            <p>{feed.message}</p>
            <button className="button subtle" type="button" onClick={refresh}>Try again</button>
          </div>}
          {feed.state === 'ready' && <>
            <div className="match-browser-controls">
              <label className="match-search"><Search size={17} />
                <input aria-label="Search matches" placeholder="Search teams, dates or matchweeks" value={query} onChange={(event) => { setQuery(event.target.value); setShown(PAGE_SIZE) }} />
              </label>
              <label className="match-browser-filter">
                <span>Club</span>
                <select aria-label="Filter by club" value={clubFilter} onChange={(event) => { setClubFilter(event.target.value); setShown(PAGE_SIZE) }}>
                  <option value="">All clubs</option>
                  {[...catalog!.clubs].sort((a, b) => a.name.localeCompare(b.name)).map((club) =>
                    <option key={club.id} value={club.id}>{club.name}</option>)}
                </select>
              </label>
              <label className="match-browser-filter">
                <span>Matchweek</span>
                <select aria-label="Filter by matchweek" value={weekFilter} onChange={(event) => { setWeekFilter(event.target.value); setShown(PAGE_SIZE) }}>
                  <option value="">All weeks</option>
                  {weeks.map((week) => <option key={week} value={String(week)}>MW {week}</option>)}
                </select>
              </label>
            </div>
            {feed.catalog.coverage && feed.catalog.coverage.missingPast > 0 && <div className="match-browser-warning" role="status">
              <AlertCircle size={15} />
              <span>Results are incomplete. {feed.catalog.coverage.completedThrough
                ? 'Latest recorded final score: ' + dateOnly.format(new Date(feed.catalog.coverage.completedThrough)) + '.'
                : 'No final scores have been recorded.'} Check results before broadcast.</span>
            </div>}
            <div className="match-browser-count">{filtered.length} {category === 'finished' ? 'results' : 'fixtures'}</div>
            <div className="match-browser-list" aria-label={fixtureCategories.find(({ status }) => status === category)?.label}>
              {filtered.slice(0, shown).map((fixture, index, visible) => {
                const keyDate = fixture.kickoff?.slice(0, 10) ?? fixture.date ?? ''
                const previous = visible[index - 1]
                const previousDate = previous?.kickoff?.slice(0, 10) ?? previous?.date ?? ''
                return <div className="match-browser-listitem" key={fixture.id}>
                  {(index === 0 || previousDate !== keyDate) && <div className="match-browser-date">{keyDate ? dateOnly.format(new Date(keyDate)) : 'Date to be confirmed'}</div>}
                  <button type="button" className="fixture-row" aria-current={match?.id === fixture.id || undefined}
                    onClick={() => {
                      if (Date.now() >= feed.expiresAt) { refresh(); return }
                      onChange(fixtureMatch(fixture, feed.catalog, match))
                    }}>
                    <span className="match-browser-matchup">
                      <span>{clubs.get(fixture.homeId)}</span>
                      <strong className="match-browser-score">{fixture.score?.join(' – ') ?? 'v'}</strong>
                      <span>{clubs.get(fixture.awayId)}</span>
                    </span>
                    <span className="match-browser-row-meta">
                      <small>{fixture.week ? 'MW ' + fixture.week : 'Premier League'}</small>
                      <span>{fixture.kickoff ? new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' }).format(new Date(fixture.kickoff)) : 'Time TBC'}</span>
                    </span>
                    <ChevronRight size={17} className="match-browser-row-chevron" />
                  </button>
                </div>
              })}
              {!filtered.length && <div className="match-browser-empty">{query.trim() || clubFilter || weekFilter ? 'No matches found. Try a different search or filter.' : 'No matches available in this category.'}</div>}
              {filtered.length > shown && <button className="match-browser-more" type="button" onClick={() => setShown((count) => count + PAGE_SIZE)}>Show more {category === 'finished' ? 'results' : 'fixtures'}</button>}
            </div>
            <footer className="match-browser-footer">
              <span>Lineups can be added after selecting a match.</span>
              <details className="match-browser-source">
                <summary>Data source &amp; coverage</summary>
                <p>{feed.catalog.source}. Fetched {dateLabel(feed.catalog.checkedAt)} UK.
                  {validTimestamp(feed.catalog.latestUpdatedAt) && <> Latest source update: {dateLabel(feed.catalog.latestUpdatedAt)} UK.</>}
                  {feed.catalog.coverage?.missingPast ? ' ' + feed.catalog.coverage.missingPast + ' past matches have no final score in this feed.' : ''}
                </p>
              </details>
            </footer>
          </>}
        </>}
        {mode === 'manual' && <div className="match-browser-editor">
          <header className="match-browser-heading"><div><h3>{match && !newFixture ? 'Edit match' : 'Enter match'}</h3><p>Enter a match you have verified</p></div></header>
          {match && <button type="button" className="button subtle" onClick={() => setNewFixture(!newFixture)}>
            {newFixture ? 'Edit selected match' : 'Enter another match'}
          </button>}
          <ManualFixture key={newFixture ? 'new' : match?.id} match={newFixture ? null : match} onChange={onChange} />
        </div>}
        {mode === 'json' && <div className="match-browser-editor">
          <header className="match-browser-heading"><div><h3>Import match data</h3><p>Import an authorised match file</p></div></header>
          <form className="stack match-form" onSubmit={importJson}>
            <div className="match-actions">
              <label className="button subtle match-file"><FileUp size={15} /> Open JSON<input type="file" accept=".json,application/json" aria-label="Open match JSON" onChange={(event) => { void loadJson(event.currentTarget.files?.[0]); event.currentTarget.value = '' }} /></label>
              {match && <button type="button" className="button subtle" onClick={() => { setJson(JSON.stringify(match, null, 2)); setError('') }}>Use selected match</button>}
            </div>
            <label className="field">Match JSON<textarea rows={10} value={json} onChange={(event) => setJson(event.target.value)} spellCheck={false} required /></label>
            <details className="match-schema"><summary>JSON fields</summary>
              <p>Match requires id, home and away. Each club requires id and name. Supply fixture source, kickoff (ISO 8601), score [home, away] and officialUrl when available.</p>
              <p>Club squad entries use id, name, number and optional role (GK, DEF, MID, FWD). xi and bench list those player IDs. Use verification or benchVerification set to manual or verified. Verified data requires a source URL. Put players in formation order, goalkeeper first.</p>
              <p>Substitutions use teamId, off, on, minute and optional addedTime. Use verification set to verified and supply a source URL for confirmed events.</p>
            </details>
            {error && <p className="match-error" role="alert">{error}</p>}
            <button className="button primary match-submit" type="submit">Import match</button>
          </form>
        </div>}
      </section>
    </div>
  </Modal>
}

function ManualFixture({ match, onChange }: SelectorProps) {
  const [error, setError] = useState('')
  const currentKickoff = match?.kickoff ? londonInput(Date.parse(match.kickoff)) : ''
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const field = (name: string) => String(data.get(name) ?? '').trim()
    try {
      const goals = [field('homeGoals'), field('awayGoals')]
      if (Boolean(goals[0]) !== Boolean(goals[1])) throw new Error('Supply both scores or leave both blank.')
      const kickoff = match && field('kickoff') === currentKickoff ? match.kickoff : londonKickoff(field('kickoff'))
      const officialUrl = field('source') || undefined
      const score = goals[0] ? goals.map(Number) : null
      if (match) {
        const scoreChanged = score?.join() !== match.score?.join()
        const edited = scoreChanged || kickoff !== match.kickoff || officialUrl !== match.officialUrl
        const fixture = parseMatch({
          ...match,
          kickoff,
          score,
          officialUrl,
          source: edited ? officialUrl || 'Operator entry' : match.source,
          status: scoreChanged && score && match.status !== 'live' ? 'finished' : match.status,
        })
        onChange({ ...match, kickoff: fixture.kickoff, score: fixture.score, officialUrl: fixture.officialUrl, source: fixture.source, status: fixture.status })
        return
      }
      const home = field('home')
      const away = field('away')
      if (home.toLowerCase() === away.toLowerCase()) throw new Error('Choose two different clubs.')
      const clubId = (name: string) => 'manual:club:' + name.normalize('NFKC').toLowerCase().replace(/\s+/g, '-')
      onChange(parseMatch({
        id: editorId(), source: officialUrl || 'Operator entry', kickoff,
        score,
        officialUrl,
        home: { id: clubId(home), name: home },
        away: { id: clubId(away), name: away },
      }))
    } catch (error) { setError(errorMessage(error)) }
  }
  return <form className="stack match-form" onSubmit={submit}>
    <div className="match-grid">
      <label className="field">Home club<input name="home" defaultValue={match?.home.name} readOnly={Boolean(match)} required maxLength={70} /></label>
      <label className="field">Away club<input name="away" defaultValue={match?.away.name} readOnly={Boolean(match)} required maxLength={70} /></label>
      <label className="field">Home goals<input name="homeGoals" type="number" defaultValue={match?.score?.[0]} min="0" max="99" /></label>
      <label className="field">Away goals<input name="awayGoals" type="number" defaultValue={match?.score?.[1]} min="0" max="99" /></label>
    </div>
    <label className="field">Kick-off (UK time)<input type="datetime-local" name="kickoff" defaultValue={currentKickoff} /></label>
    <label className="field">Match centre URL<input type="url" name="source" defaultValue={match?.officialUrl} /></label>
    {error && <p className="match-error" role="alert">{error}</p>}
    <button type="submit" className="button primary match-submit">{match ? 'Save fixture' : 'Set match'}</button>
  </form>
}

type MatchPanelProps = {
  match: Match | null
  formations: Record<Side, Formation>
  minute: number
  addedTime?: number
  substitutions: Substitution[]
  onFormation: (side: Side, formation: Formation) => void
  onTeamChange: (side: Side, team: Team) => void
  onMinute: (minute: number, addedTime: number) => void
  onSubstitution: (event: Substitution) => void
}

type TeamDialog = { side: Side; type: 'lineup' | 'sub' }

export function MatchPanel({ match, formations, minute, addedTime = 0, substitutions, onFormation, onTeamChange, onMinute, onSubstitution }: MatchPanelProps) {
  const [dialog, setDialog] = useState<TeamDialog | null>(null)
  const [customMinute, setCustomMinute] = useState(false)
  const events = mergeMatchEvents(match?.substitutions ?? [], substitutions)
  if (!match) return <div className="teams-unavailable"><Users size={19} /><p>Choose a match to load teams.</p></div>

  return <div className="match-panel">
    <div className="match-metadata">
      <div>{match.week ? `MW ${match.week} · ` : ''}{dateLabel(match.kickoff)}</div>
      <small>{match.officialUrl
        ? <>{match.source !== match.officialUrl && <>{match.source} · </>}<a href={match.officialUrl} target="_blank" rel="noreferrer">Match centre <ExternalLink size={12} /></a></>
        : match.source}</small>
    </div>
    {(match.home.xi.length || match.away.xi.length) > 0 && <div className="match-clock">
      <label>Match state<select aria-label="Match state" value={`${minute}:${addedTime}`} onChange={(event) => {
        if (event.target.value === 'custom') { setCustomMinute(true); return }
        const [nextMinute, nextAdded] = event.target.value.split(':').map(Number)
        onMinute(nextMinute, nextAdded)
      }}>
        <option value="0:0">Kick-off</option>
        {[...new Set([
          ...events.map((event) => `${event.minute}:${event.addedTime ?? 0}`),
          ...(minute ? [`${minute}:${addedTime}`] : []),
          '45:0', '90:0',
        ])].sort((a, b) => {
          const [aMinute, aAdded] = a.split(':').map(Number)
          const [bMinute, bAdded] = b.split(':').map(Number)
          return minuteOrder(aMinute, aAdded) - minuteOrder(bMinute, bAdded)
        }).map((key) => {
          const [at, added] = key.split(':').map(Number)
          return <option key={key} value={key}>{minuteLabel(at, added)}</option>
        })}
        <option value="custom">Set minute…</option>
      </select></label>
    </div>}
    {customMinute && <MatchMinuteDialog minute={minute} addedTime={addedTime} onClose={() => setCustomMinute(false)}
      onSave={(nextMinute, nextAddedTime) => { onMinute(nextMinute, nextAddedTime); setCustomMinute(false) }} />}
    {(['home', 'away'] as const).map((side) => <TeamCard key={match[side].id}
      team={match[side]} side={side} formation={formations[side]} minute={minute} addedTime={addedTime} events={events}
      onFormation={(formation) => onFormation(side, formation)} onEdit={() => setDialog({ side, type: 'lineup' })}
      onSub={() => setDialog({ side, type: 'sub' })} />)}
    {dialog?.type === 'lineup' && <LineupDialog match={match} side={dialog.side}
      onClose={() => setDialog(null)} onSave={(team) => { onTeamChange(dialog.side, team); setDialog(null) }} />}
    {dialog?.type === 'sub' && <SubDialog team={match[dialog.side]} minute={minute} addedTime={addedTime} events={events} matchEvents={match.substitutions}
      onClose={() => setDialog(null)} onSave={(event) => { onSubstitution(event); setDialog(null) }} />}
  </div>
}

function TeamCard({ team, side, formation, minute, addedTime, events, onFormation, onEdit, onSub }: {
  team: Team; side: Side; formation: Formation; minute: number; addedTime: number; events: Substitution[]
  onFormation: (formation: Formation) => void; onEdit: () => void; onSub: () => void
}) {
  const [tab, setTab] = useState<'xi' | 'bench' | 'events'>('xi')
  const starters = activeLineup(team, events, minute, addedTime).map(({ player }) => player)
  const bench = team.bench.flatMap((id) => team.squad.find((player) => player.id === id) ?? [])
  const teamEvents = events.filter((event) => event.teamId === team.id)
  const Direction = side === 'home' ? ArrowRight : ArrowLeft
  const statusText = (status: Verification) => status === 'verified' && team.source
    ? <a href={team.source} target="_blank" rel="noreferrer">{verificationLabel(status)} <ExternalLink size={10} /></a>
    : verificationLabel(status)
  const showPlayers = (players: Player[]) => <ul className="team-roster">
    {players.map((player) => <li key={player.id}><b>{player.number ?? '–'}</b><span>{player.name}</span>{player.role === 'GK' && <small>GK</small>}</li>)}
  </ul>
  return <section className="team-card">
    <header>
      <span className="team-dot" style={{ background: team.colour }} />
      <h3>{team.name}</h3>
      <Direction size={15} aria-label={side === 'home' ? 'Attacks right' : 'Attacks left'} />
    </header>
    <label className="team-formation">Formation<select aria-label={`${team.name} formation`} value={formation} onChange={(event) => onFormation(event.target.value as Formation)}>
      {FORMATIONS.map((formation) => <option key={formation}>{formation}</option>)}
    </select></label>
    {!team.xi.length ? <div className="team-empty">
      <p>Starting XI unavailable</p>
      <button type="button" className="button subtle" onClick={onEdit}>{team.squad.length ? 'Select XI' : 'Enter lineup'}</button>
      {bench.length > 0 && <details className="bench-preview">
        <summary>Bench · {bench.length}</summary>
        <p className="team-status">{statusText(team.benchVerification ?? team.verification)}</p>
        {showPlayers(bench)}
      </details>}
    </div> : <>
      <div className="match-tabs team-tabs" aria-label={`${team.name} team view`}>
        <button type="button" aria-pressed={tab === 'xi'} onClick={() => setTab('xi')}>XI</button>
        <button type="button" aria-pressed={tab === 'bench'} onClick={() => setTab('bench')}>Bench</button>
        <button type="button" aria-pressed={tab === 'events'} onClick={() => setTab('events')}>Changes</button>
      </div>
      {tab === 'xi' && <><p className="team-status">{minute ? `Shape at ${minuteLabel(minute, addedTime)}` : statusText(team.verification)}</p>{showPlayers(starters)}</>}
      {tab === 'bench' && <><p className="team-status">{bench.length ? statusText(team.benchVerification ?? team.verification) : 'Bench unavailable'}</p>{showPlayers(bench)}</>}
      {tab === 'events' && <ul className="sub-history">
        {!teamEvents.length && <li className="match-note">No substitution records.</li>}
        {teamEvents.map((event) => <li key={`${event.off}:${event.on}:${event.minute}`}>
          <b>{minuteLabel(event.minute, event.addedTime)}</b>
          <span>{team.squad.find((player) => player.id === event.off)?.name} → {team.squad.find((player) => player.id === event.on)?.name}</span>
          <small>{event.verification === 'verified' && event.source
            ? <a href={event.source} target="_blank" rel="noreferrer">Source verified <ExternalLink size={10} /></a>
            : 'Operator entered'}</small>
        </li>)}
      </ul>}
      <div className="team-actions">
        <button type="button" className="button subtle" onClick={onEdit}>Edit lineup</button>
        <button type="button" className="button subtle" onClick={onSub} disabled={!bench.length} title={bench.length ? undefined : 'Add the matchday bench first'}>
          <ArrowRightLeft size={13} /> Substitution
        </button>
      </div>
    </>}
  </section>
}

type Selection = 'xi' | 'bench' | ''
type Entry = { selection: Selection; number: string }
const normalName = (name: string) => name.trim().normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
const editorId = () => Array.from(crypto.getRandomValues(new Uint32Array(4)), (word) => word.toString(16).padStart(8, '0')).join('')
const textRoster = (team: Team, ids: string[]) => ids.flatMap((id) => {
  const player = team.squad.find((candidate) => candidate.id === id)
  return player ? [[player.number, player.name, player.role].filter((value) => value != null).join(', ')] : []
}).join('\n')

function directRoster(team: Team, xiText: string, benchText: string): Pick<Team, 'squad' | 'xi' | 'bench'> {
  const squad = team.squad.slice()
  const read = (text: string) => text.split(/\r?\n/).filter((line) => line.trim()).map((line, index) => {
    const [number, name, role, extra] = line.split(',').map((field) => field.trim())
    if (!/^\d{1,2}$/.test(number) || !name || extra !== undefined || (role && !roleOrder.includes(role.toUpperCase()))) {
      throw new Error(`Check roster row ${index + 1}. Enter shirt number, name and optional role.`)
    }
    const matches = squad.filter((player) => normalName(player.name) === normalName(name))
    const existing = matches.find((player) => player.number === Number(number)) ?? (matches.length === 1 ? matches[0] : undefined)
    const player: Player = {
      id: existing?.id ?? `manual:player:${editorId()}`, name, number: Number(number),
      role: (role?.toUpperCase() as Player['role']) || existing?.role,
    }
    const current = squad.findIndex((candidate) => candidate.id === player.id)
    if (current < 0) squad.push(player)
    else squad[current] = player
    return player.id
  })
  return { squad, xi: read(xiText), bench: read(benchText) }
}

function LineupDialog({ match, side, onClose, onSave }: {
  match: Match; side: Side; onClose: () => void; onSave: (team: Team) => void
}) {
  const team = match[side]
  const [mode, setMode] = useState(team.squad.length ? 'squad' : 'direct')
  const [query, setQuery] = useState('')
  const [entries, setEntries] = useState<Record<string, Entry>>(() => Object.fromEntries(team.squad.map((player) => [player.id, {
    selection: team.xi.includes(player.id) ? 'xi' : team.bench.includes(player.id) ? 'bench' : '',
    number: player.number?.toString() ?? '',
  }])))
  const [xiText, setXiText] = useState(() => textRoster(team, team.xi))
  const [benchText, setBenchText] = useState(() => textRoster(team, team.bench))
  const [source, setSource] = useState(team.source ?? '')
  const [verified, setVerified] = useState(team.verification === 'verified')
  const [colour, setColour] = useState(team.colour)
  const [error, setError] = useState('')
  const count = (selection: Selection) => Object.values(entries).filter((entry) => entry.selection === selection).length
  const update = (id: string, update: Partial<Entry>) => setEntries((before) => ({ ...before, [id]: { ...before[id], ...update } }))
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    try {
      const squad = team.squad.map((player) => ({
        ...player, number: entries[player.id].number ? Number(entries[player.id].number) : null,
      }))
      const select = (kind: Selection) => squad.filter((player) => entries[player.id].selection === kind).sort((a, b) => {
        const prior = kind === 'xi' ? team.xi : team.bench
        const order = (player: Player) => prior.includes(player.id) ? prior.indexOf(player.id) - prior.length : roleOrder.indexOf(player.role ?? '') + 1
        return order(a) - order(b)
      }).map((player) => player.id)
      const roster = mode === 'direct'
        ? directRoster(team, xiText, benchText)
        : { squad, xi: select('xi'), bench: select('bench') }
      if (roster.xi.length !== 11) throw new Error('Choose exactly 11 starters.')
      const keepers = roster.xi.filter((id) => roster.squad.find((player) => player.id === id)?.role === 'GK').length
      if (keepers > 1 || (!keepers && mode === 'squad' && roster.squad.some((player) => player.role === 'GK'))) {
        throw new Error('Choose one starting goalkeeper.')
      }
      const status = verified ? 'verified' : 'manual'
      const updated = parseMatch({
        ...match, [side]: {
          ...team, ...roster, colour, verification: status, benchVerification: roster.bench.length ? status : 'unavailable',
          source: source.trim() || undefined,
        },
      })
      onSave(updated[side])
    } catch (error) { setError(errorMessage(error)) }
  }

  return <Modal title={`${team.name} matchday lineup`} onClose={onClose}>
    <form className="stack match-form" onSubmit={submit}>
      {team.squad.length > 0 && <div className="match-tabs">
        <button type="button" aria-pressed={mode === 'squad'} onClick={() => { setMode('squad'); setError('') }}>Select from squad</button>
        <button type="button" aria-pressed={mode === 'direct'} onClick={() => { setMode('direct'); setError('') }}>Enter players</button>
      </div>}
      {mode === 'squad' ? <>
        <label className="match-search"><Search size={16} /><input aria-label="Find squad player" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <div className="match-selection-count"><strong>{count('xi')} / 11 starters</strong><span>{count('bench')} on bench</span></div>
        <div className="squad-list">
          {team.squad.filter((player) => normalName(player.name).includes(normalName(query))).map((player) => <div className="squad-row" key={player.id}>
            <div><b>{player.name}</b><small>{player.role}</small></div>
            <input aria-label={`${player.name} shirt number`} type="number" min="1" max="99" inputMode="numeric"
              value={entries[player.id].number} onChange={(event) => update(player.id, { number: event.target.value })} />
            <select aria-label={`${player.name} matchday selection`} value={entries[player.id].selection}
              onChange={(event) => update(player.id, { selection: event.target.value as Selection })}>
              <option value="">Squad</option><option value="xi" disabled={count('xi') >= 11 && entries[player.id].selection !== 'xi'}>XI</option><option value="bench">Bench</option>
            </select>
          </div>)}
        </div>
      </> : <>
        <p className="match-note">One player per line. Enter shirt number, name and optional role (GK, DEF, MID, FWD). Put the starting goalkeeper first.</p>
        <label className="field">Starting XI<textarea rows={6} value={xiText} onChange={(event) => setXiText(event.target.value)} required /></label>
        <label className="field">Matchday bench<textarea rows={4} value={benchText} onChange={(event) => setBenchText(event.target.value)} /></label>
      </>}
      <div className="lineup-verification">
        <label className="field">Matchday source URL<input type="url" value={source} onChange={(event) => setSource(event.target.value)} required={verified} /></label>
        <label className="field team-colour">Marker colour<input type="color" value={colour} onChange={(event) => setColour(event.target.value)} /></label>
      </div>
      <label className="match-checkbox"><input type="checkbox" checked={verified} onChange={(event) => setVerified(event.target.checked)} /> Verified against this matchday source</label>
      {error && <p className="match-error" role="alert">{error}</p>}
      <button className="button primary match-submit" type="submit">Apply lineup</button>
    </form>
  </Modal>
}

function parseMinute(input: string, allowKickoff = false): [number, number] {
  const parts = input.trim().match(/^(\d{1,3})(?:\+(\d{1,2}))?$/)
  const minute = Number(parts?.[1])
  const addedTime = Number(parts?.[2] ?? 0)
  if (!parts || minute < Number(!allowKickoff) || minute > 120 ||
    (addedTime && (![45, 90, 105, 120].includes(minute) || addedTime > 30))) {
    throw new Error('Enter a match minute from 0 to 120, with added time if needed (such as 90+3).')
  }
  return [minute, addedTime]
}

function MatchMinuteDialog({ minute, addedTime, onClose, onSave }: {
  minute: number; addedTime: number; onClose: () => void; onSave: (minute: number, addedTime: number) => void
}) {
  const [value, setValue] = useState(minuteLabel(minute, addedTime).slice(0, -1))
  const [error, setError] = useState('')
  return <Modal title="Set match minute" onClose={onClose}>
    <form className="stack match-form" onSubmit={(event) => {
      event.preventDefault()
      try { onSave(...parseMinute(value, true)) }
      catch (error) { setError(errorMessage(error)) }
    }}>
      <label className="field">Match minute<input value={value} onChange={(event) => setValue(event.target.value)} required /></label>
      {error && <p className="match-error" role="alert">{error}</p>}
      <button className="button primary match-submit" type="submit">Set minute</button>
    </form>
  </Modal>
}

function SubDialog({ team, minute, addedTime, events, matchEvents, onClose, onSave }: {
  team: Team; minute: number; addedTime: number; events: Substitution[]; matchEvents: Substitution[]
  onClose: () => void; onSave: (event: Substitution) => void
}) {
  const [at, setAt] = useState(minute ? minuteLabel(minute, addedTime).slice(0, -1) : '')
  const [off, setOff] = useState('')
  const [on, setOn] = useState('')
  const [source, setSource] = useState('')
  const [verified, setVerified] = useState(false)
  const [error, setError] = useState('')
  let when = minuteOrder(minute, addedTime)
  try { when = minuteOrder(...parseMinute(at)) } catch { /* The submit handler validates the minute. */ }
  const teamEvents = (verified ? matchEvents : events).filter((event) => event.teamId === team.id)
  const preceding = teamEvents.filter((event) => minuteOrder(event.minute, event.addedTime) <= when)
  const occupied = activeLineup(team, preceding, 120, 30)
  const bench = team.squad.filter((player) => team.bench.includes(player.id) && !teamEvents.some((event) => event.on === player.id))
  const submit = (form: FormEvent<HTMLFormElement>) => {
    form.preventDefault()
    try {
      const [eventMinute, extra] = parseMinute(at)
      if (!occupied.some(({ player }) => player.id === off) || !bench.some((player) => player.id === on)) throw new Error('Choose a player on the pitch and an unused bench player.')
      let sourceUrl: string | undefined
      if (source.trim()) {
        const parsed = new URL(source.trim())
        if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Enter an HTTP or HTTPS source URL.')
        sourceUrl = parsed.href
      }
      if (verified && !sourceUrl) throw new Error('Provide a source URL for the verified event.')
      const next: Substitution = { teamId: team.id, off, on, minute: eventMinute, addedTime: extra, verification: verified ? 'verified' : 'manual', source: sourceUrl }
      if (teamEvents.some((event) => event.off === off || event.on === on)) {
        throw new Error('This change conflicts with an existing substitution.')
      }
      const chronological = mergeMatchEvents(teamEvents, [next])
      const applied: Substitution[] = []
      for (const event of chronological) {
        if (!activeLineup(team, applied, event.minute, event.addedTime).some(({ player }) => player.id === event.off)) {
          throw new Error('This change conflicts with an existing substitution.')
        }
        applied.push(event)
      }
      onSave(next)
    } catch (error) { setError(errorMessage(error)) }
  }
  return <Modal title={`${team.name} substitution`} onClose={onClose}>
    <form className="stack match-form" onSubmit={submit}>
      <label className="field">Minute<input aria-label="Substitution minute" value={at} onChange={(event) => setAt(event.target.value)} required /></label>
      <div className="match-grid">
        <label className="field">Player off<select aria-label="Player off" value={occupied.some(({ player }) => player.id === off) ? off : ''} onChange={(event) => setOff(event.target.value)} required>
          <option value="">Select player</option>{occupied.map(({ player }) => <option key={player.id} value={player.id}>{player.number} · {player.name}</option>)}
        </select></label>
        <label className="field">Player on<select aria-label="Player on" value={bench.some((player) => player.id === on) ? on : ''} onChange={(event) => setOn(event.target.value)} required>
          <option value="">Select player</option>{bench.map((player) => <option key={player.id} value={player.id}>{player.number} · {player.name}</option>)}
        </select></label>
      </div>
      {!bench.length && <p className="match-note">All listed substitutes have been used.</p>}
      <label className="field">Substitution source URL<input type="url" value={source} onChange={(event) => setSource(event.target.value)} required={verified} /></label>
      <label className="match-checkbox"><input type="checkbox" checked={verified} onChange={(event) => setVerified(event.target.checked)} /> Verified against this match source</label>
      {error && <p className="match-error" role="alert">{error}</p>}
      <button className="button primary match-submit" type="submit" disabled={!bench.length}>Apply substitution</button>
    </form>
  </Modal>
}
