# Site Car Tracker — build plan

Handover for Claude Code. Read this whole file before writing code.

## 1. Goal

A web app that lets one person on the purchasing team see where two site cars are, live, on a 3D map. They also need to look back at past trips and see simple daily totals.

- **Users:** one viewer, on a laptop browser.
- **Vehicles:** 2 cars, each with a hardware GPS tracker.
- **Area:** a mix of town roads and a remote site with patchy mobile signal.
- **Why 3D:** the owner wants it to look great. Treat the visual design as a real requirement, not a nice-to-have.

## 2. Design reference (source of truth for the UI)

The approved design is a three-screen mockup called **Site Car Tracker**.

- **Live design:** https://claude.ai/artifact/TicP9r1QqMpSVepj5MMmr4 (private to the owner; ask them to share or export it if you cannot open it).
- **Files in this repo:** `design/Main.dc.html` (Live map), `design/History.dc.html` (Route history), `design/Dashboard.dc.html` (Dashboard).

How to use the design files:

- They are design-canvas files, not app code. They will not render on their own. Read them as the exact reference for layout, spacing, colours, copy and states.
- Do **not** copy them into the app as-is. Rebuild each screen as React components.
- The map in the mockup is a hand-drawn SVG illustration. Replace it with a real MapLibre map styled to match (section 6).
- Every number, time, place name and driver name in the mockup is sample data. Never hard-code it.

### 2.1 Design tokens

| Token | Value | Used for |
|---|---|---|
| Page background | `#E6F0FF` | App background |
| Card | `#FFFFFF` | Panels, cards, floating map controls |
| Raised | `#F1F6FF` | Stat tiles inside cards, timeline track |
| Line | `#D5E2F7` | Borders, dividers, chart gridlines |
| Ink | `#0E1320` | Main text, active tab pill, selected buttons |
| Muted | `#5A6B85` | Secondary text, "No signal" marker |
| Blue | `#1D6FE8` | Moving status, trail, primary buttons, Car 01 chart series |
| Deep blue | `#1250BF` | Gradient start on the hero stat card |
| Blue tint | `#E1EDFF` | Moving pill background |
| Light blue | `#A9CBFF` | Car 02 chart series |
| Orange | `#B45F06` | Parked status, stops, site zone outline |
| Orange tint | `#FFF1E0` | Parked pill background |
| Orange light | `#F3C892` | Parked blocks on the timeline |
| Car red | `#E24A2B` | Car 01 icon tile and 3D car body |

- **Fonts:** Montserrat (400, 500, 600, 700) for all text. JetBrains Mono (400, 500) for times, speeds and distances so digits line up.
- **Type sizes:** page title 28px bold; card title 17px bold; big dashboard numbers 34px bold; body 14px; small labels 12px.
- **Corners:** cards and the map 24px; stat tiles 14px; pills and tab bar fully rounded.
- **Controls:** every button and tab is at least 44px tall.
- **Status is never colour alone:** Moving uses a round dot plus the word; Parked uses a square dot plus the word; No signal uses a dashed ring plus the words.

### 2.2 Map style targets

| Element | Value |
|---|---|
| Ground | `#DFE9F8` |
| Roads | `#F7FAFF` |
| Building roofs | `#FFFFFF` / `#F3F7FD` |
| Building walls | `#D6E0F0` and `#BCC9DF` (two shades for depth) |
| Highlighted building | `#9CC4FF` roof, `#5E9BF5` / `#3F7FE0` walls |
| Trail (driven) | Blue `#1D6FE8`, 6px, with a soft wider glow at 25% opacity |
| Trail (not yet driven) | Grey-blue dotted line |
| Site zone | Orange dashed outline with a 6% orange fill |

### 2.3 Screens

**Shared header (all screens)**
- Logo tile, app name, "Purchasing · 2 cars".
- Tab bar: Live map, Route history, Dashboard. The active tab is a dark pill.
- "Live · updated N s ago" chip. This must count up from the last message received.

