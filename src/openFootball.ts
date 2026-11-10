import type { Fixture, FixtureCatalog, Match } from './match'

export const OPEN_FOOTBALL_URL = 'https://raw.githubusercontent.com/openfootball/football.json/master/2026-27/en.1.json'
const SEASON = '2026-27'
const FRESHNESS_SECONDS = 300

export class OpenFootballFeedError extends Error {}

export type OpenFootballCatalog = Omit<FixtureCatalog, 'fixtures'> & {
  fixtures: (Fixture & { date?: string })[]
  checkedAt: string
  freshnessSec: number
  latestUpdatedAt: null
  coverage: { completedThrough: string | null; missingPast: number }
}

const londonParts = new Intl.DateTimeFormat('en-GB', {
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  hourCycle: 'h23', timeZone: 'Europe/London',
})

export function londonInput(time: number): string {
  const parts = Object.fromEntries(londonParts.formatToParts(time).map(({ type, value }) => [type, value]))
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`
}

export function londonKickoff(value: string): string | null {
  if (!value) return null
  const target = Date.parse(value + 'Z')
  if (!Number.isFinite(target)) throw new Error('Enter a valid London kick-off time.')
  const utc = [target, target - 3600000].find((time) => londonInput(time) === value)
  if (utc === undefined) throw new Error('Enter a valid London kick-off time.')
  return new Date(utc).toISOString()
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function calendarDate(value: unknown): string | undefined {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined
  const utc = Date.parse(value + 'T00:00:00Z')
  return Number.isFinite(utc) && new Date(utc).toISOString().slice(0, 10) === value ? value : undefined
}

function fixtureKickoff(date: string | undefined, time: unknown): string | null {
  if (!date || typeof time !== 'string' || !/^\d{2}:\d{2}$/.test(time)) return null
  try { return londonKickoff(`${date}T${time}`) }
  catch { return null }
}

function clubKey(name: string): string {
  return encodeURIComponent(name.normalize('NFKC').toLowerCase())
}

function finalScore(value: unknown): Match['score'] {
  const ft = record(value)?.ft
  return Array.isArray(ft) && ft.length === 2 && ft.every((score) => Number.isInteger(score) && score >= 0 && score <= 99)
    ? [ft[0], ft[1]] : null
}

export function normaliseOpenFootball(payload: unknown, checkedAt = Date.now()): OpenFootballCatalog {
  const feed = record(payload)
  if (feed?.name !== 'English Premier League 2026/27' || !Array.isArray(feed.matches)) {
    throw new OpenFootballFeedError('OpenFootball returned an unexpected Premier League catalogue.')
  }

  const today = londonInput(checkedAt).slice(0, 10)
  const clubs = new Map<string, OpenFootballCatalog['clubs'][number]>()
  const fixtures = new Map<string, OpenFootballCatalog['fixtures'][number]>()
  for (const entry of feed.matches) {
    const match = record(entry)
    const home = typeof match?.team1 === 'string' ? match.team1.trim() : ''
    const away = typeof match?.team2 === 'string' ? match.team2.trim() : ''
    if (!home || !away || !match) continue

    const homeKey = clubKey(home)
    const awayKey = clubKey(away)
    if (homeKey === awayKey) continue

    const id = `openfootball:match:${SEASON}:${homeKey}:${awayKey}`
    const homeId = `openfootball:club:${homeKey}`
    const awayId = `openfootball:club:${awayKey}`
    if (!clubs.has(homeId)) clubs.set(homeId, { id: homeId, name: home, squad: [] })
    if (!clubs.has(awayId)) clubs.set(awayId, { id: awayId, name: away, squad: [] })

    const date = calendarDate(match.date)
    const kickoff = fixtureKickoff(date, match.time)
    const score = finalScore(match.score)
    const week = typeof match.round === 'string' ? Number(/^Matchday (\d+)$/.exec(match.round)?.[1]) : NaN
    if (!fixtures.get(id)?.score || score) fixtures.set(id, {
      id, homeId, awayId, date, kickoff, score, status: score ? 'finished' : 'scheduled',
      week: week >= 1 && week <= 38 ? week : undefined,
    })
  }
  if (!fixtures.size) throw new OpenFootballFeedError('OpenFootball returned no Premier League fixtures.')

  let missingPast = 0
  let completedThrough: string | null = null
  const visible = [...fixtures.values()].filter((fixture) => {
    if (fixture.status === 'finished') {
      if (fixture.date && (!completedThrough || fixture.date > completedThrough)) completedThrough = fixture.date
      return true
    }
    const past = fixture.kickoff ? Date.parse(fixture.kickoff) < checkedAt : fixture.date && fixture.date < today
    if (past) missingPast++
    return !past
  })
  return {
    source: 'OpenFootball · Premier League 2026/27 (CC0)',
    clubs: [...clubs.values()], fixtures: visible,
    checkedAt: new Date(checkedAt).toISOString(),
    latestUpdatedAt: null, freshnessSec: FRESHNESS_SECONDS,
    coverage: { completedThrough, missingPast },
  }
}

let cached: OpenFootballCatalog | undefined
let pending: Promise<OpenFootballCatalog> | undefined

async function fetchCatalogue(): Promise<OpenFootballCatalog> {
  const request = new AbortController()
  const timeout = setTimeout(() => request.abort(), 8_000)
  try {
    const response = await fetch(OPEN_FOOTBALL_URL, { signal: request.signal, cache: 'no-store', credentials: 'omit' })
    if (!response.ok) throw new OpenFootballFeedError(`OpenFootball fixture feed returned HTTP ${response.status}.`)
    const data = await response.json().catch(() => { throw new OpenFootballFeedError('OpenFootball returned unreadable fixture data.') })
    return normaliseOpenFootball(data)
  } finally {
    clearTimeout(timeout)
  }
}

export function loadOpenFootball(signal: AbortSignal): Promise<OpenFootballCatalog> {
  if (signal.aborted) return Promise.reject(signal.reason)
  if (cached && Date.now() < Date.parse(cached.checkedAt) + FRESHNESS_SECONDS * 1000) return Promise.resolve(cached)
  const loading = pending ??= fetchCatalogue().then((catalog) => {
    cached = catalog
    return catalog
  }).finally(() => { pending = undefined })

  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    loading.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}
