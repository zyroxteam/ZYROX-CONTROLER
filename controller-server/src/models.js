const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  telegramId: { type: String, required: true, unique: true, index: true },
  firstName: { type: String, default: '' },
  username: { type: String, default: '' },
  role: { type: String, enum: ['admin', 'user'], default: 'user', index: true },
  active: { type: Boolean, default: false, index: true },
  deviceIds: [{ type: String }],
  selectedDeviceId: { type: String, default: '' },
  selectedColour: { type: String, enum: ['red', 'green', 'blue', 'yellow'], default: 'red' },
  lastSeenAt: { type: Date, default: Date.now },
}, { timestamps: true, collection: 'zyrox_users' });

const deviceSchema = new mongoose.Schema({
  deviceId: { type: String, required: true, unique: true, index: true },
  secretHash: { type: String, required: true },
  linkedTelegramId: { type: String, default: '', index: true },
  controllerTelegramIds: [{ type: String }],
  authorized: { type: Boolean, default: false, index: true },
  activationKeyHash: { type: String, default: '', index: true },
  activationKeyPreview: { type: String, default: '' },
  keyIssuedToTelegramId: { type: String, default: '', index: true },
  keyIssuedToUsername: { type: String, default: '' },
  keyIssuedToName: { type: String, default: '' },
  keyRequestedAt: { type: Date, default: null },
  keyCreatedAt: { type: Date, default: null },
  keyActivatedAt: { type: Date, default: null },
  keyRevokedAt: { type: Date, default: null },
  appVersion: { type: String, default: '' },
  manufacturer: { type: String, default: '' },
  model: { type: String, default: '' },
  androidVersion: { type: String, default: '' },
  sdkInt: { type: Number, default: null },
  batteryLevel: { type: Number, min: -1, max: 100, default: -1 },
  charging: { type: Boolean, default: false },
  telemetryConsentVersion: { type: String, default: '' },
  onlineAt: { type: Date, default: null, index: true },
  lastTelemetryAt: { type: Date, default: null, index: true },
  registeredAt: { type: Date, default: Date.now },
  adminNotifiedAt: { type: Date, default: null },
  lastOnlineNoticeAt: { type: Date, default: null },
}, { timestamps: true, collection: 'zyrox_devices' });

const commandSchema = new mongoose.Schema({
  deviceId: { type: String, required: true, index: true },
  telegramId: { type: String, required: true },
  colour: { type: String, enum: ['red', 'green', 'blue', 'yellow'], required: true, index: true },
  dice: { type: Number, min: 1, max: 6, required: true },
  status: { type: String, enum: ['pending', 'delivered'], default: 'pending', index: true },
  deliveredAt: { type: Date, default: null },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
}, { timestamps: true, collection: 'zyrox_commands' });
commandSchema.index({ deviceId: 1, status: 1, createdAt: 1 });

const settingSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  value: { type: mongoose.Schema.Types.Mixed, required: true },
}, { timestamps: true, collection: 'zyrox_settings' });

const auditSchema = new mongoose.Schema({
  actorTelegramId: { type: String, required: true },
  action: { type: String, required: true, index: true },
  target: { type: String, default: '' },
  meta: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true, collection: 'zyrox_audit' });
auditSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 });

module.exports = {
  User: mongoose.model('ZyroxUser', userSchema),
  Device: mongoose.model('ZyroxDevice', deviceSchema),
  Command: mongoose.model('ZyroxCommand', commandSchema),
  Setting: mongoose.model('ZyroxSetting', settingSchema),
  Audit: mongoose.model('ZyroxAudit', auditSchema),
};
