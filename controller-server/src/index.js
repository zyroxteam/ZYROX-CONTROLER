require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const mongoose = require('mongoose');
const { loadConfig } = require('./config');
const { User, Device, Command, Setting } = require('./models');
const { createBot } = require('./bot');
const { hashSecret, safeEqualHex, normalizeDeviceId, isValidDeviceId, isValidDeviceSecret } = require('./utils');

const config = loadConfig();
const startedAt = new Date();
let botUsername = '';
const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

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
  for (const telegramId of config.adminIds) {
    await User.findOneAndUpdate({ telegramId }, { $set: { role: 'admin', active: true }, $setOnInsert: { deviceIds: [] } }, { upsert: true });
  }

  const bot = createBot(config);
  botUsername = (await bot.telegram.getMe()).username;
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
    ok: true, service: 'zyrox-colour-dice-controler', version: '1.1.0', bot: `@${botUsername}`, botMode: config.botMode,
    activationOwner: config.adminPublicHandle, database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    maintenance: Boolean((await Setting.findOne({ key: 'maintenance' }).lean())?.value), startedAt,
  })));

  app.post('/api/v1/devices/register', asyncRoute(async (req, res) => {
    const deviceId = normalizeDeviceId(req.body?.deviceId);
    const deviceSecret = String(req.body?.deviceSecret || '');
    const appVersion = String(req.body?.appVersion || '').slice(0, 40);
    if (!isValidDeviceId(deviceId) || !isValidDeviceSecret(deviceSecret)) return res.status(400).json({ ok: false, error: 'invalid_device_data' });
    const secretHash = hashSecret(deviceSecret);
    let device = await Device.findOne({ deviceId });
    if (device && !safeEqualHex(device.secretHash, secretHash)) return res.status(409).json({ ok: false, error: 'device_id_conflict' });
    if (!device) device = await Device.create({ deviceId, secretHash, appVersion, onlineAt: new Date() });
    else { device.appVersion = appVersion; device.onlineAt = new Date(); await device.save(); }

    if (!device.adminNotifiedAt) {
      for (const adminId of config.adminIds) {
        await bot.telegram.sendMessage(adminId, `📱 NEW ZYROX DEVICE\n\nDevice ID: ${deviceId}\nApp version: ${appVersion || '-'}\n\nIs ID ko bot mein send karke activate karein.`, {
          reply_markup: { inline_keyboard: [[{ text: '✅ ACTIVATE DEVICE', callback_data: `activate:${deviceId}` }]] },
        }).catch((error) => console.error(`Admin notify failed for ${adminId}:`, error.message));
      }
      device.adminNotifiedAt = new Date();
      await device.save();
    }
    return res.json({ ok: true, deviceId, authorized: device.authorized, linked: Boolean(device.linkedTelegramId), activationOwner: config.adminPublicHandle, botUsername, botLink: `https://t.me/${botUsername}?start=${deviceId}` });
  }));

  app.get('/api/v1/devices/:deviceId/status', asyncRoute(authenticateDevice), asyncRoute(async (req, res) => {
    const device = req.zyroxDevice; device.onlineAt = new Date(); await device.save();
    return res.json({ ok: true, deviceId: device.deviceId, authorized: device.authorized, linked: Boolean(device.linkedTelegramId), maintenance: Boolean((await Setting.findOne({ key: 'maintenance' }).lean())?.value), activationOwner: config.adminPublicHandle, botUsername, botLink: `https://t.me/${botUsername}?start=${device.deviceId}` });
  }));

  app.get('/api/v1/devices/:deviceId/next-command', asyncRoute(authenticateDevice), asyncRoute(async (req, res) => {
    const device = req.zyroxDevice; device.onlineAt = new Date(); await device.save();
    const maintenance = Boolean((await Setting.findOne({ key: 'maintenance' }).lean())?.value);
    if (!device.authorized || !device.linkedTelegramId || maintenance) return res.json({ ok: true, authorized: device.authorized, linked: Boolean(device.linkedTelegramId), maintenance, command: null });
    const command = await Command.findOneAndUpdate({ deviceId: device.deviceId, status: 'pending', expiresAt: { $gt: new Date() } }, { $set: { status: 'delivered', deliveredAt: new Date() } }, { sort: { createdAt: 1 }, new: true });
    return res.json({ ok: true, authorized: true, linked: true, maintenance: false, command: command ? { id: String(command._id), colour: command.colour, dice: command.dice, createdAt: command.createdAt } : null });
  }));

  app.use((error, _req, res, _next) => { console.error(error); res.status(500).json({ ok: false, error: 'internal_server_error' }); });
  const server = app.listen(config.port, '0.0.0.0', () => console.log(`ZYROX API listening on 0.0.0.0:${config.port}`));
  const shutdown = async (signal) => { server.close(); if (config.botMode === 'polling') bot.stop(signal); await mongoose.disconnect(); process.exit(0); };
  process.once('SIGINT', () => shutdown('SIGINT')); process.once('SIGTERM', () => shutdown('SIGTERM'));
}

bootstrap().catch((error) => { console.error('Startup failed:', error); process.exit(1); });
