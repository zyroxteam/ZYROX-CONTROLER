# ZYROX CONTROLER — Colour Dice Edition

Android Ludo clone with a secure Telegram colour-specific dice controller, Device ID activation, MongoDB persistence, and a Telegram admin panel.

## Live service

- API: `https://zyrox-shield.antideploy.com`
- Health: `https://zyrox-shield.antideploy.com/health`
- Android package: `com.zyrox.controler`

## Colour control

The Telegram user chooses a player colour first and then the next dice value:

```text
[ 🔴 RED   ] [ 🟢 GREEN  ]
[ 🔵 BLUE  ] [ 🟡 YELLOW ]
[ 🎲 6 ] [ 🎲 5 ] [ 🎲 4 ]
[ 🎲 3 ] [ 🎲 2 ] [ 🎲 1 ]
```

A command only applies when the selected colour's next turn is rolled. Other colours continue rolling normally.

## Automatic activation flow

1. On first open, the app clearly asks permission to send limited device activation/status data.
2. After consent, it creates and saves a stable `ZRX-XXXXXXXXXXXX` Device ID plus a private 256-bit device secret. The user never has to type or repeatedly enter the Device ID.
3. Registration starts automatically—no dice long-press setup is required.
4. The admin receives Device ID, manufacturer/model, Android version, battery percentage, charging state, app version and online status in Telegram.
5. The admin sends the bare Device ID to the controller bot or taps **APPROVE & ACTIVATE**.
6. The app detects approval and shows an **OPEN TELEGRAM** prompt. Telegram requires the user to press Start once; after that the bot automatically links the saved Device ID and shows the colour dice panel.
7. With consent, Android WorkManager refreshes device status in the background on a best-effort schedule of approximately 15 minutes. The bot notifies the admin on first open and when an approved device returns online after a gap; `/admin` → **Device status** shows the latest battery/model/report.

No location, contacts, files, IMEI, serial number or phone number are collected. Telegram bots cannot initiate a user chat, so the one-time user Start action cannot be removed. Admin notifications use numeric IDs in `ADMIN_TELEGRAM_IDS`; `ADMIN_PUBLIC_HANDLE` is the visible label.

## Admin panel

Send `/admin` from an authorized admin Telegram ID:

- Bot status
- All users
- Maintenance mode
- Broadcasting
- Add user/device
- Remove user/device
- Pending requests
- Approve/reject and one-tap device activation

An admin can also send a bare Device ID such as `ZRX-ABC123XYZ789` directly to activate it.

## Server setup

```bash
cd controller-server
cp .env.example .env
# Put newly rotated credentials in .env
npm install
npm test
npm start
```

For Antideploy, use `BOT_MODE=webhook`. Credentials belong only in encrypted host environment variables—never Android source, Git, or an APK.

## Android build

```bash
./gradlew assembleDebug
```

Output: `app/build/outputs/apk/debug/app-debug.apk`

The hosted API URL is already embedded as the Android default and is not displayed in the long-press panel. Registration begins automatically after the one-time first-open consent.

## MongoDB isolation

The app uses the separate `zyrox_controller` database and collections beginning with `zyrox_`, so unrelated legacy data is ignored. A guarded controller-only reset script is included:

```bash
RESET_CONFIRM=DELETE_ZYROX_CONTROLLER_DATA npm run reset:controller
```

## Security

- Rotate any GitHub token, Telegram bot token, or MongoDB password pasted into a chat.
- Never hardcode the Telegram bot token or MongoDB URI in Android.
- Use HTTPS in production.
- The visible Device ID is not an API credential; every app installation also has a private device secret.
- Commands expire and admin activity is audited.

The upstream project description is preserved in [`ORIGINAL_README.md`](ORIGINAL_README.md).
