// The real DataSource: Traccar's REST API plus its WebSocket. Mirrors the behaviour of the mock source
// (data/mock/index.ts); see api.ts for the Traccar version this follows.
//
// How Traccar's model maps onto ours:
//  - A Traccar "trip" is one drive between two parked periods (parking of 5 min or more ends it). Our Trip is the
//    same, with `stops` = pauses inside the drive. Traccar does not report those, so they are derived from each trip's
//    route when the range is short (cfg.pauseDeriveMaxRangeMs); on longer ranges `stopsKnown` is false instead.
//  - The car's current drive is built here (inProgress.ts), never taken from a report.
//  - getSummary adds up getTrips, so the Dashboard and Route history always agree (/reports/summary is not used).
//  - getStops returns the in-trip pauses, like the mock. Traccar's /reports/stops (parking) is only used to find
//    where the current drive began.
import { config as appConfig, type Config } from '../../config'
import { carStatus, sortPositions, summarizeTrips } from '../derive'
import { EditRefused, truckInputProblem, type LocationEditor, type ConnectionState, type DataSource, type TruckEditor, type TruckInput, type TruckRecord } from '../source'
import type { Car, Geofence, Position, Stop, Summary, Trip } from '../types'
import type { TraccarDevice, TraccarGeofence, TraccarPosition, TraccarSocketMessage, TraccarStop, TraccarTrip, TraccarUser } from './api'
import { createTraccarAuth, type TraccarAuth } from './auth'
import { toCar, toGeofences, toPosition, toTrip, truckSourceOf } from './convert'
import { createHttp, isoParam, TraccarHttpError, type FetchLike } from './http'
import { buildInProgressTrip, findOpenTrip, OPEN_TRIP_TOLERANCE_MS, withInProgress } from './inProgress'
import { derivePauses, totalPauseMs } from './pauses'
import { createLiveSocket, type SocketCtor } from './socket'
import { circleWkt } from './wkt'
import { LOCATION_TYPE } from './convert'

/** Trips are asked for from this long before `from`, so a drive that began before the range is returned whole (as the mock does). */
const TRIP_PADDING_MS = 6 * 60 * 60 * 1000
/** How far back the current drive is searched for when the car is moving. */
const IN_PROGRESS_LOOKBACK_MS = 12 * 60 * 60 * 1000
const STATIC_CACHE_MS = 60_000
const PAUSE_ROUTE_CONCURRENCY = 4
const PAUSE_CACHE_MAX = 300

export interface TraccarSourceOptions {
  /** Server origin, "" = same origin as the app. */
  baseUrl?: string
  fetch?: FetchLike
  WebSocketImpl?: SocketCtor
  now?: () => number
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
  random?: () => number
  /** Called (possibly several times) when the server says the session is gone. */
  onUnauthorized?: () => void
  cfg?: Config
}

/** Runs at most `limit` tasks at once. */
function createLimiter(limit: number) {
  let active = 0
  const queue: (() => void)[] = []
  const next = () => {
    if (active >= limit) return
    const run = queue.shift()
    if (!run) return
    active++
    run()
  }
  return <T>(task: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      queue.push(() => {
        task().then(resolve, reject).finally(() => {
          active--
          next()
        })
      })
      next()
    })
}

/** A trip overlaps [from, to) if it starts before `to` and has not ended before `from`. An open trip never ends. */
function overlaps(trip: Trip, from: number, to: number): boolean {
  return trip.startTime < to && (trip.endTime === null || trip.endTime > from)
}

function socketUrl(baseUrl: string): string {
  if (baseUrl !== '') return `${baseUrl.replace(/^http/i, 'ws')}/api/socket`
  const { protocol, host } = globalThis.location
  return `${protocol === 'https:' ? 'wss' : 'ws'}://${host}/api/socket`
}

