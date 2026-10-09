#!/bin/sh
# check-ports.sh - read-only pre-flight check. Run it BEFORE `docker compose up`.
#
# It changes nothing. It reports:
#   1. what is already listening on the ports this project uses,
#   2. whether to use Mode A (Caddy owns 80/443) or Mode B (existing proxy),
#   3. how to check that your domain points to this server.
#
# Usage:   sh deploy/check-ports.sh [tracker.example.com]
# Tip: run it with sudo to also see the program names (e.g. `sudo sh deploy/check-ports.sh`).
# Uses whichever of ss, lsof or netstat is installed.

DOMAIN="${1:-}"

PORTS="80 443 5055 5023 5027 5004 8080 8082"

# Which tool can list listening TCP sockets?
TOOL=""
if command -v ss >/dev/null 2>&1; then
  TOOL="ss"
elif command -v lsof >/dev/null 2>&1; then
  TOOL="lsof"
elif command -v netstat >/dev/null 2>&1; then
  TOOL="netstat"
fi

# listeners PORT -> prints one line per listening socket on that TCP port (nothing if free).
listeners() {
  port="$1"
  case "$TOOL" in
    ss)
      ss -H -ltnp 2>/dev/null | awk -v p=":$port" '{ n = split($4, a, ":"); if (":" a[n] == p) print "    " $4 "  " $6 }'
      ;;
    lsof)
      lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | awk 'NR > 1 { print "    " $9 "  " $1 " (pid " $2 ")" }'
      ;;
    netstat)
      netstat -ltn 2>/dev/null | awk -v p=":$port" '$1 ~ /^tcp/ { n = split($4, a, ":"); if (":" a[n] == p) print "    " $4 }'
      ;;
  esac
}

echo "Site Car Tracker - port pre-flight check"
echo "========================================"

if [ -z "$TOOL" ]; then
  echo "None of ss, lsof or netstat is installed, so ports cannot be checked."
  echo "Install one (Debian/Ubuntu: sudo apt install iproute2) and run this again."
  exit 2
fi
echo "Using: $TOOL"
if [ "$(id -u)" -ne 0 ]; then
  echo "(Not running as root: program names may be missing. Try: sudo sh $0)"
fi
echo

BUSY_80=0
BUSY_443=0
for port in $PORTS; do
  out="$(listeners "$port")"
  if [ -n "$out" ]; then
    echo "Port $port: IN USE"
    echo "$out"
    [ "$port" = "80" ] && BUSY_80=1
    [ "$port" = "443" ] && BUSY_443=1
  else
    echo "Port $port: free"
  fi
done

echo
echo "Notes on the ports"
echo "  80, 443   web app. Needed by Mode A (Caddy)."
echo "  8080      Mode B: the app listens here on 127.0.0.1 (change APP_PORT in .env if busy)."
echo "  8082      Traccar admin UI, 127.0.0.1 only (needed for the SSH tunnel)."
echo "  5055      phone-app test. 5023 GT06, 5027 Teltonika, 5004 Queclink: open only what you use."
echo "  A port that is 'IN USE' by Docker for an older run of this project is fine; stop it first with"
echo "  'docker compose down'. Any other program on 5055/5023/5027/5004/8082 must be moved or stopped."

echo
echo "Which mode?"
if [ "$BUSY_80" -eq 0 ] && [ "$BUSY_443" -eq 0 ]; then
  echo "  -> MODE A. Ports 80 and 443 are free. Use the default command:"
  echo "       cd deploy && docker compose up -d --build"
else
  echo "  -> MODE B. Something already uses port 80 and/or 443 (see above)."
  echo "     Put the app behind that program. Use:"
  echo "       cd deploy && docker compose -f docker-compose.yml -f docker-compose.existing-proxy.yml up -d --build"
  echo "     Then add the nginx / Traefik / Caddy snippet from the README."
fi

# Docker Compose version (the Mode B override needs 2.24 or newer).
if command -v docker >/dev/null 2>&1; then
  echo
  echo "Docker Compose version (Mode B needs 2.24 or newer):"
  docker compose version 2>&1 | sed 's/^/    /'
else
  echo
  echo "docker command not found in PATH."
fi

echo
echo "Does the domain point to this server?"
echo "  1. Find this server's public IP:   curl -4 -s https://ifconfig.me ; echo"
if [ -n "$DOMAIN" ]; then
  echo "  2. What the domain points to now:"
  if command -v dig >/dev/null 2>&1; then
    echo "       dig +short $DOMAIN"
    dig +short "$DOMAIN" 2>/dev/null | sed 's/^/       -> /'
  fi
  if command -v getent >/dev/null 2>&1; then
    echo "       getent hosts $DOMAIN"
    getent hosts "$DOMAIN" 2>/dev/null | sed 's/^/       -> /'
  fi
else
  echo "  2. What the domain points to:      dig +short tracker.example.com"
  echo "                                     getent hosts tracker.example.com"
  echo "     (or run this script again with your domain: sh $0 tracker.example.com)"
fi
echo "  3. Both IP addresses must be the same. A new DNS record can take minutes to hours to appear."
echo "     Mode A cannot get an HTTPS certificate until they match."
echo
echo "This script changed nothing."
