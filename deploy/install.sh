#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# VM Installer – fully OFFLINE setup.
#
#   sudo bash install.sh [--port 8088] [--bind 0.0.0.0]
#
# Turns a blank Ubuntu (22.04 / 24.04, x86-64) machine with NO internet into a running installer:
#   1. checks the bundle's own checksums, the CPU, systemd and free disk space
#   2. installs Docker Engine + the Compose plugin from files bundled here (docker-offline/),
#      including iptables if the machine lacks it. Skipped when Docker already works.
#   3. loads the installer image (image.tar.gz) and starts it (restart: unless-stopped)
#   4. prints the URL and the access token
#
# Nothing is downloaded. Safe to re-run: the token, uploaded bundles and history are kept.
# ─────────────────────────────────────────────────────────────────────────────
set -Eeuo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE=/opt/intellivision-installer
CNAME=intellivision-installer
PORT=""
BIND=""

c_ok=$'\033[32m'; c_warn=$'\033[33m'; c_err=$'\033[31m'; c_dim=$'\033[2m'; c_off=$'\033[0m'
say()  { printf '%s\n' "$*"; }
step() { printf '\n%s==>%s %s\n' "$c_ok" "$c_off" "$*"; }
ok()   { printf '   %s✔%s %s\n' "$c_ok" "$c_off" "$*"; }
warn() { printf '%sWARN:%s %s\n' "$c_warn" "$c_off" "$*"; }
die()  { printf '%sERROR:%s %s\n' "$c_err" "$c_off" "$*" >&2; exit 1; }
trap 'die "failed at line $LINENO"' ERR

while [ $# -gt 0 ]; do
  case "$1" in
    --port) PORT="${2:-}"; shift 2 ;;
    --bind) BIND="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,14p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) die "unknown option: $1" ;;
  esac
done

[ "$(id -u)" -eq 0 ] || die "run as root:  sudo bash install.sh"
[ -f "$HERE/docker-compose.yml" ] || die "docker-compose.yml is missing next to install.sh"
VERSION="$(cat "$HERE/VERSION" 2>/dev/null || echo 1.0.0)"

# ---------------------------------------------------------------- 1. Preflight
step "Checking this machine"
[ "$(uname -s)" = Linux ] || die "Linux only"
case "$(uname -m)" in
  x86_64|amd64) ok "CPU x86-64" ;;
  *) die "this bundle is built for x86-64; this machine is $(uname -m)" ;;
esac
[ -d /run/systemd/system ] || die "systemd is required (it runs the Docker service)"
ok "systemd present"
# read in a subshell: os-release defines VERSION, ID ... which must not leak into this script
OS_NAME="$( . /etc/os-release 2>/dev/null && printf %s "${PRETTY_NAME:-Linux}" )"
ok "${OS_NAME:-Linux}"

# Disk: image ~0.4 GB loaded + Docker itself. Bundles you deploy later need their own space.
FREE_KB="$(df -Pk /opt 2>/dev/null | awk 'NR==2{print $4}')"
if [ -n "${FREE_KB:-}" ] && [ "$FREE_KB" -lt 3145728 ]; then die "less than 3 GB free on /opt (have $((FREE_KB / 1024)) MB)"; fi
ok "free disk $(( ${FREE_KB:-0} / 1048576 )) GB on /opt"

if [ -f "$HERE/SHA256SUMS" ]; then
  (cd "$HERE" && sha256sum -c SHA256SUMS --quiet) || die "checksum mismatch: this installer bundle is corrupted or incomplete. Copy it to the VM again."
  ok "bundle checksums verified"
else
  warn "no SHA256SUMS in the bundle, integrity not checked"
fi

# ---------------------------------------------------------------- 2. Docker (offline)
step "Docker Engine and Compose"
docker_ok() { command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; }
if docker_ok && docker compose version >/dev/null 2>&1; then
  ok "already installed: $(docker --version | sed 's/Docker version //;s/,.*//'), compose $(docker compose version --short)"
