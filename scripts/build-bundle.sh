#!/usr/bin/env bash
# Builds the offline installer bundle:  dist/vm-installer_<version>_offline_<date>.tar (+ .sha256)
# Needs Docker on the build machine only. The target VM needs no internet and no Docker: the bundle carries Docker Engine, Compose and iptables.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="$(grep -m1 '"version"' "$ROOT/web/package.json" | cut -d'"' -f4)"
STAMP="$(date +%Y%m%d)"
NAME="vm-installer_${VERSION}_offline_${STAMP}"
OUT="$ROOT/dist"
STAGE="$OUT/$NAME"

rm -rf "$STAGE"; mkdir -p "$STAGE"

echo "==> Building image (linux/amd64)"
docker build --platform linux/amd64 -t "intellivision-installer:$VERSION" --build-arg "INSTALLER_VERSION=$VERSION" "$ROOT/web"

echo "==> Saving image"
docker save "intellivision-installer:$VERSION" | gzip -9 > "$STAGE/image.tar.gz"

cp "$ROOT/deploy/install.sh" "$ROOT/deploy/installer-ctl" "$ROOT/deploy/docker-compose.yml" "$STAGE/"
echo "$VERSION" > "$STAGE/VERSION"
cp "$ROOT/README.md" "$STAGE/README.md"
cp "$ROOT/docs/INSTALLATION-GUIDE.md" "$STAGE/INSTALLATION-GUIDE.md"

# Everything a blank offline Ubuntu VM needs: Docker Engine, Compose plugin and iptables (22.04 / 24.04)
[ -d "$ROOT/vendor/docker-offline" ] || { echo "vendor/docker-offline is missing" >&2; exit 1; }
cp -r "$ROOT/vendor/docker-offline" "$STAGE/docker-offline"
mkdir -p "$STAGE/scripts"
cp "$ROOT/deploy/scripts/install-docker-offline.sh" "$STAGE/scripts/"
sed -i 's/$//' "$STAGE/scripts/install-docker-offline.sh"
sed -i 's/\r$//' "$STAGE/install.sh" "$STAGE/installer-ctl" "$STAGE/docker-compose.yml" "$STAGE/VERSION"
chmod +x "$STAGE/install.sh" "$STAGE/installer-ctl" "$STAGE/scripts/install-docker-offline.sh"

echo "==> Checksums"
( cd "$STAGE" && find . -type f ! -name SHA256SUMS | sort | xargs sha256sum > SHA256SUMS )

echo "==> Packing"
tar -C "$OUT" -cf "$OUT/$NAME.tar" "$NAME"
( cd "$OUT" && sha256sum "$NAME.tar" > "$NAME.tar.sha256" )
cp "$ROOT/docs/INSTALLATION-GUIDE.md" "$OUT/INSTALLATION-GUIDE.md"
rm -rf "$STAGE"

echo
ls -lh "$OUT/$NAME.tar" "$OUT/$NAME.tar.sha256" "$OUT/INSTALLATION-GUIDE.md"
echo
echo "On the VM:"
echo "  sha256sum -c $NAME.tar.sha256 && tar -xf $NAME.tar && cd $NAME && sudo bash install.sh"
