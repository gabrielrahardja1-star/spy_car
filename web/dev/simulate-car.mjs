#!/usr/bin/env node
// Sends FAKE GPS positions to a real Traccar server, the way a phone or tracker would (OsmAnd protocol, port 5055).
// Use it to test the whole chain (Traccar -> app) before a real tracker exists.
//
//   node dev/simulate-car.mjs --host 203.0.113.10 --id sim-2 --lat -6.2022 --lon 106.8237
//
// The device must already exist in Traccar with exactly this identifier, or Traccar ignores the messages.
//
// The car drives along REAL ROADS: the script asks the free public OSRM demo server (router.project-osrm.org, no
// key, light use only) for a driving route from the start to a second point and back, then follows it with
// varying speed (slower at the ends). First it fills the last ~hour (park, drive there, park, drive back, park, so
// Route history and the Dashboard get 2 trips), then it keeps driving live, one position every --every seconds,
// until you press Ctrl+C. Needs internet access on the machine that runs it.
//
// Options (all optional except --id):
//   --host     Traccar address (default 127.0.0.1)           --port   5055
//   --id       device identifier in Traccar (required)
//   --lat/--lon        start point (default: central Jakarta, a place with a dense road network). It is moved to the nearest road.
//   --to-lat/--to-lon  turning point (default: about 2 km north and 1.6 km east of the start). Also moved to the nearest road.
//   --kmh      cruising speed (default 40, dump truck 30)    --every  seconds between live positions (default 5)
//   --no-history  skip the backfill      --no-live  stop after the backfill      --dry-run  print URLs, send nothing
//
// Dump truck haul cycles instead of a car (--profile dump-truck): the start is the loading point in the pit, the turning
// point is the dump (disposal, ROM or stockpile). Each cycle: load (parked), haul loaded (slower), tip, return empty.
//   --load-min    minutes loading/queueing at the pit (default 6; 5 or more makes Traccar end the trip there)
//   --dump-min    minutes queueing and tipping at the dump (default 5, so loaded and empty runs are separate trips)
//   --loaded-kmh  hauling speed (default 60% of --kmh)
//   --cycles      haul cycles in the backfill (default 4)
//   --tip-lat/--tip-lon  middle of the dump face (default: 60 m on from where the road ends)
// At the dump the truck does not just stop at the end of the road: it drives in, swings round, reverses up to the
// tipping edge, tips (parked for --dump-min), then drives back out. Each load tips 9 m along the face from the last,
// in rows of 10, with each new row 12 m further out, the way a dump fills up.
// Example, mine site in South Kalimantan, pit about 1.6 km west of "Area 2" (3°10'21.04"S 115°16'54.51"E):
//   node dev/simulate-car.mjs --host 203.0.113.10 --id dt-01 --profile dump-truck \
//     --lat -3.16880 --lon 115.26846 --to-lat -3.172511 --to-lon 115.281808
// Remote haul roads are often missing from OpenStreetMap; if the routing service finds no route, pick points on a mapped road.
//
// A test truck that works shifts, forever (--schedule, dump truck only): it hauls during the shift, parks at the start
// point for breaks and overnight, and varies from cycle to cycle (loading 85-150%, tipping 100-140%, speeds 85-110%).
// Every few days it breaks down on the road for 20-45 minutes. Times are the site's local time.
//   --shift       working hours (default 06:00-18:00)        --break  a break, repeatable (default 12:00-13:00)
//   --tz-offset   site time zone in hours from UTC (default 8, WITA)
//   --breakdown-chance  chance per cycle (default 0.01, about one every few days)
//   --state FILE  remembers the route and the last position sent. On start it fills in everything since then (at most
//                 --backfill-hours, default 12) before going live, so a restart leaves no gap and sends nothing twice.
//   --start NAME:LAT,LON  several loading points instead of --lat/--lon (repeat it). The truck is dispatched like a
//                 real one: a block of 2-6 loads from one start point, then sent to another; after tipping it drives
//                 empty from the dump to its next start point on the real road. All of them haul to --to-lat/--to-lon.
//   --gps-noise   metres of GPS wander added to every position (default 2 in schedule mode, 0 otherwise)
// Example (the server runs this as the sim-dt01 service, see deploy/docker-compose.yml):
//   node dev/simulate-car.mjs --host 203.0.113.10 --id sim-dt-01 --profile dump-truck --schedule --state sim-dt-01.json \
//     --lat -3.176917 --lon 115.273364 --to-lat -3.172511 --to-lon 115.281808
//
// Only ever send to your own server. Positions are made up and mean nothing.