else
  [ -f "$HERE/scripts/install-docker-offline.sh" ] && [ -d "$HERE/docker-offline" ] \
    || die "Docker is missing and this bundle has no docker-offline/ files. Re-create the bundle with scripts/build-bundle.sh."
  bash "$HERE/scripts/install-docker-offline.sh"
fi
docker_ok || die "Docker is installed but its daemon is not running (journalctl -u docker -n 50)"
DC="docker compose"
$DC version >/dev/null 2>&1 || die "Docker Compose plugin is not working"

# ---------------------------------------------------------------- 3. Layout and config
step "Preparing $BASE"
mkdir -p "$BASE"/{packages,work,logs,data}
# Let the person who ran sudo copy bundles here with plain scp/WinSCP (no root needed for uploads).
if [ -n "${SUDO_USER:-}" ] && [ "$SUDO_USER" != root ]; then chown "$SUDO_USER" "$BASE/packages"; fi
chmod 755 "$BASE"
install -m 0644 "$HERE/docker-compose.yml" "$BASE/docker-compose.yml"
install -m 0755 "$HERE/installer-ctl" /usr/local/bin/installer-ctl
echo "$VERSION" > "$BASE/VERSION"

ENVF="$BASE/.env"
get() { grep -E "^$1=" "$ENVF" 2>/dev/null | head -n1 | cut -d= -f2- || true; }
TOKEN="$(get INSTALLER_TOKEN)"
[ -n "$TOKEN" ] || TOKEN="$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"
PORT="${PORT:-$(get INSTALLER_PORT)}"; PORT="${PORT:-8088}"
BIND="${BIND:-$(get INSTALLER_BIND)}"; BIND="${BIND:-0.0.0.0}"
[[ "$PORT" =~ ^[0-9]+$ ]] && [ "$PORT" -ge 1 ] && [ "$PORT" -le 65535 ] || die "invalid port: $PORT"
if { ss -ltn 2>/dev/null || true; } | awk '{print $4}' | grep -qE "[:.]${PORT}\$" && ! docker ps --format '{{.Names}}' | grep -qx "$CNAME"; then
  die "port $PORT is already in use. Pick another:  sudo bash install.sh --port 8090"
fi
(umask 077; cat > "$ENVF" <<EOF
INSTALLER_VERSION=$VERSION
INSTALLER_PORT=$PORT
INSTALLER_BIND=$BIND
INSTALLER_TOKEN=$TOKEN
EOF
)
chmod 600 "$ENVF"
ok "configuration written"

# ---------------------------------------------------------------- 4. Image
step "Loading the installer image"
[ -f "$HERE/image.tar.gz" ] || die "image.tar.gz is missing from the bundle"
docker load -i "$HERE/image.tar.gz" | sed 's/^/   /'
docker image inspect "intellivision-installer:$VERSION" >/dev/null 2>&1 || die "image intellivision-installer:$VERSION was not in image.tar.gz"

# ---------------------------------------------------------------- 5. Start
step "Starting"
cd "$BASE"
$DC up -d --force-recreate --remove-orphans --pull never

printf 'Waiting for the installer to become healthy'
healthy=0
for _ in $(seq 1 60); do
  st="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$CNAME" 2>/dev/null || true)"
  if [ "$st" = healthy ]; then healthy=1; break; fi
  printf '.'; sleep 2
done
echo
[ "$healthy" -eq 1 ] || { docker logs --tail 40 "$CNAME" 2>&1 || true; die "the installer did not become healthy"; }
ok "running"

if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
  ufw allow "$PORT/tcp" >/dev/null && ok "ufw: opened $PORT/tcp"
fi

IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
IP="${IP:-<vm-ip>}"
cat <<EOF

${c_ok}Installer is running.${c_off}

  URL      http://$IP:$PORT
  Token    $TOKEN
  Packages $BASE/packages   ${c_dim}(upload bundles from the Upload tab, or copy them here)${c_off}

  Manage:  sudo installer-ctl status | logs | restart | token | uninstall

EOF
