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
- No Python, no PSNAWP local installation, no system dependencies

## Installation

You can install it via Homebridge UI or manually using:

```bash
npm install -g homebridge-playstation-title-endpoint

## Configuration

### Pairing with homebridge-playstation-login

Before Homebridge can control your console, you must pair it using the Remote Play 8‑digit code.

1. Put your PlayStation in **Remote Play pairing mode**  
Settings → System → Remote Play → Link Device

2. Run the pairing tool:

```bash
homebridge-playstation-login
```

3. Enter the 8‑digit code shown on your console.
This step is required only once.
The generated credentials are stored locally and used by PlayActor for power control.

Then add the console to HomeKit with Hombebridge pairing code displayed on Homebridge's logs

### Parameters

- **endpoint**  
URL of your external status endpoint. Must return JSON with `"title"`.

- **pollInterval**  
Polling interval in milliseconds (default: 60000).

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

This architecture is stable, reproducible, and appliance‑grade.

## Language Support

English and Français.  
Affects fallback titles, NPSSO messages, and logs.

```json
"language": "fr"
```

## Troubleshooting

- Make sure **Remote Play** is enabled on your PlayStation  
- Ensure your **endpoint** is reachable from the Homebridge container  
- If titles do not update, verify the endpoint returns valid JSON  
- If HomeKit shows “NPSSO expired”, renew your NPSSO token  
- Restart Homebridge after changing configuration

If at some point you have any problem, you can try to reset the Homebridge accessory and re-pair it.

To do so, go to Homebridge UI > "Settings" > "Unpair Bridges / Cameras / TVs / External Accessories" and delete the Playstation.

To reset the credentials used by PlayActor, you need to manually remove the directory /home/homebridge/.config/playactor


## Credits

This project is based on the original work of **NikDev**  
and uses the excellent **playactor** library by **dhleong**.

This fork is maintained by **Djoko‑cli**  
with a focus on Docker compatibility and appliance‑grade behavior.

## License

This project is licensed under the MIT License.

