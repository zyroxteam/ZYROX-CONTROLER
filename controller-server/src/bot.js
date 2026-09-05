const { Telegraf, Markup } = require('telegraf');
const { User, Device, Command, Setting, Audit } = require('./models');
const {
  isValidDeviceId, normalizeDeviceId, userLabel, isValidColour, generateActivationKey, hashSecret,
  normalizeActivationKey, isValidActivationKey, activationKeyMatchesDevice,
  toggleAutoSixColour, disableAutoSixColour,
} = require('./utils');

const pendingAdminInput = new Map();
const pendingKeyInput = new Map();
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

function keyAccessKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🔑 ADD YOUR KEY', 'access:addkey')],
    [Markup.button.callback('🎲 OPEN DICE CONTROLS', 'panel:open')],
  ]);
}

function diceKeyboard(selectedColour, autoSixEnabled) {
  return Markup.inlineKeyboard([
    ['red', 'green'].map((c) => Markup.button.callback(`${c === selectedColour ? '✅' : COLOUR_META[c].emoji} ${COLOUR_META[c].label}`, `colour:${c}`)),
    ['blue', 'yellow'].map((c) => Markup.button.callback(`${c === selectedColour ? '✅' : COLOUR_META[c].emoji} ${COLOUR_META[c].label}`, `colour:${c}`)),
    [
      Markup.button.callback(autoSixEnabled ? '✅ ♾ 6 AUTO ON' : '♾ 6 AUTO', 'dice:6'),
      Markup.button.callback('🎲 5', 'dice:5'),
      Markup.button.callback('🎲 4', 'dice:4'),
    ],
    [3, 2, 1].map((n) => Markup.button.callback(`🎲 ${n}`, `dice:${n}`)),
    [Markup.button.callback('🔄 Refresh', 'panel:open'), Markup.button.callback('📱 Devices', 'panel:devices')],
  ]);
}

function isAdmin(config, telegramId) { return config.adminIds.includes(String(telegramId)); }
function approvalRecipients(config) {
  const recipients = [...(config.ownerChatId ? [String(config.ownerChatId)] : []), ...config.adminIds.map(String)];
  return [...new Set(recipients)];
}
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
    await ctx.reply(`Device control add nahi hai.\n\nYour Telegram user ID: ${telegramId}\nApni permanent device key add karne ke liye niche button press karein.`, keyAccessKeyboard());
    return null;
  }
  return user;
}

async function showDicePanel(ctx, config) {
  const user = await getAuthorizedUser(ctx, config);
  if (!user) return;
  if ((await maintenanceEnabled()) && user.role !== 'admin') return ctx.reply('🛠 Controller maintenance mode mein hai.');
  const devices = await Device.find({
    deviceId: { $in: user.deviceIds || [] }, authorized: true,
    controllerTelegramIds: String(ctx.from.id),
  }).sort({ updatedAt: -1 });
  if (!devices.length) return ctx.reply('No connected device. Permanent device key add karein.', keyAccessKeyboard());
  const selected = devices.find((d) => d.deviceId === user.selectedDeviceId) || devices[0];
  if (selected.deviceId !== user.selectedDeviceId) { user.selectedDeviceId = selected.deviceId; await user.save(); }
  const online = selected.onlineAt && Date.now() - selected.onlineAt.getTime() <= config.deviceOnlineSeconds * 1000;
  const colour = isValidColour(user.selectedColour) ? user.selectedColour : 'red';
  const meta = COLOUR_META[colour];
  const autoSixEnabled = (selected.autoSixColours || []).includes(colour);
  await ctx.reply([
    '⚡ ZYROX COLOUR DICE CONTROL', '',
    `Device: ${selected.deviceId}`,
    `App: ${online ? '🟢 Online' : '🔴 Offline'}`,
    `Selected colour: ${meta.emoji} ${meta.label}`,
    `Auto 6: ${autoSixEnabled ? '✅ ON — every roll is 6' : '⚪ OFF'}`, '',
    '6 ko ek baar press karke AUTO ON karein. Dobara 6 press karne par OFF hoga. 5/4/3/2/1 one-time rahenge aur AUTO 6 band kar denge.',
  ].join('\n'), diceKeyboard(colour, autoSixEnabled));
}

