# Site Car Tracker: project status and next steps

*First written 9 Oct 2026, updated 10 Oct 2026 after the first live deployment. Covers Phases 1 to 7 of
[`Claude Plan/PLAN.md`](../Claude%20Plan/PLAN.md). Real domain names, addresses and people's names are left out on
purpose: this repository may be public.*

## 1. Where we are, in one paragraph

The whole app is built and tested in **mock mode** (fake cars on a laptop): the live 3D map, route history with
playback, and the dashboard. Since 10 Oct it is also **running on the company VPS** (Docker stack behind the existing
nginx and Cloudflare), and a **fake car driven into the real Traccar server shows up and moves on the live map**. So
the full chain works: tracker port, Traccar, database, login, live updates, 3D map. Not yet seen on real data: Route
history and the Dashboard, the read-only viewer account, the Traccar Client phone app, and a real tracker.

**The next step is to finish the live checks** (section 7): run the road-following fake car and look at Route history
and the Dashboard, create the viewer account, then do the phone test.

## 2. Status by phase

| Phase | What | State |
|---|---|---|
| 1 | App shell and design system | Done |
| 2 | Mock data mode | Done |
| 3 | Real 3D map (MapLibre) | Done |
| 4 | 3D car models | Done |
| 5 | Route history with playback | Done in mock mode. Not yet seen on live data. |
| 6 | Dashboard | Done in mock mode. Not yet seen on live data. |
| 7 | Traccar connection and Docker | **Deployed and working** (live map, login, live updates). Phone app and real tracker still to test. |
| 8 | Hardening | Partly present (see section 6). Best done now that real behaviour is visible. |

Git: the first full commit (`c972826`) is on `main` and pushed. Newer work (`web/dev/simulate-car.mjs`, the
`simulate-car` script in `web/package.json`, and these docs) is **not committed yet**.

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
                   /api (REST) + /api/socket (live)      same domain, via the proxies below
                              |
                       React app (web/)
                              |
   screens  ->  hooks (data/hooks.ts)  ->  ONE data interface (data/source.ts)
                                              |-- mock source   (fake cars, default)
                                              |-- Traccar source (real server)
