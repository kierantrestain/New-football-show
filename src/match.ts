export const FORMATIONS = [
  '4-3-3', '4-2-3-1', '4-4-2', '4-1-4-1', '4-2-2-2', '4-3-2-1',
  '3-4-3', '3-5-2', '3-4-2-1', '5-3-2', '5-4-1',
] as const

export type Formation = typeof FORMATIONS[number]
export type Side = 'home' | 'away'
export type Verification = 'unavailable' | 'manual' | 'verified'
export type Role = 'GK' | 'DEF' | 'MID' | 'FWD'

export type Player = {
  id: string
  name: string
  number: number | null
  role?: Role
}

export type Team = {
  id: string
  name: string
  colour: string
  squad: Player[]
  xi: string[]
  bench: string[]
  verification: Verification
  benchVerification?: Verification
  source?: string
  formation?: Formation
}

export type Substitution = {
  teamId: string
  off: string
  on: string
  minute: number
  addedTime?: number
  verification: 'manual' | 'verified'
  source?: string
}

export type Match = {
  id: string
  source: string
  kickoff: string | null
  score: [number, number] | null
  status?: 'scheduled' | 'live' | 'finished'
  home: Team
  away: Team
  substitutions: Substitution[]
  week?: number
  officialUrl?: string
}

export type Fixture = {
  id: string
  homeId: string
  awayId: string
  kickoff: Match['kickoff']
  score: Match['score']
  status: NonNullable<Match['status']>
  week?: number
}

export type FixtureCatalog = {
  source: string
  fixtures: Fixture[]
  clubs: { id: string; name: string; squad: Player[] }[]
}

export const TEAM_COLOURS = { home: '#e85a64', away: '#52a9ed' }

export function fixtureMatch(fixture: Fixture, catalog: FixtureCatalog): Match {
  const team = (id: string, side: Side): Team => {
    const club = catalog.clubs.find((candidate) => candidate.id === id)
    if (!club) throw new Error('This fixture is missing a club record.')
    return { ...club, colour: TEAM_COLOURS[side], xi: [], bench: [], verification: 'unavailable' }
  }
  return {
    id: fixture.id, source: catalog.source, kickoff: fixture.kickoff, score: fixture.score,
    status: fixture.status, week: fixture.week,
    home: team(fixture.homeId, 'home'), away: team(fixture.awayId, 'away'), substitutions: [],
  }
}

export function minuteOrder(minute: number, addedTime = 0): number {
  return minute * 100 + addedTime
}

export function minuteLabel(minute: number, addedTime = 0): string {
  return addedTime ? `${minute}+${addedTime}′` : `${minute}′`
}

export function mergeMatchEvents(official: Substitution[], editorial: Substitution[]): Substitution[] {
  const bySource = [...official, ...editorial].map((event, index) => ({ event, index }))
    .sort((a, b) => Number(b.event.verification === 'verified') - Number(a.event.verification === 'verified'))
  const events: typeof bySource = []
  for (const candidate of bySource) {
    const { event } = candidate
    const alreadyRecorded = events.some(({ event: other }) => other.teamId === event.teamId &&
      (other.off === event.off || other.on === event.on))
    if (!alreadyRecorded) events.push(candidate)
  }
  return events.sort((a, b) =>
    minuteOrder(a.event.minute, a.event.addedTime) - minuteOrder(b.event.minute, b.event.addedTime) ||
    a.index - b.index).map(({ event }) => event)
}

export function activeLineup(team: Team, substitutions: Substitution[], minute: number, addedTime = 0): { slotId: string; player: Player }[] {
  const occupied = team.xi.map((id) => ({ slotId: id, player: team.squad.find((player) => player.id === id) }))
  const used = new Set(team.xi)
  for (const event of mergeMatchEvents(substitutions, [])) {
    if (event.teamId !== team.id || minuteOrder(event.minute, event.addedTime) > minuteOrder(minute, addedTime)) continue
    const slot = occupied.find((candidate) => candidate.player?.id === event.off)
    const player = team.squad.find((candidate) => candidate.id === event.on)
    if (slot && player && team.bench.includes(player.id) && !used.has(player.id)) {
      slot.player = player
      used.add(player.id)
    }
  }
  return occupied.flatMap(({ slotId, player }) => player ? [{ slotId, player }] : [])
}

