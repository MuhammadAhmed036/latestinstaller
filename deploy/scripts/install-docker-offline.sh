#!/bin/bash
# ==============================================================================
# Install Docker Engine + the compose plugin from files BUNDLED in the offline
# package (docker-offline/). No internet needed.
#
#   sudo bash scripts/install-docker-offline.sh
#
# deploy.sh calls this automatically when Docker is missing. It:
#   1. does nothing if Docker (and `docker compose`) already work
#   2. installs the bundled `iptables` .deb packages if iptables is missing
#      (Debian/Ubuntu only; other distros normally have it already)
#   3. installs Docker from the official STATIC binaries (works on any x86_64
#      Linux with systemd - no package manager or distro version involved)
#   4. installs the compose plugin, writes the systemd units, and starts Docker
#
# It never touches an existing Docker installation.
# ==============================================================================

set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
ok()   { printf "${GREEN}[OK]${NC} %s\n" "$*"; }
warn() { printf "${YELLOW}[!]${NC} %s\n" "$*"; }
info() { printf "${BLUE}[..]${NC} %s\n" "$*"; }
err()  { printf "${RED}[X]${NC} %s\n" "$*" >&2; exit 1; }

cd "$(dirname "${BASH_SOURCE[0]}")/.."
SRC="docker-offline"

docker_ok()  { command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; }
compose_ok() { docker compose version >/dev/null 2>&1; }

kv() { grep -E "^$1=" "$SRC/MANIFEST" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '[:space:]' || true; }

# ---------- what is already there ----------
if docker_ok && compose_ok; then
    ok "Docker and the compose plugin are already installed - nothing to do."
    exit 0
fi

[ "$(id -u)" -eq 0 ] || err "Installing Docker needs root. Run: sudo bash $0"
[ -d "$SRC" ] || err "The bundled Docker files ($SRC/) are missing from this package."

# ---------- preflight ----------
[ "$(uname -s)" = "Linux" ] || err "Only Linux is supported."
BUNDLE_ARCH=$(kv ARCH); HOST_ARCH=$(uname -m)
[ -z "$BUNDLE_ARCH" ] || [ "$BUNDLE_ARCH" = "$HOST_ARCH" ] || err "The bundled Docker is for ${BUNDLE_ARCH}, this machine is ${HOST_ARCH}."
[ -d /run/systemd/system ] || err "systemd is required (it runs the Docker service). On WSL enable it: /etc/wsl.conf -> [boot] systemd=true, then 'wsl --shutdown'."

if [ -f "$SRC/SHA256SUMS" ]; then
    info "Verifying bundled Docker files ..."
    (cd "$SRC" && sha256sum -c SHA256SUMS --quiet) || err "Checksum mismatch in $SRC/ - the package is corrupted or incomplete."
    ok "Checksums OK."
fi