**Live map (`Main.dc.html`)**
- Left panel: one card per car. Each shows car name, driver name, status pill, and three tiles (Speed or "Parked for", Last seen, Today's distance), then a one-line context ("Town depot to Site · left 13:20" or "Inside Site zone · arrived 13:40").
- Clicking a car card selects it (coloured border) and flies the map to that car.
- Map: tilted 3D view, both cars as 3D models, a numbered pin above each car with a callout (name, status, speed, last seen), today's trail for the selected car, the site zone.
- Moving cars have a pulsing ring on the pin. Respect "reduce motion".
- Floating controls: Legend (top right), 2D/3D toggle (bottom left), "Fit both cars" and zoom (bottom right).

**Route history (`History.dc.html`)**
- Left panel: car switch (Car 01 / Car 02), day picker with previous/next (next is disabled on today), day summary, then a list of trips.
- The selected trip card expands to show stats (distance, driving time, stops) and a timeline of events (left zone, stops, arrived).
- A trip still under way shows "In progress".
- Map: the selected trip's route, a start marker, an end marker, square orange stop markers with their duration, and the car at the playback position.
- Playback bar across the bottom of the map: play/pause, current time, a scrubber with stop ticks, start and end times, and a speed button (1×, 2×, 4×, 8×).

**Dashboard (`Dashboard.dc.html`)**
- Range switch: Today, 7 days, 30 days.
- Four stat cards: Distance (blue gradient hero card), Driving time, Trips, Signal gaps. Each has a per-car breakdown line.
- "Distance per day" grouped bar chart, two series, last 7 days.
- "Today, hour by hour": one strip per car from 06:00 to 18:00 showing Moving, Parked and No signal blocks.
- "Recent trips" table: Car, Route, Time, Distance, Driving, Stops, Notes. It scrolls sideways on narrow screens.

## 3. Scope

**In scope**
- The three screens above, working against live data.
- A mock data mode so the UI can be built and demoed before any tracker is installed.
- Deployment on one small server.

**Out of scope for now**
- Multiple customers or accounts that must not see each other's cars.
- A custom backend API (see section 4).
- Alerts, notifications, speeding rules, driver scoring.
- A phone-first layout. The layout must not break on a phone, but it is designed for a laptop.
- User management beyond one shared login.

## 4. Architecture

```
GPS tracker --(GT06 over mobile data)--> Traccar server --> database
                                              |
                              REST + WebSocket (same domain)
                                              |
                                   React app + MapLibre GL JS
```

- **Traccar** (open source) receives tracker pings, stores them, and serves the API. It already calculates trips, stops and summaries.
- **The browser talks to Traccar directly.** There is no custom backend in this phase.
- **A reverse proxy** (Caddy is the simplest) serves the React app and Traccar's `/api` under one domain. This avoids cookie and WebSocket cross-origin problems.
- **Later:** if this becomes a multi-customer product, add a FastAPI layer between the app and Traccar. Keep all Traccar calls behind one small data module so that swap does not touch the screens.

### 4.1 Tech choices

| Layer | Choice | Note |
|---|---|---|
| App | React + TypeScript + Vite | |
| Map | MapLibre GL JS | Tilt, 3D buildings, terrain |
| 3D cars | deck.gl `ScenegraphLayer` on top of MapLibre | Loads a glTF car model, rotates it to the heading |
| Basemap tiles | OpenFreeMap | Free, no API key. Protomaps self-hosted is the fallback |
| Charts | Plain SVG/CSS or a small chart library | Two charts only, keep it light |
| Tracking server | Traccar | |
| Database | PostgreSQL | For Traccar, not its default file database |
| Proxy | Caddy | Automatic HTTPS |
| Run | Docker Compose | Traccar, Postgres, Caddy, static app |

## 5. Data

### 5.1 Traccar API used

| Need | Call |
|---|---|
| Log in | `POST /api/session` (or a token) |
| List cars | `GET /api/devices` |
| Latest positions | `GET /api/positions` |
| Live updates | WebSocket `/api/socket` — messages carry `positions`, `devices` and `events` arrays |
| Site zone and named places | `GET /api/geofences` |
| A trip's path | `GET /api/reports/route` |
| Trips in a date range | `GET /api/reports/trips` |
| Stops in a date range | `GET /api/reports/stops` |
| Totals in a date range | `GET /api/reports/summary` |

Check the installed Traccar version's API docs before relying on exact field names.

### 5.2 Things that will bite you

- **Speed is in knots.** Multiply by 1.852 for km/h.
- **Distances are in metres, durations in milliseconds.**
- **Times are UTC.** Show everything in the site's local time (Asia/Makassar, UTC+8). Make the time zone a config value.
- **Heading** is `course` in degrees. Use it to rotate the car model.
- **Trackers buffer pings** when they lose signal and send them late. Positions can arrive out of order. Sort by `fixTime`, not arrival time.

### 5.3 Status rules

Keep the thresholds in one config file.

| Status | Rule (starting values) |
|---|---|
| Moving | Last fix is fresh and speed is above 3 km/h (or Traccar's `motion` attribute is true) |
| Parked | Last fix is fresh and the car is not moving |
| No signal | Last fix is older than 5 minutes |

- "Last seen" always shows the age of the last fix and keeps counting. A car with no signal must never look parked.
- "Parked for" is the time since the car last moved.

### 5.4 Derived values

- **Place names** ("Site", "Town depot") come from Traccar geofences. Label a trip by the geofence it started and ended in. If there is none, show "Unknown place".
- **Site zone** on the map is the "Site" geofence shape.
- **Signal gaps:** a gap is any break between two fixes longer than the No signal threshold while the car was on a trip. Show the count and the longest gap.
- **Hour-by-hour strip:** build it from the day's trips, stops and gaps.

## 6. Build phases

Build in this order. Each phase should end in something the owner can open and look at.

**Phase 1 — App shell and design system**
- Set up the project, fonts and design tokens.
- Build the shared header, tab routing, cards, pills, stat tiles and buttons.
- Done when: all three screens exist with the right layout and static sample content, and match the design side by side.

**Phase 2 — Mock data mode**
- One data module with a clear interface (cars, live positions, trips, stops, summaries, geofences).
- A mock implementation: two cars, one driving a looped route, one parked, plus a fake signal gap.
- Switch with an environment variable, e.g. `VITE_DATA_SOURCE=mock`.
- Done when: every screen runs off the mock module with nothing hard-coded in components.

**Phase 3 — Real map**
- MapLibre with a custom light style matching section 2.2.
- 3D buildings (extruded from the basemap's building heights), tilt, 2D/3D toggle, zoom, "Fit both cars".
- Car pins with callouts, trail line, site zone.
- Smooth movement between pings so cars glide instead of jumping.
- Done when: the Live map screen works end to end on mock data.

**Phase 4 — 3D car models**
- Add deck.gl and a glTF car model, rotated to the heading.
- Use a free, properly licensed model. Record the source and licence in the repo.
- Done when: both cars show as 3D models at any zoom and tilt, with a flat marker fallback if the model fails to load.

**Phase 5 — Route history**
- Trip list, trip detail, route on the map, stop markers.
- Playback: play/pause, scrubbing, speed.
- Done when: a full day can be replayed for either car on mock data.

**Phase 6 — Dashboard**
- Stat cards, bar chart, hour-by-hour strip, trips table, range switch.
- Done when: totals on the dashboard agree with the trips shown in Route history for the same day.

**Phase 7 — Traccar connection**
- Real implementation of the data module: login, REST load, WebSocket updates, reconnect with back-off.
- Docker Compose with Traccar, Postgres and Caddy.
- Done when: a real tracker (or Traccar's own test client) moves a car on the Live map.

**Phase 8 — Hardening**
- Loading, empty and error states on every screen ("No trips on this day", "Can't reach the server").
- Reconnect behaviour, stale-data warnings, time zone checks.
- A short README: how to run in mock mode, how to deploy, how to add a tracker.

## 7. Constraints

- **Remote area:** outside town there is little or no 3D building data. The map must still look good there. Turn on 3D terrain if a free elevation source is available; otherwise fall back to a clean tilted map.
- **Patchy signal:** design for late and missing pings from day one (sections 5.2 and 5.3).
- **Cost:** two cars, one viewer. Use free and open-source parts. No paid map API keys.
- **Secrets:** no passwords, tokens or server addresses in the repo. Use environment files and commit an example file only.
- **People's names:** do not put real staff or driver names in code, tests, sample data or commits. Use "Car 01", "Car 02" and placeholder driver names.
- **Accessibility:** real buttons and links, visible focus, readable contrast, status never shown by colour alone.

## 8. Assumptions (confirm with the owner)

1. The trackers speak the GT06 protocol and can be pointed at our own server.
2. Traccar will be self-hosted on a server the owner controls.
3. The browser talks to Traccar directly, with no custom backend yet.
4. One shared login is enough for now.
5. The drivers know the cars are tracked.
6. This is a new repo. If an earlier prototype exists (FastAPI, React, Leaflet), reuse what fits, but the map must be MapLibre because Leaflet cannot tilt or show 3D.

## 9. Open questions for the owner

1. Which server will host this, and is there a domain name for it?
2. What are the real place names and boundaries (the site, the town depot, regular suppliers)?
3. What should the cars be called on screen, and should driver names show at all?
4. How long should trip history be kept?
5. Is the dashboard needed for this one viewer, or is it mainly a showcase? If it is a showcase, build it last.
6. Should the working day on the hour-by-hour strip be 06:00 to 18:00, or something else?

## 10. Working rules for Claude Code

- Start with Phases 1 and 2. Do not touch Traccar until the UI works on mock data.
- Match the design files closely. If something in the design cannot be built as drawn, say so and propose the nearest option before changing it.
- Keep all data access behind the one data module.
- Ask before adding any paid service or any dependency that needs an API key.
- After each phase, stop and show the owner the result before moving on.
