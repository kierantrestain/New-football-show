import type { Fixture, FixtureCatalog } from './match'
import { londonInput } from './match'

const scoreboardUrl = '/api/espn?resource=scoreboard'
const FRESHNESS_SECONDS = 300
const dateLabel = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/London',
})

type EspnFixture = Fixture & { date?: string }
export type EspnCatalog = Omit<FixtureCatalog, 'fixtures'> & {
  fixtures: EspnFixture[]
  checkedAt: string
  latestUpdatedAt: null
  freshnessSec: number
  windowLabel: string
  hasEarlier: boolean
  hasLater: boolean
}
type Scoreboard = {
  calendar: string[]
  day?: string
  fixtures: EspnFixture[]
  clubs: FixtureCatalog['clubs']
  checkedAt: number
}

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
const records = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.map(asRecord).filter(item => item !== undefined) : []
const idOf = (value: unknown) => typeof value === 'string' && /^[1-9]\d*$/.test(value) ? value : undefined

function calendarDate(value: unknown) {
  if (typeof value !== 'string') return undefined
  const date = value.slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined
  const time = Date.parse(date + 'T00:00:00Z')
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === date ? date : undefined
}

function scoreOf(value: unknown) {
  const score = typeof value === 'string' && /^\d{1,2}$/.test(value) ? Number(value) : value
  return typeof score === 'number' && Number.isInteger(score) && score >= 0 && score <= 99 ? score : null
}

function clubOf(competitor: Record<string, unknown>) {
  const team = asRecord(competitor.team)
  const id = idOf(team?.id)
  const name = typeof team?.displayName === 'string' ? team.displayName.trim() : ''
  return id && name ? { id, name, squad: [] } : undefined
}

function statusOf(type: Record<string, unknown> | undefined): Fixture['status'] | undefined {
  if (!type || (typeof type.name === 'string' && /POSTPON|CANCEL|SUSPEND|ABANDON|DELAY/.test(type.name))) return
  if (type.state === 'post' && type.completed === true) return 'finished'
  if (type.state === 'in') return 'live'
  if (type.state === 'pre') return 'scheduled'
}

function parseScoreboard(payload: unknown, checkedAt: number): Scoreboard {
  const board = asRecord(payload)
  const league = records(board?.leagues).find(item => item.slug === 'eng.1')
  if (!league || !Array.isArray(board?.events)) throw new Error('ESPN returned an unexpected Premier League scoreboard.')

  const calendar = new Set<string>()
  for (const value of Array.isArray(league.calendar) ? league.calendar : []) {
    const date = calendarDate(value)
    if (date) calendar.add(date)
  }
  const day = calendarDate(asRecord(board.day)?.date)
  if (day) calendar.add(day)
  const fixtures = new Map<string, EspnFixture>()
  const clubs = new Map<string, FixtureCatalog['clubs'][number]>()

  for (const event of records(board.events)) {
    const id = idOf(event.id)
    const competition = records(event.competitions)[0]
    if (!id || !competition) continue
    const type = asRecord(asRecord(competition.status)?.type) ?? asRecord(asRecord(event.status)?.type)
    const status = statusOf(type)
    if (!status) continue
    const competitors = records(competition.competitors)
    const home = competitors.find(team => team.homeAway === 'home')
    const away = competitors.find(team => team.homeAway === 'away')
    if (!home || !away) continue
    const homeClub = clubOf(home)
    const awayClub = clubOf(away)
    if (!homeClub || !awayClub || homeClub.id === awayClub.id) continue

    const dateValue = competition.date ?? event.date
    const timestamp = typeof dateValue === 'string' && /T\d{2}:\d{2}.*(?:Z|[+-]\d{2}:\d{2})$/.test(dateValue)
      ? Date.parse(dateValue) : NaN
    const date = competition.timeValid === false || !Number.isFinite(timestamp)
      ? calendarDate(dateValue) : londonInput(timestamp).slice(0, 10)
    const kickoff = competition.timeValid !== false && Number.isFinite(timestamp)
      ? new Date(timestamp).toISOString() : null
    const homeScore = scoreOf(home.score)
    const awayScore = scoreOf(away.score)
    clubs.set(homeClub.id, homeClub)
    clubs.set(awayClub.id, awayClub)
    fixtures.set(id, {
      id, homeId: homeClub.id, awayId: awayClub.id, date, kickoff, status,
      score: status === 'finished' && homeScore !== null && awayScore !== null ? [homeScore, awayScore] : null,
    })
    if (date) calendar.add(date)
  }
  if (board.events.length && !fixtures.size) {
    // A dated scoreboard can legitimately contain only postponed or cancelled games.
    if (records(board.events).some(event => !idOf(event.id) || !records(event.competitions).length)) {
      throw new Error('ESPN returned invalid match records.')
    }
  }
  return { calendar: [...calendar].sort(), day, fixtures: [...fixtures.values()], clubs: [...clubs.values()], checkedAt }
}