# ---------- iptables (Docker needs it for container networking) ----------
if ! command -v iptables >/dev/null 2>&1; then
    . /etc/os-release 2>/dev/null || true
    DEBDIR="$SRC/iptables-debs/${ID:-unknown}-${VERSION_ID:-unknown}"
    if [ -d "$DEBDIR" ] && command -v dpkg >/dev/null 2>&1; then
        info "iptables is missing - installing it from the bundle (${ID} ${VERSION_ID}) ..."
        TODO=()
        for deb in "$DEBDIR"/*.deb; do
            pkg=$(dpkg-deb -f "$deb" Package); arch=$(dpkg-deb -f "$deb" Architecture)
            # install only what is missing: never downgrade or replace a package that is already there
            if ! dpkg-query -W -f='${Status}' "$pkg${arch:+:$arch}" 2>/dev/null | grep -q "install ok installed"; then
                TODO+=("$deb")
            fi
        done
        if [ "${#TODO[@]}" -gt 0 ]; then
            DEBIAN_FRONTEND=noninteractive dpkg -i "${TODO[@]}" >/dev/null || err "dpkg failed while installing iptables."
        fi
        command -v iptables >/dev/null 2>&1 || err "iptables is still missing after installing the bundled packages."
        ok "iptables installed."
    else
        err "iptables is not installed and this package has no iptables files for '${ID:-unknown} ${VERSION_ID:-unknown}'. Install iptables with your package manager (or from your offline repository) and re-run."
    fi
fi

# ---------- Docker Engine (static binaries) ----------
if ! docker_ok; then
    if command -v docker >/dev/null 2>&1 || command -v dockerd >/dev/null 2>&1; then
        warn "A Docker installation exists but the daemon is not usable - it is left untouched. Start it (systemctl start docker) and re-run."
        exit 1
    fi
    TGZ=$(ls "$SRC"/docker-*.tgz 2>/dev/null | head -1)
    [ -n "$TGZ" ] || err "$SRC/ has no docker-*.tgz."
    info "Installing Docker Engine from $(basename "$TGZ") ..."
    TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
    tar xzf "$TGZ" -C "$TMP"
    for f in containerd containerd-shim-runc-v2 ctr docker dockerd docker-init docker-proxy runc; do
        [ -f "$TMP/docker/$f" ] || err "$f is missing from $(basename "$TGZ")."
        install -m 0755 "$TMP/docker/$f" "/usr/local/bin/$f"
    done
    getent group docker >/dev/null 2>&1 || groupadd --system docker

    cat > /etc/systemd/system/containerd.service <<'EOF'
[Unit]
Description=containerd container runtime
Documentation=https://containerd.io
After=network.target local-fs.target

[Service]
ExecStartPre=-/sbin/modprobe overlay
ExecStart=/usr/local/bin/containerd
Type=notify
Delegate=yes
KillMode=process
Restart=always
RestartSec=5
LimitNPROC=infinity
LimitCORE=infinity
LimitNOFILE=infinity
TasksMax=infinity
OOMScoreAdjust=-999

[Install]
WantedBy=multi-user.target
EOF
    cat > /etc/systemd/system/docker.socket <<'EOF'
[Unit]
Description=Docker Socket for the API

[Socket]
ListenStream=/run/docker.sock
SocketMode=0660
SocketUser=root
SocketGroup=docker

[Install]
WantedBy=sockets.target
EOF
    cat > /etc/systemd/system/docker.service <<'EOF'
[Unit]
Description=Docker Application Container Engine
Documentation=https://docs.docker.com
After=network-online.target containerd.service docker.socket firewalld.service
Wants=network-online.target
Requires=docker.socket containerd.service

[Service]
Type=notify
ExecStart=/usr/local/bin/dockerd -H fd:// --containerd=/run/containerd/containerd.sock
ExecReload=/bin/kill -s HUP $MAINPID
TimeoutStartSec=0
RestartSec=2
Restart=always
StartLimitBurst=3
StartLimitInterval=60s
LimitNPROC=infinity
LimitCORE=infinity
TasksMax=infinity
Delegate=yes
KillMode=process
OOMScoreAdjust=-500

[Install]
WantedBy=multi-user.target
EOF
    systemctl daemon-reload
    ok "Docker binaries and systemd units installed."
fi

# ---------- compose plugin ----------
if ! compose_ok || ! command -v docker >/dev/null 2>&1; then
    [ -f "$SRC/docker-compose" ] || err "$SRC/docker-compose is missing."
    mkdir -p /usr/local/lib/docker/cli-plugins
    install -m 0755 "$SRC/docker-compose" /usr/local/lib/docker/cli-plugins/docker-compose
    ok "Compose plugin installed."
fi

# ---------- start ----------
if ! docker_ok; then
    info "Starting Docker ..."
    systemctl enable --now containerd.service docker.socket docker.service >/dev/null 2>&1 || systemctl start containerd docker || true
    for _ in $(seq 1 30); do docker_ok && break; sleep 1; done
fi
docker_ok || err "Docker was installed but the daemon did not start. Check: journalctl -u docker -n 50"
compose_ok || err "The compose plugin was installed but 'docker compose' does not work."

ok "Docker $(docker version --format '{{.Server.Version}}' 2>/dev/null) and $(docker compose version --short 2>/dev/null | sed 's/^/compose /') are ready (start on boot: enabled)."
if [ -n "${SUDO_USER:-}" ] && [ "$SUDO_USER" != "root" ]; then
    warn "To use docker without sudo, add yourself to the docker group:  usermod -aG docker ${SUDO_USER}   (then log in again)"
fi
