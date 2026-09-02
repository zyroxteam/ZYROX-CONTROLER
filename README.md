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

## Device activation flow

1. The app creates a stable `ZRX-XXXXXXXXXXXX` Device ID and a separate private 256-bit device secret.
2. The app registers the ID with the HTTPS backend.
3. The backend automatically sends the new Device ID to the configured admin account (`ADMIN_PUBLIC_HANDLE`, displayed as `@ZB_EXPLOIT`).
4. The admin sends the bare Device ID to the controller bot or taps **ACTIVATE DEVICE**.
5. The user long-presses the in-game dice, taps **CONNECT TELEGRAM**, and starts the bot deep link.
6. After linking, `/panel` shows the colour and dice controls.

Telegram bots cannot initiate a chat using only a public username. The backend sends notifications using the numeric IDs in `ADMIN_TELEGRAM_IDS`; `ADMIN_PUBLIC_HANDLE` is the visible label.

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

The hosted API URL is already the Android default. Start a game and long-press the dice to view/copy the Device ID and connect Telegram.

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