function object(input: unknown, label: string): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error(`${label} must be an object.`)
  return input as Record<string, unknown>
}

function value(input: unknown, label: string, maxLength = 128): string {
  if (typeof input !== 'string' || !input.trim() || input.trim().length > maxLength) {
    throw new Error(`${label} requires text up to ${maxLength} characters.`)
  }
  return input.trim()
}

function url(input: unknown, label: string): string {
  const text = value(input, label, 2048)
  try {
    const candidate = new URL(text)
    if (candidate.protocol === 'https:' || candidate.protocol === 'http:') return candidate.href
  } catch { /* Report the field consistently below. */ }
  throw new Error(`${label} must be a source URL.`)
}

function integer(input: unknown, label: string, min: number, max: number): number {
  if (typeof input !== 'number' || !Number.isInteger(input) || input < min || input > max) {
    throw new Error(`${label} must be a whole number from ${min} to ${max}.`)
  }
  return input
}

function list(input: unknown, label: string, limit: number): unknown[] {
  if (!Array.isArray(input) || input.length > limit) throw new Error(`${label} requires a list of up to ${limit} entries.`)
  return input
}

function verification(input: unknown, populated: boolean): Verification {
  if (input === undefined) return populated ? 'manual' : 'unavailable'
  if (input === 'unavailable' || input === 'manual' || input === 'verified') return input
  throw new Error('Verification must be unavailable, manual or verified.')
}

