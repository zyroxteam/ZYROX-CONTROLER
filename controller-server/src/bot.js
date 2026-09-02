const { Telegraf, Markup } = require('telegraf');
const { User, Device, Command, Setting, Audit } = require('./models');
const { isValidDeviceId, normalizeDeviceId, userLabel, isValidColour } = require('./utils');

const pendingAdminInput = new Map();
const COLOUR_META = {
  red: { emoji: '🔴', label: 'RED' },
  green: { emoji: '🟢', label: 'GREEN' },
  blue: { emoji: '🔵', label: 'BLUE' },
  yellow: { emoji: '🟡', label: 'YELLOW' },
};

function adminKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('📊 Bot status', 'admin:status'), Markup.button.callback('👥 All users', 'admin:users')],
    [Markup.button.callback('🛠 Maintenance', 'admin:maintenance'), Markup.button.callback('📣 Broadcasting', 'admin:broadcast')],
    [Markup.button.callback('➕ Add user/device', 'admin:add'), Markup.button.callback('➖ Remove user', 'admin:remove')],
    [Markup.button.callback('⏳ Pending', 'admin:pending'), Markup.button.callback('📱 Device status', 'admin:devices')],
    [Markup.button.callback('🎲 Dice panel', 'panel:open')],
  ]);
}

function diceKeyboard(selectedColour) {
  return Markup.inlineKeyboard([
    ['red', 'green'].map((c) => Markup.button.callback(`${c === selectedColour ? '✅' : COLOUR_META[c].emoji} ${COLOUR_META[c].label}`, `colour:${c}`)),
    ['blue', 'yellow'].map((c) => Markup.button.callback(`${c === selectedColour ? '✅' : COLOUR_META[c].emoji} ${COLOUR_META[c].label}`, `colour:${c}`)),
    [6, 5, 4].map((n) => Markup.button.callback(`🎲 ${n}`, `dice:${n}`)),
    [3, 2, 1].map((n) => Markup.button.callback(`🎲 ${n}`, `dice:${n}`)),
    [Markup.button.callback('🔄 Refresh', 'panel:open'), Markup.button.callback('📱 Devices', 'panel:devices')],
  ]);
}

