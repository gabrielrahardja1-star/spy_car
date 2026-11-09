#!/usr/bin/env node
// Adds the site's locations to Traccar in one go: the four start points and Area 2, the end point (dump).
// The same as adding them one by one in the app's Manage tab. A location that already exists (same name) is checked:
// if its type or circle differs it is reported, and --fix sets it right. Safe to run twice. Each new one is shared with
// every user, like the app does.
//
//   npm run add-locations -- --email admin@example.com
//
// It asks for the password (nothing is stored). By default it talks to Traccar through the SSH tunnel
// (ssh -L 8082:localhost:8082 root@SERVER-IP, then leave that window open); --url https://your-app-address works too.
//
// Options: --url (default http://localhost:8082)  --email (required)  --dry-run (show what would change, change nothing)
//          --fix (also correct the type and circle of locations that already exist)

import { createInterface } from 'node:readline'

const LOCATIONS = [
  // name, type (start | end | checkpoint), latitude, longitude, radius in metres. Coordinates as given from site, Nov 2026.
  ['Area 2', 'end', -3.172511, 115.281808, 150], //               3°10'21.04"S 115°16'54.51"E
  ['Klinik', 'start', -3.178875, 115.272158, 50], //              3°10'43.95"S 115°16'19.77"E
  ['Ventilasi', 'start', -3.177925, 115.273756, 50], //           3°10'40.53"S 115°16'25.52"E
  ['CWP', 'start', -3.176917, 115.273364, 50], //                 3°10'36.90"S 115°16'24.11"E
  ['Belakang Conveyor', 'start', -3.176414, 115.275161, 50], //   3°10'35.09"S 115°16'30.58"E
]

const args = process.argv.slice(2)
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback
}
const base = opt('url', 'http://localhost:8082').replace(/\/+$/, '')
const email = opt('email', '')
const dryRun = args.includes('--dry-run')
const fix = args.includes('--fix')
const TYPE_NAME = { start: 'start point', end: 'end point', checkpoint: 'checkpoint' }

if (!email) {
  console.error('Missing --email. Example: npm run add-locations -- --email admin@example.com')
  process.exit(1)
}

/** Reads a line without echoing it (for the password). TRACCAR_PASSWORD skips the question. */
function askHidden(question) {
  if (process.env.TRACCAR_PASSWORD) return Promise.resolve(process.env.TRACCAR_PASSWORD)
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true })
    rl._writeToOutput = (text) => {
      if (text.startsWith(question)) process.stdout.write(question)
    }
    rl.question(question, (answer) => {
      rl.close()
      process.stdout.write('\n')
      resolve(answer)
    })
  })
}

/** True when `area` is a circle within 1 m of the given centre and radius (Traccar may write numbers differently). */
function sameCircle(area, lat, lon, radius) {
  const m = /^CIRCLE\s*\(\s*(-?[\d.]+)\s+(-?[\d.]+)\s*,\s*([\d.]+)\s*\)$/i.exec(String(area).trim())
  if (!m) return false
  const [la, lo, r] = m.slice(1).map(Number)
  return Math.abs(la - lat) * 110574 < 1 && Math.abs(lo - lon) * 111000 < 1 && Math.abs(r - radius) < 1
}

let cookie = ''
async function call(method, path, body, form = false) {
  const headers = { Accept: 'application/json', ...(cookie ? { Cookie: cookie } : {}) }
  if (body !== undefined) headers['Content-Type'] = form ? 'application/x-www-form-urlencoded' : 'application/json'
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : form ? new URLSearchParams(body).toString() : JSON.stringify(body),
  })
  const setCookie = res.headers.get('set-cookie')
  if (setCookie) cookie = setCookie.split(';')[0]
  if (!res.ok) {
    const text = (await res.text()).slice(0, 200)
    const err = new Error(`${method} ${path} answered ${res.status}${text ? `: ${text}` : ''}`)
    err.status = res.status
    throw err
  }
  return res.status === 204 ? undefined : res.json()
}

try {
  const password = await askHidden(`Traccar password for ${email}: `)
  let me
  try {
    me = await call('POST', '/api/session', { email, password }, true)
  } catch (e) {
    if (e.status === 401) throw new Error('Wrong email or password.')
    throw e
  }
  if (!me.administrator || me.readonly) throw new Error(`${email} is not an administrator (or is read-only), so it cannot add locations.`)

  const byName = new Map((await call('GET', '/api/geofences')).map((g) => [g.name.trim().toLowerCase(), g]))
  const todo = LOCATIONS.filter(([name]) => !byName.has(name.toLowerCase()))
  let wrong = 0
  for (const [name, type, lat, lon, radius] of LOCATIONS) {
    const g = byName.get(name.toLowerCase())
    if (!g) continue
    const area = `CIRCLE (${lat.toFixed(6)} ${lon.toFixed(6)}, ${radius})`
    const hasType = String(g.attributes?.type ?? '').trim().toLowerCase()
    const problems = []
    if (hasType !== type) problems.push(`saved as ${TYPE_NAME[hasType] ?? 'a plain zone'}, should be ${TYPE_NAME[type]}`)
    if (!sameCircle(g.area, lat, lon, radius)) problems.push(`shape is ${g.area.trim()}, expected ${area}`)
    if (problems.length === 0) {
      console.log(`OK ${name}: ${TYPE_NAME[type]}, ${radius} m.`)
      continue
    }
    wrong++
    if (fix && !dryRun) {
      await call('PUT', `/api/geofences/${g.id}`, { ...g, area, attributes: { ...g.attributes, type } })
      console.log(`Fixed ${name}: ${problems.join('; ')}.`)
    } else {
      console.log(`Needs fixing ${name}: ${problems.join('; ')}.`)
    }
  }
  if (wrong > 0 && !fix) console.log(`Run again with --fix to correct ${wrong === 1 ? 'it' : 'them'}.`)
  if (todo.length === 0) {
    await call('DELETE', '/api/session').catch(() => {})
    process.exit(0)
  }

  const others = dryRun ? [] : (await call('GET', '/api/users')).filter((u) => u.id !== me.id)
  for (const [name, type, lat, lon, radius] of todo) {
    const area = `CIRCLE (${lat.toFixed(6)} ${lon.toFixed(6)}, ${radius})`
    if (dryRun) {
      console.log(`Would add ${name} (${type}, ${radius} m): ${area}`)
      continue
    }
    const created = await call('POST', '/api/geofences', { name, area, attributes: { type } })
    for (const u of others) await call('POST', '/api/permissions', { userId: u.id, geofenceId: created.id })
    console.log(`Added ${name} (${type === 'end' ? 'end point' : type === 'start' ? 'start point' : type}, ${radius} m).`)
  }
  if (!dryRun) console.log(`Done. Shared with ${others.length} other user(s). Reload the app to see them.`)
  await call('DELETE', '/api/session').catch(() => {})
} catch (e) {
  const cause = e.cause?.code ? ` (${e.cause.code})` : ''
  console.error(`\nFailed: ${e.message}${cause}`)
  if (e.cause?.code === 'ECONNREFUSED') console.error(`Nothing answered at ${base}. Is the SSH tunnel open? ssh -L 8082:localhost:8082 root@SERVER-IP`)
  process.exit(1)
}
