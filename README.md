# ZYROX CONTROLER — Colour Dice Edition

Android Ludo clone with a secure Telegram colour-specific dice controller, Device ID activation, MongoDB persistence, and a Telegram admin panel.

## Live service

- API: `https://zyrox-shield.antideploy.com`
- Health: `https://zyrox-shield.antideploy.com/health`
- Telegram bot: `@ZyroxLudoKingbot`
- Android package: `com.ludo.king`

## Colour control

The Telegram user chooses a player colour first and then the next dice value:

```text
[ 🔴 RED   ] [ 🟢 GREEN  ]
[ 🔵 BLUE  ] [ 🟡 YELLOW ]
[ 🎲 6 ] [ 🎲 5 ] [ 🎲 4 ]
[ 🎲 3 ] [ 🎲 2 ] [ 🎲 1 ]
```

A command only applies when the selected colour's next turn is rolled. Other colours continue rolling normally.

## Device-bound activation-key flow

1. On first open, the app asks permission to send limited device activation/status data.
2. It creates and permanently saves a stable `ZRX-XXXXXXXXXXXX` Device ID plus a private 256-bit device secret, registers the installation, and shows a locked activation popup.
3. The user taps **GET KEY**. Telegram opens the bot with the Device ID embedded in the signed device request; Telegram requires the user to press Start once.
4. The bot records the requesting user's name, `@username`, numeric Telegram ID and Device ID, then sends the request and phone/status details directly to the configured owner.
5. The owner taps **GENERATE KEY**. The server creates a random device-bound key in the form `LK-{DEVICE-ID-SUFFIX}-{RANDOM}`, stores only its SHA-256 hash, and sends the one-time visible key to both owner and requesting user.
6. The user pastes that key into the app popup once. Home and gameplay remain locked until the authenticated server verifies the key for that exact device and Telegram requester.
7. The activation remains valid for that installation until the owner taps **DELETE KEY**. Deletion revokes the device, removes its pending commands and redirects any open Home/game session back to the key popup after a successful status check.
8. After activation, long-pressing the in-game dice opens the Telegram control shortcut. The linked user selects Red/Green/Blue/Yellow and then `6 5 4 3 2 1`; the command applies only to the selected colour's next roll.
9. The permanent key is also a shareable controller credential. On any trusted Telegram account, start the bot, press **ADD YOUR KEY** (or send `/addkey`), and paste the key. That account is added as another controller for the same active device without changing the phone installation.
10. Multiple trusted Telegram accounts can control one device. Deleting the key removes every linked controller, clears pending commands and locks the app.

Treat the permanent key like a password: anyone who has it can control that device until the owner deletes or rotates it.

No location, contacts, files, IMEI, serial number or phone number are collected. Telegram bots cannot initiate a private chat by username, so the one-time user/owner Start action cannot be removed.

## Admin panel

Send `/admin` from an authorized admin Telegram ID:

- Bot status
- All users
- Maintenance mode
- Broadcasting
- Add user/device
- Remove user/device
- Pending key requests with requester name, username, Telegram ID and Device ID
- Generate/reject a device-bound activation key
- View key status and delete a key to lock the device immediately

Direct activation by a bare Device ID is disabled; every device must complete the key flow.

### Direct owner approval messages

Telegram does not allow a bot to DM a private user until that account starts the bot once. From the configured admin account, open `https://t.me/ZyroxLudoKingbot?start=owner` and press **Start**. The server verifies that the numeric Telegram ID is configured as an admin (or that the owner username matches), permanently stores the chat ID, forwards pending device requests, and sends future approval messages directly to that owner chat.

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

The hosted API URL is embedded as the Android default and is not displayed in the long-press panel. Registration begins after first-open consent; the owner request is sent only when the user taps **GET KEY** and starts the Telegram bot.

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
