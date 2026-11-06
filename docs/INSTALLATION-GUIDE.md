# VM Installer: Installation Guide (poori tarah offline)

Ye guide batati hai ke **VM Installer** ko ek khali Ubuntu VM par kaise lagana hai, jahan **internet nahi hai aur Docker bhi installed nahi hai**. Iske baad aap apne saare systems (Website, Streaming Server, NATS, RTSP Engine, Inference Engine) browser se upload aur deploy kar sakte hain.

---

## 1. Aapke paas kya files hain

| File | Kaam |
|---|---|
| `vm-installer_1.0.0_offline_<date>.tar` | Poora installer. Isme Docker Engine, Docker Compose, iptables aur installer ki image sab shamil hain. Kuch download nahi hota. |
| `vm-installer_1.0.0_offline_<date>.tar.sha256` | Checksum, taake pata chale file sahi copy hui. |
| `INSTALLATION-GUIDE.md` | Ye guide. |

Size lagbhag **200 MB** hai.

## 2. VM par kya hona chahiye

- **Ubuntu 22.04 ya 24.04**, 64-bit (x86-64). Debian 12 bhi chalta hai.
- **systemd** (Ubuntu mein hota hi hai).
- `/opt` par kam az kam **3 GB** khali jagah. Aapki bundles (jaise 1.5 GB wali Inference images) ke liye is se **zyada** chahiye (bundle ke size ka lagbhag 3 guna).
- **root / sudo** access.
- SSH chalna chahiye (taake `scp` se file copy ho sake).
- **Internet ki zaroorat nahi.** Docker install karne ki bhi zaroorat nahi.

---

## 3. Step 1: File VM par copy karo (apne PC se)

Apne Windows PC par **PowerShell** kholo (Windows 10/11 mein `scp` pehle se maujood hai).

Neeche `<USER>` ki jagah VM ka username aur `<VM_IP>` ki jagah VM ka IP likho. Password poochne par VM ka password likho (type karte waqt screen par kuch nazar nahi aata, ye normal hai).

```powershell
cd D:\latestinstaller\dist

scp vm-installer_1.0.0_offline_20261106.tar        <USER>@<VM_IP>:~/
scp vm-installer_1.0.0_offline_20261106.tar.sha256 <USER>@<VM_IP>:~/
```

Misaal: user `ubuntu`, IP `192.168.1.50` ho to:

```powershell
scp vm-installer_1.0.0_offline_20261106.tar ubuntu@192.168.1.50:~/
```

Pehli baar connect karte waqt "Are you sure you want to continue connecting?" aaye to `yes` likho.

> Agar `scp` pasand na ho to **WinSCP** ya **FileZilla** se bhi dono files VM ke home folder (`/home/<USER>/`) mein drag-drop kar sakte ho.

## 4. Step 2: VM par installer lagao

PC se VM mein login karo:

```powershell
ssh <USER>@<VM_IP>
```

Ab VM ke andar ye commands ek ek karke chalao:

```bash
# 1. Check karo file poori aur sahi copy hui
sha256sum -c vm-installer_1.0.0_offline_20261106.tar.sha256

# 2. Kholo
tar -xf vm-installer_1.0.0_offline_20261106.tar
cd vm-installer_1.0.0_offline_20261106

# 3. Install karo (sudo ka password dobara poochega)
sudo bash install.sh
```

Pehli command `...tar: OK` likhe to file sahi hai. Agar `FAILED` aaye to file dobara copy karo.

`install.sh` khud ye sab karta hai (aapko kuch nahi karna):

1. Machine check karta hai (CPU, systemd, disk) aur apne checksums verify karta hai.
2. Agar `iptables` nahi hai to bundle se install karta hai.
3. Agar Docker nahi hai to bundle se **Docker Engine aur Compose install** karta hai (internet ke bagair).
4. Installer ki image load karke start karta hai.
5. Ant mein ye likhta hai:

```
Installer is running.

  URL      http://192.168.1.50:8088
  Token    5c8567725b8b6d9a...(lamba token)
  Packages /opt/intellivision-installer/packages
```

**Is `Token` ko copy karke kahin safe rakh lo.** Browser mein login ke liye chahiye hoga.