function isAdmin(config, telegramId) { return config.adminIds.includes(String(telegramId)); }
function ageLabel(date) {
  if (!date) return 'never';
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
async function maintenanceEnabled() {
  return Boolean((await Setting.findOne({ key: 'maintenance' }).lean())?.value);
}
async function audit(actorTelegramId, action, target = '', meta = {}) {
  await Audit.create({ actorTelegramId: String(actorTelegramId), action, target, meta });
}

async function upsertTelegramUser(ctx, extra = {}) {
  const from = ctx.from;
  if (!from) return null;
  return User.findOneAndUpdate(
    { telegramId: String(from.id) },
    { $set: { firstName: userLabel(from), username: from.username || '', lastSeenAt: new Date(), ...extra }, $setOnInsert: { telegramId: String(from.id), deviceIds: [] } },
    { upsert: true, new: true },
  );
}

async function getAuthorizedUser(ctx, config) {
  const telegramId = String(ctx.from?.id || '');
  let user = await User.findOne({ telegramId });
  if (isAdmin(config, telegramId)) user = await upsertTelegramUser(ctx, { role: 'admin', active: true });
  if (!user?.active) {
    await ctx.reply(`Access pending.\n\nYour Telegram user ID: ${telegramId}\nAdmin ko ye User ID ya app ka Device ID send karein.`);
    return null;
  }
  return user;
}

async function showDicePanel(ctx, config) {
  const user = await getAuthorizedUser(ctx, config);
  if (!user) return;
  if ((await maintenanceEnabled()) && user.role !== 'admin') return ctx.reply('🛠 Controller maintenance mode mein hai.');
  const devices = await Device.find({ deviceId: { $in: user.deviceIds || [] }, authorized: true, linkedTelegramId: String(ctx.from.id) }).sort({ updatedAt: -1 });
  if (!devices.length) return ctx.reply('No connected device. App mein dice long-press karke “Connect Telegram” tap karein.');
  const selected = devices.find((d) => d.deviceId === user.selectedDeviceId) || devices[0];
  if (selected.deviceId !== user.selectedDeviceId) { user.selectedDeviceId = selected.deviceId; await user.save(); }
  const online = selected.onlineAt && Date.now() - selected.onlineAt.getTime() <= config.deviceOnlineSeconds * 1000;
  const colour = isValidColour(user.selectedColour) ? user.selectedColour : 'red';
  const meta = COLOUR_META[colour];
  await ctx.reply([
    '⚡ ZYROX COLOUR DICE CONTROL', '',
    `Device: ${selected.deviceId}`,
    `App: ${online ? '🟢 Online' : '🔴 Offline'}`,
    `Selected colour: ${meta.emoji} ${meta.label}`, '',
    'Pehle colour select karein, phir next dice value:',
  ].join('\n'), diceKeyboard(colour));
}

async function activateDevice(config, actorTelegramId, deviceId) {
  const device = await Device.findOne({ deviceId });
  if (!device) return { ok: false, message: 'Device registered nahi hai. App ko internet ke saath open karwao.' };
  device.authorized = true;
  await device.save();
  await audit(actorTelegramId, 'device_activated', deviceId);
  return { ok: true, message: `✅ Device activated: ${deviceId}\nAb user app se Connect Telegram karke /panel open kar sakta hai.` };
}

async function connectPayload(ctx, config, rawPayload) {
  const deviceId = normalizeDeviceId(rawPayload);
  if (!isValidDeviceId(deviceId)) {
    await ctx.reply(`Welcome to ZYROX CONTROLER.\nYour Telegram user ID: ${ctx.from.id}\nApp mein dice long-press karke Connect Telegram karein.`);
    if (await User.exists({ telegramId: String(ctx.from.id), active: true })) await showDicePanel(ctx, config);
    return;
  }
  const device = await Device.findOne({ deviceId });
  if (!device) return ctx.reply('Device registered nahi hai. App open karke dobara try karein.');
  const telegramId = String(ctx.from.id);
  let user = await User.findOne({ telegramId });
  const admin = isAdmin(config, telegramId);
  const mayLink = admin || (device.authorized && (user?.active || !device.linkedTelegramId));
  user = await upsertTelegramUser(ctx, admin ? { role: 'admin', active: true } : {});
  if (device.linkedTelegramId && device.linkedTelegramId !== telegramId) return ctx.reply('Ye Device ID kisi aur Telegram account se linked hai.');
  if (!mayLink) {
    await ctx.reply(`⏳ Request admin ${config.adminPublicHandle} ko send ho gayi.\nDevice: ${deviceId}\nTelegram ID: ${telegramId}`);
    for (const adminId of config.adminIds) {
      await ctx.telegram.sendMessage(adminId, `🔔 ACCESS REQUEST\nUser: ${user.firstName}\nTelegram ID: ${telegramId}\nDevice: ${deviceId}`, Markup.inlineKeyboard([[
        Markup.button.callback('✅ Approve', `approve:${telegramId}:${deviceId}`),
        Markup.button.callback('❌ Reject', `reject:${telegramId}:${deviceId}`),
      ]])).catch(() => null);
    }
    return audit(telegramId, 'access_requested', deviceId);
  }
  device.authorized = true;
  device.linkedTelegramId = telegramId;
  await device.save();
  user.active = true;
  user.deviceIds = [...new Set([...(user.deviceIds || []), deviceId])];
  user.selectedDeviceId = deviceId;
  await user.save();
  await audit(telegramId, 'device_linked', deviceId);
  await ctx.reply(`✅ Connected: ${deviceId}`);
  return showDicePanel(ctx, config);
}

function createBot(config) {
  const bot = new Telegraf(config.botToken);

  bot.start(async (ctx) => {
    try { await connectPayload(ctx, config, ctx.startPayload || ''); }
    catch (error) { console.error('start handler:', error); await ctx.reply('Temporary server error.'); }
  });
  bot.command('id', (ctx) => ctx.reply(`Your Telegram user ID: ${ctx.from.id}`));
  bot.command('panel', (ctx) => showDicePanel(ctx, config));
  bot.command('admin', async (ctx) => {
    if (!isAdmin(config, ctx.from.id)) return ctx.reply('Admin access denied.');
    await upsertTelegramUser(ctx, { role: 'admin', active: true });
    return ctx.reply(`🛡 ZYROX ADMIN PANEL\nActivation owner: ${config.adminPublicHandle}`, adminKeyboard());
  });

  bot.action('panel:open', async (ctx) => { await ctx.answerCbQuery(); await showDicePanel(ctx, config); });
  bot.action(/^colour:(red|green|blue|yellow)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const user = await getAuthorizedUser(ctx, config);
    if (!user) return;
    user.selectedColour = ctx.match[1];
    await user.save();
    return showDicePanel(ctx, config);
  });
  bot.action('panel:devices', async (ctx) => {
    await ctx.answerCbQuery();
    const user = await getAuthorizedUser(ctx, config);
    if (!user) return;
    const devices = await Device.find({ deviceId: { $in: user.deviceIds || [] } }).sort({ updatedAt: -1 });
    if (!devices.length) return ctx.reply('No devices connected.');
    return ctx.reply('Select device:', Markup.inlineKeyboard(devices.map((d) => [Markup.button.callback(`${d.deviceId === user.selectedDeviceId ? '✅' : '📱'} ${d.deviceId}`, `select:${d.deviceId}`)])));
  });
  bot.action(/^select:(ZRX-[A-Z0-9]{12})$/, async (ctx) => {
    await ctx.answerCbQuery();
    const user = await getAuthorizedUser(ctx, config); if (!user) return;
    if (!(user.deviceIds || []).includes(ctx.match[1])) return ctx.reply('Device access denied.');
    user.selectedDeviceId = ctx.match[1]; await user.save(); return showDicePanel(ctx, config);
  });
  bot.action(/^dice:([1-6])$/, async (ctx) => {
    const dice = Number(ctx.match[1]);
    const user = await getAuthorizedUser(ctx, config);
    if (!user) return ctx.answerCbQuery('Access denied', { show_alert: true });
    if ((await maintenanceEnabled()) && user.role !== 'admin') return ctx.answerCbQuery('Maintenance mode', { show_alert: true });
    const device = await Device.findOne({ deviceId: user.selectedDeviceId, authorized: true, linkedTelegramId: String(ctx.from.id) });
    if (!device) return ctx.answerCbQuery('No connected device', { show_alert: true });
    const colour = isValidColour(user.selectedColour) ? user.selectedColour : 'red';
    await Command.deleteMany({ deviceId: device.deviceId, colour, status: 'pending' });
    await Command.create({ deviceId: device.deviceId, telegramId: String(ctx.from.id), colour, dice, expiresAt: new Date(Date.now() + config.commandTtlMinutes * 60000) });
    await audit(ctx.from.id, 'colour_dice_queued', device.deviceId, { colour, dice });
    return ctx.answerCbQuery(`${COLOUR_META[colour].emoji} ${colour.toUpperCase()} dice ${dice} queued`);
  });

  async function adminOnly(ctx) {
    if (!isAdmin(config, ctx.from?.id)) { await ctx.answerCbQuery('Admin access denied', { show_alert: true }); return false; }
    await ctx.answerCbQuery(); return true;
  }
  bot.action(/^activate:(ZRX-[A-Z0-9]{12})$/, async (ctx) => {
    if (!(await adminOnly(ctx))) return;
    const result = await activateDevice(config, ctx.from.id, ctx.match[1]);
    return ctx.reply(result.message, adminKeyboard());
  });
  bot.action('admin:status', async (ctx) => {
    if (!(await adminOnly(ctx))) return;
    const since = new Date(Date.now() - config.deviceOnlineSeconds * 1000);
    const [users, activeUsers, devices, online, commands, maintenance] = await Promise.all([
      User.countDocuments(), User.countDocuments({ active: true }), Device.countDocuments(), Device.countDocuments({ onlineAt: { $gte: since } }), Command.countDocuments({ status: 'pending' }), maintenanceEnabled(),
    ]);
    return ctx.reply(`📊 BOT STATUS\nBot: 🟢 Running\nMongoDB: 🟢 Connected\nMaintenance: ${maintenance ? '🟠 ON' : '🟢 OFF'}\nUsers: ${activeUsers}/${users}\nDevices: ${online}/${devices} online\nCommands: ${commands}\nUptime: ${Math.floor(process.uptime()/60)} min`, adminKeyboard());
  });
  bot.action('admin:users', async (ctx) => {
    if (!(await adminOnly(ctx))) return;
    const users = await User.find().sort({ createdAt: -1 }).limit(60).lean();
    return ctx.reply(`👥 ALL USERS\n\n${users.map((u,i) => `${i+1}. ${u.active?'✅':'⏳'} ${u.telegramId} • ${u.firstName||'-'} • ${u.deviceIds?.length||0} device`).join('\n') || 'No users'}`, adminKeyboard());
  });
  bot.action('admin:devices', async (ctx) => {
    if (!(await adminOnly(ctx))) return;
    const devices = await Device.find().sort({ lastTelemetryAt: -1, onlineAt: -1 }).limit(30).lean();
    const lines = devices.map((d, i) => {
      const battery = d.batteryLevel >= 0 ? `${d.batteryLevel}%${d.charging ? ' ⚡' : ''}` : 'unknown';
      const phone = [d.manufacturer, d.model].filter(Boolean).join(' ') || 'Unknown model';
      const state = d.authorized ? '✅' : '⏳';
      return `${i + 1}. ${state} ${d.deviceId}\n   ${phone} • 🔋 ${battery}\n   ${d.linkedTelegramId ? `User ${d.linkedTelegramId}` : 'Not linked'} • ${ageLabel(d.lastTelemetryAt || d.onlineAt)}`;
    });
    return ctx.reply(`📱 DEVICE STATUS (${devices.length})\n\n${lines.join('\n\n') || 'No devices'}`, adminKeyboard());
  });
  bot.action('admin:maintenance', async (ctx) => {
    if (!(await adminOnly(ctx))) return;
    const current = await maintenanceEnabled();
    await Setting.findOneAndUpdate({ key: 'maintenance' }, { value: !current }, { upsert: true });
    await audit(ctx.from.id, 'maintenance_changed', '', { enabled: !current });
    return ctx.reply(`Maintenance ${!current ? 'ON 🟠' : 'OFF 🟢'}`, adminKeyboard());
  });
  for (const action of ['broadcast', 'add', 'remove']) {
    bot.action(`admin:${action}`, async (ctx) => {
      if (!(await adminOnly(ctx))) return;
      pendingAdminInput.set(String(ctx.from.id), { action });
      const prompts = {
        broadcast: '📣 Broadcast message send karein. /cancel to stop.',
        add: '➕ TelegramID DeviceID, sirf TelegramID, ya sirf DeviceID send karein.',
        remove: '➖ Telegram ID ya Device ID send karein.',
      };
      return ctx.reply(prompts[action]);
    });
  }
  bot.action('admin:pending', async (ctx) => {
    if (!(await adminOnly(ctx))) return;
    const pending = await User.find({ active: false }).sort({ updatedAt: -1 }).limit(30).lean();
    return ctx.reply(`⏳ PENDING\n\n${pending.map((u) => `${u.telegramId} • ${u.firstName||'-'}`).join('\n') || 'No pending users'}`, adminKeyboard());
  });
  bot.action(/^approve:(\d+):(ZRX-[A-Z0-9]{12})$/, async (ctx) => {
    if (!(await adminOnly(ctx))) return;
    const [, telegramId, deviceId] = ctx.match;
    const device = await Device.findOne({ deviceId }); if (!device) return ctx.reply('Device not found.');
    device.authorized = true; device.linkedTelegramId = telegramId; await device.save();
    await User.findOneAndUpdate({ telegramId }, { $set: { active: true, selectedDeviceId: deviceId }, $addToSet: { deviceIds: deviceId } }, { upsert: true });
    await audit(ctx.from.id, 'access_approved', deviceId, { telegramId });
    await ctx.telegram.sendMessage(telegramId, `✅ ${deviceId} approved. /panel send karein.`).catch(() => null);
    return ctx.reply(`Approved ${telegramId} → ${deviceId}`, adminKeyboard());
  });
  bot.action(/^reject:(\d+):(ZRX-[A-Z0-9]{12})$/, async (ctx) => {
    if (!(await adminOnly(ctx))) return;
    const [, telegramId, deviceId] = ctx.match;
    await audit(ctx.from.id, 'access_rejected', deviceId, { telegramId });
    await ctx.telegram.sendMessage(telegramId, `❌ ${deviceId} request rejected.`).catch(() => null);
    return ctx.reply('Request rejected.', adminKeyboard());
  });
  bot.command('cancel', async (ctx) => { pendingAdminInput.delete(String(ctx.from.id)); return ctx.reply('Cancelled.', isAdmin(config, ctx.from.id) ? adminKeyboard() : undefined); });

  bot.on('text', async (ctx) => {
    const telegramId = String(ctx.from.id);
    const text = ctx.message.text.trim();
    const state = pendingAdminInput.get(telegramId);
    if (!state && isAdmin(config, telegramId) && isValidDeviceId(text)) {
      const result = await activateDevice(config, telegramId, normalizeDeviceId(text));
      return ctx.reply(result.message, adminKeyboard());
    }
    if (!state || !isAdmin(config, telegramId)) return;
    pendingAdminInput.delete(telegramId);
    if (state.action === 'broadcast') {
      const users = await User.find({ active: true }).select('telegramId').lean(); let sent=0, failed=0;
      for (const u of users) { if (config.adminIds.includes(u.telegramId)) continue; try { await ctx.telegram.sendMessage(u.telegramId, `📣 ZYROX BROADCAST\n\n${text}`); sent++; } catch (_) { failed++; } }
      await audit(telegramId, 'broadcast_sent', '', { sent, failed }); return ctx.reply(`Sent: ${sent}, failed: ${failed}`, adminKeyboard());
    }
    if (state.action === 'add') {
      const parts = text.toUpperCase().split(/\s+/); const userId = parts.find((p) => /^\d+$/.test(p)); const deviceId = parts.find(isValidDeviceId);
      if (!userId && !deviceId) return ctx.reply('Invalid input.', adminKeyboard());
      if (deviceId) {
        const device = await Device.findOne({ deviceId }); if (!device) return ctx.reply('Device registered nahi hai.', adminKeyboard());
        if (device.linkedTelegramId && userId && device.linkedTelegramId !== userId) return ctx.reply('Device kisi aur user se linked hai.', adminKeyboard());
        device.authorized = true; if (userId) device.linkedTelegramId = userId; await device.save();
      }
      if (userId) await User.findOneAndUpdate({ telegramId: userId }, { $set: { active: true, ...(deviceId ? { selectedDeviceId: deviceId } : {}) }, ...(deviceId ? { $addToSet: { deviceIds: deviceId } } : {}) }, { upsert: true });
      await audit(telegramId, 'user_or_device_added', deviceId || userId, { userId, deviceId });
      return ctx.reply(`✅ Added${userId?` user ${userId}`:''}${deviceId?` device ${deviceId}`:''}`, adminKeyboard());
    }
    if (state.action === 'remove') {
      const value = text.toUpperCase();
      if (/^\d+$/.test(value)) {
        const user = await User.findOne({ telegramId: value }); if (!user) return ctx.reply('User not found.', adminKeyboard());
        await Device.updateMany({ linkedTelegramId: value }, { $set: { linkedTelegramId: '', authorized: false } }); user.active=false; user.deviceIds=[]; user.selectedDeviceId=''; await user.save();
        return ctx.reply(`Removed user ${value}`, adminKeyboard());
      }
      if (isValidDeviceId(value)) {
        const device = await Device.findOne({ deviceId: value }); if (!device) return ctx.reply('Device not found.', adminKeyboard());
        const old=device.linkedTelegramId; device.authorized=false; device.linkedTelegramId=''; await device.save(); await Command.deleteMany({ deviceId:value });
        if (old) await User.updateOne({ telegramId:old }, { $pull:{deviceIds:value}, $set:{selectedDeviceId:''} });
        return ctx.reply(`Removed device ${value}`, adminKeyboard());
      }
      return ctx.reply('Invalid ID.', adminKeyboard());
    }
  });

  bot.catch((error) => console.error('Telegram bot error:', error));
  return bot;
}

module.exports = { createBot, adminKeyboard, activateDevice };
