const crypto = require('crypto');
const DEVICE_ID_PATTERN = /^ZRX-[A-Z0-9]{12}$/;
const DEVICE_SECRET_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;
const ACTIVATION_KEY_PATTERN = /^LK-[A-Z0-9]{12}-[A-Z0-9]{24}$/;
const KEY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const COLOURS = ['red', 'green', 'blue', 'yellow'];

function hashSecret(value) { return crypto.createHash('sha256').update(value, 'utf8').digest('hex'); }
function safeEqualHex(left, right) {
  if (!left || !right || left.length !== right.length) return false;
  return crypto.timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}
function normalizeDeviceId(value) { return String(value || '').trim().toUpperCase(); }
function isValidDeviceId(value) { return DEVICE_ID_PATTERN.test(normalizeDeviceId(value)); }
function isValidDeviceSecret(value) { return DEVICE_SECRET_PATTERN.test(String(value || '')); }
function normalizeActivationKey(value) { return String(value || '').trim().toUpperCase().replace(/\s+/g, ''); }
function isValidActivationKey(value) { return ACTIVATION_KEY_PATTERN.test(normalizeActivationKey(value)); }
function activationKeyMatchesDevice(value, deviceId) {
  const key = normalizeActivationKey(value);
  const normalizedDeviceId = normalizeDeviceId(deviceId);
  return isValidActivationKey(key) && isValidDeviceId(normalizedDeviceId) && key.slice(3, 15) === normalizedDeviceId.slice(4);
}
function generateActivationKey(deviceId) {
  const normalizedDeviceId = normalizeDeviceId(deviceId);
  if (!isValidDeviceId(normalizedDeviceId)) throw new Error('invalid_device_id');
  let randomPart = '';
  for (let i = 0; i < 24; i += 1) randomPart += KEY_ALPHABET[crypto.randomInt(KEY_ALPHABET.length)];
  return `LK-${normalizedDeviceId.slice(4)}-${randomPart}`;
}
function isValidColour(value) { return COLOURS.includes(String(value || '').toLowerCase()); }
function userLabel(from = {}) {
  return [from.first_name, from.last_name].filter(Boolean).join(' ').trim() || from.username || String(from.id || 'Unknown');
}

module.exports = {
  COLOURS, hashSecret, safeEqualHex, normalizeDeviceId, isValidDeviceId, isValidDeviceSecret,
  normalizeActivationKey, isValidActivationKey, activationKeyMatchesDevice, generateActivationKey,
  isValidColour, userLabel,
};
