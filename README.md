# Site Car Tracker

A web app that shows where two site cars are, live, on a 3D map. It also shows past trips and simple daily totals.
One person (the purchasing team's viewer) uses it on a laptop browser.
GPS trackers in the cars report to a Traccar server (open source), and this app reads from that server.

The full plan and the approved design are in [`Claude Plan/`](Claude%20Plan/PLAN.md).

> **Honest status (10 Oct 2026).** The app is tested in mock mode on a laptop, and the server setup in `deploy/`
> **has now run on a real VPS** (Mode B, behind an existing nginx and Cloudflare). A fake car sent to the server
> appears and moves on the live map. Not yet seen on live data: Route history, the Dashboard, the read-only viewer
> account, the phone app and a real tracker. See [`docs/STATUS.md`](docs/STATUS.md) for the details and
> ["First things to check"](#first-things-to-check-on-the-first-real-run) for what is ticked off.

---

## Contents

1. [Quick start in mock mode](#quick-start-in-mock-mode)
2. [Project layout](#project-layout)
3. [Deploy on the company VPS](#deploy-on-the-company-vps)
4. [Test with a fake car (no phone, no tracker)](#test-with-a-fake-car-no-phone-no-tracker)
5. [Test with the Traccar Client phone app](#test-with-the-traccar-client-phone-app)
6. [Adding a real tracker](#adding-a-real-tracker)
7. [Updating](#updating)
8. [Backups and restore](#backups-and-restore)
9. [Firewall](#firewall)
10. [Troubleshooting](#troubleshooting)
11. [Security notes](#security-notes)
12. [Open items](#open-items)

---

## Quick start in mock mode

Mock mode uses made-up cars and trips. No server and no tracker are needed.
You need Node.js 22 (or 20.19+) and npm.

```sh
cd web
cp .env.example .env        # contains VITE_DATA_SOURCE=mock
npm install
npm run dev                 # open the address it prints, usually http://localhost:5173
```

Other commands (run them inside `web/`):

| Command | What it does |
|---|---|
| `npm test` | Runs the automated tests once. |
| `npm run lint` | Checks the code style (oxlint). |
| `npm run build` | Type-checks and builds the app into `web/dist/`. |
| `npm run preview` | Serves the built app locally. |

`VITE_DATA_SOURCE` can be `mock` (made-up data) or `traccar` (real server, needs a login).
`VITE_TIMEZONE` sets the time zone used to show times (default `Asia/Makassar`, UTC+8).
Traccar itself always stores UTC.

## Project layout

```
.
├── README.md              this file
├── Claude Plan/           the build plan and the three design mockups
├── web/                   the React + Vite app
│   ├── src/               app code (screens, map, data modules for mock and Traccar)
│   ├── dev/               local fake Traccar server and the car simulator
│   ├── public/models/     the 3D car models (CC0, see the README inside)
│   └── Dockerfile         builds the app and packages it with Caddy
└── deploy/                everything for the server
    ├── docker-compose.yml                 PostgreSQL + Traccar + Caddy/app (Mode A, default)
    ├── docker-compose.existing-proxy.yml  override for Mode B (another proxy owns 80/443)
    ├── caddy/Caddyfile                    web server rules (app, /api proxy, headers, cache)
    ├── traccar.xml                        Traccar settings (no secrets)
    ├── .env.example                       settings and passwords template (copy to .env)
    ├── check-ports.sh                     read-only pre-flight check
    └── backup.sh                          database backup
```

---

## Deploy on the company VPS

### What you need

- The company VPS with **Docker and Docker Compose v2** installed. Check: `docker compose version`
  (it should print a version; Mode B needs 2.24 or newer).
- A **domain** you control, to create a new sub-domain such as `tracker.example.com`
  (use your real domain; `example.com` is only a placeholder everywhere in this repo).
- A shell on the VPS (SSH) with a user that may run `docker`.
- About 2 GB RAM free is comfortable. Traccar is limited to 512 MB of Java memory.

### Step 1. DNS record

At the company's DNS provider, add an **A record**:

| Name | Type | Value |
|---|---|---|
| `tracker` | A | the VPS public IP address |

Find the VPS address with `curl -4 -s https://ifconfig.me`. A new record can take minutes to hours to show up.

### Step 2. Get the code

```sh
git clone <the address of this repository> spy_car
cd spy_car
```

### Step 3. Check the ports

```sh
sh deploy/check-ports.sh tracker.example.com
```

(Use `sudo sh ...` to also see program names.) The script changes nothing. It tells you:

- which of the ports 80, 443, 5055, 5023, 5027, 5004, 8080 and 8082 are already used,
- **which mode to use**,
- how to check that the domain points to this server (`dig +short tracker.example.com` or `getent hosts tracker.example.com`; the answer must be the VPS address).

**Which mode?**

| Mode | When | Who handles HTTPS |
|---|---|---|
| **A** (default) | Ports 80 and 443 are free. | Caddy in this project gets a free Let's Encrypt certificate by itself. |
| **B** | Another web server (nginx, Traefik, Apache, another Caddy...) already uses 80 or 443. | Your existing proxy. This project only listens on `127.0.0.1:8080`. |

Port 80 must be free for Mode A even if you only want HTTPS: Let's Encrypt uses it to check that you own the domain.

### Step 4. Fill in the settings

```sh
cd deploy
cp .env.example .env
chmod 600 .env
openssl rand -hex 24          # prints a random password; copy it
nano .env                     # or any editor
```

Edit these lines in `.env`:

| Setting | What to put |
|---|---|
| `SITE_ADDRESS` | Mode A: your sub-domain, e.g. `tracker.example.com`. For a first test with no domain: `:80`. |
| `POSTGRES_PASSWORD` | The random password you generated (letters and digits only). Set it **before the first start**. |
| `OSMAND_BIND` | Keep `0.0.0.0` for the phone-app test. Tracker ports are explained below. |
| `VITE_TIMEZONE`, `VITE_SITE_GEOFENCE_NAME` | Keep `Asia/Makassar` and `Site` unless told otherwise. |

Never commit `.env` (git already ignores it). Keep a copy in the company password manager.

### Step 5. Start everything

Mode A (default):

```sh
docker compose up -d --build
```

Mode B (another proxy owns 80/443):

```sh
docker compose -f docker-compose.yml -f docker-compose.existing-proxy.yml up -d --build
```

For Mode B, also put the proxy snippet from [Mode B proxy snippets](#mode-b-proxy-snippets) in front of it.

The first build takes a few minutes (it downloads images and builds the app). Then check:

```sh
docker compose ps             # db, traccar and web should be "running" (healthy after a few minutes)
docker compose logs -f traccar   # Ctrl+C to leave; look for lines about ports being opened, and no errors
```

Traccar needs a minute or two on its first start to create its database tables.
To use the same mode on later commands, add the same `-f` options each time (or put
`COMPOSE_FILE=docker-compose.yml:docker-compose.existing-proxy.yml` in `.env`).

### First run (create the accounts)

The admin screen of Traccar is deliberately **not** on the internet. You reach it through an SSH tunnel
(an encrypted "pipe" from your laptop to the server).

1. **On your laptop**, open a terminal and run (replace the user and address):

   ```sh
   ssh -L 8082:localhost:8082 user@tracker.example.com
   ```

   Keep this window open. If port 8082 is already used on your laptop, use `-L 9082:localhost:8082` and open port 9082 below.

2. In your laptop's browser open **http://localhost:8082**.

3. **Create the admin account.** Click *Register*. The first account ever created automatically becomes the administrator
   (this is how Traccar works). Use a real email address as the login name and a long, unique password. Store it in the password manager.

4. **Close public registration.** Click the settings (gear) icon, open **Server**, find the **Registration** checkbox
   (it may be inside a *Permissions* section), **untick it** and save. Then log out. The *Register* link should be gone.
   *Why:* once the admin exists, anyone who could open the register page could otherwise create an account.
   (Extra protection already in place: the public domain refuses every change except login and logout, and the admin screen is not public.)

5. **Add the two cars.** Log in again as admin. *Settings > Devices > +*.

   | Name | Identifier |
   |---|---|
   | `Car 01` | the phone-app ID (for the test) or the tracker's **IMEI** (printed on the tracker; 15 digits) |
   | `Car 02` | same, for the second car |

   The identifier must match exactly what the device sends, or Traccar ignores its messages.

6. **Draw ONE geofence named exactly `Site`.** Open *Geofences* (map menu or *Settings > Geofences*), add an area
   (polygon or circle) around the work site, and name it **`Site`** (capital S, nothing else).
   *Why:* the app draws the orange "Site zone" from the geofence with this name, and it names trips ("Town to Site")
   from the geofences they start and end in. If the name differs, the zone does not show.
   (The name is a setting: `VITE_SITE_GEOFENCE_NAME`. A rebuild is needed to change it.)

7. **Create the shared viewer account.** *Settings > Users > +*. Use a placeholder email such as `viewer@example.com`
   (or a real shared mailbox), a long unique password, and tick **Readonly**.
   A read-only user can look at everything assigned to it but cannot add, change or delete anything.
   Leave *Administrator* and *Disable reports* unticked (the app needs reports for the history and dashboard screens). Save.

8. **Give the viewer access.** Traccar shows a user only what is linked to that user. In *Settings > Users*, open the viewer's
   **Connections** (link) option and tick:
   - **Devices:** `Car 01`, `Car 02`
   - **Geofences:** `Site`

   Without these links the viewer logs in but sees no cars and no site zone.

9. **Log into the app.** Open `https://tracker.example.com` (Mode A) and sign in with the **viewer** account.
   Do not use the admin account in the app. You can now close the SSH tunnel.

### Mode B proxy snippets

In Mode B the app listens on `http://127.0.0.1:8080` (change with `APP_PORT` in `.env`). Your existing proxy does HTTPS and forwards
**everything** for the sub-domain there, including `/api/socket`, which is a long-lived WebSocket connection.
The WebSocket needs the `Upgrade` headers and a long read timeout, or the live map drops every minute.
Only web traffic goes through the proxy. Tracker traffic (ports 5055 and so on) goes straight to the containers.

**nginx**

```nginx
# in the http { } block (once, if not already there)
map $http_upgrade $connection_upgrade { default upgrade; '' close; }

server {
    listen 443 ssl;
    server_name tracker.example.com;
    ssl_certificate     /etc/letsencrypt/live/tracker.example.com/fullchain.pem;   # your certificate
    ssl_certificate_key /etc/letsencrypt/live/tracker.example.com/privkey.pem;
    add_header Strict-Transport-Security "max-age=2592000" always;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # live updates (WebSocket)
    location /api/socket {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 3600s;    # nginx default is 60s and would cut the live connection
        proxy_send_timeout 3600s;
    }
}
server { listen 80; server_name tracker.example.com; return 301 https://$host$request_uri; }
```

**Another Caddy on the host** (add to its Caddyfile; it handles WebSockets by itself):

```
tracker.example.com {
	reverse_proxy 127.0.0.1:8080
}
```

**Traefik** (it runs in Docker, so it cannot reach `127.0.0.1` of the host; attach the `web` container to Traefik's network instead).
Adapt the network, entrypoint and resolver names to your Traefik setup. This is an untested sketch. Save as `deploy/docker-compose.traefik.yml`
and add `-f docker-compose.traefik.yml` to the Mode B command:

```yaml
services:
  web:
    networks: [default, traefik]
    labels:
      - traefik.enable=true
      - traefik.docker.network=traefik
      - traefik.http.routers.cartracker.rule=Host(`tracker.example.com`)
      - traefik.http.routers.cartracker.entrypoints=websecure
      - traefik.http.routers.cartracker.tls.certresolver=letsencrypt
      - traefik.http.services.cartracker.loadbalancer.server.port=80
networks:
  traefik:
    external: true
```

Traefik proxies WebSockets without extra settings.

**Cloudflare in front of nginx** (what the first real deployment uses, verified 10 Oct 2026)

- Put the nginx server block in its **own file** (for example `/etc/nginx/conf.d/tracker.conf`) so it can be added or removed
  without touching other sites. Use the nginx snippet above, with `proxy_pass http://127.0.0.1:8081` if you set `APP_PORT=8081`.
  Always run `nginx -t` before `systemctl reload nginx`. A broken file in `conf.d` can stop nginx from starting at all.
- If the other sites already use a Cloudflare Origin CA certificate for `*.yourdomain`, reuse it. It is only trusted by Cloudflare,
  so the DNS record must be **proxied** (orange cloud) and Cloudflare's SSL mode must be **Full (strict)**.
- The proxied name carries web traffic only. **Trackers and the phone app must connect to the server's IP address and port**
  (or to a second, DNS-only name), never to the proxied name.
- Test the nginx block on the server before DNS exists:
  `curl -sk --resolve tracker.example.com:443:127.0.0.1 https://tracker.example.com/api/server` (run it **on the server**; `-k` is needed because the origin certificate is only trusted by Cloudflare).
- Do not paste long multi-line commands (heredocs) into an SSH terminal: a split paste once wrote a half-finished config file.
  Copy the file with `scp` instead.

---

## Test with a fake car (no phone, no tracker)

`web/dev/simulate-car.mjs` sends made-up positions to Traccar the way a tracker would (OsmAnd protocol, port 5055). The car
follows **real roads**: the script asks the free public OSRM routing service for a driving route from a start point to a
turning point and back. It first fills the last hour (park, drive out, park, drive back, park, so Route history has two trips),
then keeps driving live until you press Ctrl+C. The computer running it needs internet access.

1. In the Traccar admin screen (SSH tunnel), add a throw-away device: name `Test Car`, **Identifier** `sim-3` (any value, but it must match exactly).
   Link it to the account you sign in with (Settings > Users > Connections).
2. From your own computer, in `web/`:

   ```sh
   npm run simulate-car -- --host tracker-server-ip --id sim-3
   ```

   Useful options: `--lat` / `--lon` (start point; default central Jakarta), `--to-lat` / `--to-lon` (turning point),
   `--kmh` (default 40), `--no-live`, `--no-history`, `--dry-run` (print the requests, send nothing). The list is at the top of the script.
3. Open the app and check Live map, Route history (today) and Dashboard.
4. Afterwards, delete the `Test Car` device in the admin screen.

Notes:
- Port 5055 must be reachable from your computer: `nc -vz tracker-server-ip 5055` should say "succeeded". A **time-out** with Traccar
  running fine on the server usually means a firewall in the VPS provider's control panel.
- `Server answered 400` means Traccar does not know that identifier ("Unknown device" in `docker compose logs traccar`). Check the spelling.
  Copying a command with a trailing full stop (`sim-3.`) has caused this.
- The OsmAnd port takes `speed` in **knots** (the script converts from km/h). Real trackers are decoded by Traccar and are not affected.
- Real GPS wanders by a few metres; the simulator's trail is a perfect line on the road.
- Only send to your own server. The data is made up.

---

## Test with the Traccar Client phone app

This proves the whole chain before any tracker is bought.

1. Install **Traccar Client** (free, Android or iPhone, from the app store).
2. In the Traccar admin screen (SSH tunnel), edit `Car 01` and set its **Identifier** to the ID the app shows on its main screen.
3. In the app settings:

   | Setting | Value |
   |---|---|
   | Server URL | `http://tracker.example.com:5055` (a **full** URL with `http://` and port 5055, not only the host name). If the name is proxied through Cloudflare, use the server's **IP address** instead, e.g. `http://203.0.113.10:5055`. |
   | Device identifier | the ID shown in the app (must equal the Identifier in step 2) |
   | Frequency / interval | 30 seconds is good for a test (the app's own wording varies by version) |
   | Accuracy | highest (keeps GPS on) |

   Then switch the tracking service **on** in the app (the main on/off switch).
4. Allow the location permission (choose "always" / "all the time" and exempt the app from battery saving, or tracking stops when the screen is off).
5. Walk or drive outside (indoors there is no GPS fix). Open the app in a browser, sign in with the viewer account, open **Live map**.
   The car should appear within a minute and move when you move.

Port 5055 must be reachable from the internet: `OSMAND_BIND=0.0.0.0` (the default) and, if you use a firewall, `sudo ufw allow 5055/tcp`.
Port 5055 is plain HTTP (not encrypted). That is acceptable for a short test. Close it afterwards (`OSMAND_BIND=127.0.0.1`).
I have not verified whether the iPhone version accepts a plain-`http` address; if the phone refuses it, add a small HTTPS front for port 5055
(a second sub-domain, for example `osmand.example.com { reverse_proxy traccar:5055 }` in `deploy/caddy/Caddyfile`, then use `https://osmand.example.com` in the app). This is untested.

Official reference for the app settings: https://www.traccar.org/client-configuration/

## Adding a real tracker

Traccar understands hundreds of tracker models. Only the **port** differs between them.
Choose the port that matches the tracker's protocol, open it, and point the tracker at it.

| Tracker family | Traccar protocol | Port | Setting in `deploy/.env` |
|---|---|---|---|
| Traccar Client phone app | `osmand` | 5055 | `OSMAND_BIND` |
| GT06 family (many cheap 4G car trackers) | `gt06` | 5023 | `GT06_BIND` |
| Teltonika (FMB/FMC...) | `teltonika` | 5027 | `TELTONIKA_BIND` |
| Queclink GL/GV series | `gl200` | 5004 | `QUECLINK_BIND` |

Steps:

1. Check your exact model on https://www.traccar.org/devices/ . Note the protocol name and port Traccar lists. If it is not one of the four above,
   add the protocol name to `protocols.enable` in `deploy/traccar.xml`, and add its port to the `ports:` list of `traccar` in `deploy/docker-compose.yml`.
2. In `deploy/.env`, set the matching `..._BIND=0.0.0.0` (it is `127.0.0.1` = closed by default). Apply it with `docker compose up -d` (run it in `deploy/`).
   Open the same port in the firewall (see [Firewall](#firewall)).
3. In Traccar, set `Car 01`'s **Identifier** to the tracker's **IMEI**.
4. Configure the tracker to send to **`tracker.example.com`** (or the VPS IP), the port from the table, with the **mobile data APN of its SIM card**.
   How depends on the vendor: usually an SMS command or a vendor app/PC tool. Look in the tracker's manual for "server", "IP", "port" and "APN"
   commands. This repository cannot give the exact text for every model.
5. Some trackers need UDP instead of TCP. If yours says UDP, add the matching `/udp` line next to its port in `docker-compose.yml` (an example is in the file).

Notes for Indonesia: buy a **4G (LTE)** tracker. Older 2G-only trackers stop working where 2G networks are being shut down.
Check which mobile carrier covers the town **and** the remote site, and test the SIM in a phone at the site before buying a data plan.
Trackers buffer positions when there is no signal and send them later; the app sorts them by time.

---

## Updating

App or deployment changes:

```sh
cd spy_car
git pull
cd deploy
docker compose up -d --build        # add the same -f options as at the start if you use Mode B
```

New Traccar release: change `TRACCAR_TAG` in `deploy/.env` (check https://www.traccar.org/docker/ for the current tag), then:

```sh
cd deploy
docker compose pull
docker compose up -d
docker compose logs --tail 50 traccar
```

Take a [backup](#backups-and-restore) first. Traccar migrates its database on start and cannot go back to an older version afterwards.
Docker images for Postgres and Caddy follow their pinned tags (`postgres:17-alpine`, `caddy:2-alpine`); a PostgreSQL major upgrade (17 to 18) needs a dump and restore.

## Backups and restore

Make a backup (the database is the only thing you cannot rebuild):

```sh
sh deploy/backup.sh
ls -lh deploy/backups
```

It writes `deploy/backups/traccar-<date>.sql.gz` and deletes dumps older than 14 days (`KEEP_DAYS=30 sh deploy/backup.sh` to change).
Suggested cron line (run `crontab -e` and add; the path is an example):

```
30 2 * * * /bin/sh /home/you/spy_car/deploy/backup.sh >> /home/you/spy_car/deploy/backups/backup.log 2>&1
```

Copy the files to **another machine** regularly. A backup on the same disk does not survive a dead disk.

**Restore** (this replaces the current data):

```sh
cd deploy
docker compose stop traccar web
docker compose exec -T db psql -U traccar -d postgres -c "DROP DATABASE traccar;" -c "CREATE DATABASE traccar OWNER traccar;"
gunzip -c backups/traccar-2026-01-01_023000.sql.gz | docker compose exec -T db psql -U traccar -d traccar
docker compose start traccar web
```

(Use the real file name.) On a brand-new server: do Steps 1 to 5 first, then stop `traccar` and run the last three commands above.

## Firewall

Only open what you use. Example with `ufw` (Ubuntu):

```sh
sudo ufw allow 22/tcp          # SSH: do this FIRST or you lock yourself out
sudo ufw allow 80/tcp          # web (Mode A) and the certificate check
sudo ufw allow 443/tcp
sudo ufw allow 443/udp         # HTTP/3 (optional)
sudo ufw allow 5055/tcp        # ONLY while testing with the phone app
# sudo ufw allow 5023/tcp      # ONLY the one tracker port you use (GT06)
# sudo ufw allow 5027/tcp      # (Teltonika)
sudo ufw enable
sudo ufw status
```

Never open 8082 (the admin screen) or 5432 (the database). They are not published to the internet anyway.

**Important:** Docker adds its own firewall rules that go around `ufw`. A published port is open even if `ufw` says it is not.
That is why this project uses the `..._BIND` settings in `.env` (`127.0.0.1` = closed). Treat them as the real switch and `ufw` as a second layer.
(In Mode B, ports 80/443 belong to your other proxy; its own rules apply.)

Tracker protocols are **not encrypted**. Anyone on the network path could read the positions. Do not reuse passwords anywhere in a tracker's settings, and keep Traccar updated.

## Troubleshooting

**No cars appear / the car never moves**
1. In the admin screen (SSH tunnel), open *Devices*. Does the car show *online* or a recent "last update"? If not, no data is arriving.
2. `cd deploy && docker compose logs --tail 100 traccar`. A line mentioning an *unknown device* with an ID means the Identifier in Traccar does not match; fix it.
3. Is the port reachable from outside? From another computer: `nc -vz tracker.example.com 5055` (use the tracker's port). "Connection refused" or a time-out means the `..._BIND` value, the firewall, or the VPS provider's network rules (some providers have a separate firewall in their control panel) block it.
4. Is the protocol enabled? `protocols.enable` in `deploy/traccar.xml` must list it. After editing: `docker compose restart traccar`.
5. Viewer sees nothing but admin does: the devices and the `Site` geofence are not linked to the viewer (First run, step 8).
6. Temporarily set `logger.level` to `all` in `traccar.xml`, restart, and watch `docker compose logs -f traccar` while the tracker connects. Set it back afterwards (it is very noisy).

**The app asks for the login again and again (login loop)**
- Open the browser's developer tools (F12), tab *Network*, and look at `POST /api/session`. `401` = wrong email or password. `403` = a proxy rule blocks it. No response = the proxy does not forward `/api`.
- Check you are using the **viewer** account and that the browser accepts cookies for the domain.
- Mode B: make sure the proxy forwards `/api` and sends `X-Forwarded-Proto` (see the snippets).

**Live data does not update / "Can't reach the server" (WebSocket)**
- In F12 > Network > *WS* there should be a connection to `/api/socket` that stays open.
- Behind your own proxy: the `Upgrade` and `Connection` headers must be passed and the read timeout must be long (nginx: `proxy_read_timeout 3600s`). See the snippets.
- A corporate proxy or some VPNs block WebSockets. Try from a phone on mobile data.

**HTTPS certificate does not arrive (Mode A)**
- `docker compose logs web`. Usual causes: the DNS record does not point here yet, port 80 or 443 is blocked by the firewall or the provider, or another program uses port 80.
- Test with `SITE_ADDRESS=:80` first (plain HTTP), then switch back to the domain.

**Times look wrong, trips are on the wrong day**
- Traccar stores UTC; the app shows `VITE_TIMEZONE` (Asia/Makassar). If the whole day is shifted, check that value and rebuild (`docker compose up -d --build`).
- If positions have a time that is several hours off, the tracker may send local time instead of UTC. Fix with `decoder.timezone` in `traccar.xml` (see the Traccar docs).

**The map is blank (cars and panels are fine)**
- The tiles come from `tiles.openfreemap.org`. Open it in the browser; if it is blocked by a company filter, allow it. Check F12 > Console for errors.
- Fonts come from Google Fonts; if they are blocked, the app falls back to system fonts.

**Traccar says "password authentication failed for user traccar"**
- The database was created with a different `POSTGRES_PASSWORD`. Changing `.env` later does not change an existing database. Either put the old password back,
  or run `docker compose exec db psql -U traccar -d traccar -c "ALTER USER traccar PASSWORD 'the-new-password';"`.
  (`docker compose down -v` also fixes it but **deletes all data**.)

**Out of memory / Traccar restarts**: `docker compose logs traccar` shows `OutOfMemoryError`. Raise `JAVA_OPTS` (for example `-Xmx768m`) and `TRACCAR_MEM_LIMIT` (`1280m`) in `.env`.

**Disk is filling up**: `df -h` and `docker system df`. Position history grows forever (see Open items).

## Security notes

- The Traccar **admin screen is not public**: it is bound to `127.0.0.1:8082`. Use the SSH tunnel. If you decide to publish it, see the commented block at the end of `deploy/caddy/Caddyfile`, and use a very strong password.
- The public address is **read-only** apart from login/logout (`deploy/caddy/Caddyfile` blocks other changes to `/api`). This also prevents strangers from registering the first admin account.
- The viewer account is **Readonly**. Use a long, unique password. Changing the viewer's password: admin screen > Users.
- The database is not reachable from outside Docker. Passwords live only in `deploy/.env` (not in git; `chmod 600`).
- Tracker connections are plain text and unauthenticated by nature. Anyone who guesses an IMEI could send fake positions for that device. This is a limit of the tracker protocols; do not rely on the data for anything safety-critical.
- Security headers are set (nosniff, referrer policy, frame denial, HSTS when on HTTPS). A **Content Security Policy** is sent in *report-only* mode: it cannot break the app, but it is not enforcing yet. See Open items.
- Keep the server updated (`sudo apt update && sudo apt upgrade`), keep Traccar updated, and test restores occasionally.
- Telling the drivers that the cars are tracked is an assumption in the plan; confirm it.

## Open items

- **History retention.** Nothing is deleted. I found no automatic purge setting in Traccar's configuration page, so the length of history to keep is undecided.
  Decide how long (the owner's question 4 in the plan). With two cars the data is small for a long time; check disk use every few months.
- **Working-day strip.** The hour-by-hour strip uses 06:00 to 18:00 (`workdayStartHour`/`workdayEndHour` in `web/src/config.ts`). Confirm with the owner; changing it needs a rebuild.
- **Alerts and notifications** (speeding, leaving the site, no signal) are out of scope for now. Traccar has a notification system that could be used later.
- **Content Security Policy.** Open each screen with the browser console open (F12). If there are no "Content Security Policy" messages, rename `Content-Security-Policy-Report-Only` to `Content-Security-Policy` in `deploy/caddy/Caddyfile` and restart `web`.
- **Phone-app over HTTPS** (see above) and whether the phone-app port should stay open: close it once a real tracker works.
- **Reverse geocoding** (street addresses) is off. Place names come from geofences. The public Nominatim service is for low volume only.

## First things to check on the first real run

In this order. Done = checked on the first real deployment (10 Oct 2026, Mode B).

1. [done] `docker compose config` (in `deploy/`) prints the settings without errors. If it complains about a missing variable, fill it in `.env`.
2. [done] `docker compose up -d --build`: the web image builds (the `npm run build` step is the longest; about a minute on the VPS).
3. [done] `docker compose ps`: `db` healthy, `traccar` healthy (about a minute), `web` healthy.
4. [done] `docker compose logs traccar`: database migrations ran, no database errors, the web server started on 8082.
5. [done] The admin screen loads through the SSH tunnel and the first-registration flow works. **Still to confirm:** the *Registration* box is switched off afterwards.
6. [done] `https://tracker.example.com` shows the login screen over HTTPS (through Cloudflare). **Still to check:** `/history` reloads without a 404.
7. [partly] Login and live updates work (checked with the admin account; "updated N s ago" counts). **Still to do:** the read-only viewer account, and watching F12 > Network > WS to see that `/api/socket` stays open for a long time.
8. [partly] A fake car (see [Test with a fake car](#test-with-a-fake-car-no-phone-no-tracker)) moves on the Live map. **Still to do:** Route history and Dashboard on live data, and the phone-app test with `Car 01`.
9. Browser console shows no Content Security Policy reports (then enforce it).
10. `sh deploy/backup.sh` creates a file, and a test restore works on a spare machine.
