const test = require('node:test');
const assert = require('node:assert/strict');
const { hashSecret, safeEqualHex, normalizeDeviceId, isValidDeviceId, isValidDeviceSecret, isValidColour } = require('../src/utils');
test('device IDs', () => { assert.equal(normalizeDeviceId(' zrx-ab12cd34ef56 '), 'ZRX-AB12CD34EF56'); assert.equal(isValidDeviceId('ZRX-AB12CD34EF56'), true); assert.equal(isValidDeviceId('bad'), false); });
test('device secrets', () => { assert.equal(isValidDeviceSecret('a'.repeat(32)), true); assert.equal(isValidDeviceSecret('short'), false); });
test('hash compare', () => { assert.equal(safeEqualHex(hashSecret('one'), hashSecret('one')), true); assert.equal(safeEqualHex(hashSecret('one'), hashSecret('two')), false); });
test('colours', () => { for (const c of ['red','green','blue','yellow']) assert.equal(isValidColour(c), true); assert.equal(isValidColour('purple'), false); });
