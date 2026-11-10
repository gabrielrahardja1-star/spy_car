# Connecting a device to Traccar

*Written 9 Nov 2026 from the code in `web/src/data/trackers.ts`, `web/src/screens/Manage/`, `deploy/` and
`web/dev/simulate-car.mjs`. Server addresses are placeholders: `VPS-IP` is the server's public IP address.*

Traccar accepts a position only when two things are right:

1. **The identifier.** Every message carries a device ID: the IMEI for a GPS tracker, or a free-text ID for the phone
   app and the simulator. Traccar must already have a device with exactly that ID, or it drops the message
   ("Unknown device" in its log, HTTP 400 on the OsmAnd port). There is no password or pairing.
2. **The port.** Each tracker family speaks its own protocol on its own port. The device must send to the port of
   its protocol, and that port must be open on the server.

## 1. Device endpoints (where devices send to)

Devices connect to the **VPS IP address**, never to the tracker web domain: that name is proxied by Cloudflare, which
only carries web traffic.

| Device | Protocol | Endpoint | Open with (`deploy/.env`) | Default |
|---|---|---|---|---|
| Traccar Client phone app | `osmand` | `http://VPS-IP:5055` | `OSMAND_BIND=0.0.0.0` | open |
| Simulator (`simulate-car.mjs`) | `osmand` | `http://VPS-IP:5055` | `OSMAND_BIND=0.0.0.0` | open |
| Teltonika FMB / FMC / FMM | `teltonika` | `VPS-IP:5027` TCP | `TELTONIKA_BIND=0.0.0.0` | closed |
| Concox / Jimi / other GT06 | `gt06` | `VPS-IP:5023` TCP | `GT06_BIND=0.0.0.0` | closed |
| Queclink GL / GV | `gl200` | `VPS-IP:5004` TCP | `QUECLINK_BIND=0.0.0.0` | closed |

- All four protocols are enabled in `deploy/traccar.xml` (`protocols.enable`). A model not in this table needs its
  protocol added there and its port added to `traccar` > `ports:` in `deploy/docker-compose.yml`. Look the model up
  on https://www.traccar.org/devices/ first.
- After changing a `_BIND` value: `cd deploy && docker compose up -d`.
- Also open the port in the **VPS provider's control-panel firewall** (and `ufw` if used). On this provider, port 5055
  timed out until the panel firewall was opened.
- Some trackers use UDP. Add the matching `/udp` port line in `docker-compose.yml` (an example is commented there).
- The simulator's Docker services (`sim-dt01`, `sim-dt02`) send to `traccar:5055` inside Docker, so they work with
  5055 closed.

### The OsmAnd request (phone app and simulator)

One HTTP request per position, query string only:

```
POST http://VPS-IP:5055/?id=sim-dt-03&timestamp=1762650000&lat=-3.172511&lon=115.281808&speed=12.4&bearing=270&altitude=10&hdop=1
```

| Field | Meaning |
|---|---|
| `id` | The device identifier (must match the device in Traccar exactly) |
| `timestamp` | Fix time, Unix seconds, UTC |
| `lat`, `lon` | Decimal degrees |
| `speed` | **Knots**, not km/h (km/h / 1.852) |
| `bearing` | Heading in degrees, 0 = north |
| `altitude`, `hdop` | Optional |

Answers: `200` = stored, `400` = unknown device (check the ID, including a trailing full stop from a copy-paste).
Quick test with no device at all: `curl -X POST "http://VPS-IP:5055/?id=TEST&lat=0&lon=0"` should answer `400`,
which proves the port is reachable.

## 2. App endpoints (how the app registers devices)

The app has no backend of its own; the browser calls Traccar's REST API through Caddy on the same domain.
`deploy/caddy/Caddyfile` makes the public `/api` read-only except for the calls below.

| Action in the app | Traccar call |
|---|---|
| Sign in / out | `POST` / `DELETE /api/session` |
| List trucks | `GET /api/devices` |
| Add truck | `POST /api/devices`, then `POST /api/permissions` `{userId, deviceId}` for every other user |
| Edit truck | `PUT /api/devices/{id}` |
| Disable / enable | `PUT /api/devices/{id}` with `disabled` |
| Delete truck (and all its positions) | `DELETE /api/devices/{id}` |
| Locations (start, end, checkpoint) | `POST` / `PUT` / `DELETE /api/geofences[/{id}]`, shared the same way |
| Latest positions / live | `GET /api/positions`, WebSocket `/api/socket` |

