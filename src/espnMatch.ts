import { FORMATIONS, mergeMatchEvents } from './match'
import type { Formation, Match, Player, Role, Side, Substitution, Team } from './match'

type RecordValue = Record<string, unknown>
type RankedPlayer = { player: Player; starts: number; appearances: number; position: string; starter?: boolean; replacement?: string; substitutionClock?: unknown }
type Matchday = { formation?: Formation; players: RankedPlayer[] }
type Summary = {
  teams: Partial<Record<Side, Matchday>>
  substitutions: Substitution[]
  kickoff?: string
  status?: Match['status']
  score: Match['score']
}
type CacheEntry<T> = { promise: Promise<T>; expiresAt: number }

const rosterCache = new Map<string, CacheEntry<RankedPlayer[]>>()
const summaryCache = new Map<string, CacheEntry<Summary>>()
const numericId = (value: unknown) => typeof value === 'string' && /^\d{1,12}$/.test(value) ? value : undefined
const text = (value: unknown) => typeof value === 'string' ? value.trim() : ''
const record = (value: unknown): RecordValue | undefined =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : undefined
const list = (value: unknown): RecordValue[] =>
  Array.isArray(value) ? value.map(record).filter((item): item is RecordValue => item !== undefined) : []
const matchLink = (id: string) => `https://www.espn.com/soccer/match/_/gameId/${id}`

function smallNumber(value: unknown, min: number): number | null {
  const number = typeof value === 'string' && /^\d{1,2}$/.test(value) ? Number(value) : value
  return typeof number === 'number' && Number.isInteger(number) && number >= min && number <= 99 ? number : null
}

function playerRole(position: RecordValue | undefined): Role | undefined {
  const abbreviation = text(position?.abbreviation).toUpperCase()
  const name = text(position?.name).toLowerCase()
  if (/^(G|GK)$/.test(abbreviation) || name.includes('goalkeeper')) return 'GK'
  if (/^(D|CB|CD|[LR](B|WB)|SW)(-[LR])?$/.test(abbreviation) || /defender|back/.test(name)) return 'DEF'
  if (/^([CDALR]?M)(-[LR])?$/.test(abbreviation) || name.includes('midfield')) return 'MID'
  if (/^([CLRS]?F|[LR]W|ST)(-[LR])?$/.test(abbreviation) || /forward|striker|winger/.test(name)) return 'FWD'
}

function rankedPlayer(entry: RecordValue, teamId: string): RankedPlayer | null {
  const athlete = record(entry.athlete) ?? entry
  const id = numericId(athlete.id)
  const name = text(athlete.displayName) || text(athlete.fullName)
  if (!id || !name) return null
  const position = record(entry.position) ?? record(athlete.position)
  const splits = record(record(athlete.statistics)?.splits)
  const general = list(splits?.categories).find((category) => category.name === 'general')
  const stats = list(general?.stats)
  const stat = (name: string) => smallNumber(stats.find((item) => item.name === name)?.value, 0) ?? 0
  const appearances = stat('appearances')
  return {
    player: { id, name, number: smallNumber(entry.jersey ?? athlete.jersey, 1), role: playerRole(position), teamId },
    appearances, starts: Math.max(0, appearances - stat('subIns')),
    position: text(position?.abbreviation).toUpperCase(),
    starter: typeof entry.starter === 'boolean' ? entry.starter : undefined,
    replacement: numericId(record(record(entry.subbedOutFor)?.athlete)?.id),
    substitutionClock: record(list(entry.plays).find((play) => play.substitution === true)?.clock)?.displayValue,
  }
}

function distinctPlayers(players: RankedPlayer[]): RankedPlayer[] {
  return [...new Map(players.map((item) => [item.player.id, item])).values()]
}

function rosterFrom(payload: unknown, teamId: string): RankedPlayer[] {
  const body = record(payload)
  if (record(body?.team)?.id !== teamId || !Array.isArray(body?.athletes)) throw new Error('ESPN roster identity could not be verified.')
  return distinctPlayers(list(body.athletes)
    .filter((entry) => !['inactive', 'released'].includes(text(record(entry.status)?.type).toLowerCase()))
    .flatMap((entry) => rankedPlayer(entry, teamId) ?? []))
}

