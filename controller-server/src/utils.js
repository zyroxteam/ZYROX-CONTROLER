const crypto = require('crypto');
const DEVICE_ID_PATTERN = /^ZRX-[A-Z0-9]{12}$/;
const DEVICE_SECRET_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;
const COLOURS = ['red', 'green', 'blue', 'yellow'];

function hashSecret(value) { return crypto.createHash('sha256').update(value, 'utf8').digest('hex'); }
function safeEqualHex(left, right) {
  if (!left || !right || left.length !== right.length) return false;
  return crypto.timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}
function normalizeDeviceId(value) { return String(value || '').trim().toUpperCase(); }
function isValidDeviceId(value) { return DEVICE_ID_PATTERN.test(normalizeDeviceId(value)); }
function isValidDeviceSecret(value) { return DEVICE_SECRET_PATTERN.test(String(value || '')); }
function isValidColour(value) { return COLOURS.includes(String(value || '').toLowerCase()); }
function userLabel(from = {}) {
  return [from.first_name, from.last_name].filter(Boolean).join(' ').trim() || from.username || String(from.id || 'Unknown');
}

module.exports = { COLOURS, hashSecret, safeEqualHex, normalizeDeviceId, isValidDeviceId, isValidDeviceSecret, isValidColour, userLabel };
