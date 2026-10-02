import assert from 'node:assert/strict';
import test from 'node:test';
import { isAvailableSlot, type Slot } from './slots.js';

const now = Date.parse('2026-01-01T00:00:00Z');

function slot(overrides: Partial<Slot> = {}): Slot {
  return {
    id: 'slot-test',
    label: 'Test appointment',
    isoStart: '2026-01-02T10:00:00Z',
    isoEnd: '2026-01-02T11:00:00Z',
    booked: false,
    bookedBy: null,
    ...overrides,
  };
}

test('availability requires a future valid start time and an unbooked slot', () => {
  assert.equal(isAvailableSlot(slot(), now), true);
  assert.equal(isAvailableSlot(slot({ booked: true }), now), false);
  assert.equal(isAvailableSlot(slot({ isoStart: '2025-12-31T23:59:59Z' }), now), false);
  assert.equal(isAvailableSlot(slot({ isoStart: 'invalid' }), now), false);
});