# Homebridge Playstation (Docker-friendly fork)

### Playstation integration for Homebridge.

_Hey Siri, turn on PS5_ — now fully compatible with Docker environments.

<img src="./PS5 title change.gif" width="200">

This plugin exposes your PlayStation 4/5 as a HomeKit Television accessory.  
It uses the excellent [playactor](https://github.com/dhleong/playactor) library for discovery and power control, and an external HTTP endpoint to retrieve the currently playing title.

This project is **inspired by the original work of [NikDev](https://github.com/NikDevx/homebridge-playstation)**.  
This fork was created to support **Homebridge Docker architectures**, where local Python or PSNAWP installations are not suitable.

No Python.  
No PSNAWP.  
No system dependencies.  
Everything runs cleanly inside a container.

## Features

- Power ON/OFF via PlayActor (Remote Play protocol)  
- Real‑time game title via external HTTP endpoint  
- Dynamic HomeKit InputSource updated with the current title  
- NPSSO UX mode (token expired state)  
- Multilingual (English / Français)  
- Fully compatible with Homebridge Docker deployments  
- Works on both **Homebridge v1.8** and **Homebridge v2**  
- No Python, no PSNAWP local installation, no system dependencies

## Requirements

| | |
|---|---|
| Homebridge | `^1.8.0` or `^2.0.0` |
| Node.js | 20.19+, 22.12+ or 24+ |

Homebridge v2 ships HAP‑NodeJS v2 and drops Node.js 16/18, so `2.1.0` of this
plugin does the same. If you are still on Node 16 or 18, stay on `2.0.5` until
you can upgrade your runtime.

## Installation

You can install it via Homebridge UI or manually using:

```bash
npm install -g homebridge-playstation-title-endpoint
```

## Configuration

### Pairing with homebridge-playstation-login

Before Homebridge can control your console, you must pair it using the Remote Play 8‑digit code.

1. Put your PlayStation in **Remote Play pairing mode**  
Settings → System → Remote Play → Link Device

2. Run the pairing tool from the **Homebridge UI terminal**:

```bash
homebridge-playstation-login
```

3. Enter the 8‑digit code shown on your console.
This step is required only once.

The credentials are stored in the Homebridge storage directory, next to
`config.json`:

```
<storage>/homebridge-playstation-title-endpoint/credentials.json
```

With the official Docker image that is
`/homebridge/homebridge-playstation-title-endpoint/credentials.json`, on the
persistent volume, so the pairing survives container rebuilds. The pairing tool
finds the storage directory on its own when run from the Homebridge UI terminal;
from anywhere else (SSH, `docker exec`), pass it explicitly:

```bash
homebridge-playstation-login -U /var/lib/homebridge
```

Then add the console to HomeKit with the Homebridge pairing code displayed in Homebridge's logs

### Parameters

- **endpoint**  
URL of your external status endpoint. Must return JSON with `"title"`.

- **pollInterval**  
Polling interval in milliseconds (default: 15000, minimum: 5000).  
Values below the minimum are clamped and a warning is logged.

- **language**  
`"en"` or `"fr"` for titles and log messages.

## External Endpoint

The plugin expects a simple JSON response:

```json
{
"online": true,
"title": "Horizon Forbidden West"
}
```

### NPSSO UX Mode

If the endpoint returns a title containing `"npsso"` (case‑insensitive):

```json
{
"online": true,
"title": "NPSSO expiré"
}
```

The plugin enters **NPSSO UX mode**:

- HomeKit displays **“NPSSO expired”** (or FR equivalent)
- The console remains marked as **ON**
- No false ON/OFF transitions
- Normal mode resumes automatically when a valid title is received

### Title sanitising

HAP‑NodeJS v2 (bundled with Homebridge 2) validates names against Apple's
HomeKit naming rules and rejects anything outside letters, numbers, spaces,
apostrophes and common punctuation. Game titles regularly contain `™`, `®` or
emoji, so every title is sanitised before it reaches HomeKit:

| Endpoint returns | HomeKit shows |
|---|---|
| `HELLDIVERS™ 2` | `HELLDIVERS 2` |
| `Marvel's Spider-Man 2` | `Marvel's Spider-Man 2` |
| `🎮` (nothing usable) | `Not playing` |

Names are also truncated to the 64‑character HomeKit limit.

## HomeKit Pairing

At startup, Homebridge will log a message similar to:

Please add [PS5 XYZ] manually in Home app. Setup Code: 111-22-333

Open the Home app → **Add Accessory** → enter the code.

## Docker Compatibility

This fork was designed specifically for **Homebridge Docker**:

- No Python  
- No PSNAWP local installation  
- No system dependencies  
- No privileged container required  
- All logic runs inside Node.js  
- External endpoint handles authentication and title retrieval  
- Remote Play credentials live in the Homebridge storage directory, so they
  survive container rebuilds without any extra volume  

This architecture is stable, reproducible, and appliance‑grade.

## Language Support

English and Français.  
Affects fallback titles, NPSSO messages, and logs.

```json
"language": "fr"
```

## Troubleshooting

- Make sure **Remote Play** is enabled on your PlayStation  
- For the console to be found and woken up from rest mode, enable (on PS5)
  *Settings → System → Power Saving → Features Available in Rest Mode →*
  **Stay Connected to the Internet** and **Enable Turning On PS5 from Network**  
- Ensure your **endpoint** is reachable from the Homebridge container  
- If titles do not update, verify the endpoint returns valid JSON  
- If HomeKit shows “NPSSO expired”, renew your NPSSO token  
- Restart Homebridge after changing configuration

### The console shows "No Response" in Home

Look at the Homebridge log from the last start:

| Log line | Meaning |
|---|---|
| `ONBOARDING required` | no Remote Play credentials: run `homebridge-playstation-login` |
| `No PlayStation found on the network yet` | the console did not answer; the plugin keeps looking and publishes it as soon as it does |
| `PlayStation 5 XXXX is running on port …` | the plugin side is fine; look at the network / mDNS side |

`Please add [PlayStation 5 XXXX] manually in Home app` is printed by Homebridge
at **every** start, even when the console is already paired: it does not mean
the pairing was lost.

### Unpairing is a last resort

"Unpair Bridges / Cameras / TVs / External Accessories" in the Homebridge UI
deletes the console's HomeKit pairing for good: it then has to be added to Home
again, and the scenes and automations using it are lost. Plugin updates never
require it, since the console keeps the same HomeKit identity across versions.
Only use it when the log shows the console as published and the Home app still
refuses it.

### Resetting the Remote Play credentials

To reset the credentials used by PlayActor, delete `credentials.json` from
`<storage>/homebridge-playstation-title-endpoint/` and run
`homebridge-playstation-login` again. Keep the directory itself: its presence
tells the plugin the pre‑2.2.0 credentials were already migrated, so they are
not imported a second time.

## Upgrading to 2.2.0

Remote Play credentials move from PlayActor's default
`~/.config/playactor/credentials.json` to the Homebridge storage directory
(`<storage>/homebridge-playstation-title-endpoint/credentials.json`). In the
official Docker image `~` is `/home/homebridge`, outside the `/homebridge`
volume, so the console pairing was lost every time the container was recreated
(new image, `docker compose up` after a change, Synology "Build"...).

- Existing credentials are copied over automatically on first start. The log
  says `Moved PlayActor credentials from … to …`, and there is nothing to
  re‑pair.
- If the container had already been recreated and the credentials are gone, the
  log says `ONBOARDING required`: run `homebridge-playstation-login` once from
  the Homebridge UI terminal.
- The old file is left in place, so going back to 2.1.0 still works.

The console is also no longer lost when it does not answer at startup. Discovery
used to run once, for 30 seconds, when Homebridge started: a console switched
off at that moment (typically during the restart a plugin update triggers) was
never published and showed "No Response" until the next restart. The plugin now
keeps looking, every minute, until the console answers.

## Upgrading from 2.0.x to 2.1.0

No configuration change is required — 2.1.0 reads the same `config.json` and the
same PlayActor credentials, and the accessory keeps its HomeKit identity, so
there is nothing to re-pair.

What changed under the hood:

- Declares support for Homebridge v2 (`engines.homebridge: "^1.8.0 || ^2.0.0"`),
  so the readiness check in the Homebridge UI turns green
- Requires Node.js 20.19+ (Homebridge v2 itself requires 22+)
- Discovery now runs on `didFinishLaunching` instead of during plugin load, so
  the plugin no longer delays Homebridge startup
- Timers are released on the Homebridge `shutdown` event
- Endpoint requests use `fetch` with a 10s timeout, instead of an untimed
  `http.get` that could hold a socket open forever
- Titles are sanitised for HAP‑NodeJS v2's name validation (see above)
- `pollInterval` now defaults to 15000 ms everywhere (the accessory used to fall
  back to 120000 ms while the config UI advertised 15000 ms)

## Credits

This project is based on the original work of **NikDev**  
and uses the excellent **playactor** library by **dhleong**.

This fork is maintained by **Djoko‑cli**  
with a focus on Docker compatibility and appliance‑grade behavior.

## License

This project is licensed under the MIT License.