import { readFileSync, writeFileSync } from 'node:fs'

const args = process.argv.slice(2)
/** `--name value` or `--name=value`. */
const opt = (name, fallback) => {
  const eq = args.find((a) => a.startsWith(`--${name}=`))
  if (eq !== undefined) return eq.slice(name.length + 3)
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback
}
const flag = (name) => args.includes(`--${name}`)

const host = opt('host', '127.0.0.1')
const port = Number(opt('port', 5055))
const id = opt('id', '')
/** --start NAME:LAT,LON, repeatable: the loading points of a truck that is sent to different ones. */
const starts = args
  .flatMap((a, i) => (a.startsWith('--start=') ? [a.slice(8)] : a === '--start' && args[i + 1] ? [args[i + 1]] : []))
  .map((text) => {
    const m = /^(.+):\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)$/.exec(text.trim())
    if (!m) throw new Error(`Not a start point: ${text} (use NAME:LAT,LON, e.g. CWP:-3.176917,115.273364)`)
    return { name: m[1].trim(), lat: Number(m[2]), lon: Number(m[3]) }
  })
const lat0 = starts.length > 0 ? starts[0].lat : Number(opt('lat', -6.2022))
const lon0 = starts.length > 0 ? starts[0].lon : Number(opt('lon', 106.8237))
const lat1 = Number(opt('to-lat', lat0 + 0.018))
const lon1 = Number(opt('to-lon', lon0 + 0.015))
const truck = opt('profile', 'car') === 'dump-truck'
const kmh = Number(opt('kmh', truck ? 30 : 40))
const loadedKmh = Number(opt('loaded-kmh', kmh * 0.6))
const loadMin = Number(opt('load-min', 6))
const dumpMin = Number(opt('dump-min', 5))
const cycles = Number(opt('cycles', 4))
const tipLat = opt('tip-lat', null)
const tipLon = opt('tip-lon', null)
const everyS = Number(opt('every', 5))
const dryRun = flag('dry-run')
const scheduled = truck && flag('schedule')
const tzOffsetH = Number(opt('tz-offset', 8))
const breakdownChance = Number(opt('breakdown-chance', 0.01))
const backfillHours = Number(opt('backfill-hours', 12))
const statePath = opt('state', null)
const gpsNoiseM = Number(opt('gps-noise', scheduled ? 2 : 0))

/** "06:00-18:00" -> [360, 1080] minutes of the day. */
function minutesRange(text) {
  const [a, b] = text.split('-').map((hm) => {
    const [h, m] = hm.trim().split(':').map(Number)
    return h * 60 + (m || 0)
  })
  if (!Number.isFinite(a) || !Number.isFinite(b)) throw new Error(`Not a time range: ${text} (use 06:00-18:00)`)
  return [a, b]
}
const shiftRange = minutesRange(opt('shift', '06:00-18:00'))
const breakRanges = args.flatMap((a, i) =>
  a.startsWith('--break=') ? [minutesRange(a.slice(8))] : a === '--break' && args[i + 1] ? [minutesRange(args[i + 1])] : [],
)
if (breakRanges.length === 0) breakRanges.push(minutesRange('12:00-13:00'))

if (!id) {
  console.error('Missing --id. Example: node dev/simulate-car.mjs --host 203.0.113.10 --id sim-2')
  process.exit(1)
}

// ------------------------------------------------------------------ route on real roads