function chooseDates(board: Scoreboard, offset: number, today: string) {
  const dates = board.calendar
  if (!dates.length) throw new Error('ESPN returned no Premier League match dates.')
  let next = dates.findIndex(date => date >= today)
  if (next === -1) next = dates.length
  if (dates[next] === today && board.day === today && board.fixtures.length
      && board.fixtures.every(fixture => fixture.status === 'finished')) next++

  const start = Math.max(0, next - 1)
  const end = Math.min(next, dates.length - 1)
  if (offset === 0) return { dates: dates.slice(start, end + 1), start, end }
  const index = Math.min(dates.length - 1, Math.max(0, offset < 0 ? start + offset : end + offset))
  return { dates: [dates[index]], start: index, end: index }
}

function withAbort<T>(request: Promise<T>, signal: AbortSignal) {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    request.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
    if (signal.aborted) abort()
  })
}

export function createEspnFixtureLoader({ fetcher = globalThis.fetch, now = Date.now } = {}) {
  const cache = new Map<string, Scoreboard>()
  const pending = new Map<string, Promise<Scoreboard>>()

  async function fetchScoreboard(date: string) {
    const request = new AbortController()
    const timeout = setTimeout(() => request.abort(), 6500)
    const url = date ? scoreboardUrl + '&date=' + date.replaceAll('-', '') : scoreboardUrl
    try {
      const response = await fetcher(url, { signal: request.signal, cache: 'no-store' })
      if (!response.ok) throw new Error(`ESPN fixture feed returned HTTP ${response.status}.`)
      const board = parseScoreboard(await response.json(), now())
      cache.set(date, board)
      if (!date && board.day && board.fixtures.every(fixture => fixture.date === board.day)) cache.set(board.day, board)
      return board
    } finally {
      clearTimeout(timeout)
    }
  }

  function scoreboard(date: string) {
    const cached = cache.get(date)
    if (cached && now() < cached.checkedAt + FRESHNESS_SECONDS * 1000) return Promise.resolve(cached)
    let request = pending.get(date)
    if (!request) {
      request = fetchScoreboard(date).finally(() => pending.delete(date))
      pending.set(date, request)
    }
    return request
  }

  return async function loadEspnFixtures(windowOffset: number, signal: AbortSignal): Promise<EspnCatalog> {
    if (signal.aborted) throw signal.reason
    const base = await withAbort(scoreboard(''), signal)
    const today = londonInput(now()).slice(0, 10)
    const selection = chooseDates(base, windowOffset, today)
    const windows = await withAbort(Promise.all(selection.dates.map(scoreboard)), signal)
    const clubs = new Map<string, FixtureCatalog['clubs'][number]>()
    const fixtures = new Map<string, EspnFixture>()
    for (const window of windows) {
      for (const club of window.clubs) clubs.set(club.id, club)
      for (const fixture of window.fixtures) fixtures.set(fixture.id, fixture)
    }
    return {
      source: 'ESPN',
      clubs: [...clubs.values()],
      fixtures: [...fixtures.values()],
      checkedAt: new Date(Math.min(...windows.map(window => window.checkedAt))).toISOString(),
      latestUpdatedAt: null,
      freshnessSec: FRESHNESS_SECONDS,
      windowLabel: selection.dates.map(date => dateLabel.format(new Date(date + 'T12:00:00Z'))).join(' & '),
      hasEarlier: selection.start > 0,
      hasLater: selection.end < base.calendar.length - 1,
    }
  }
}

export const loadEspnFixtures = createEspnFixtureLoader()