function substitutionTime(value: unknown): Pick<Substitution, 'minute' | 'addedTime'> | null {
  const parts = /^(\d{1,3})(?:\+(\d{1,2}))?$/.exec(text(value).replace(/['′’]/g, ''))
  if (!parts) return null
  const minute = Number(parts[1])
  const addedTime = parts[2] ? Number(parts[2]) : undefined
  if (minute < 1 || minute > 120 || (addedTime && (![45, 90, 105, 120].includes(minute) || addedTime > 30))) return null
  return { minute, addedTime }
}

function summaryFrom(payload: unknown, match: Match): Summary {
  const body = record(payload)
  const header = record(body?.header)
  const competition = list(header?.competitions).find((item) => item.id === match.id)
  const sides = ['home', 'away'] as const
  const competitors = list(competition?.competitors)
  const home = competitors.find((item) => item.homeAway === 'home')
  const away = competitors.find((item) => item.homeAway === 'away')
  if (header?.id !== match.id || record(home?.team)?.id !== match.home.id || record(away?.team)?.id !== match.away.id) {
    throw new Error('ESPN summary identity could not be verified.')
  }

  const teams: Summary['teams'] = {}
  const substitutions: Substitution[] = []
  const source = matchLink(match.id)
  const addEvent = (teamId: string | undefined, off: string | undefined, on: string | undefined, time: unknown) => {
    const clock = substitutionTime(time)
    if (!teamId || !off || !on || !clock || off === on ||
        substitutions.some((item) => item.teamId === teamId && item.off === off && item.on === on)) return
    substitutions.push({ teamId, off, on, ...clock, source, verification: 'verified' })
  }
  for (const event of list(body?.keyEvents)) {
    const type = record(event.type)
    if (type?.type !== 'substitution' && type?.text !== 'Substitution') continue
    const participants = list(event.participants)
    if (participants.length !== 2) continue
    addEvent(numericId(record(event.team)?.id), numericId(record(participants[1].athlete)?.id),
      numericId(record(participants[0].athlete)?.id), record(event.clock)?.displayValue)
  }
  const rosters = list(body?.rosters)
  for (const side of sides) {
    const teamId = match[side].id
    const roster = rosters.find((item) => record(item.team)?.id === teamId && item.homeAway === side)
    const players = distinctPlayers(list(roster?.roster).filter((entry) => typeof entry.starter === 'boolean')
      .flatMap((entry) => rankedPlayer(entry, teamId) ?? []))
    const starters = players.filter((item) => item.starter === true)
    if (starters.length !== 11) continue
    teams[side] = { players, formation: FORMATIONS.find((candidate) => candidate === roster?.formation) }
    for (const { player, replacement, substitutionClock } of players) {
      addEvent(teamId, player.id, replacement, substitutionClock)
    }
  }
  const sourceHome = teams.home?.players
  const sourceAway = teams.away?.players
  if (sourceHome && sourceAway) {
    const removeOverlap = (side: Side, own: RankedPlayer[], other: RankedPlayer[]) => {
      const matchday = teams[side]
      if (!matchday) return
      matchday.players = own.filter((entry) => {
        const rival = other.find((candidate) => candidate.player.id === entry.player.id)
        return !rival || (entry.starter && !rival.starter)
      })
      if (matchday.players.filter(({ starter }) => starter).length !== 11) delete teams[side]
    }
    removeOverlap('home', sourceHome, sourceAway)
    removeOverlap('away', sourceAway, sourceHome)
  }
  const type = record(record(competition?.status)?.type)
  const status = type?.completed === true ? 'finished' : type?.state === 'in' ? 'live' : type?.state === 'pre' ? 'scheduled' : undefined
  const homeGoals = smallNumber(home?.score, 0)
  const awayGoals = smallNumber(away?.score, 0)
  const score = status !== 'scheduled' && homeGoals !== null && awayGoals !== null ? [homeGoals, awayGoals] as [number, number] : null
  const date = Date.parse(text(competition?.date))
  return { teams, substitutions, status, score, kickoff: Number.isFinite(date) ? new Date(date).toISOString() : undefined }
}

function formationOrder(starters: RankedPlayer[], formation?: Formation): string[] {
  const depth = ({ player, position }: RankedPlayer) => {
    if (player.role === 'GK') return 0
    if (/^[LR]WB$/.test(position)) return 2
    if (player.role === 'DEF') return 1
    if (player.role === 'FWD') return 5
    return /^DM/.test(position) ? 2 : /^AM/.test(position) ? 4 : 3
  }
  const side = ({ position }: RankedPlayer) => {
    if (/^L(B|WB|M|W|F)$/.test(position)) return -2
    if (position.endsWith('-L')) return -1
    if (/^R(B|WB|M|W|F)$/.test(position)) return 2
    return position.endsWith('-R') ? 1 : 0
  }
  const ordered = [...starters].sort((a, b) => depth(a) - depth(b))
  if (!formation) return ordered.map(({ player }) => player.id)
  return [1, ...formation.split('-').map(Number)].flatMap((size) =>
    ordered.splice(0, size).sort((a, b) => side(a) - side(b)).map(({ player }) => player.id))
}

const provisionalShapes: { formation: Formation; counts: [number, number, number, number] }[] = [
  { formation: '4-3-3', counts: [1, 4, 3, 3] },
  { formation: '4-4-2', counts: [1, 4, 4, 2] },
  { formation: '4-2-3-1', counts: [1, 4, 5, 1] },
  { formation: '3-5-2', counts: [1, 3, 5, 2] },
  { formation: '5-4-1', counts: [1, 5, 4, 1] },
]

function provisionalLineup(roster: RankedPlayer[]): { formation: Formation; xi: string[] } | undefined {
  const sorted = [...roster].sort((a, b) => b.starts - a.starts || b.appearances - a.appearances ||
    (a.player.number ?? 100) - (b.player.number ?? 100))
  const roles = ['GK', 'DEF', 'MID', 'FWD'] as const
  const groups = roles.map((role) => sorted.filter(({ player }) => player.role === role))
  const shape = provisionalShapes.find(({ counts }) => groups.every((group, index) => group.length >= counts[index]))
  if (shape) return {
    formation: shape.formation,
    xi: groups.flatMap((group, index) => group.slice(0, shape.counts[index]).map(({ player }) => player.id)),
  }
  const keeper = groups[0][0]
  const outfield = sorted.filter(({ player }) => player.role !== 'GK').slice(0, 10)
  if (!keeper || outfield.length !== 10) return undefined
  return { formation: '4-3-3', xi: formationOrder([keeper, ...outfield], '4-3-3') }
}

function unionPlayers(...groups: Player[][]): Player[] {
  return [...new Map(groups.flat().map((player) => [player.id, player])).values()]
}

function authorSelected(team: Team): boolean {
  return team.xi.length === 11 && !team.selection && team.verification === 'manual'
}

function validSubstitutions(events: Substitution[], home: Team, away: Team): Substitution[] {
  const byTeam = [home, away].map((team) => ({ team, active: new Set(team.xi), used: new Set(team.xi) }))
  return events.filter((event) => {
    const lineup = byTeam.find(({ team }) => team.id === event.teamId)
    if (!lineup || !lineup.active.has(event.off) || lineup.used.has(event.on) || !lineup.team.bench.includes(event.on)) return false
    lineup.active.delete(event.off)
    lineup.active.add(event.on)
    lineup.used.add(event.on)
    return true
  })
}

function assemble(match: Match, homeRoster: RankedPlayer[], awayRoster: RankedPlayer[], summary?: Summary): Match {
  const actual = summary?.teams
  const observed = (side: Side) => new Set(actual?.[side]?.players.map(({ player }) => player.id))
  const homeObserved = observed('home')
  const awayObserved = observed('away')
  const preserve = (team: Team, opposite: Set<string>) => (authorSelected(team) || team.verification === 'verified') &&
    [...team.xi, ...team.bench].every((id) => !opposite.has(id))
  const keepHome = preserve(match.home, awayObserved)
  const keepAway = preserve(match.away, homeObserved)
  const homeClaimed = new Set([...homeObserved, ...(keepHome ? [...match.home.xi, ...match.home.bench] : [])])
  const awayClaimed = new Set([...awayObserved, ...(keepAway ? [...match.away.xi, ...match.away.bench] : [])])
  const homeIds = new Set([...homeRoster.map(({ player }) => player.id), ...match.home.squad.map((player) => player.id)])
  const awayIds = new Set([...awayRoster.map(({ player }) => player.id), ...match.away.squad.map((player) => player.id)])
  const status = summary?.status ?? match.status ?? (match.score ? 'finished' : 'scheduled')
  const source = matchLink(match.id)
  const team = (side: Side, roster: RankedPlayer[], keep: boolean, claimed: Set<string>, otherClaimed: Set<string>, otherIds: Set<string>): Team => {
    const current = match[side]
    const includes = (player: Player) => !otherClaimed.has(player.id) && (!otherIds.has(player.id) || claimed.has(player.id))
    const qualified = roster.filter(({ player }) => includes(player))
    const reference = unionPlayers(current.squad.filter(includes), qualified.map(({ player }) => player))
    const matchday = actual?.[side]
    if (keep && (authorSelected(current) || !matchday)) {
      return { ...current, squad: unionPlayers(reference, current.squad.filter(({ id }) => current.xi.includes(id) || current.bench.includes(id))) }
    }
    if (matchday) {
      const starters = matchday.players.filter(({ starter }) => starter === true)
      const bench = matchday.players.filter(({ starter }) => starter === false).map(({ player }) => player.id)
      return {
        ...current, squad: unionPlayers(reference, matchday.players.map(({ player }) => player)),
        xi: formationOrder(starters, matchday.formation), bench, verification: 'verified',
        benchVerification: bench.length ? 'verified' : 'unavailable', formation: matchday.formation, source, selection: undefined,
      }
    }
    const existing = current.selection && current.xi.every((id) => reference.some((player) => player.id === id))
      ? { xi: current.xi, formation: current.formation } : undefined
    const lineup = existing ?? provisionalLineup(qualified)
    return {
      ...current, squad: reference, xi: lineup?.xi ?? [], bench: [], formation: lineup?.formation,
      verification: lineup ? 'manual' : 'unavailable', benchVerification: 'unavailable',
      selection: lineup ? status === 'scheduled' ? 'provisional' : 'reconstruction' : undefined,
      source: qualified.length ? `https://www.espn.com/soccer/team/squad/_/id/${current.id}` : current.source,
    }
  }
  const home = team('home', homeRoster, keepHome, homeClaimed, awayClaimed, awayIds)
  const away = team('away', awayRoster, keepAway, awayClaimed, homeClaimed, homeIds)
  const sourced = summary?.substitutions.filter((event) =>
    (event.teamId === home.id && home.verification === 'verified') ||
    (event.teamId === away.id && away.verification === 'verified')) ?? []
  const substitutions = validSubstitutions(mergeMatchEvents(sourced, match.substitutions), home, away)
  return {
    ...match, source: 'ESPN', kickoff: summary?.kickoff ?? match.kickoff, status,
    score: status === 'scheduled' ? null : summary?.score ?? match.score,
    officialUrl: match.officialUrl ?? source, home, away, substitutions,
  }
}

function readCached<T>(cache: Map<string, CacheEntry<T>>, url: string, ttl: number, parse: (body: unknown) => T, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason)
  const now = Date.now()
  for (const [key, entry] of cache) if (entry.expiresAt <= now) cache.delete(key)
  let entry = cache.get(url)
  if (!entry) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 12_000)
    const promise = fetch(url, { signal: controller.signal, cache: 'no-store' }).then(async (response) => {
      if (!response.ok) throw new Error(`ESPN fixture data returned HTTP ${response.status}.`)
      const value = parse(await response.json())
      cache.set(url, { promise: Promise.resolve(value), expiresAt: Date.now() + ttl })
      return value
    }).catch((error) => {
      cache.delete(url)
      throw error
    }).finally(() => clearTimeout(timer))
    entry = { promise, expiresAt: Infinity }
    cache.set(url, entry)
  }
  const pending = entry.promise
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    pending.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

export async function hydrateEspnMatch(match: Match, signal: AbortSignal): Promise<Match> {
  if (signal.aborted) throw signal.reason
  if (match.source !== 'ESPN' || ![match.id, match.home.id, match.away.id].every(numericId)) return match
  const teamRoster = (id: string) =>
    readCached(rosterCache, `/api/espn?resource=roster&teamId=${id}`, 30 * 60_000, (body) => rosterFrom(body, id), signal)
  const [summary, home, away] = await Promise.allSettled([
    readCached(summaryCache, `/api/espn?resource=summary&eventId=${match.id}`, 5 * 60_000, (body) => summaryFrom(body, match), signal),
    teamRoster(match.home.id),
    teamRoster(match.away.id),
  ])
  if (signal.aborted) throw signal.reason
  return assemble(
    match, home.status === 'fulfilled' ? home.value : [], away.status === 'fulfilled' ? away.value : [],
    summary.status === 'fulfilled' ? summary.value : undefined,
  )
}
