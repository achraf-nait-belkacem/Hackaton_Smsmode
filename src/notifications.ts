import { SmsmodeRcsClient } from '@smsmode/rcs';
import { requireRcsCallbackUrl } from './config.js';
import { getBookedSlots, updateSlot, Slot } from './slots.js';

const NOTIFICATION_INTERVAL = 60 * 1000; 
const REMINDER_TIME_BEFORE = 2 * 60 * 60 * 1000;
const MAX_REMINDER_ATTEMPTS = 3;

export interface NotificationManager {
  startScheduler: () => void;
  stopScheduler: () => void;
  sendReminderNotification: (slotId: string, phoneNumber: string, slot: Slot) => Promise<void>;
}

export function createNotificationManager(client: SmsmodeRcsClient, companyName: string): NotificationManager {
  let schedulerInterval: NodeJS.Timeout | null = null;

  async function checkAndSendReminders() {
    try {
      const bookedSlots = await getBookedSlots();
      const now = Date.now();

      for (const slot of bookedSlots) {
        const slotTime = new Date(slot.isoStart).getTime();
        const timeUntilSlot = slotTime - now;
        if (slot.notificationSent || !slot.bookedBy || !Number.isFinite(slotTime) || timeUntilSlot <= 0) continue;

        if (slot.notificationMessageId) {
          let status: string | undefined;
          try {
            status = (await client.get(slot.notificationMessageId)).status.value;
          } catch (error) {
            console.error(`Impossible de vérifier le rappel ${slot.id}:`, error);
            continue;
          }

          if (status === 'DELIVERED' || status === 'READ') {
            await updateSlot(slot.id, { notificationSent: true, notificationMessageId: undefined });
            continue;
          }
          if (status === 'ENROUTE' || status === 'SCHEDULED') continue;
          if (status !== 'UNDELIVERED' && status !== 'UNDELIVERABLE') continue;

          await updateSlot(slot.id, { notificationMessageId: undefined });
        }

        if ((slot.notificationAttempts ?? 0) >= MAX_REMINDER_ATTEMPTS) continue;
        if (timeUntilSlot <= REMINDER_TIME_BEFORE) {
          await sendReminderNotification(slot.id, slot.bookedBy, slot);
        }
      }
    } catch (error) {
      console.error('Erreur lors de la vérification des reminders:', error);
    }
  }

  async function sendReminderNotification(slotId: string, phoneNumber: string, slot: Slot) {
    try {
      const attempt = (slot.notificationAttempts ?? 0) + 1;
      await updateSlot(slotId, { notificationAttempts: attempt });
      const slotTime = new Date(slot.isoStart);
      const timeStr = slotTime.toLocaleString('fr-FR', {
        hour: '2-digit',
        minute: '2-digit',
        day: '2-digit',
        month: '2-digit',
      });

      const callbackUrlMo = requireRcsCallbackUrl();
      const message = await client.send({
        recipient: { to: phoneNumber },
        callbackUrlMo,
        body: {
          type: 'TEXT',
          text: `📅 Rappel: Vous avez un rendez-vous à ${companyName} dans 2 heures (${timeStr})`,
          suggestions: [
            {
              type: 'REPLY',
              text: '✅ Confirmé',
              postbackData: `appointment_confirmed_${slotId}`,
            },
            {
              type: 'REPLY',
              text: '❌ Annuler',
              postbackData: `appointment_cancel_${slotId}`,
            },
            {
              type: 'REPLY',
              text: '🔄 Modifier',
              postbackData: `appointment_modify_${slotId}`,
            },
          ],
        },
      });

      const delivered = message.status.value === 'DELIVERED' || message.status.value === 'READ';
      await updateSlot(slotId, {
        notificationMessageId: delivered ? undefined : message.messageId,
        notificationSent: delivered,
      });
      console.log(`✅ Rappel RCS accepté pour le créneau ${slotId} (tentative ${attempt})`);
    } catch (error) {
      console.error(`❌ Erreur lors de l'envoi du rappel pour ${slotId}:`, error);
    }
  }

  function startScheduler() {
    if (schedulerInterval) {
      console.log('Scheduler déjà actif');
      return;
    }

    console.log('Scheduler de notifications lancé');
    schedulerInterval = setInterval(checkAndSendReminders, NOTIFICATION_INTERVAL);
    checkAndSendReminders();
  }

  function stopScheduler() {
    if (schedulerInterval) {
      clearInterval(schedulerInterval);
      schedulerInterval = null;
      console.log('Scheduler de notifications arrêté');
    }
  }

  return {
    startScheduler,
    stopScheduler,
    sendReminderNotification,
  };
}
