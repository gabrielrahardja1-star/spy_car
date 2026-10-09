# Site Car Tracker: project status and next steps

*Written 9 Oct 2026. Covers Phases 1 to 7 of [`Claude Plan/PLAN.md`](../Claude%20Plan/PLAN.md).*

## 1. Where we are, in one paragraph

The whole app is built and works in **mock mode** (fake cars on a laptop): the live 3D map, route history with
playback, and the dashboard. A real **Traccar connection**, a login screen and a ready-to-run **Docker deployment**
are also written. None of the Traccar or Docker parts has run against a live server yet, because no Docker or
Traccar server was available while building. They were checked against the official docs and against a local fake
server, so the first real run is expected to need small fixes, not a rewrite.

**The next step belongs to you:** put the stack on the company VPS and try it with a phone. Section 7 lists
the steps in order.

## 2. Status by phase

| Phase | What | State |
|---|---|---|
| 1 | App shell and design system | Done |
| 2 | Mock data mode | Done |
| 3 | Real 3D map (MapLibre) | Done |
| 4 | 3D car models | Done |
| 5 | Route history with playback | Done |
| 6 | Dashboard | Done |
| 7 | Traccar connection and Docker | **Code written, not run live.** Needs your VPS. |
| 8 | Hardening | Partly present (see section 6). Best done after the first live run. |

Nothing has been committed to git yet: `web/`, `deploy/`, `docs/`, `README.md`, `.gitignore` and `Claude Plan/` are
all new files. Committing is your call.

## 3. What has been built

### The three screens