async function linkControllerByKey(ctx, config, rawKey) {
  const telegramId = String(ctx.from?.id || '');
  const activationKey = normalizeActivationKey(rawKey);
  if (!isValidActivationKey(activationKey)) {
    await ctx.reply('❌ Invalid key format. Example: LK-DEVICEID-RANDOMKEY', keyAccessKeyboard());
    return false;
  }
  const device = await Device.findOne({ activationKeyHash: hashSecret(activationKey), authorized: true });
  if (!device || !activationKeyMatchesDevice(activationKey, device.deviceId)) {
    await ctx.reply('❌ Key invalid, deleted, ya device abhi active nahi hai. Owner se active key lein.', keyAccessKeyboard());
    await audit(telegramId, 'shared_key_rejected', '', { preview: `••••${activationKey.slice(-6)}` });
    return false;
  }
  const user = await upsertTelegramUser(ctx, { active: true });
  user.deviceIds = [...new Set([...(user.deviceIds || []), device.deviceId])];
  user.selectedDeviceId = device.deviceId;
  await user.save();
  if (!(device.controllerTelegramIds || []).includes(telegramId)) {
    device.controllerTelegramIds = [...new Set([...(device.controllerTelegramIds || []), telegramId])];
    await device.save();
  }
  await audit(telegramId, 'shared_key_controller_added', device.deviceId, {
    username: ctx.from?.username || '', controllerCount: device.controllerTelegramIds.length,
  });
  const username = ctx.from?.username ? `@${ctx.from.username}` : 'No username';
  for (const adminId of approvalRecipients(config)) {
    await ctx.telegram.sendMessage(adminId, `🔑 SHARED KEY ADDED\n\nUser: ${user.firstName || '-'} (${username})\nTelegram ID: ${telegramId}\nDevice ID: ${device.deviceId}\nControllers: ${device.controllerTelegramIds.length}`).catch(() => null);
  }
  await ctx.reply(`✅ KEY ADDED\n\nDevice: ${device.deviceId}\nAb is Telegram account se colour dice control kar sakte hain.`, Markup.inlineKeyboard([[
    Markup.button.callback('🎲 OPEN DICE CONTROLS', 'panel:open'),
  ]]));
  return true;
}

async function activateDevice(_config, _actorTelegramId, _deviceId) {
  return { ok: false, message: 'Direct activation disabled. Device-bound activation key required.' };
}

async function claimOwner(ctx, config) {
  const expected = String(config.ownerUsername || '').replace(/^@/, '').toLowerCase();
  const actual = String(ctx.from?.username || '').toLowerCase();
  const telegramId = String(ctx.from.id);
  const configuredAdmin = isAdmin(config, telegramId);
  if ((!actual || actual !== expected) && !configuredAdmin) {
    await ctx.reply(`Owner setup denied. Ye link sirf @${config.ownerUsername} ya configured admin account ke liye hai.`);
    return false;
  }
  const existing = await Setting.findOne({ key: 'owner_chat_id' }).lean();
  if (existing?.value && String(existing.value) !== telegramId && !configuredAdmin) {
    await ctx.reply('Owner pehle hi kisi doosre Telegram account se securely linked hai.');
    return false;
  }
  await Setting.findOneAndUpdate({ key: 'owner_chat_id' }, { value: telegramId }, { upsert: true });
  config.ownerChatId = telegramId;
  if (!config.adminIds.includes(telegramId)) config.adminIds.unshift(telegramId);
  await upsertTelegramUser(ctx, { role: 'admin', active: true });
  await ctx.reply(`✅ OWNER CONNECTED\n@${config.ownerUsername}\n\nAb first-open Device ID approval messages direct isi chat mein aayenge.`, adminKeyboard());

  const pendingDevices = await Device.find({ authorized: false, keyIssuedToTelegramId: { $ne: '' } }).sort({ keyRequestedAt: -1 }).limit(20).lean();
  for (const device of pendingDevices) {
    const phone = [device.manufacturer, device.model].filter(Boolean).join(' ') || 'Unknown model';
    const battery = device.batteryLevel >= 0 ? `${device.batteryLevel}%${device.charging ? ' ⚡' : ''}` : 'unknown';
    const username = device.keyIssuedToUsername ? `@${device.keyIssuedToUsername}` : 'No username';
    await ctx.telegram.sendMessage(telegramId, `🔐 PENDING KEY REQUEST\n\nUser: ${device.keyIssuedToName || '-'} (${username})\nTelegram ID: ${device.keyIssuedToTelegramId}\nDevice ID: ${device.deviceId}\nPhone: ${phone}\nBattery: ${battery}\nStatus: 🟢 Online`, Markup.inlineKeyboard([[
      Markup.button.callback('🔑 GENERATE KEY', `keygen:${device.keyIssuedToTelegramId}:${device.deviceId}`),
      Markup.button.callback('❌ REJECT', `keyreject:${device.keyIssuedToTelegramId}:${device.deviceId}`),
    ]])).catch(() => null);
  }
  return true;
}