What the app writes on a device:

| Traccar field | Value |
|---|---|
| `name` | Truck name, e.g. `DT-03` |
| `uniqueId` | IMEI, phone-app identifier, or `sim-<name>` for the simulator |
| `model` | Tracker model key (`teltonika`, `gt06`, `queclink`); real trackers only |
| `phone` | SIM number; real trackers only, optional |
| `category` | `truck` |
| `attributes.source` | `simulator`, `phone` or `tracker` |
| `attributes.driver` | Driver name, optional |

Only a signed-in admin who is **not** marked Readonly can make these changes (Traccar enforces it). Read-only users
get `403`.

## 3. Requirements checklist

**Server (once)**
- [ ] Stack running (`docker compose ps`: `db`, `traccar`, `web` healthy).
- [ ] `VITE_TRACKER_SERVER=VPS-IP` in `deploy/.env`, rebuilt, so the Setup panel shows the real address.
- [ ] Port for the device's protocol open: `_BIND=0.0.0.0`, `docker compose up -d`, provider firewall.
- [ ] Check from outside: `nc -vz VPS-IP <port>` says "succeeded".

**Per device**
- [ ] Added in the app: Manage > Trucks > Add truck, with the right source and ID.
- [ ] Device pointed at `VPS-IP` and the port from the table.
- [ ] Phone app: Server URL `http://VPS-IP:5055`, identifier as registered, location "always", battery saving off.
- [ ] Real tracker: **4G (LTE)** model, SIM with mobile data and the right **APN**, server and port set (usually by
      SMS command; the text is in the tracker's manual). Test the SIM's coverage at the pit first.
- [ ] Truck shows on the Live map within a minute. If not: `docker compose logs --tail 100 traccar`
      ("Unknown device" = ID mismatch; nothing at all = port, `_BIND` or firewall).

## 4. UI to-do list

Gaps found while reading the Manage screens. Highest value first.

- [ ] **Connection status in the truck list.** `TruckPanel.tsx` shows name, source and ID but not whether the device
      has ever reported. Traccar already returns `status` (`online` / `offline` / `unknown`) and `lastUpdate` on each
      device; show "Never connected", "Online" or "Last seen 3 h ago" per row. This is the first thing anyone setting up
      a tracker needs to see.
- [ ] **"Waiting for first position" in the Setup panel.** After saving a new truck, keep the Setup steps open and
      flip to "Connected" when the first position arrives over the WebSocket, with the common causes listed if nothing
      comes within a few minutes (wrong ID, port closed, APN).
- [ ] **Show the port's open/closed state.** The Setup panel always says "set `TELTONIKA_BIND=0.0.0.0`". The app
      can't see `.env`, so either add the open ports as a build value (e.g. `VITE_OPEN_TRACKER_PORTS`) or word it as
      "Make sure..." and link to the README.
- [ ] **Other tracker models.** The model list has only Teltonika, GT06 and Queclink; anything else lands on "not set
      up on the server yet". Add an "Other" option with free-text protocol and port so the record is still useful, and
      add models as they are bought.
- [ ] **Example SMS commands per model.** For the models in `TRACKER_MODELS`, show the vendor's usual server/APN SMS
      format as a starting point (marked "check your manual"), filled in with the server and port.
- [ ] **Unknown-device hint.** Traccar can report unknown IDs that tried to connect (with `logger` / an "unknown
      device" event). A small list of "IDs that tried to connect but are not registered" would make typos obvious.
      Needs a check of what Traccar 6.16 exposes before building.
- [ ] **Simulator command uses fixed CWP coordinates.** `TruckSetup.tsx` hard-codes the CWP to Area 2 points. Build the
      command from the saved start and end locations instead (pick one in a dropdown).
- [ ] **Phone frequency.** The Setup panel says 10 s; the README says 30 s. Pick one (10 s gives smoother trails, 30 s
      saves battery and data) and use it in both.
- [ ] **Copy buttons** next to the server, port, ID and simulator command, to stop the trailing-full-stop typos.
- [ ] **Docs follow-up.** The README's "Test with the Traccar Client phone app" and "Adding a real tracker" sections
      still say to edit `Car 01` in Traccar's admin screen. Point them at Manage > Trucks instead.