Agar port 8088 pehle se kisi aur ne le rakha ho to:
```bash
sudo bash install.sh --port 8090
```

## 5. Step 3: Browser mein kholo

Apne PC ke browser mein `http://<VM_IP>:8088` kholo aur upar wala **Token** paste karke sign in karo.

(Agar page na khule to VM ka firewall dekho: `sudo ufw allow 8088/tcp`. Installer ufw active hone par ye khud kar deta hai.)

## 6. Step 4: Apni bundles upload karo

1. Upar **Upload** tab kholo.
2. Apne PC se jitni chahiye utni `.tar` bundles (aur agar hon to `.sha256` files) drag-drop karo ya "Choose files" se chuno.
3. **Upload** dabao. Har file ka apna progress bar aur percent dikhta hai, aur neeche poore batch ka bar.
4. Upload ke dauran browser tab band mat karna. Agar net toot jaye to wahin se resume hota hai (wahi file dobara chuno).

Bundle ka **naam kuch bhi ho sakta hai**. SHA file **zaroori nahi** hai (agar hai to verify hoti hai, na ho to deploy phir bhi chalta hai).

> Dusra tareeka: bundles ko seedha `scp` se `/opt/intellivision-installer/packages/` mein bhi daal sakte ho.

## 7. Step 5: Deploy karo

Har system ka apna tab hai:

| Tab | System |
|---|---|
| **Website** | Intellivision Dashboard |
| **Streaming Server** | GELECEK Streaming Server |
| **NATS** | NATv2 |
| **RTSP Engine** | RTSP Snapshot Engine |
| **Inference Engine** | SafeCity Stage 2 |

Deploy ka tareeka (har tab mein wahi):

1. System ka tab kholo. Aapki uploaded bundle **khud nazar aati hai** (naam badla ho tab bhi, installer andar ki files dekh kar pehchanta hai).
2. Agar file nazar na aaye: "**Your file is not listed?**" par click karo, file chuno, "**Use for ...**" dabao.
3. Jin systems ko settings chahiye (address, ports, password, waghera) unka **Configure** form bharo. Ports ka live check hota hai (busy port laal ho jata hai aur "Use 8001" jaisa suggestion aata hai).
4. **Review** mein sab PASS ho to **Deploy** dabao.
5. Neeche live log aur step-by-step progress dikhta hai. Ant mein "Success" aata hai.

**Website (Intellivision Dashboard) ka form:** isme 3 cheezein poochi jati hain: **Dashboard port** (default 3001), **HTTP ya HTTPS (self-signed)** aur **Time zone**. Port 3000, 8090 aur 8092 dashboard ke andar ke ports hain, aur 8080, 8000, 4222 jaise ports doosre modules ke hain; installer inhe laal kar deta hai aur free port suggest karta hai. Baaki settings (Detection API, tokens, Streams, Camera feed, waghera) bundle ke apne `defaults.env` se aati hain; unhe deploy ke baad dashboard ke **Settings → Connections** mein badla ja sakta hai.

**Zaroori baatein:**
- **"Clean up after install" ko band (off) rehne do.** Kai bundles ki `uninstall.sh` extracted folder mein hoti hai.
- Ek waqt mein **ek hi deploy** chal sakta hai.
- Deploy ke ant mein jo **passwords** (admin / database) dikhte hain wo **sirf ek baar** dikhte hain. Unhe copy karke rakh lo. (Ye History tab mein bhi save rehte hain.)
- Bundle agar "UNTESTED" ho to installer warning dikhata hai. Sirf aisi VM par deploy karo jahan wapas jaana mumkin ho.

**Systems ka tarteeb:** agar RTSP Engine ya Inference Engine ko NATS chahiye to pehle **NATS** deploy karo, phir baaki.

## 8. Deploy ke baad: Manage

Har system ke tab mein neeche **Manage** hai: Status, Health, Logs, Restart, Stop, Start, Apply .env, aur `.env` file edit karne ka editor. History tab mein har deploy ka poora log milta hai.

---

## 9. Rozmarra ke commands (VM par)