async function connectPayload(ctx, config, rawPayload) {
  const deviceId = normalizeDeviceId(rawPayload);
  if (!isValidDeviceId(deviceId)) {
    await upsertTelegramUser(ctx);
    await ctx.reply(`Welcome to ZYROX CONTROLER.\nYour Telegram user ID: ${ctx.from.id}\n\nApne ya kisi trusted device ko control karne ke liye permanent key add karein.`, keyAccessKeyboard());
    if (await User.exists({ telegramId: String(ctx.from.id), active: true })) await showDicePanel(ctx, config);
    return;
  }
  const device = await Device.findOne({ deviceId });
  if (!device) return ctx.reply('Device registered nahi hai. App open karke GET KEY dobara tap karein.');
  const telegramId = String(ctx.from.id);
  const admin = isAdmin(config, telegramId);
  const user = await upsertTelegramUser(ctx, admin ? { role: 'admin', active: true } : {});

  const alreadyControls = (device.controllerTelegramIds || []).includes(telegramId) || device.linkedTelegramId === telegramId;
  if (device.authorized && alreadyControls) {
    user.active = true;
    user.deviceIds = [...new Set([...(user.deviceIds || []), deviceId])];
    user.selectedDeviceId = deviceId;
    await user.save();
    if (!(device.controllerTelegramIds || []).includes(telegramId)) {
      device.controllerTelegramIds = [...new Set([...(device.controllerTelegramIds || []), telegramId])];
      await device.save();
    }
    await ctx.reply(`✅ Device active: ${deviceId}`);
    return showDicePanel(ctx, config);
  }
  if (device.authorized && !alreadyControls && !admin) {
    return ctx.reply('Device already active hai. Control karne ke liye uski permanent key ADD YOUR KEY mein enter karein.', keyAccessKeyboard());
  }

  device.authorized = false;
  if (device.keyIssuedToTelegramId && device.keyIssuedToTelegramId !== telegramId) {
    device.activationKeyHash = '';
    device.activationKeyPreview = '';
    device.keyCreatedAt = null;
    device.keyActivatedAt = null;
  }
  device.linkedTelegramId = telegramId;
  device.keyIssuedToTelegramId = telegramId;
  device.keyIssuedToUsername = ctx.from.username || '';
  device.keyIssuedToName = user.firstName || userLabel(ctx.from);
  device.keyRequestedAt = new Date();
  await device.save();
  const username = ctx.from.username ? `@${ctx.from.username}` : 'No username';
  const phone = [device.manufacturer, device.model].filter(Boolean).join(' ') || 'Unknown model';
  const battery = device.batteryLevel >= 0 ? `${device.batteryLevel}%${device.charging ? ' ⚡' : ''}` : 'unknown';

  let sent = 0;
  for (const adminId of approvalRecipients(config)) {
    try {
      await ctx.telegram.sendMessage(adminId, `🔐 ACTIVATION KEY REQUEST\n\nUser: ${user.firstName || '-'} (${username})\nTelegram ID: ${telegramId}\nDevice ID: ${deviceId}\nPhone: ${phone}\nBattery: ${battery}\n\nOwner key generate karke is device ko activate kar sakta hai.`, Markup.inlineKeyboard([[
        Markup.button.callback('🔑 GENERATE KEY', `keygen:${telegramId}:${deviceId}`),
        Markup.button.callback('❌ REJECT', `keyreject:${telegramId}:${deviceId}`),
      ]]));
      sent += 1;
    } catch (_) { /* owner must start the bot once */ }
  }
  await audit(telegramId, 'activation_key_requested', deviceId, { username: ctx.from.username || '' });
  return ctx.reply(sent
    ? `✅ Key request ${config.adminPublicHandle} OWNER ko send ho gayi.\n\nDevice: ${deviceId}\nOwner key generate karega; key yahin bot chat mein milegi. App mein key sirf ek baar enter karein.`
    : `⚠️ Request saved hai, lekin OWNER ne bot start nahi kiya. Key ke liye ${config.adminPublicHandle} ko message karein.\nDevice: ${deviceId}`);
}

