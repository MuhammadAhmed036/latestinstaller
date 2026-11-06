# VM Installer

Web installer (Next.js + Tailwind, Docker) for Ubuntu VMs. It finds release bundles on the VM, verifies their SHA-256, extracts them and runs their `install.sh` / `deploy.sh`, with live logs.

## 1. Build the installer bundle (on your PC, needs Docker and internet once)

```bash
bash scripts/build-bundle.sh
```

Produces `dist/vm-installer_<version>_offline_<date>.tar` (about 200 MB), its `.sha256` and `INSTALLATION-GUIDE.md` (step-by-step guide for the VM, in Roman Urdu). The bundle carries everything a blank offline VM needs: the installer image, Docker Engine 29.9, the Compose plugin, and `iptables` for Ubuntu 22.04 / 24.04 and Debian 12 (from `vendor/docker-offline/`).

## 2. Install the installer (on the Ubuntu VM, no internet, no Docker needed)

Requirements: Ubuntu 22.04 or 24.04, x86-64, systemd, 3 GB free on /opt, root. Copy the two files to the VM (USB, scp, anything), then:

```bash
sha256sum -c vm-installer_*.tar.sha256
tar -xf vm-installer_*.tar
cd vm-installer_*/
sudo bash install.sh            # optional: --port 8090  --bind 127.0.0.1
```

`install.sh` checks the bundle's checksums, installs iptables and Docker from the bundled files if they are missing, loads the image, starts it and prints the URL and the access token. Docker and the installer start on boot. Nothing is downloaded. Re-running upgrades in place and keeps the token, uploaded bundles and history. If Docker is already installed and working it is left alone.

Tested on a blank Ubuntu 24.04 (no Docker, iptables or curl, network disabled): full install, upload and deploy worked.

## 3. Deploy a system

Each registered system has its own tab (Website, Streaming Server, ...).

1. Copy the release bundle and its `.sha256` file to `/opt/intellivision-installer/packages/`.
2. Open `http://<vm-ip>:8088`, sign in with the token, open the system tab. (Or upload the files from your PC in the Upload tab.)
3. The bundle is found automatically. Fill the form if the system has one, review the checks, press Deploy.

The installer runs, as root on the VM: verify, extract to `/opt/intellivision-installer/work/`, find the entry script (`install.sh` / `deploy.sh`, order is per system), run it.

**Streaming Server:** its `deploy.sh` is interactive (address, 4 ports, API user and password). The installer shows those questions as a form, checks the ports against the VM (busy ports are flagged and a free one is suggested), then feeds the answers to `deploy.sh`. Leave "Clean up after install" off: `uninstall.sh` lives in the extracted folder.

**NATS and RTSP Engine:** these bundles are copied to `/opt/natv2` and `/opt/rtsp-engine` before their script runs, because the stack lives in that folder. NATv2 reads its answers from a `.env` the installer writes. The RTSP Engine script is interactive: the form shows only the questions that apply (for example NATS host and credentials only when "I already have NATS" is chosen) and the answers are sent to the script in order. Secrets (NATS password) go over stdin, never into the command line.

**Inference Engine:** its `deploy.sh` asks 12 questions (address, NATS URL/subject/queue, starting classes, three ports, database password, configurator admin login). They are a form here; questions the script skips (classes once the configurator manages them, the database password once the database exists) are skipped in the form too. The bundle is large (about 1.5 GB of images): keep "Clean up after install" off, `uninstall.sh` lives in the extracted folder.

## Uploading bundles from your PC

Open the **Upload** tab, drop or choose any number of `.tar` bundles and `.sha256` files, press Upload. Each file has its own progress bar (plus speed and time left), the whole batch has one. Files are sent in 8 MB chunks, so an interrupted upload resumes from where the VM stopped (the same file chosen again continues, it does not restart). A file that already exists with the same size is skipped unless you press Replace. The tab also lists what is in the packages folder and lets you delete files. Nothing is shown as a bundle until the last chunk arrived.

## How bundles are recognised

- **By name or by contents.** A bundle is matched to a system by its file name (`match`), and if that fails by the files inside the archive (`detect`), so renaming a `.tar` does not matter. Contents are read once in the background and cached. Bundles nobody claims appear in an **Other** tab.
- **Checksum is optional.** A `.sha256` file is picked up if present (any name that starts like the bundle, or any tiny file holding a SHA-256, even one ending in `.tar.gz`). Without it the deploy simply skips verification. A checksum that is present but wrong still stops the deploy.

- **Choosing a file yourself.** If a renamed bundle is not recognised either way, open the system's tab and use "Your file is not listed?" under the bundle list: it shows every other archive in the packages folder, and "Use for <system>" pins that file to the system. The choice is stored in `/opt/intellivision-installer/data/assignments.json` and can be undone from the same tab.

**Website (Intellivision Dashboard):** its `install.sh` takes options, not answers. The form (dashboard port, HTTP/HTTPS, time zone) becomes `bash install.sh -y --port N [--https] [--timezone Z]` (input mode `args`). The bundle's default port 3000 equals its own internal web port, so the installer defaults to 3001 and flags 3000, 8090, 8092 and the ports other modules use.

## Day-to-day

```bash
sudo installer-ctl status | logs | restart | stop | start | token | reset-token | uninstall
```

## Adding another system

Edit `/opt/intellivision-installer/data/systems.json` on the VM (no rebuild needed):

```json
{ "id": "my-system", "name": "My System", "description": "…",
  "match": "^my-system_", "entry": ["install.sh", "deploy.sh"],
  "ctl": "/opt/my_system/my-ctl",
  "ctlCommands": [{ "cmd": "status", "label": "Status", "hint": "Health" }] }
```

`match` is a regex on the bundle file name. A bundle only shows in a tab once a system with a matching `match` exists. Questions an interactive entry script asks are described under `fields` (see the Streaming Server entry).

## Security

The container is `privileged` with `pid: host` so it can run install scripts on the VM. Access needs the token. Keep the port on a private network or firewall it; use `--bind 127.0.0.1` plus an SSH tunnel if in doubt.

## Development

```bash
cd web && npm install
INSTALLER_NO_AUTH=1 INSTALLER_TOKEN=x HOST_EXEC=local INSTALLER_BASE_DIR=<dir with packages/> npm run dev
```