export function createTraccarDataSource(opts: TraccarSourceOptions = {}): DataSource {
  const cfg = opts.cfg ?? appConfig
  const baseUrl = opts.baseUrl ?? cfg.traccarUrl
  const doFetch: FetchLike = opts.fetch ?? ((input, init) => globalThis.fetch(input, init))
  const now = opts.now ?? Date.now
  const http = createHttp({ baseUrl, fetch: doFetch, onUnauthorized: opts.onUnauthorized })
  const auth: TraccarAuth = createTraccarAuth({ baseUrl, fetch: doFetch })
  const limit = createLimiter(PAUSE_ROUTE_CONCURRENCY)

  // --- cars and geofences: rarely change, asked for by several components at once -------------------------------
  function cached<T>(load: () => Promise<T>): (() => Promise<T>) & { reset(): void } {
    let entry: { at: number; value: Promise<T> } | null = null
    const get = () => {
      if (!entry || now() - entry.at > STATIC_CACHE_MS) {
        const value = load()
        const mine = { at: now(), value }
        entry = mine
        value.catch(() => {
          if (entry === mine) entry = null
        })
      }
      return entry.value
    }
    return Object.assign(get, { reset: () => (entry = null) })
  }
  const getDevices = cached(() => http.getJson<TraccarDevice[]>('/api/devices'))
  const getCars = async (): Promise<Car[]> => (await getDevices()).filter((d) => !d.disabled).map(toCar)
  const getRawGeofences = cached(() => http.getJson<TraccarGeofence[]>('/api/geofences'))
  const getGeofences = async (): Promise<Geofence[]> => toGeofences(await getRawGeofences(), cfg)

  // --- locations: admins add, change and delete them (the web proxy lets only these changes through) ------------
  const geofenceListeners = new Set<() => void>()
  const geofencesChanged = () => {
    getRawGeofences.reset()
    for (const l of geofenceListeners) l()
  }
  const sessionUser = async (): Promise<TraccarUser | null> => {
    try {
      return await http.getJson<TraccarUser>('/api/session')
    } catch (e) {
      if (e instanceof TraccarHttpError && e.status === 404) return null
      throw e
    }
  }
  const isEditor = async () => {
    const user = await sessionUser()
    return user?.administrator === true && user.readonly !== true
  }
  /** Traccar links a new object to its creator only; link it to every other user so they see it too. */
  async function shareWithEveryone(link: Record<string, number>) {
    const [me, users] = await Promise.all([sessionUser(), http.getJson<TraccarUser[]>('/api/users')])
    for (const u of users.filter((u) => u.id !== me?.id)) await http.send('POST', '/api/permissions', { userId: u.id, ...link })
  }
  const locations: LocationEditor = {
    canEdit: isEditor,
    async save(input, id) {
      const fields = { name: input.name.trim(), area: circleWkt(input.lat, input.lon, input.radiusM) }
      const type = LOCATION_TYPE[input.kind]
      if (id === undefined) {
        const created = await http.send<TraccarGeofence>('POST', '/api/geofences', { ...fields, attributes: { type } })
        if (created) await shareWithEveryone({ geofenceId: created.id })
      } else {
        const current = (await getRawGeofences()).find((g) => String(g.id) === id)
        if (!current) throw new EditRefused('That location no longer exists. Reload the page.')
        await http.send('PUT', `/api/geofences/${id}`, { ...current, ...fields, attributes: { ...current.attributes, type } })
      }
      geofencesChanged()
    },
    async remove(id) {
      await http.send('DELETE', `/api/geofences/${id}`)
      geofencesChanged()
    },
  }

  // --- trucks: admins add, change, disable and delete them ------------------------------------------------------
  const carListeners = new Set<() => void>()
  const carsChanged = () => {
    getDevices.reset()
    for (const l of carListeners) l()
  }
  const toRecord = (d: TraccarDevice): TruckRecord => ({
    id: String(d.id),
    name: d.name,
    source: truckSourceOf(d),
    trackerId: d.uniqueId ?? '',
    model: d.model ?? '',
    phone: d.phone ?? '',
    driver: toCar(d).driver,
    enabled: !d.disabled,
  })
  /** The device fields the app owns. Model and SIM number only mean something for a real tracker. */
  const deviceFields = (input: TruckInput) => {
    const real = input.source === 'tracker'
    return {
      name: input.name.trim(),
      uniqueId: input.trackerId.trim(),
      model: real && input.model ? input.model : null,
      phone: real && input.phone.trim() ? input.phone.trim() : null,
      category: 'truck',
    }
  }
  const attributesFor = (input: TruckInput, kept: Record<string, unknown> = {}) => {
    const driver = input.driver.trim()
    return { ...kept, source: input.source, ...(driver ? { driver } : {}) }
  }
  const deviceById = async (id: string): Promise<TraccarDevice> => {
    getDevices.reset()
    const device = (await getDevices()).find((d) => String(d.id) === id)
    if (!device) throw new EditRefused('That truck no longer exists. Reload the page.')
    return device
  }
  const trucks: TruckEditor = {
    canEdit: isEditor,
    async list() {
      return (await getDevices()).map(toRecord).sort((a, b) => a.name.localeCompare(b.name))
    },
    async save(input, id) {
      getDevices.reset()
      const others = (await getDevices()).map(toRecord).filter((t) => t.id !== id)
      const problem = truckInputProblem(input, others)
      if (problem) throw new EditRefused(problem)
      if (id === undefined) {
        const created = await http.send<TraccarDevice>('POST', '/api/devices', { ...deviceFields(input), attributes: attributesFor(input) })
        if (created) await shareWithEveryone({ deviceId: created.id })
      } else {
        const current = await deviceById(id)
        const { driver: _old, driverName: _oldName, ...kept } = current.attributes ?? {}
        await http.send('PUT', `/api/devices/${id}`, { ...current, ...deviceFields(input), attributes: attributesFor(input, kept) })
      }
      carsChanged()
    },
    async setEnabled(id, enabled) {
      const current = await deviceById(id)
      await http.send('PUT', `/api/devices/${id}`, { ...current, disabled: !enabled })
      carsChanged()
    },
    async remove(id) {
      await http.send('DELETE', `/api/devices/${id}`)
      carsChanged()
    },
  }

  const deviceIds = async (carId: string | null): Promise<string[]> =>
    carId !== null ? [carId] : (await getCars()).map((c) => c.id)

  // --- positions -------------------------------------------------------------------------------------------------
  const convert = (list: TraccarPosition[]): Position[] =>
    sortPositions(list.flatMap((p) => toPosition(p, cfg) ?? []))

  const getLatestPositions = async (): Promise<Position[]> => {
    const [positions, cars] = await Promise.all([http.getJson<TraccarPosition[]>('/api/positions'), getCars()])
    const known = new Set(cars.map((c) => c.id))
    // Newest fix per car: the endpoint returns one per device, but be safe about a stale duplicate.
    const latest = new Map<string, Position>()
    for (const p of convert(positions)) if (known.has(p.carId)) latest.set(p.carId, p)
    return [...latest.values()]
  }

  const getRoute = async (carId: string, from: number, to: number): Promise<Position[]> => {
    // The report is inclusive at both ends; the interface is [from, to).
    const list = await http.getJson<TraccarPosition[]>('/api/reports/route', {
      deviceId: carId,
      from: isoParam(from),
      to: isoParam(to),
    })
    return convert(list).filter((p) => p.carId === carId && p.fixTime >= from && p.fixTime < to)
  }

  // --- trips -----------------------------------------------------------------------------------------------------
  const pauseCache = new Map<string, Promise<Position[]>>()
  const routeOfFinishedTrip = (trip: Trip & { endTime: number }): Promise<Position[]> => {
    const key = `${trip.carId}:${trip.startTime}:${trip.endTime}`
    const hit = pauseCache.get(key)
    if (hit) return hit
    const value = limit(() => getRoute(trip.carId, trip.startTime, trip.endTime + 1))
    pauseCache.set(key, value)
    if (pauseCache.size > PAUSE_CACHE_MAX) pauseCache.delete(pauseCache.keys().next().value as string)
    value.catch(() => pauseCache.delete(key))
    return value
  }

  async function withPauses(trip: Trip, geofences: Geofence[]): Promise<Trip> {
    if (trip.endTime === null) return trip
    const fixes = await routeOfFinishedTrip(trip as Trip & { endTime: number })
    const stops = derivePauses({ carId: trip.carId, start: trip.startTime, end: trip.endTime, fixes, geofences, cfg })
    return { ...trip, stops, drivingMs: Math.max(0, trip.endTime - trip.startTime - totalPauseMs(stops)) }
  }

  /**
   * The car's current drive, built from its latest fix and the route since it began, plus Traccar's own unfinished
   * trip for it (to be replaced). Both null when the car is not driving.
   */
  async function currentDrive(
    carId: string,
    latest: Position | null,
    finished: Trip[],
    geofences: Geofence[],
    deriveStops: boolean,
  ): Promise<{ inProgress: Trip | null; open: Trip | null }> {
    const t = now()
    if (carStatus(latest, t, cfg) !== 'moving') return { inProgress: null, open: null }

    const open = findOpenTrip(finished, latest)
    const lookbackFrom = t - IN_PROGRESS_LOOKBACK_MS
    let routeFrom = lookbackFrom
    if (open) {
      routeFrom = open.startTime
    } else {
      // Where did the last parked period end? Only the stops report knows, and only for parking of 5 min or more.
      const stops = await http.getJson<TraccarStop[]>('/api/reports/stops', {
        deviceId: carId,
        from: isoParam(lookbackFrom),
        to: isoParam(t + 1000),
      })
      const lastStopEnd = stops.reduce((best, s) => Math.max(best, Date.parse(s.endTime) || 0), 0)
      const lastTripEnd = finished.reduce((best, tr) => Math.max(best, tr.endTime ?? 0), 0)
      const anchor = Math.max(lastStopEnd, lastTripEnd)
      if (anchor > lookbackFrom) routeFrom = anchor - OPEN_TRIP_TOLERANCE_MS
    }
    const route = await getRoute(carId, routeFrom, t + 1000)
    const inProgress = buildInProgressTrip({
      carId,
      latest,
      route,
      openTripStart: open ? open.startTime : null,
      geofences,
      now: t,
      deriveStops,
      cfg,
    })
    return { inProgress, open }
  }

  const getTrips = async (carId: string | null, from: number, to: number): Promise<Trip[]> => {
    const [ids, geofences] = await Promise.all([deviceIds(carId), getGeofences()])
    if (ids.length === 0) return []
    const deriveStops = to - from <= cfg.pauseDeriveMaxRangeMs
    // The current drive belongs to a range that reaches "now"; for older ranges Traccar's own trips are final.
    const reachesNow = to > now() - cfg.noSignalMs
    const [raw, latest] = await Promise.all([
      http.getJson<TraccarTrip[]>('/api/reports/trips', {
        deviceId: ids,
        from: isoParam(from - TRIP_PADDING_MS),
        to: isoParam(to),
      }),
      reachesNow ? getLatestPositions() : Promise.resolve([] as Position[]),
    ])
    const mapped = raw.flatMap((r) => toTrip(r, geofences) ?? []).filter((tr) => overlaps(tr, from, to))

    const perCar = await Promise.all(
      ids.map(async (id) => {
        const mine = mapped.filter((tr) => tr.carId === id)
        const drive = reachesNow
          ? await currentDrive(id, latest.find((p) => p.carId === id) ?? null, mine, geofences, deriveStops)
          : { inProgress: null, open: null }
        const inRange = drive.inProgress && overlaps(drive.inProgress, from, to) ? drive.inProgress : null
        return Promise.all(
          withInProgress(mine, drive.open, inRange).map((tr) => {
            if (tr.endTime === null) return tr
            return deriveStops ? withPauses(tr, geofences) : { ...tr, stopsKnown: false as const }
          }),
        )
      }),
    )
    return perCar.flat().sort((a, b) => b.startTime - a.startTime)
  }

  const getStops = async (carId: string | null, from: number, to: number): Promise<Stop[]> => {
    const trips = await getTrips(carId, from, to)
    return trips
      .flatMap((t) => t.stops)
      .filter((s) => s.startTime < to && s.endTime > from)
      .sort((a, b) => b.startTime - a.startTime)
  }

  const getSummary = async (from: number, to: number): Promise<Summary[]> => {
    const cars = await getCars()
    const trips = await getTrips(null, from, to)
    return cars.map((c) => summarizeTrips(c.id, trips))
  }

  // --- live ------------------------------------------------------------------------------------------------------
  type Handlers = Parameters<DataSource['subscribe']>[0]
  const subscribers = new Set<Handlers>()
  const stateListeners = new Set<(s: ConnectionState) => void>()
  let state: ConnectionState = 'reconnecting'
  let live: ReturnType<typeof createLiveSocket> | null = null

  const setState = (s: ConnectionState) => {
    if (s === state) return
    state = s
    for (const l of [...stateListeners]) l(s)
  }

  const handleMessage = (data: unknown, receivedAt: number) => {
    const message = (typeof data === 'object' && data !== null ? data : {}) as TraccarSocketMessage
    const positions = Array.isArray(message.positions) ? convert(message.positions) : []
    for (const h of [...subscribers]) {
      if (positions.length > 0) h.onPositions(positions)
      // Any message, even an empty keep-alive, proves the link is alive.
      h.onMessage?.(receivedAt)
    }
  }

  const startLive = () => {
    const WebSocketImpl = opts.WebSocketImpl ?? (globalThis.WebSocket as unknown as SocketCtor)
    live = createLiveSocket({
      url: socketUrl(baseUrl),
      WebSocketImpl,
      setTimer: opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms)),
      clearTimer: opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>)),
      random: opts.random ?? Math.random,
      now,
      onMessage: handleMessage,
      onState: setState,
      probeSession: () => auth.checkSession(),
      onAuthRequired: () => opts.onUnauthorized?.(),
    })
    live.start()
  }

  return {
    getCars,
    getGeofences,
    locations,
    trucks,
    onCarsChange(listener) {
      carListeners.add(listener)
      return () => carListeners.delete(listener)
    },
    onGeofencesChange(listener) {
      geofenceListeners.add(listener)
      return () => geofenceListeners.delete(listener)
    },
    getLatestPositions,
    getRoute,
    getTrips,
    getStops,
    getSummary,

    subscribe(handlers) {
      subscribers.add(handlers)
      if (subscribers.size === 1) startLive()
      return () => {
        subscribers.delete(handlers)
        if (subscribers.size === 0) {
          live?.stop()
          live = null
        }
      }
    },

    onConnectionChange(listener) {
      stateListeners.add(listener)
      listener(state)
      return () => {
        stateListeners.delete(listener)
      }
    },
  }
}