function parseTeam(input: unknown, side: Side): Team {
  const raw = object(input, side === 'home' ? 'Home team' : 'Away team')
  const name = value(raw.name, 'Club name', 70)
  const squad = list(raw.squad ?? [], `${name} squad`, 150).map((entry): Player => {
    const player = object(entry, 'Player')
    const role = player.role
    if (role !== undefined && role !== 'GK' && role !== 'DEF' && role !== 'MID' && role !== 'FWD') {
      throw new Error('Player role must be GK, DEF, MID or FWD.')
    }
    return {
      id: value(player.id, 'Player ID'),
      name: value(player.name, 'Player name', 70),
      number: player.number == null ? null : integer(player.number, 'Shirt number', 1, 99),
      role,
    }
  })
  const xi = list(raw.xi ?? [], `${name} XI`, 11).map((id) => value(id, 'Starter ID'))
  const bench = list(raw.bench ?? [], `${name} bench`, 20).map((id) => value(id, 'Substitute ID'))
  if (xi.length && xi.length !== 11) throw new Error(`${name} needs exactly 11 starters.`)
  if (new Set(squad.map((player) => player.id)).size !== squad.length) throw new Error(`${name} has duplicate player IDs.`)
  const selection = [...xi, ...bench]
  if (new Set(selection).size !== selection.length) throw new Error(`${name} lists a player more than once on matchday.`)
  const shirts = selection.map((id) => squad.find((player) => player.id === id)?.number)
  if (shirts.some((number) => number == null)) throw new Error(`${name} matchday players need a squad entry and shirt number.`)
  if (new Set(shirts).size !== shirts.length) throw new Error(`${name} matchday shirt numbers must be unique.`)

  const xiStatus = verification(raw.verification, xi.length > 0)
  const benchStatus = verification(raw.benchVerification, bench.length > 0)
  if ((xi.length > 0) === (xiStatus === 'unavailable') || (bench.length > 0) === (benchStatus === 'unavailable')) {
    throw new Error(`${name} needs a verification status for supplied matchday data.`)
  }
  const verified = xiStatus === 'verified' || benchStatus === 'verified'
  const colour = raw.colour ?? TEAM_COLOURS[side]
  if (typeof colour !== 'string' || !/^#[0-9a-f]{6}$/i.test(colour)) throw new Error(`${name} colour must be a six-digit hex colour.`)
  const formation = FORMATIONS.find((item) => item === raw.formation)
  if (raw.formation !== undefined && !formation) throw new Error(`${name} formation is unavailable.`)
  const keeper = xi.findIndex((id) => squad.find((player) => player.id === id)?.role === 'GK')
  if (keeper > 0) xi.unshift(...xi.splice(keeper, 1))
  return {
    id: value(raw.id, 'Club ID'), name, colour, squad, xi, bench, verification: xiStatus,
    benchVerification: benchStatus, formation,
    source: verified ? url(raw.source, `${name} matchday source`) : raw.source === undefined ? undefined : value(raw.source, 'Matchday source', 2048),
  }
}

export function parseMatch(input: unknown): Match {
  const raw = object(input, 'Match')
  const home = parseTeam(raw.home, 'home')
  const away = parseTeam(raw.away, 'away')
  if (home.id === away.id) throw new Error('The fixture requires two different club IDs.')
  if (away.squad.some((player) => home.squad.some((candidate) => candidate.id === player.id))) {
    throw new Error('Player IDs must be unique across both clubs.')
  }
  const kickoff = raw.kickoff == null ? null : value(raw.kickoff, 'Kick-off')
  if (kickoff && (!/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(kickoff) || !Number.isFinite(Date.parse(kickoff)))) {
    throw new Error('Kick-off must include a date, time and time zone.')
  }
  let score: Match['score'] = null
  if (raw.score != null) {
    const numbers = list(raw.score, 'Score', 2)
    score = [integer(numbers[0], 'Home goals', 0, 99), integer(numbers[1], 'Away goals', 0, 99)]
  }
  const status = raw.status ?? (score ? 'finished' : 'scheduled')
  if (status !== 'scheduled' && status !== 'live' && status !== 'finished') throw new Error('Unknown fixture status.')
  if (score && status === 'scheduled') throw new Error('A scheduled fixture cannot have a score.')
  const substitutions = list(raw.substitutions ?? [], 'Substitutions', 30).map((entry): Substitution => {
    const event = object(entry, 'Substitution')
    const status = verification(event.verification, true)
    if (status === 'unavailable') throw new Error('Supplied substitutions require verification.')
    const minute = integer(event.minute, 'Substitution minute', 1, 120)
    const addedTime = event.addedTime === undefined ? undefined : integer(event.addedTime, 'Added time', 0, 30)
    if (addedTime && ![45, 90, 105, 120].includes(minute)) throw new Error('Added time requires minute 45, 90, 105 or 120.')
    return {
      teamId: value(event.teamId, 'Substitution club ID'), off: value(event.off, 'Player off ID'),
      on: value(event.on, 'Player on ID'), minute, addedTime, verification: status,
      source: status === 'verified' ? url(event.source, 'Substitution source') : event.source === undefined ? undefined : value(event.source, 'Substitution source', 2048),
    }
  }).sort((a, b) => minuteOrder(a.minute, a.addedTime) - minuteOrder(b.minute, b.addedTime))
  const previous: Substitution[] = []
  for (const event of substitutions) {
    const team = [home, away].find(({ id }) => id === event.teamId)
    if (!team || !team.bench.includes(event.on) || previous.some((candidate) => candidate.on === event.on) ||
        !activeLineup(team, previous, event.minute, event.addedTime).some(({ player }) => player.id === event.off)) {
      throw new Error('Each substitution must replace a player on the pitch with an unused bench player.')
    }
    previous.push(event)
  }
  return {
    id: value(raw.id, 'Fixture ID'), source: value(raw.source ?? 'Operator entry', 'Fixture source', 2048),
    kickoff, score, status, home, away, substitutions,
    week: raw.week === undefined ? undefined : integer(raw.week, 'Matchweek', 1, 38),
    officialUrl: raw.officialUrl === undefined ? undefined : url(raw.officialUrl, 'Match centre'),
  }
}
