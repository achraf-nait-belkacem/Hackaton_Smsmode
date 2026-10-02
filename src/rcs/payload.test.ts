import assert from 'node:assert/strict';
import test from 'node:test';
import { extractClientLocation, extractPostbackData } from './payload.js';

test('postback data takes precedence over display text', () => {
  assert.equal(extractPostbackData({ postbackData: 'slot-1', text: 'Thursday at ten' }), 'slot-1');
  assert.equal(extractPostbackData({ text: 'oui' }), 'oui');
  assert.equal(extractPostbackData({}), '');
});

test('location extraction accepts valid coordinates and rejects out-of-range values', () => {
  assert.deepEqual(extractClientLocation({ body: { latitude: 48.85, longitude: 2.35 } }), {
    latitude: 48.85,
    longitude: 2.35,
  });
  assert.deepEqual(extractClientLocation({ body: { location: { latitude: 48.85, longitude: 2.35 } } }), {
    latitude: 48.85,
    longitude: 2.35,
  });
  assert.equal(extractClientLocation({ body: { latitude: 91, longitude: 2 } }), null);
});