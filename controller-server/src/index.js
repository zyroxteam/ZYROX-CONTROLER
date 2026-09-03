require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const mongoose = require('mongoose');
const { loadConfig } = require('./config');
const { User, Device, Command, Setting } = require('./models');
const { createBot } = require('./bot');
const { hashSecret, safeEqualHex, normalizeDeviceId, isValidDeviceId, isValidDeviceSecret, normalizeActivationKey, activationKeyMatchesDevice } = require('./utils');

const config = loadConfig();
const startedAt = new Date();
let botUsername = '';
const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

function cleanText(value, max = 80) {
  value = String(value || '').trim();
  return value.length > max ? value.slice(0, max) : value;
}

function applyTelemetry(device, input) {
  const telemetry = input && typeof input === 'object' ? input : {};
  const previous = device.lastTelemetryAt ? new Date(device.lastTelemetryAt).getTime() : 0;
  const hasConsentedTelemetry = Boolean(cleanText(telemetry.consentVersion, 20));
  device.onlineAt = new Date();
  if (!hasConsentedTelemetry) return false;
  const wasBackgroundOffline = !previous || Date.now() - previous > 20 * 60 * 1000;
  const battery = Number(telemetry.batteryLevel);
  device.manufacturer = cleanText(telemetry.manufacturer);
  device.model = cleanText(telemetry.model);
  device.androidVersion = cleanText(telemetry.androidVersion, 30);
  device.sdkInt = Number.isInteger(Number(telemetry.sdkInt)) ? Number(telemetry.sdkInt) : null;
  device.batteryLevel = Number.isFinite(battery) ? Math.max(-1, Math.min(100, Math.round(battery))) : -1;
  device.charging = Boolean(telemetry.charging);
  device.telemetryConsentVersion = cleanText(telemetry.consentVersion, 20);
  device.lastTelemetryAt = new Date();
  return wasBackgroundOffline;
}

function deviceHasControllers(device) {
  return Array.isArray(device.controllerTelegramIds) && device.controllerTelegramIds.length > 0;
}

function deviceStatusText(device) {
  const phone = [device.manufacturer, device.model].filter(Boolean).join(' ') || 'Unknown model';
  const battery = device.batteryLevel >= 0 ? `${device.batteryLevel}%${device.charging ? ' • Charging ⚡' : ''}` : 'Unknown';
  return `Device ID: ${device.deviceId}\nPhone: ${phone}\nAndroid: ${device.androidVersion || 'Unknown'}${device.sdkInt ? ` (SDK ${device.sdkInt})` : ''}\nBattery: ${battery}\nStatus: 🟢 Online\nApp: ${device.appVersion || '-'}`;
}

async function authenticateDevice(req, res, next) {
  const deviceId = normalizeDeviceId(req.params.deviceId || req.body?.deviceId);
  const secret = String(req.get('X-Device-Secret') || req.body?.deviceSecret || '');
  if (!isValidDeviceId(deviceId) || !isValidDeviceSecret(secret)) return res.status(400).json({ ok: false, error: 'invalid_device_credentials' });
  const device = await Device.findOne({ deviceId });
  if (!device || !safeEqualHex(device.secretHash, hashSecret(secret))) return res.status(403).json({ ok: false, error: 'device_auth_failed' });
  req.zyroxDevice = device;
  return next();
}