| Screen | What it does |
|---|---|
| **Live map** | One card per car (status, speed or "parked for", last seen, today's distance, one-line context). Click a card and the map flies to that car. Tilted 3D map with the buildings drawn as blocks, a numbered pin and callout per car, a pulsing ring on moving cars (off if "reduce motion" is set), today's trail for the selected car, the dashed site zone, 2D/3D toggle, "Fit both cars" and zoom. |
| **Route history** | Pick a car and a day. The trips are listed. The selected trip shows distance, driving time, stops and a timeline. The map shows the route, start, stops (orange squares with durations), end, and a 3D car. A playback bar has play/pause, a draggable scrubber with stop ticks, and 1x/2x/4x/8x speed. Clicking a timeline event jumps playback to it. |
| **Dashboard** | Today / 7 days / 30 days. Four cards (distance, driving time, trips, signal gaps), a 7-day distance chart per car, an hour-by-hour strip for today (moving, parked, no signal), and a recent-trips table. Totals come from the same trip data as Route history, and a test checks they agree. |

Also: a shared header with a live "updated N s ago" counter, a **login screen** (only in Traccar mode), and
**status that never relies on colour alone** (round dot = moving, square = parked, dashed ring = no signal).

### How the pieces fit together

```
 Tracker / phone app --> Traccar server --> PostgreSQL
                              |
                   /api (REST) + /api/socket (live)      same domain, via Caddy
                              |
                       React app (web/)
                              |
   screens  ->  hooks (data/hooks.ts)  ->  ONE data interface (data/source.ts)
                                              |-- mock source   (fake cars, default)
                                              |-- Traccar source (real server)
```

Screens never talk to Traccar directly. Everything goes through one small data interface, so the mock and the
Traccar source are interchangeable (`VITE_DATA_SOURCE=mock` or `traccar`). This is also the place where a later
backend could be slotted in.

### Where things live (`web/src/`)

| Folder | Contents |
|---|---|
| `app/` | Header, tab bar, routes, login gate and session handling |
| `screens/` | `LiveMap`, `RouteHistory`, `Dashboard`, `Login` |
| `components/map/` | The MapLibre map style, car pins, the 3D car layer, route playback maths, history markers |
| `components/ui/` | Cards, tiles, status pills, buttons, overlays |
| `data/` | Types, the data interface, status rules, formatting, hooks |
| `data/mock/` | Deterministic fake data: 2 cars, 30 days of history, a live feed |
| `data/traccar/` | The real Traccar client: REST, websocket with reconnect, login, unit conversion, trip logic |
| `data/traccar/fake/` and `web/dev/` | A local fake Traccar server for trying the real code path without Docker |
| `styles/`, `config.ts` | Design tokens and the thresholds (5 min no-signal, 3 km/h moving, 06:00-18:00 strip) |
| `public/models/` | The two 3D car models (CC0, Kenney Car Kit) with their licence |

Repo root: `deploy/` (Docker Compose, Caddy, Traccar config, backup and port-check scripts), `README.md` (how to run
and deploy), `docs/` (this file), `Claude Plan/` (the original plan and the design mockups).

### Size and quality

- About 8,700 lines of app code in 72 files, and 4,800 lines of tests in 31 files.
- **400 tests pass.** Type check, production build and lint are clean (lint shows 3 harmless warnings in
  `DataProvider.tsx`).
- The real browser (Chrome with software 3D) was used to check the Live map, replay, dashboard, login, wrong
  password, expired session and a dead server.
- The Caddy proxy config was validated with the real Caddy program: single-page-app fallback, caching, websocket
  upgrade, and a read-only `/api` all behave as intended.

## 4. Decisions made along the way

| Topic | Decision |
|---|---|
| Places | The owner only draws **one** geofence, named `Site`. Everywhere else reads "Away from site". Titles look like "Site → away". An address is shown when Traccar supplies one. |
| Trips | The real app uses **Traccar's own definition**: a trip is a drive between parked periods of 5 minutes or more. Short pauses inside a trip are worked out from the route (only for ranges of 2 days or less). |
| Login | One shared Traccar viewer account. The password is typed in, kept only in the session cookie, never stored or put in a build. |
| Public API | Through the public address, `/api` is **read-only** (plus login/logout). All changes go through an SSH tunnel to Traccar's admin screen. This also stops a stranger registering as admin first. |
| Drivers | The driver line is hidden unless Traccar has a driver name for the car. No names appear anywhere in code. |
| Map data | OpenFreeMap tiles, no API key and no paid service. 3D terrain was **not** added (flat coastal area, little gain). |
| 3D cars | Kenney's free low-poly sedan (Car 01) and SUV (Car 02). If the 3D layer or a model fails, a flat coloured dot is shown. |
| Library versions | MapLibre is pinned to 5.x, because deck.gl 9.4 does not work with MapLibre 6. |
| Tracker protocol | The plan assumed GT06. The app does not care: Traccar decodes many protocols and only the published server port changes. |

## 5. What to buy: trackers

- **Indonesia's mobile networks:** I found no firm 2G shutdown date and an uneven, carrier-by-carrier 3G phase-out.
  Buy **4G (LTE Cat-1 or Cat-M)** and ask your carrier which networks are active at the remote site.
  [Background](https://developingtelecoms.com/telecom-technology/data-centres-networks/12632-indonesia-pushes-operators-to-begin-shutting-down-3g-services.html).
- **Safest with Traccar:** Teltonika FMC-series (4G; the older FMB920 is 2G) or Queclink GV-series (4G variants).
  Check each exact model's supported bands first.
- **Cheapest and easiest to find:** Jimi/Concox JM-VL03 (4G). Traccar support for the 4G models is mixed
  ([forum thread](https://www.traccar.org/forums/topic/traccar-verified-gps-hardware-4g-wired-trackers-high-capacity-battery-devices-gt06808-support/),
  [JM-VL01 thread](https://www.traccar.org/forums/reply/69827)). Buy **one** to test, not a batch.
- **Before buying anything:** test the whole system with the free **Traccar Client** phone app. It sends real
  positions, so you can drive around and watch the map.

## 6. Known limits and rough edges

**Not verified live (the big one)**
- No container has been started. Whether Traccar and Postgres come up cleanly, the health check, and the Let's
  Encrypt certificate flow are all untested.
- Traccar details that came from docs and source, not from a running server (the code was written to the docs):
  stop item field names, how an unfinished trip appears in the trips report, geofence text formats written by
  Traccar's own screen, websocket behaviour through Caddy, and login cookie flags.
- The exact wording of the Traccar admin settings ("Registration", "Readonly") may differ from the README.
- Whether the phone app accepts a plain `http://` address, especially on iPhone.
- The content-security-policy header is in **report-only** mode until it has been watched in a real browser.
- The Queclink port comment in `docker-compose.yml` should be checked against Traccar's protocol port list.

**Behaviour you will notice**
- **Trips split at every stop of 5 minutes or more.** A drive with an 8-minute stop at a shop shows as two trips, so
  trip counts will be higher than in the mockups. See decision 2 in section 7.
- Over ranges longer than 2 days, "Stops" shows a dash and driving time includes short pauses.
- A trip that crosses midnight counts on both days.
- A route for a trip still in progress is a snapshot taken when you select it (it does not keep growing).
- The mock's second car sits near the first, so the two callouts overlap on the Live map. The "Start" label can
  cover "SITE ZONE" when a trip starts inside the zone.
- Distances over 1,000 km have no thousands separator ("2494 km").
- The mock's routes cross water in places. That is fake data only.
- The map code is a large download (about 280 KB for the map plus 260 KB for the 3D layer, compressed). It loads only
  when a map screen opens.
- `npm audit` flags a denial-of-service issue in an image parser buried inside the 3D library. The app never
  parses that image type, and the only offered fix is a downgrade that would break things.

**Phase 8 items that already exist:** basic loading, empty and error messages on every screen, automatic reconnect
with back-off, a "reconnecting / offline" note in the header, the README, and time-zone handling through one config
value (with tests across daylight-saving changes).

## 7. What needs to happen next

### A. You (the order matters)

1. **Decide whether to commit** this work to git. Nothing is saved there yet.
2. **Optional, 5 minutes, no Docker:** try the real-server code path on your laptop. In `web/`, run
   `npm run fake-traccar`. In a second terminal run
   `VITE_DATA_SOURCE=traccar VITE_TRACCAR_DEV_URL=http://localhost:8082 npm run dev`.
   Sign in with `demo@example.com` / `demo`.
3. **Pick the address** (a new subdomain, for example `tracker.yourdomain.com`) and create a DNS record pointing to
   the VPS.
4. **Deploy on the VPS** following the root [`README.md`](../README.md) (14-step checklist). Start with
   `sh deploy/check-ports.sh tracker.yourdomain.com`, which tells you whether ports 80 and 443 are free (default
   setup) or taken (use the existing-proxy variant).
5. **Set up Traccar** through the SSH tunnel: create the first (admin) account, turn off registration, add two
   devices named "Car 01" and "Car 02", draw one geofence named exactly `Site`, and create the viewer account
   (read-only) linked to both cars and the zone.
6. **Phone test:** install the Traccar Client app, point it at your server, walk or drive, and watch the Live map.
7. **Report back what happened.** Even a list of error messages is enough. Section 6 lists what is most likely to
   need a fix.
8. **Buy one 4G tracker** (section 5), test it, then decide on more.
9. **Afterwards:** close the phone-test port (5055), turn on the content-security-policy header, set up the nightly
   backup, and keep Traccar updated.

### B. Decisions only you can make

| # | Decision | My suggestion |
|---|---|---|
| 1 | Which tracker model | One 4G Teltonika or Queclink for reliability, or a JM-VL03 for cost. Test one first. |
| 2 | Trips split at stops of 5 min or more | Keep it for the first week. If it is noisy, raise `report.trip.minimalParkingDuration` in `deploy/traccar.xml` (about 15 min), or ask me to merge short away-from-site stops in the app. |
| 3 | How long to keep history | Not needed yet. Decide before the database gets large. |
| 4 | Working-day hours on the dashboard strip | Currently 06:00-18:00 (one setting in `config.ts`). |
| 5 | Whether street addresses should show | Optional later. It means switching on Traccar's address lookup, and the free public service is low-volume only. |
| 6 | Driver names on screen | Hidden unless you add a driver name to the device in Traccar. |

### C. What I will do after the first live run

1. **Fix whatever differs** between the docs and the real server (field names, cookies, websocket, geofence
   formats). This is the main job.
2. **Phase 8, hardening:**
   - a warning banner when no data has arrived for a while (stale data), and clearer states for a lost server;
   - an accessibility pass on every screen and a phone-width check;
   - a decision on the trip-merge rule (decision 2 above);
   - automatic refresh of a trip that is still in progress;
   - clean-ups from section 6: overlapping callouts, thousands separators, the "Start" label overlap.
3. **Possible extras if you want them:** 3D terrain, a highlighted building, a "route still to drive" line, street
   addresses, and a wider side panel so tiles do not wrap.

### D. Explicitly out of scope for now (from the plan)

More than one customer or login, alerts and notifications, speeding rules and driver scoring, and a phone-first
layout. The layout does not break on a phone but is designed for a laptop.

## 8. Open questions from the plan: status

| # | Question | Answer so far |
|---|---|---|
| 1 | Server and domain | Company VPS with Docker, plus a new subdomain. DNS record still to be created. |
| 2 | Real place names | Only the `Site` zone. Everything else shows as "Away from site". |
| 3 | Car and driver names | "Car 01" and "Car 02". Driver names hidden unless set in Traccar. |
| 4 | How long to keep history | Open. |
| 5 | Is the dashboard needed | Built. Keep it. |
| 6 | Working-day hours for the strip | Open (06:00-18:00 for now). |

## 9. Handy commands (run in `web/`)

| Command | What it does |
|---|---|
| `npm install` then `npm run dev` | Run the app with fake data (mock mode) |
| `npm test` | Run all 400 tests |
| `npm run build` | Production build into `web/dist` |
| `npm run lint` | Style and mistake check |
| `npm run fake-traccar` | Local stand-in for a Traccar server (see section 7A, step 2) |

Deployment commands are in the root [`README.md`](../README.md).