const toRad = (d) => (d * Math.PI) / 180
function haversineM(a, b) {
  const dLat = toRad(b[0] - a[0])
  const dLon = toRad(b[1] - a[1])
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLon / 2) ** 2
  return 2 * 6371000 * Math.asin(Math.sqrt(h))
}
function bearingDeg(a, b) {
  const y = Math.sin(toRad(b[1] - a[1])) * Math.cos(toRad(b[0]))
  const x = Math.cos(toRad(a[0])) * Math.sin(toRad(b[0])) - Math.sin(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.cos(toRad(b[1] - a[1]))
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

/** Driving route as [lat, lon] points, from the free OSRM demo server. */
async function fetchRoute(from, to) {
  const url = `https://router.project-osrm.org/route/v1/driving/${from[1]},${from[0]};${to[1]},${to[0]}?overview=full&geometries=geojson`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Routing service answered ${res.status}`)
  const data = await res.json()
  if (data.code !== 'Ok' || !data.routes?.length) throw new Error(`Routing service found no route (${data.code}). Try other coordinates.`)
  return data.routes[0].geometry.coordinates.map(([lon, lat]) => [lat, lon])
}

function toPath(points) {
  const cum = [0]
  for (let i = 1; i < points.length; i++) cum.push(cum[i - 1] + haversineM(points[i - 1], points[i]))
  return { points, cum, length: cum[cum.length - 1] }
}

/** Position and heading `s` metres along the path (clamped to its ends). */
function pointAt(path, s) {
  const d = Math.min(Math.max(s, 0), path.length)
  let lo = 0
  let hi = path.points.length - 1
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1
    if (path.cum[mid] <= d) lo = mid
    else hi = mid
  }
  const a = path.points[lo]
  const b = path.points[hi]
  const seg = path.cum[hi] - path.cum[lo]
  const f = seg > 0 ? (d - path.cum[lo]) / seg : 0
  return { lat: a[0] + (b[0] - a[0]) * f, lon: a[1] + (b[1] - a[1]) * f, bearing: bearingDeg(a, b) }
}

// ------------------------------------------------------------------ remembered state (--state)

function readState() {
  if (!statePath) return {}
  try {
    return JSON.parse(readFileSync(statePath, 'utf8'))
  } catch {
    return {}
  }
}
const state = readState()
/** Saved after every position sent, so a restart (even in the middle of a backfill) never sends one twice. */
function saveState() {
  if (!statePath || dryRun) return
  writeFileSync(statePath, JSON.stringify(state))
}

// ------------------------------------------------------------------ sending

/** GPS wander: a slowly drifting offset of about --gps-noise metres, the way a real receiver's error drifts. */
const drift = { east: 0, north: 0 }
const gauss = () => Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random())
function withNoise(p) {
  if (gpsNoiseM <= 0) return p
  drift.east = 0.8 * drift.east + 0.6 * gpsNoiseM * gauss()
  drift.north = 0.8 * drift.north + 0.6 * gpsNoiseM * gauss()
  return { ...p, lat: p.lat + drift.north / 110574, lon: p.lon + drift.east / (111320 * Math.cos(toRad(p.lat))) }
}

async function post(tSec, exact, speedKmh) {
  const p = withNoise(exact)
  const q = new URLSearchParams({
    id,
    timestamp: String(Math.round(tSec)),
    lat: p.lat.toFixed(6),
    lon: p.lon.toFixed(6),
    speed: (speedKmh / 1.852).toFixed(1), // the OsmAnd protocol carries knots, Traccar shows km/h
    bearing: p.bearing.toFixed(0),
    altitude: '10',
    hdop: '1',
  })
  const url = `http://${host}:${port}/?${q}`
  if (dryRun) {
    console.log(url)
    return
  }
  let res = await fetch(url, { method: 'POST' })
  // 400 = Traccar does not know this device (yet). Wait for it to be added instead of failing over and over.
  for (let waited = 0; res.status === 400 && scheduled; waited++) {
    if (waited % 10 === 0) {
      console.log(`Traccar does not know a device with ID "${id}" yet. Add it in the app (Manage > Trucks > Add truck, Test truck, Simulator); trying again every minute.`)
    }
    await sleep(60_000)
    res = await fetch(url, { method: 'POST' })
  }
  if (!res.ok) throw new Error(`Server answered ${res.status} for ${url}`)
  state.lastSent = Math.max(state.lastSent ?? 0, Math.round(tSec))
  saveState()
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ------------------------------------------------------------------ the drive

let route
let outLen // metres from the start to the turning point
let s = 0 // metres driven along the whole route (out, then back)
const clock = { t: 0, live: false }
let buffer = null // while planning the history, samples are collected here and sent afterwards with shifted times
let at = null // position off the road (manoeuvring on the dump), or null while on the route

async function tick(speedKmh, stepS) {
  const p = at ?? pointAt(route, s)
  if (buffer) buffer.push([clock.t, p, speedKmh])
  else await post(clock.t, p, speedKmh)
  if (clock.live) {
    await sleep(stepS * 1000)
    clock.t = Date.now() / 1000
  } else {
    clock.t += stepS
  }
}

async function park(minutes, stepS) {
  for (let i = 0; i < Math.ceil((minutes * 60) / stepS); i++) await tick(0, stepS)
}

/** Drive on until `toS`: slower near both ends of the leg, with gentle speed changes on the way. */
async function drive(toS, stepS, vmax = kmh) {
  const from = s
  while (s < toS) {
    const ease = Math.min(1, Math.max(0.25, Math.min(s - from, toS - s) / 120))
    const v = vmax * ease * (0.85 + 0.15 * Math.sin(s / 250))
    await tick(v, stepS)
    s = Math.min(toS, s + (v / 3.6) * stepS)
  }
}

// ------------------------------------------------------------------ tipping at the dump

let loadsTipped = 0

/** [lat, lon] `ahead` metres along bearing `b` and `right` metres to its right, from p. */
function moved(p, b, ahead, right) {
  const r = toRad(b)
  const east = ahead * Math.sin(r) + right * Math.cos(r)
  const north = ahead * Math.cos(r) - right * Math.sin(r)
  return [p[0] + north / 110574, p[1] + east / (111320 * Math.cos(toRad(p[0])))]
}

/** Drive in a straight line from where the truck is to `to` at `speed`. The bearing is the direction of travel, as GPS reports it. */
async function crawl(to, speed, stepS) {
  const from = [at.lat, at.lon]
  const bearing = bearingDeg(from, to)
  const steps = Math.max(1, Math.ceil(haversineM(from, to) / ((speed / 3.6) * stepS)))
  for (let i = 1; i <= steps; i++) {
    at = { lat: from[0] + ((to[0] - from[0]) * i) / steps, lon: from[1] + ((to[1] - from[1]) * i) / steps, bearing }
    await tick(speed, stepS)
  }
}

/** Tip one load: in from the end of the road, swing round, reverse up to the edge, tip, and back out to the road. */
async function tipLoad(stepS) {
  const end = pointAt(route, outLen)
  const roadEnd = [end.lat, end.lon]
  const centre = tipLat !== null && tipLon !== null ? [Number(tipLat), Number(tipLon)] : moved(roadEnd, pointAt(route, outLen - 1).bearing, 60, 0)
  const b = bearingDeg(roadEnd, centre) // facing the dump face
  const k = loadsTipped++ % 50 // five rows, then the dump is levelled and filling starts again
  const tip = moved(centre, b, Math.floor(k / 10) * 12, ((k % 10) - 4.5) * 9)
  const step = Math.min(stepS, 5)
  at = { ...end }
  await crawl(moved(tip, b, -10, 25), 12, step) // in, passing to the right of the spot
  await crawl(moved(tip, b, -35, 8), 10, step) // round, now facing back towards the road
  await crawl(tip, 5, step) // reversing up to the edge
  await park(dumpMin * vary(1, 1.4), Math.min(30, stepS * 6)) // tipping (and any wait before it)
  await crawl(roadEnd, 12, step) // out to the haul road
  at = null
}

/** A random factor between lo and hi in schedule mode; exactly 1 otherwise, so other runs stay repeatable. */
const vary = (lo, hi) => (scheduled ? lo + Math.random() * (hi - lo) : 1)

/** Drive one leg; in schedule mode it may break down somewhere along it and stand still for 20-45 minutes. */
async function driveLeg(toS, stepS, vmax) {
  if (scheduled && Math.random() < breakdownChance / 2) {
    await drive(s + (toS - s) * (0.2 + Math.random() * 0.6), stepS, vmax)
    const minutes = 20 + Math.random() * 25
    note(`breakdown: stopped on the road for ${Math.round(minutes)} min`)
    await park(minutes, Math.min(60, stepS * 6))
  }
  await drive(toS, stepS, vmax)
}

/** One dump truck cycle: load at the pit, haul loaded to the dump, tip, return empty. */
async function haulCycle(stepS) {
  await park(loadMin * vary(0.85, 1.5), Math.min(30, stepS * 6))
  await driveLeg(outLen, stepS, loadedKmh * vary(0.85, 1.1))
  await tipLoad(stepS)
  await driveLeg(route.length, stepS, kmh * vary(0.85, 1.1))
}

// ------------------------------------------------------------------ shift schedule (--schedule)

/** Minute of the local day at `t` (seconds since epoch). */
const localMinute = (t) => (((Math.floor(t / 60) + tzOffsetH * 60) % 1440) + 1440) % 1440
const inRange = (m, [a, b]) => (a <= b ? m >= a && m < b : m >= a || m < b)
/** Why the truck is not working at `t`, or null during working time. */
function downtimeReason(t) {
  const m = localMinute(t)
  if (!inRange(m, shiftRange)) return 'end of shift'
  return breakRanges.some((r) => inRange(m, r)) ? 'break' : null
}
/** The first whole minute from `t` on where downtimeReason is (or is not) null; at most a day ahead. */
function nextChange(t, working) {
  let u = Math.ceil(t / 60) * 60
  for (let i = 0; i < 1440 && (downtimeReason(u) === null) !== working; i++) u += 60
  return u
}
/** Worst-case length of one cycle in seconds, to avoid starting a load that would run into a break. */
const longestCycleS = () => {
  const out = legs ? Math.max(...legs.map((l) => l.outLen)) : outLen
  const back = legs ? Math.max(...legs.map((l) => l.backLen)) : route.length - outLen
  return loadMin * 60 * 1.5 + (out / (loadedKmh * 0.85)) * 3.6 + dumpMin * 60 * 1.4 + 240 + (back / (kmh * 0.85)) * 3.6
}

// ------------------------------------------------------------------ dispatch between start points (--start)

/** Per start point: the road to the dump and back, as [lat, lon] points. Null with a single start. */
let legs = null
let current = 0 // index of the start point the truck is at
let loadsLeft = 0 // loads still to take from the current start point before being sent elsewhere

/** Sets `route` for the next cycle: load at the current start point, tip, return empty to the next one. */
function planCycle() {
  if (!legs) return
  if (loadsLeft <= 0) {
    loadsLeft = 2 + Math.floor(Math.random() * 5)
    note(`loading at ${legs[current].name} (${loadsLeft} loads)`)
  }
  loadsLeft--
  let next = current
  if (loadsLeft === 0 && legs.length > 1) {
    next = Math.floor(Math.random() * (legs.length - 1))
    if (next >= current) next++
  }
  route = toPath([...legs[current].out, ...legs[next].back.slice(1)])
  outLen = legs[current].outLen
  current = next
  state.at = legs[current].name
}

let lastNote = ''
function note(text) {
  if (text === lastNote) return
  lastNote = text
  const local = new Date((clock.t + tzOffsetH * 3600) * 1000).toISOString().slice(0, 16).replace('T', ' ')
  console.log(`${local} ${text}`)
}

/** Parks at the start point until `until` (seconds), one position a minute, like a tracker with the engine off. */
async function parkUntil(until) {
  while (clock.t < until) await tick(0, Math.max(1, Math.min(60, until - clock.t)))
}

/** Works the schedule from clock.t until `until`, never starting a cycle that would not finish by then. */
async function workSchedule(until, stepS) {
  while (clock.t < until) {
    const why = downtimeReason(clock.t)
    if (why) {
      note(why === 'break' ? 'break: parked at the start point' : 'end of shift: parked at the start point')
      await parkUntil(Math.min(until, nextChange(clock.t, true)))
      continue
    }
    const stopAt = Math.min(until, nextChange(clock.t, false))
    if (clock.t + longestCycleS() > stopAt) {
      // Not enough time for another load before the break, the end of the shift or now: wait at the start point.
      await parkUntil(stopAt)
      continue
    }
    if (!legs) note('hauling')
    planCycle()
    s = 0
    await haulCycle(stepS)
  }
}

/** --schedule: fill in what happened since the last run (or the last --backfill-hours), then keep working live. */
async function runSchedule() {
  const now = Date.now() / 1000
  const from = Math.max(state.lastSent ?? 0, now - backfillHours * 3600)
  if (from < now - 120) {
    buffer = []
    clock.live = false
    clock.t = from + 1
    s = 0
    console.log(`Filling in ${((now - from) / 3600).toFixed(1)} h since ${state.lastSent ? 'the last run' : 'the start'}...`)
    await workSchedule(now, 10)
    for (const [t, p, v] of buffer) await post(t, p, v)
    console.log(`Sent ${buffer.length} positions.`)
    buffer = null
  }
  saveState()
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      saveState()
      process.exit(0)
    })
  }
  console.log(`Working live: shift ${opt('shift', '06:00-18:00')}, breaks ${breakRanges.map((r) => r.map((m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`).join('-')).join(', ')}, a position every ${everyS} s.`)
  clock.live = true
  clock.t = Date.now() / 1000
  await workSchedule(Infinity, everyS)
}

try {
  /** The road from a start point to the dump and back, remembered so a restart does not need the routing service. */
  async function roadsFrom(lat, lon) {
    const key = `${lat},${lon},${lat1},${lon1}`
    state.routes ??= {}
    if (state.route?.key === key) state.routes[key] = state.route // from before several start points were possible
    if (!state.routes[key]) {
      console.log('Asking the routing service for a road route...')
      const out = await fetchRoute([lat, lon], [lat1, lon1])
      const back = await fetchRoute(out[out.length - 1], out[0]) // can differ from the way out (one-way streets)
      state.routes[key] = { key, out, back }
      saveState()
    }
    return state.routes[key]
  }

  if (starts.length > 1) {
    legs = []
    for (const st of starts) {
      const { out, back } = await roadsFrom(st.lat, st.lon)
      legs.push({ name: st.name, out, back, outLen: toPath(out).length, backLen: toPath(back).length })
      console.log(`Route from ${st.name}: ${(legs.at(-1).outLen / 1000).toFixed(1)} km to the dump, ${(legs.at(-1).backLen / 1000).toFixed(1)} km back.`)
    }
    current = Math.max(0, legs.findIndex((l) => l.name === state.at))
    if (state.at === undefined) current = Math.floor(Math.random() * legs.length)
    route = toPath([...legs[current].out, ...legs[current].back.slice(1)])
    outLen = legs[current].outLen
  } else {
    const { out, back } = await roadsFrom(lat0, lon0)
    route = toPath([...out, ...back.slice(1)])
    outLen = toPath(out).length
    console.log(`Route: ${(outLen / 1000).toFixed(1)} km out, ${((route.length - outLen) / 1000).toFixed(1)} km back, on real roads.`)
  }

  if (scheduled) {
    await runSchedule()
  } else if (!flag('no-history')) {
    buffer = []
    clock.t = 0
    if (truck) {
      for (let i = 0; i < cycles; i++) {
        s = 0
        await haulCycle(10)
      }
      await park(10, 60)
    } else {
      await park(20, 60)
      await drive(outLen, 10)
      await park(10, 60)
      await drive(route.length, 10)
      await park(15, 60)
    }
    const shift = Date.now() / 1000 - 30 - buffer[buffer.length - 1][0]
    console.log(`Sending ${buffer.length} history positions (about ${Math.round(buffer[buffer.length - 1][0] / 60)} minutes)...`)
    for (const [t, p, v] of buffer) await post(t + shift, p, v)
    buffer = null
    console.log(truck ? `History sent: ${cycles} haul cycles (pit to dump and back).` : 'History sent: 2 trips (out and back) with parked periods between.')
  }

  if (!scheduled && !flag('no-live')) {
    console.log(`Driving live at up to ${kmh} km/h, a position every ${everyS} s. Press Ctrl+C to stop.`)
    clock.live = true
    clock.t = Date.now() / 1000
    for (;;) {
      s = 0
      if (truck) {
        await haulCycle(everyS)
      } else {
        await park(1, everyS)
        await drive(outLen, everyS)
        await park(1, everyS)
        await drive(route.length, everyS)
      }
      process.stdout.write('.')
    }
  }
} catch (err) {
  const cause = err.cause?.code ? ` (${err.cause.code})` : ''
  console.error(`\nFailed: ${err.message}${cause}`)
  console.error('Check the host and port, that port 5055 is open (OSMAND_BIND=0.0.0.0 in deploy/.env), that the device exists, and that this computer has internet access (for the routing service).')
  process.exit(1)
}