```bash
sudo installer-ctl status        # installer chal raha hai ya nahi
sudo installer-ctl logs          # installer ke logs
sudo installer-ctl restart       # restart
sudo installer-ctl token         # token dobara dekhna
sudo installer-ctl reset-token   # naya token banana
sudo installer-ctl uninstall     # installer hatana (aapki bundles aur Docker rehte hain)
```

## 10. Masle aur hal

| Masla | Hal |
|---|---|
| `sha256sum -c` mein `FAILED` | File adhuri copy hui. `scp` dobara chalao. |
| `scp` mein `Permission denied` | Username ya password galat hai. Ya VM par SSH band hai. |
| Browser mein page nahi khulta | IP / port check karo. `sudo ufw allow 8088/tcp`. `sudo installer-ctl status` mein Health `healthy` hona chahiye. |
| Token bhool gaye | `sudo installer-ctl token` |
| `port 8088 is already in use` | `sudo bash install.sh --port 8090` |
| `less than 3 GB free on /opt` | VM mein jagah banao ya bada disk lagao. |
| `systemd is required` | VM mein systemd nahi hai. Ubuntu server image use karo. |
| `this machine is aarch64` | Ye bundle sirf x86-64 ke liye hai. |
| Docker pehle se kharab hai (daemon nahi chalta) | Script usay chhedti nahi. `sudo systemctl start docker` karke dobara chalao. |
| Streaming Server ka browser login `Invalid username or password` deta hai | **Browser login aur API login alag hain.** Browser mein pehli baar **admin / admin** chalta hai (phir naya password set karna padta hai). Deploy ke ant mein jo `API login admin / ...` likha aata hai wo sirf scripts/API ke liye hai, browser ke liye nahi. 5 galat koshishon ke baad account 15 minute ke liye lock ho jata hai: Streaming Server tab > Manage > **Unlock admin**. Password bhool gaye to VM par: `sudo docker exec -it $(sudo docker ps --format '{{.Names}}' \| grep -m1 gelecek-streaming-server) python3 /usr/local/bin/useradmin.py reset-password admin` |
| RTSP Engine ke browser login ka password nahi pata / `Invalid username or password` | Username **admin** hai. Naye installer se deploy karo to password deploy ke ant mein "Admin login : admin / ..." likha aata hai. Pehle ke deploy ke liye: RTSP Engine tab > Manage > **Reset admin password** (password log mein aata hai, pehle sign-in par badalna padta hai). Terminal se: `sudo docker exec rtsp-engine /app/rtsp-engine admin reset-password admin`. 5 galat koshishon ke baad lock ho to **Unlock admin**. |
| Inference Engine (port 18090 Configurator) ka password nahi pata | Username **admin**. Password deploy ke log mein ek baar likha aata hai. Inference Engine tab ke upar **Login hint** kholo ya VM par: `sudo grep -h "Admin login" /opt/intellivision-installer/logs/*.log \| tail -1` |
| Website deploy par `the dashboard port 3000 must differ from the internal ports` | Dashboard port 3000 mat rakho. Installer ka naya version Website tab mein port 3001 deta hai (form se badal bhi sakte ho). Purana installer ho to naya `.tar` dobara lagao (Section 11). |
| Deploy mein "Not enough free disk space" | VM mein jagah banao (bundle ke size ka lagbhag 3 guna chahiye). |
| Upload beech mein ruk gaya | Wahi file dobara chuno. Jitna ja chuka hai wahan se aage chalega. |

## 11. Installer ko upgrade karna

Naya `.tar` isi tarah copy karo aur dobara `sudo bash install.sh` chalao. **Token, uploaded bundles aur History sab bache rehte hain.**

## 12. Security

- Installer VM par **root** power se commands chalata hai (isliye woh sirf token se khulta hai). **Token kisi ko mat do.**
- Port 8088 ko **public internet par expose mat karo.** Sirf private network par rakho. Sirf apne PC se kholna ho to:
  ```bash
  sudo bash install.sh --bind 127.0.0.1
  ```
  aur PC se SSH tunnel: `ssh -L 8088:127.0.0.1:8088 <USER>@<VM_IP>`, phir browser mein `http://localhost:8088`.
