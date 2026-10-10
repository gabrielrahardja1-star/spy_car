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
//   --kmh      cruising speed (default 40)                   --every  seconds between live positions (default 5)
//   --no-history  skip the backfill      --no-live  stop after the backfill      --dry-run  print URLs, send nothing
//
// Only ever send to your own server. Positions are made up and mean nothing.

const args = process.argv.slice(2)
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback
}
const flag = (name) => args.includes(`--${name}`)

const host = opt('host', '127.0.0.1')
const port = Number(opt('port', 5055))
const id = opt('id', '')
const lat0 = Number(opt('lat', -6.2022))
const lon0 = Number(opt('lon', 106.8237))
const lat1 = Number(opt('to-lat', lat0 + 0.018))
const lon1 = Number(opt('to-lon', lon0 + 0.015))
const kmh = Number(opt('kmh', 40))
const everyS = Number(opt('every', 5))
const dryRun = flag('dry-run')

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

// ------------------------------------------------------------------ sending

async function post(tSec, p, speedKmh) {
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
  const res = await fetch(url, { method: 'POST' })
  if (!res.ok) throw new Error(`Server answered ${res.status} for ${url}`)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ------------------------------------------------------------------ the drive

let route
let outLen // metres from the start to the turning point
let s = 0 // metres driven along the whole route (out, then back)
const clock = { t: 0, live: false }
let buffer = null // while planning the history, samples are collected here and sent afterwards with shifted times

async function tick(speedKmh, stepS) {
  const p = pointAt(route, s)
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
async function drive(toS, stepS) {
  const from = s
  while (s < toS) {
    const ease = Math.min(1, Math.max(0.25, Math.min(s - from, toS - s) / 120))
    const v = kmh * ease * (0.85 + 0.15 * Math.sin(s / 250))
    await tick(v, stepS)
    s = Math.min(toS, s + (v / 3.6) * stepS)
  }
}

try {
  console.log('Asking the routing service for a road route...')
  const out = await fetchRoute([lat0, lon0], [lat1, lon1])
  const turn = out[out.length - 1]
  const back = await fetchRoute(turn, out[0]) // can differ from the way out (one-way streets)
  route = toPath([...out, ...back.slice(1)])
  outLen = toPath(out).length
  console.log(`Route: ${(outLen / 1000).toFixed(1)} km out, ${((route.length - outLen) / 1000).toFixed(1)} km back, on real roads.`)

  if (!flag('no-history')) {
    buffer = []
    clock.t = 0
    await park(20, 60)
    await drive(outLen, 10)
    await park(10, 60)
    await drive(route.length, 10)
    await park(15, 60)
    const shift = Date.now() / 1000 - 30 - buffer[buffer.length - 1][0]
    console.log(`Sending ${buffer.length} history positions (about ${Math.round(buffer[buffer.length - 1][0] / 60)} minutes)...`)
    for (const [t, p, v] of buffer) await post(t + shift, p, v)
    buffer = null
    console.log('History sent: 2 trips (out and back) with parked periods between.')
  }

  if (!flag('no-live')) {
    console.log(`Driving live at up to ${kmh} km/h, a position every ${everyS} s. Press Ctrl+C to stop.`)
    clock.live = true
    clock.t = Date.now() / 1000
    for (;;) {
      s = 0
      await park(1, everyS)
      await drive(outLen, everyS)
      await park(1, everyS)
      await drive(route.length, everyS)
      process.stdout.write('.')
    }
  }
} catch (err) {
  const cause = err.cause?.code ? ` (${err.cause.code})` : ''
  console.error(`\nFailed: ${err.message}${cause}`)
  console.error('Check the host and port, that port 5055 is open (OSMAND_BIND=0.0.0.0 in deploy/.env), that the device exists, and that this computer has internet access (for the routing service).')
  process.exit(1)
}
