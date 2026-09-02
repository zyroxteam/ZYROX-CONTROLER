const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
};

function parseAdminIds() {
  const ids = required('ADMIN_TELEGRAM_IDS').split(',').map((id) => id.trim()).filter(Boolean);
  if (!ids.every((id) => /^\d+$/.test(id))) throw new Error('ADMIN_TELEGRAM_IDS must contain numeric Telegram IDs');
  return [...new Set(ids)];
}

module.exports = {
  loadConfig() {
    return {
      botToken: required('BOT_TOKEN'),
      adminIds: parseAdminIds(),
      adminPublicHandle: process.env.ADMIN_PUBLIC_HANDLE?.trim() || '@ZB_EXPLOIT',
      mongoUri: required('MONGODB_URI'),
      mongoDb: process.env.MONGODB_DB?.trim() || 'zyrox_controller',
      port: Number(process.env.PORT || 8080),
      publicBaseUrl: (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, ''),
      botMode: process.env.BOT_MODE || 'polling',
      webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET?.trim() || '',
      deviceOnlineSeconds: Number(process.env.DEVICE_ONLINE_SECONDS || 90),
      commandTtlMinutes: Number(process.env.COMMAND_TTL_MINUTES || 30),
    };
  },
};