function createBot(config) {
  const bot = new Telegraf(config.botToken);

  bot.start(async (ctx) => {
    try {
      if (String(ctx.startPayload || '').toLowerCase() === 'owner') await claimOwner(ctx, config);
      else await connectPayload(ctx, config, ctx.startPayload || '');
    } catch (error) { console.error('start handler:', error); await ctx.reply('Temporary server error.'); }
  });
  bot.command('owner', (ctx) => claimOwner(ctx, config));
  bot.command('id', (ctx) => ctx.reply(`Your Telegram user ID: ${ctx.from.id}`));
  bot.command('addkey', async (ctx) => {
    pendingKeyInput.set(String(ctx.from.id), Date.now());
    await upsertTelegramUser(ctx);
    return ctx.reply('🔑 Apni permanent device key send karein.\n\nExample: LK-DEVICEID-RANDOMKEY\n/cancel se stop karein.');
  });
  bot.command('panel', (ctx) => showDicePanel(ctx, config));
  bot.command('admin', async (ctx) => {
    if (!isAdmin(config, ctx.from.id)) return ctx.reply('Admin access denied.');
    await upsertTelegramUser(ctx, { role: 'admin', active: true });
    return ctx.reply(`🛡 ZYROX ADMIN PANEL\nActivation owner: ${config.adminPublicHandle}`, adminKeyboard());
  });

  bot.action('access:addkey', async (ctx) => {
    await ctx.answerCbQuery();
    pendingKeyInput.set(String(ctx.from.id), Date.now());
    await upsertTelegramUser(ctx);
    return ctx.reply('🔑 Apni permanent device key ab send karein.\n\nExample: LK-DEVICEID-RANDOMKEY\n/cancel se stop karein.');
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
    const device = await Device.findOne({
      deviceId: user.selectedDeviceId, authorized: true,
      controllerTelegramIds: String(ctx.from.id),
    });
    if (!device) return ctx.answerCbQuery('No connected device', { show_alert: true });
    const colour = isValidColour(user.selectedColour) ? user.selectedColour : 'red';
    await Command.deleteMany({ deviceId: device.deviceId, colour, status: 'pending' });
    if (dice === 6) {
      const toggled = toggleAutoSixColour(device.autoSixColours, colour);
      const enabled = toggled.enabled;
      device.autoSixColours = toggled.colours;
      await device.save();
      await audit(ctx.from.id, enabled ? 'auto_six_enabled' : 'auto_six_disabled', device.deviceId, { colour });
      await ctx.answerCbQuery(`${COLOUR_META[colour].emoji} ${colour.toUpperCase()} AUTO 6 ${enabled ? 'ON' : 'OFF'}`, { show_alert: true });
      return showDicePanel(ctx, config);
    }
    device.autoSixColours = disableAutoSixColour(device.autoSixColours, colour);
    await device.save();
    await Command.create({ deviceId: device.deviceId, telegramId: String(ctx.from.id), colour, dice, expiresAt: new Date(Date.now() + config.commandTtlMinutes * 60000) });
    await audit(ctx.from.id, 'colour_dice_queued', device.deviceId, { colour, dice, autoSixDisabled: true });
    return ctx.answerCbQuery(`${COLOUR_META[colour].emoji} ${colour.toUpperCase()} dice ${dice} queued once`);
  });

  async function adminOnly(ctx) {
    if (!isAdmin(config, ctx.from?.id)) { await ctx.answerCbQuery('Admin access denied', { show_alert: true }); return false; }
    await ctx.answerCbQuery(); return true;
  }
  bot.action(/^keygen:(\d+):(ZRX-[A-Z0-9]{12})$/, async (ctx) => {
    if (!(await adminOnly(ctx))) return;
    const [, telegramId, deviceId] = ctx.match;
    const device = await Device.findOne({ deviceId });
    if (!device) return ctx.reply('Device not found.', adminKeyboard());
    if (device.keyIssuedToTelegramId && device.keyIssuedToTelegramId !== telegramId) return ctx.reply('Request user mismatch. User ko GET KEY dobara tap karwayein.', adminKeyboard());
    const activationKey = generateActivationKey(deviceId);
    await User.updateMany({ deviceIds: deviceId }, { $pull: { deviceIds: deviceId } });
    await User.updateMany({ selectedDeviceId: deviceId }, { $set: { selectedDeviceId: '' } });
    await Command.deleteMany({ deviceId });
    device.authorized = false;
    device.linkedTelegramId = telegramId;
    device.controllerTelegramIds = [];
    device.autoSixColours = [];
    device.activationKeyHash = hashSecret(activationKey);
    device.activationKeyPreview = `••••${activationKey.slice(-6)}`;
    device.keyIssuedToTelegramId = telegramId;
    device.keyCreatedAt = new Date();
    device.keyActivatedAt = null;
    device.keyRevokedAt = null;
    await device.save();
    await audit(ctx.from.id, 'activation_key_generated', deviceId, { telegramId, preview: device.activationKeyPreview });
    const keyMessage = `🔐 DEVICE ACTIVATION KEY\n\n${activationKey}\n\nDevice ID: ${deviceId}\nYe key sirf isi device ke liye hai. App ke popup mein ek baar paste karke ACTIVATE tap karein.`;
    const delivered = await ctx.telegram.sendMessage(telegramId, keyMessage).then(() => true).catch(() => false);
    return ctx.reply(`✅ KEY GENERATED\n\nUser: ${device.keyIssuedToName || '-'}${device.keyIssuedToUsername ? ` (@${device.keyIssuedToUsername})` : ''}\nTelegram ID: ${telegramId}\nDevice ID: ${deviceId}\nKey: ${activationKey}\n\nUser delivery: ${delivered ? '✅ Sent' : '⚠️ Failed — owner manually share kare'}`, Markup.inlineKeyboard([[
      Markup.button.callback('🗑 DELETE KEY', `keydelete:${deviceId}`),
    ]]));
  });
  bot.action(/^keyreject:(\d+):(ZRX-[A-Z0-9]{12})$/, async (ctx) => {
    if (!(await adminOnly(ctx))) return;
    const [, telegramId, deviceId] = ctx.match;
    const device = await Device.findOne({ deviceId });
    if (device) {
      device.authorized = false; device.linkedTelegramId = ''; device.controllerTelegramIds = []; device.autoSixColours = [];
      device.activationKeyHash = ''; device.activationKeyPreview = '';
      device.keyCreatedAt = null; device.keyActivatedAt = null; device.keyRevokedAt = new Date();
      await device.save();
      await Command.deleteMany({ deviceId });
      await User.updateMany({ deviceIds: deviceId }, { $pull: { deviceIds: deviceId } });
      await User.updateMany({ selectedDeviceId: deviceId }, { $set: { selectedDeviceId: '' } });
    }
    await audit(ctx.from.id, 'activation_key_rejected', deviceId, { telegramId });
    await ctx.telegram.sendMessage(telegramId, `❌ ${deviceId} activation key request rejected by owner.`).catch(() => null);
    return ctx.reply(`Rejected ${telegramId} → ${deviceId}`, adminKeyboard());
  });
  bot.action(/^keydelete:(ZRX-[A-Z0-9]{12})$/, async (ctx) => {
    if (!(await adminOnly(ctx))) return;
    const deviceId = ctx.match[1];
    const device = await Device.findOne({ deviceId });
    if (!device) return ctx.reply('Device not found.', adminKeyboard());
    const affectedTelegramIds = [...new Set([
      ...(device.controllerTelegramIds || []), device.linkedTelegramId, device.keyIssuedToTelegramId,
    ].filter(Boolean).map(String))];
    device.authorized = false; device.linkedTelegramId = ''; device.controllerTelegramIds = []; device.autoSixColours = [];
    device.activationKeyHash = ''; device.activationKeyPreview = '';
    device.keyCreatedAt = null; device.keyActivatedAt = null; device.keyRevokedAt = new Date();
    await device.save();
    await Command.deleteMany({ deviceId });
    await User.updateMany({ deviceIds: deviceId }, { $pull: { deviceIds: deviceId } });
    await User.updateMany({ selectedDeviceId: deviceId }, { $set: { selectedDeviceId: '' } });
    await audit(ctx.from.id, 'activation_key_deleted', deviceId, { affectedTelegramIds });
    for (const affectedId of affectedTelegramIds) {
      await ctx.telegram.sendMessage(affectedId, `🔒 ${deviceId} activation key owner ne delete kar di. Is Telegram account ka control access remove ho gaya.`).catch(() => null);
    }
    return ctx.reply(`🗑 Key deleted, device locked, and ${affectedTelegramIds.length} controller account(s) removed: ${deviceId}`, adminKeyboard());
  });
  bot.action(/^activate:(ZRX-[A-Z0-9]{12})$/, async (ctx) => {
    if (!(await adminOnly(ctx))) return;
    return ctx.reply('Old approval flow disabled. User ko app mein GET KEY tap karwayein.', adminKeyboard());
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
      const identity = d.keyIssuedToTelegramId ? `${d.keyIssuedToName || 'User'}${d.keyIssuedToUsername ? ` (@${d.keyIssuedToUsername})` : ''} • ID ${d.keyIssuedToTelegramId}` : 'No key requester';
      const key = d.activationKeyHash ? `🔐 ${d.activationKeyPreview || 'Key issued'}` : '🔒 No key';
      return `${i + 1}. ${state} ${d.deviceId}\n   ${phone} • 🔋 ${battery}\n   ${identity}\n   ${key} • Controllers: ${(d.controllerTelegramIds || []).length}\n   ${ageLabel(d.lastTelemetryAt || d.onlineAt)}`;
    });
    const actionRows = devices.flatMap((d) => {
      if (d.activationKeyHash) return [[Markup.button.callback(`🗑 Delete key • ${d.deviceId}`, `keydelete:${d.deviceId}`)]];
      if (d.keyIssuedToTelegramId) return [[
        Markup.button.callback(`🔑 Generate • ${d.deviceId}`, `keygen:${d.keyIssuedToTelegramId}:${d.deviceId}`),
        Markup.button.callback('❌', `keyreject:${d.keyIssuedToTelegramId}:${d.deviceId}`),
      ]];
      return [];
    });
    return ctx.reply(`📱 DEVICE STATUS (${devices.length})\n\n${lines.join('\n\n') || 'No devices'}`, actionRows.length ? Markup.inlineKeyboard([...actionRows, [Markup.button.callback('↩️ Admin panel', 'admin:status')]]) : adminKeyboard());
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
    const pending = await Device.find({ authorized: false, keyIssuedToTelegramId: { $ne: '' } }).sort({ keyRequestedAt: -1 }).limit(30).lean();
    const lines = pending.map((d, i) => `${i + 1}. ${d.deviceId}\n   ${d.keyIssuedToName || 'User'}${d.keyIssuedToUsername ? ` (@${d.keyIssuedToUsername})` : ''}\n   Telegram ID: ${d.keyIssuedToTelegramId} • ${ageLabel(d.keyRequestedAt)}`);
    const rows = pending.map((d) => [
      Markup.button.callback(`🔑 Generate • ${d.deviceId}`, `keygen:${d.keyIssuedToTelegramId}:${d.deviceId}`),
      Markup.button.callback('❌', `keyreject:${d.keyIssuedToTelegramId}:${d.deviceId}`),
    ]);
    return ctx.reply(`⏳ PENDING KEY REQUESTS\n\n${lines.join('\n\n') || 'No pending key requests'}`, rows.length ? Markup.inlineKeyboard([...rows, [Markup.button.callback('↩️ Admin panel', 'admin:status')]]) : adminKeyboard());
  });
  bot.action(/^approve:(\d+):(ZRX-[A-Z0-9]{12})$/, async (ctx) => {
    if (!(await adminOnly(ctx))) return;
    return ctx.reply('Old approval flow disabled. User ko app mein GET KEY tap karwayein.', adminKeyboard());
  });
  bot.action(/^reject:(\d+):(ZRX-[A-Z0-9]{12})$/, async (ctx) => {
    if (!(await adminOnly(ctx))) return;
    const [, telegramId, deviceId] = ctx.match;
    await audit(ctx.from.id, 'access_rejected', deviceId, { telegramId });
    await ctx.telegram.sendMessage(telegramId, `❌ ${deviceId} request rejected.`).catch(() => null);
    return ctx.reply('Request rejected.', adminKeyboard());
  });
  bot.command('cancel', async (ctx) => {
    const telegramId = String(ctx.from.id);
    pendingAdminInput.delete(telegramId);
    pendingKeyInput.delete(telegramId);
    return ctx.reply('Cancelled.', isAdmin(config, telegramId) ? adminKeyboard() : keyAccessKeyboard());
  });

  bot.on('text', async (ctx) => {
    const telegramId = String(ctx.from.id);
    const text = ctx.message.text.trim();
    const state = pendingAdminInput.get(telegramId);
    if (!state && (pendingKeyInput.has(telegramId) || isValidActivationKey(text))) {
      pendingKeyInput.delete(telegramId);
      return linkControllerByKey(ctx, config, text);
    }
    if (!state && isAdmin(config, telegramId) && isValidDeviceId(text)) {
      const deviceId = normalizeDeviceId(text);
      const device = await Device.findOne({ deviceId }).lean();
      if (!device) return ctx.reply('Device registered nahi hai. User ko app open karke GET KEY tap karwayein.', adminKeyboard());
      if (!device.keyIssuedToTelegramId) return ctx.reply(`Device ${deviceId} registered hai, lekin user ne bot mein GET KEY request complete nahi ki.`, adminKeyboard());
      if (device.activationKeyHash) return ctx.reply(`Key pehle se generated hai: ${device.activationKeyPreview}. Zarurat ho to delete karke user se request dobara karwayein.`, Markup.inlineKeyboard([[
        Markup.button.callback('🗑 DELETE KEY', `keydelete:${deviceId}`),
      ]]));
      return ctx.reply(`🔐 KEY REQUEST\n\nUser: ${device.keyIssuedToName || '-'}${device.keyIssuedToUsername ? ` (@${device.keyIssuedToUsername})` : ''}\nTelegram ID: ${device.keyIssuedToTelegramId}\nDevice ID: ${deviceId}`, Markup.inlineKeyboard([[
        Markup.button.callback('🔑 GENERATE KEY', `keygen:${device.keyIssuedToTelegramId}:${deviceId}`),
        Markup.button.callback('❌ REJECT', `keyreject:${device.keyIssuedToTelegramId}:${deviceId}`),
      ]]));
    }
    if (!state || !isAdmin(config, telegramId)) return;
    pendingAdminInput.delete(telegramId);
    if (state.action === 'broadcast') {
      const users = await User.find({ active: true }).select('telegramId').lean(); let sent=0, failed=0;
      for (const u of users) { if (config.adminIds.includes(u.telegramId)) continue; try { await ctx.telegram.sendMessage(u.telegramId, `📣 ZYROX BROADCAST\n\n${text}`); sent++; } catch (_) { failed++; } }
      await audit(telegramId, 'broadcast_sent', '', { sent, failed }); return ctx.reply(`Sent: ${sent}, failed: ${failed}`, adminKeyboard());
    }
    if (state.action === 'add') {
      return ctx.reply('Direct add disabled. Device-bound key ke liye user app mein GET KEY tap kare; phir owner GENERATE KEY button use kare.', adminKeyboard());
    }
    if (state.action === 'remove') {
      const value = text.toUpperCase();
      if (/^\d+$/.test(value)) {
        const user = await User.findOne({ telegramId: value }); if (!user) return ctx.reply('User not found.', adminKeyboard());
        await Device.updateMany({ controllerTelegramIds: value }, { $pull: { controllerTelegramIds: value } });
        await Device.updateMany({ linkedTelegramId: value }, { $set: { linkedTelegramId: '' } });
        user.active=false; user.deviceIds=[]; user.selectedDeviceId=''; await user.save();
        return ctx.reply(`Removed user ${value} from all shared device controls`, adminKeyboard());
      }
      if (isValidDeviceId(value)) {
        const device = await Device.findOne({ deviceId: value }); if (!device) return ctx.reply('Device not found.', adminKeyboard());
        device.authorized=false; device.linkedTelegramId=''; device.controllerTelegramIds=[]; device.autoSixColours=[];
        device.activationKeyHash=''; device.activationKeyPreview=''; device.keyRevokedAt=new Date();
        await device.save(); await Command.deleteMany({ deviceId:value });
        await User.updateMany({ deviceIds:value }, { $pull:{deviceIds:value} });
        await User.updateMany({ selectedDeviceId:value }, { $set:{selectedDeviceId:''} });
        return ctx.reply(`Removed device ${value}, key deleted, and all shared controls revoked`, adminKeyboard());
      }
      return ctx.reply('Invalid ID.', adminKeyboard());
    }
  });

  bot.catch((error) => console.error('Telegram bot error:', error));
  return bot;
}

module.exports = { createBot, adminKeyboard, activateDevice };