```

Screens never talk to Traccar directly. Everything goes through one small data interface, so the mock and the
Traccar source are interchangeable (`VITE_DATA_SOURCE=mock` or `traccar`). Traccar is the whole backend: there is no
custom server code. This is also the place where a later backend could be slotted in.

### How it is deployed (Mode B, verified 10 Oct)

```
 browser --> Cloudflare (proxied, SSL "Full (strict)")
         --> host nginx on the VPS (its own file conf.d/tracker.conf, Cloudflare Origin CA wildcard certificate)
         --> Docker "web" container (Caddy) on 127.0.0.1:8081
         --> Traccar container (read-only /api for the public, admin only via SSH tunnel)

 phone app / tracker --> VPS public IP, port 5055 (and later the tracker's own port), straight to Traccar.
                         The Cloudflare proxy only carries web traffic, so these must NOT use the proxied name.
```

The VPS is shared with other apps, so Mode B was needed: nginx already owns ports 80 and 443, and port 8080 was taken
by another container (hence `APP_PORT=8081`). The compose project is named `site-car-tracker`, so its containers
and volumes do not clash with the other apps. The tracker's nginx file is separate from the others, so it can be
removed on its own (`rm conf.d/tracker.conf && nginx -t && systemctl reload nginx`).

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
| `data/traccar/fake/` and `web/dev/` | A local fake Traccar server (`fake-traccar.mjs`) and a **car simulator** (`simulate-car.mjs`, see below) |
| `styles/`, `config.ts` | Design tokens and the thresholds (5 min no-signal, 3 km/h moving, 06:00-18:00 strip) |
| `public/models/` | The two 3D car models (CC0, Kenney Car Kit) with their licence |

Repo root: `deploy/` (Docker Compose, Caddy, Traccar config, backup and port-check scripts), `README.md` (how to run
and deploy), `docs/` (this file), `Claude Plan/` (the original plan and the design mockups).

### The car simulator (`web/dev/simulate-car.mjs`)

Sends fake positions to a real Traccar the way a phone or tracker would (OsmAnd protocol, port 5055), so the whole
chain can be tested before any tracker is bought. It asks the free public OSRM routing service for a real driving route
from a start point to a turning point and back, fills the last hour (park, drive out, park, drive back, park, so 2
trips) and then keeps driving live. Run from `web/`: `npm run simulate-car -- --host <server> --id <identifier>`.
Options are listed at the top of the script. The device must exist in Traccar with exactly that identifier, or Traccar
answers 400 and ignores it. It is a dev tool: it has no automated tests, only a dry run (`--dry-run`).

### Size and quality

- About 7,100 lines of app code in 77 files, and 4,800 lines of tests in 31 files (counted 10 Oct, excluding tests).
- **400 tests pass.** Type check, production build and lint are clean (lint shows 3 harmless warnings in
  `DataProvider.tsx`). The test run prints repeated "HTMLCanvasElement getContext not implemented" lines; they are
  harmless (the test environment has no canvas).
- Before deployment the real browser (Chrome with software 3D) was used to check the Live map, replay, dashboard,
  login, wrong password, expired session and a dead server, against a local fake server.
- The Caddy proxy config was validated with the real Caddy program, and now also runs for real inside the deployed
  stack.

## 4. Decisions made along the way

| Topic | Decision |
|---|---|
| Places | The owner only draws **one** geofence, named `Site`. Everywhere else reads "Away from site". Titles look like "Site → away". An address is shown when Traccar supplies one. |
| Trips | The real app uses **Traccar's own definition**: a trip is a drive between parked periods of 5 minutes or more. Short pauses inside a trip are worked out from the route (only for ranges of 2 days or less). |
| Login | One shared Traccar viewer account (a normal Traccar account, no separate user store). The password is typed in, kept only in the session cookie, never stored or put in a build. |
| Public API | Through the public address, `/api` is **read-only** (plus login/logout). All changes go through an SSH tunnel to Traccar's admin screen. This also stops a stranger registering as admin first. |
| Hosting | **Mode B**: the VPS already runs other apps behind nginx and Cloudflare, so this app sits behind that nginx (own config file) on `127.0.0.1:8081`, using the existing Cloudflare Origin CA wildcard certificate. The DNS record is **proxied** (orange cloud), like the other apps. |
| Tracker traffic | Goes to the VPS IP address and port directly, never through the Cloudflare-proxied name. |
| Drivers | The driver line is hidden unless Traccar has a driver name for the car. No names appear anywhere in code. |
| Map data | OpenFreeMap tiles, no API key and no paid service. 3D terrain was **not** added (flat coastal area, little gain). |
| 3D cars | Kenney's free low-poly sedan (Car 01) and SUV (Car 02). If the 3D layer or a model fails, a flat coloured dot is shown. |
| Library versions | MapLibre is pinned to 5.x, because deck.gl 9.4 does not work with MapLibre 6. |
| Tracker protocol | The plan assumed GT06. The app does not care: Traccar decodes many protocols and only the published server port changes. |
| Test data | A simulator drives a fake car along real roads (free OSRM routing service, no key). Use a throw-away device, and delete it afterwards. |

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

## 6. What the first live run showed, and known rough edges

### Verified live (10 Oct 2026)

- The Docker stack starts in Mode B: database, Traccar (6.16.0) and web are all healthy, and Traccar's 35 database
  migrations ran cleanly.
- The nginx file passes `nginx -t`, reloads without affecting the other sites on the server, and the public address
  serves the app over HTTPS through Cloudflare. `/api/server` answers through the read-only proxy.
- The first-account registration flow in Traccar's admin screen (through the SSH tunnel) works.
- Login from the app works, and the header's "updated N s ago" counter runs.
- A fake car sent to port 5055 appears on the Live map: 3D car, numbered pin, callout, trail, last-seen counter.
  So positions travel the whole way: tracker port, Traccar, REST and websocket through Cloudflare and nginx, the app.
- The app's knots to km/h conversion is correct.

### Found during the run

- **Traccar's OsmAnd port takes `speed` in knots**, not km/h. The simulator first sent km/h and the app showed 74 km/h
  for 40. The simulator now converts. Real trackers are decoded by Traccar, so this affects only hand-made requests.
- **Port 5055 timed out from outside** although Traccar answered on the server and no firewall was active on the
  server itself. It became reachable after the firewall in the VPS provider's control panel was opened. On this
  provider, check the panel's firewall as well as the server.
- **Mistyped identifiers are rejected silently** (HTTP 400, "Unknown device" in the Traccar log). A trailing full stop
  copied from a chat message was the cause both times.
- **Empty state:** a signed-in account with no linked cars shows "0 cars" and an empty left panel, with no message. A
  viewer who is missing the device links would not know why. Needs a clear message.
- **Trail hidden by buildings:** in the tilted 3D view, today's trail breaks into blocks where it passes behind tall
  buildings. It should be drawn above the buildings (or lifted slightly).
- **The repository was public** when last checked, although it was created as private. It contains no secrets, no
  real addresses and no names, but decide whether it should stay public.
- A stray copy of the repository (`spy_car/` inside the repo folder) was found on the laptop. It is an accidental
  nested clone and should be deleted, not committed.

### Not verified yet

- **Route history and Dashboard on live data.** The most likely place for trip, stop and field-name surprises.
- Whether the Traccar admin "Registration" box was switched off (the README step 4 must be done and checked).
- The read-only **viewer** account: it does not exist yet. So far the app was used with the admin account.
- The `Site` geofence on a live server (geofence text formats written by Traccar's own screen).
- The Traccar Client phone app, and whether an iPhone accepts a plain `http://` server address.
- Websocket stability over a long time through Cloudflare. Cloudflare may drop idle connections, and the app is
  designed to reconnect, but this has not been watched for hours.
- The content-security-policy header is in **report-only** mode until it has been watched in a real browser.
- The Queclink port comment in `docker-compose.yml` should be checked against Traccar's protocol port list.
- Backups and a test restore.

### Behaviour you will notice

- **Trips split at every stop of 5 minutes or more.** A drive with an 8-minute stop at a shop shows as two trips, so
  trip counts will be higher than in the mockups. See decision 2 in section 7.
- Over ranges longer than 2 days, "Stops" shows a dash and driving time includes short pauses.
- A trip that crosses midnight counts on both days.
- A route for a trip still in progress is a snapshot taken when you select it (it does not keep growing).
- The mock's second car sits near the first, so the two callouts overlap on the Live map. The "Start" label can
  cover "SITE ZONE" when a trip starts inside the zone.
- Distances over 1,000 km have no thousands separator ("2494 km").
- The mock's routes cross water in places. That is fake data only. (The simulator uses real roads.)
- Real GPS wanders by a few metres, so a real trail looks rougher than the simulator's clean line.
- The map code is a large download (about 280 KB for the map plus 260 KB for the 3D layer, compressed). It loads only
  when a map screen opens.
- `npm audit` flags a denial-of-service issue in an image parser buried inside the 3D library. The app never
  parses that image type, and the only offered fix is a downgrade that would break things.

**Phase 8 items that already exist:** basic loading, empty and error messages on every screen, automatic reconnect
with back-off, a "reconnecting / offline" note in the header, the README, and time-zone handling through one config
value (with tests across daylight-saving changes).

## 7. What needs to happen next

### A. You (the order matters)

1. **Tidy the repo:** delete the stray `spy_car/` folder inside the project folder, decide whether the GitHub repo
   should be private, then commit the simulator and these docs.
2. **Run the road-following simulator** (needs the SSH tunnel and a test device, see section 3) and look at Live map,
   **Route history** and **Dashboard** on live data. Send screenshots or error text. This is where most surprises are
   expected.
3. **Create the read-only viewer** in Traccar (Readonly ticked, linked to the cars and the `Site` zone), check
   Registration is switched off, and use the viewer, not the admin, in the app from now on.
4. **Draw the `Site` geofence** around the real site and add the real device names.
5. **Phone test:** Traccar Client app, server `http://<VPS IP>:5055` (the IP, not the proxied name), walk or drive,
   watch the Live map. Report whether an iPhone accepts the plain `http://` address.
6. **Buy one 4G tracker** (section 5), test it, then decide on more.
7. **Afterwards:** close the phone-test port (5055: `OSMAND_BIND=127.0.0.1` and the provider firewall), delete the test
   device, turn on the content-security-policy header, set up the nightly backup, and keep Traccar updated.

### B. Decisions only you can make

| # | Decision | My suggestion |
|---|---|---|
| 1 | Which tracker model | One 4G Teltonika or Queclink for reliability, or a JM-VL03 for cost. Test one first. |
| 2 | Trips split at stops of 5 min or more | Keep it for the first week. If it is noisy, raise `report.trip.minimalParkingDuration` in `deploy/traccar.xml` (about 15 min), or ask me to merge short away-from-site stops in the app. |
| 3 | How long to keep history | Not needed yet. Decide before the database gets large. |
| 4 | Working-day hours on the dashboard strip | Currently 06:00-18:00 (one setting in `config.ts`). |
| 5 | Whether street addresses should show | Optional later. It means switching on Traccar's address lookup, and the free public service is low-volume only. |
| 6 | Driver names on screen | Hidden unless you add a driver name to the device in Traccar. |
| 7 | Public or private repository | Private. It describes the server setup. |
| 8 | The planned move from host nginx to Caddy | The stack only listens on `127.0.0.1:8081`, so it works behind any proxy. Add a `reverse_proxy 127.0.0.1:8081` block for the tracker name, with the same certificate. |

### C. What I will do next

1. **Fix whatever differs** between the docs and the real server once Route history and the Dashboard have been seen on
   live data (field names, geofence formats, in-progress trips).
2. **Phase 8, hardening:**
   - draw the trail above the 3D buildings;
   - a clear message when the account has no cars, and when no data has arrived for a while (stale data), plus clearer
     states for a lost server;
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
| 1 | Server and domain | Company VPS with Docker, a new subdomain behind Cloudflare. Done and live. |
| 2 | Real place names | Only the `Site` zone. Everything else shows as "Away from site". The zone still has to be drawn on the live server. |
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
| `npm run fake-traccar` | Local stand-in for a Traccar server |
| `npm run simulate-car -- --host <server> --id <identifier>` | Drive a fake car along real roads into a real Traccar (needs port 5055 open and a device with that identifier) |

Deployment commands are in the root [`README.md`](../README.md).
