import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'smsmode-session-test-'));
process.env.SMSMODE_SESSIONS_FILE = join(temporaryDirectory, 'sessions.json');
const { getConversationProgress, setAppointmentProgress, setLocationPending } = await import('./sessions.js');

after(async () => {
  delete process.env.SMSMODE_SESSIONS_FILE;
  await rm(temporaryDirectory, { recursive: true, force: true });
});

test('conversation progress survives storage reload and can clear its booking', async () => {
  await setAppointmentProgress('test-session', 'awaiting_schedule', 'slot-test');
  await setLocationPending('test-session', true);
  assert.deepEqual(await getConversationProgress('test-session'), {
    appointmentStage: 'awaiting_schedule',
    bookedSlotId: 'slot-test',
    awaitingLocation: true,
  });

  await setAppointmentProgress('test-session', 'completed', null);
  assert.deepEqual(await getConversationProgress('test-session'), {
    appointmentStage: 'completed',
    awaitingLocation: true,
  });
});