async function bootstrap() {
  await mongoose.connect(config.mongoUri, { dbName: config.mongoDb, serverSelectionTimeoutMS: 15000 });
  console.log(`MongoDB connected (database: ${config.mongoDb})`);
  await Setting.findOneAndUpdate({ key: 'maintenance' }, { $setOnInsert: { value: false } }, { upsert: true });
  const keyMode = await Setting.findOne({ key: 'device_key_mode_version' }).lean();
  if (Number(keyMode?.value || 0) < 1) {
    await Device.updateMany({}, { $set: {
      authorized: false, linkedTelegramId: '', activationKeyHash: '', activationKeyPreview: '',
      keyIssuedToTelegramId: '', keyIssuedToUsername: '', keyIssuedToName: '', keyRequestedAt: null,
      keyCreatedAt: null, keyActivatedAt: null, keyRevokedAt: null,
    } });
    await User.updateMany({ role: { $ne: 'admin' } }, { $set: { active: false, deviceIds: [], selectedDeviceId: '' } });
    await Command.deleteMany({});
    await Setting.findOneAndUpdate({ key: 'device_key_mode_version' }, { value: 1 }, { upsert: true });
    console.log('Device-bound key mode initialized; legacy approvals cleared');
  }
  const sharingMode = await Setting.findOne({ key: 'shared_key_mode_version' }).lean();
  if (Number(sharingMode?.value || 0) < 1) {
    const legacyDevices = await Device.find({ linkedTelegramId: { $ne: '' } }).select('deviceId linkedTelegramId').lean();
    if (legacyDevices.length) {
      await Device.bulkWrite(legacyDevices.map((device) => ({
        updateOne: {
          filter: { deviceId: device.deviceId },
          update: { $addToSet: { controllerTelegramIds: String(device.linkedTelegramId) } },
        },
      })));
    }
    await Setting.findOneAndUpdate({ key: 'shared_key_mode_version' }, { value: 1 }, { upsert: true });
    console.log(`Shared-key controller mode initialized; migrated ${legacyDevices.length} device(s)`);
  }
  const savedOwner = await Setting.findOne({ key: 'owner_chat_id' }).lean();
  if (savedOwner?.value && /^\d+$/.test(String(savedOwner.value))) {
    config.ownerChatId = String(savedOwner.value);
    if (!config.adminIds.includes(config.ownerChatId)) config.adminIds.unshift(config.ownerChatId);
  } else if (config.adminIds.length) {
    config.ownerChatId = String(config.adminIds[0]);
    await Setting.findOneAndUpdate({ key: 'owner_chat_id' }, { value: config.ownerChatId }, { upsert: true });
    console.log(`Owner chat auto-linked from ADMIN_TELEGRAM_IDS: ${config.ownerChatId}`);
  }
  for (const telegramId of config.adminIds) {
    await User.findOneAndUpdate({ telegramId }, { $set: { role: 'admin', active: true }, $setOnInsert: { deviceIds: [] } }, { upsert: true });
  }

  const bot = createBot(config);
  botUsername = (await bot.telegram.getMe()).username;
  await bot.telegram.setMyCommands([
    { command: 'start', description: 'Open bot menu' },
    { command: 'addkey', description: 'Add your permanent device key' },
    { command: 'panel', description: 'Open colour dice controls' },
    { command: 'id', description: 'Show your Telegram user ID' },
    { command: 'admin', description: 'Open owner/admin panel' },
  ]);
  async function notifyAdmins(title, device, withApproval) {
    let sent = 0;
    const options = withApproval ? { reply_markup: { inline_keyboard: [[{ text: '✅ APPROVE & ACTIVATE', callback_data: `activate:${device.deviceId}` }]] } } : {};
    const recipients = [...new Set([...(config.ownerChatId ? [String(config.ownerChatId)] : []), ...config.adminIds.map(String)])];
    for (const adminId of recipients) {
      try {
        await bot.telegram.sendMessage(adminId, `${title}\n\n${deviceStatusText(device)}`, options);
        sent += 1;
      } catch (error) {
        console.error(`Admin notify failed for ${adminId}:`, error.message);
      }
    }
    return sent;
  }
  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors({ origin: false }));
  app.use(express.json({ limit: '32kb' }));
  app.use(rateLimit({ windowMs: 60000, limit: 600, standardHeaders: 'draft-7', legacyHeaders: false }));

  if (config.botMode === 'webhook') {
    if (!config.publicBaseUrl.startsWith('https://')) throw new Error('PUBLIC_BASE_URL must be HTTPS in webhook mode');
    if (!/^[A-Za-z0-9_-]{32,256}$/.test(config.webhookSecret)) throw new Error('TELEGRAM_WEBHOOK_SECRET must be 32-256 URL-safe characters');
    app.post('/telegram/webhook', asyncRoute(async (req, res) => {
      if (req.get('X-Telegram-Bot-Api-Secret-Token') !== config.webhookSecret) return res.status(403).json({ ok: false });
      await bot.handleUpdate(req.body);
      return res.sendStatus(200);
    }));
    await bot.telegram.setWebhook(`${config.publicBaseUrl}/telegram/webhook`, { secret_token: config.webhookSecret, drop_pending_updates: false });
    console.log(`Telegram bot @${botUsername} started in webhook mode`);
  } else if (config.botMode === 'polling') {
    await bot.telegram.deleteWebhook({ drop_pending_updates: false });
    await bot.launch({ dropPendingUpdates: false });
    console.log(`Telegram bot @${botUsername} started in polling mode`);
  } else if (config.botMode !== 'disabled') throw new Error('BOT_MODE must be webhook, polling, or disabled');

  app.get('/', (_req, res) => res.type('html').send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ZYROX CONTROLER</title><style>*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:radial-gradient(circle at 20% 10%,#342060,#0d0a18 55%);font:16px system-ui;color:#f4efff}.card{width:min(92vw,560px);padding:38px;border:1px solid #6d4ca4;border-radius:24px;background:#171126;box-shadow:0 24px 80px #0008}.brand{font-size:12px;letter-spacing:.24em;color:#ae8cff}.title{font-size:34px;font-weight:800;margin:10px 0}.row{display:flex;gap:10px;flex-wrap:wrap;margin:25px 0}.chip{padding:10px 13px;background:#261b3d;border-radius:12px}.status{display:flex;align-items:center;gap:10px;padding:14px;border-radius:14px;background:#201735}.dot{width:10px;height:10px;border-radius:50%;background:#41dd91;box-shadow:0 0 18px #41dd91}.muted{color:#b7aacd;line-height:1.5}</style></head><body><main class="card"><div class="brand">ZYROX SYSTEMS</div><div class="title">COLOUR DICE CONTROL</div><p class="muted">Telegram controlled Red, Green, Blue and Yellow dice commands with Device ID activation.</p><div class="row"><span class="chip">🔴 RED</span><span class="chip">🟢 GREEN</span><span class="chip">🔵 BLUE</span><span class="chip">🟡 YELLOW</span></div><div class="status"><span class="dot"></span><strong>Service online</strong></div></main></body></html>`));

  app.get('/health', asyncRoute(async (_req, res) => res.json({
    ok: true, service: 'zyrox-colour-dice-controler', version: '1.4.0', bot: `@${botUsername}`, botMode: config.botMode,
    activationOwner: config.adminPublicHandle, database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    maintenance: Boolean((await Setting.findOne({ key: 'maintenance' }).lean())?.value), startedAt,
  })));

  app.post('/api/v1/devices/register', asyncRoute(async (req, res) => {
    const deviceId = normalizeDeviceId(req.body?.deviceId);
    const deviceSecret = String(req.body?.deviceSecret || '');
    const appVersion = cleanText(req.body?.appVersion, 40);
    if (!isValidDeviceId(deviceId) || !isValidDeviceSecret(deviceSecret)) return res.status(400).json({ ok: false, error: 'invalid_device_data' });
    const secretHash = hashSecret(deviceSecret);
    let device = await Device.findOne({ deviceId });
    if (device && !safeEqualHex(device.secretHash, secretHash)) return res.status(409).json({ ok: false, error: 'device_id_conflict' });
    const isNew = !device;
    if (!device) device = new Device({ deviceId, secretHash, appVersion, registeredAt: new Date() });
    device.appVersion = appVersion;
    const wasBackgroundOffline = applyTelemetry(device, req.body?.telemetry);
    await device.save();

    if (!isNew && device.authorized && wasBackgroundOffline && (!device.lastOnlineNoticeAt || Date.now() - new Date(device.lastOnlineNoticeAt).getTime() > 20 * 60 * 1000)) {
      await notifyAdmins('🟢 DEVICE BACK ONLINE', device, false);
      device.lastOnlineNoticeAt = new Date();
      await device.save();
    }
    return res.json({ ok: true, deviceId, authorized: device.authorized, linked: deviceHasControllers(device), activationOwner: config.adminPublicHandle, botUsername, botLink: `https://t.me/${botUsername}?start=${deviceId}` });
  }));

  const keyActivationLimiter = rateLimit({ windowMs: 10 * 60 * 1000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false });
  app.post('/api/v1/devices/:deviceId/activate-key', keyActivationLimiter, asyncRoute(authenticateDevice), asyncRoute(async (req, res) => {
    const device = req.zyroxDevice;
    const activationKey = normalizeActivationKey(req.body?.activationKey);
    if (!activationKeyMatchesDevice(activationKey, device.deviceId)) return res.status(400).json({ ok: false, error: 'invalid_activation_key_format' });
    if (!device.activationKeyHash || !safeEqualHex(device.activationKeyHash, hashSecret(activationKey))) return res.status(403).json({ ok: false, error: 'activation_key_rejected' });
    if (!device.linkedTelegramId || device.keyIssuedToTelegramId !== device.linkedTelegramId) return res.status(409).json({ ok: false, error: 'key_owner_mismatch' });
    device.authorized = true;
    device.keyActivatedAt = new Date();
    device.keyRevokedAt = null;
    device.onlineAt = new Date();
    device.controllerTelegramIds = [...new Set([...(device.controllerTelegramIds || []), String(device.linkedTelegramId)])];
    await device.save();
    await User.findOneAndUpdate(
      { telegramId: device.linkedTelegramId },
      { $set: { active: true, selectedDeviceId: device.deviceId }, $addToSet: { deviceIds: device.deviceId } },
      { upsert: true },
    );
    const recipients = [...new Set([...(config.ownerChatId ? [String(config.ownerChatId)] : []), ...config.adminIds.map(String)])];
    for (const adminId of recipients) {
      await bot.telegram.sendMessage(adminId, `✅ KEY ACTIVATED\n\nDevice ID: ${device.deviceId}\nUser: ${device.keyIssuedToName || '-'}${device.keyIssuedToUsername ? ` (@${device.keyIssuedToUsername})` : ''}\nTelegram ID: ${device.linkedTelegramId}\nKey: ${device.activationKeyPreview}`).catch(() => null);
    }
    await bot.telegram.sendMessage(device.linkedTelegramId, `✅ ${device.deviceId} activated successfully. /panel send karke dice controls open karein.`).catch(() => null);
    return res.json({ ok: true, authorized: true, linked: true, activationOwner: config.adminPublicHandle, botUsername, botLink: `https://t.me/${botUsername}?start=${device.deviceId}` });
  }));

  app.get('/api/v1/devices/:deviceId/status', asyncRoute(authenticateDevice), asyncRoute(async (req, res) => {
    const device = req.zyroxDevice; device.onlineAt = new Date(); await device.save();
    return res.json({ ok: true, deviceId: device.deviceId, authorized: device.authorized, linked: deviceHasControllers(device), maintenance: Boolean((await Setting.findOne({ key: 'maintenance' }).lean())?.value), activationOwner: config.adminPublicHandle, botUsername, botLink: `https://t.me/${botUsername}?start=${device.deviceId}` });
  }));

  app.post('/api/v1/devices/:deviceId/heartbeat', asyncRoute(authenticateDevice), asyncRoute(async (req, res) => {
    const device = req.zyroxDevice;
    const wasBackgroundOffline = applyTelemetry(device, req.body);
    if (device.authorized && wasBackgroundOffline && (!device.lastOnlineNoticeAt || Date.now() - new Date(device.lastOnlineNoticeAt).getTime() > 20 * 60 * 1000)) {
      await notifyAdmins('🟢 BACKGROUND DEVICE ONLINE', device, false);
      device.lastOnlineNoticeAt = new Date();
    }
    await device.save();
    return res.json({ ok: true, authorized: device.authorized, linked: deviceHasControllers(device), maintenance: Boolean((await Setting.findOne({ key: 'maintenance' }).lean())?.value), activationOwner: config.adminPublicHandle, botUsername, botLink: `https://t.me/${botUsername}?start=${device.deviceId}` });
  }));

  app.get('/api/v1/devices/:deviceId/next-command', asyncRoute(authenticateDevice), asyncRoute(async (req, res) => {
    const device = req.zyroxDevice; device.onlineAt = new Date(); await device.save();
    const maintenance = Boolean((await Setting.findOne({ key: 'maintenance' }).lean())?.value);
    if (!device.authorized || !deviceHasControllers(device) || maintenance) return res.json({ ok: true, authorized: device.authorized, linked: deviceHasControllers(device), maintenance, command: null });
    const command = await Command.findOneAndUpdate({ deviceId: device.deviceId, status: 'pending', expiresAt: { $gt: new Date() } }, { $set: { status: 'delivered', deliveredAt: new Date() } }, { sort: { createdAt: 1 }, new: true });
    return res.json({ ok: true, authorized: true, linked: true, maintenance: false, command: command ? { id: String(command._id), colour: command.colour, dice: command.dice, createdAt: command.createdAt } : null });
  }));

  app.use((error, _req, res, _next) => { console.error(error); res.status(500).json({ ok: false, error: 'internal_server_error' }); });
  const server = app.listen(config.port, '0.0.0.0', () => console.log(`ZYROX API listening on 0.0.0.0:${config.port}`));
  const shutdown = async (signal) => { server.close(); if (config.botMode === 'polling') bot.stop(signal); await mongoose.disconnect(); process.exit(0); };
  process.once('SIGINT', () => shutdown('SIGINT')); process.once('SIGTERM', () => shutdown('SIGTERM'));
}

bootstrap().catch((error) => { console.error('Startup failed:', error); process.exit(1); });
