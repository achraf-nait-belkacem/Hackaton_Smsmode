import express from 'express';
import { SmsmodeRcsClient, parseWebhookPayload, isIncomingMessage } from '@smsmode/rcs';
import { RcsIncomingMessagePayload } from '@smsmode/rcs';
import { config, isValidRcsWebhookSecret, requireRcsConfig } from './config.js';
import { generateCalendarFile } from './calendar.js';
import { getAllSlots, getAvailableSlots, getSlotByCalendarToken } from './slots.js';
import { createNotificationManager } from './notifications.js';
import { addGlobalReply, removeGlobalReply, addPhoneReply, removePhoneReply, getAllReplies, getConversationProgress, getHistory, ConversationProgress } from './rcs/sessions.js';
import { DoctorAppointement } from './rcs/DoctorAppointement.js';
import { MapAssistant } from './rcs/map.js';
import { extractPostbackData } from './rcs/payload.js';

const app = express();
app.use(express.json({ limit: '32kb' }));
const webhookApp = express();
webhookApp.use(express.json({ limit: '32kb' }));

webhookApp.get('/calendar/:slotId/:token', async (req, res) => {
  const { slotId, token } = req.params;
  if (typeof slotId !== 'string' || typeof token !== 'string') {
    res.sendStatus(404);
    return;
  }

  try {
    const slot = await getSlotByCalendarToken(slotId, token);
    if (!slot) {
      res.sendStatus(404);
      return;
    }

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="appointment-${slot.id}.ics"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(generateCalendarFile(slot));
  } catch (error) {
    console.error('Erreur lors de la génération du calendrier:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

const apiKey = config.rcsApiKey;
const client = apiKey ? new SmsmodeRcsClient({ apiKey }) : null;
const companyName = config.companyName || 'Cabinet Médical';
const companyDestination = config.companyAddress || companyName;

const sessions = new Map<string, DoctorAppointement>();
const mapAssistants = new Map<string, MapAssistant>();

async function initSessionsForBookedSlots() {
  if (!client) return;
  try {
    const slots = await getAllSlots();
    const replies = await getAllReplies();
    const bookedSlotByPhone = new Map<string, string>();
    for (const slot of slots) {
      if (slot.booked && slot.bookedBy && !bookedSlotByPhone.has(slot.bookedBy)) {
        bookedSlotByPhone.set(slot.bookedBy, slot.id);
      }
    }
    const activeSessionPhones = Object.entries(replies.sessions)
      .filter(([, session]) => {
        const progress = session.conversation;
        return progress && (
          progress.awaitingLocation
          || progress.appointmentStage === 'awaiting_confirmation'
          || progress.appointmentStage === 'awaiting_name'
          || progress.appointmentStage === 'awaiting_schedule'
        );
      })
      .map(([phone]) => phone);
    const phones = new Set([...bookedSlotByPhone.keys(), ...activeSessionPhones]);
    for (const phone of phones) {
      if (!sessions.has(phone)) {
        createSession(phone, replies.sessions[phone]?.conversation, bookedSlotByPhone.get(phone));
        console.log('Session patient restaurée');
      }
    }
    console.log(`${sessions.size} session(s) chargée(s) depuis les créneaux réservés`);
  } catch (err) {
    console.error('Erreur initialisation sessions:', err);
  }
}

app.post('/send-rcs', async (req, res) => {
  const { phone, type } = req.body as { phone?: string; type?: string };

  if (!phone || !/^\d{8,15}$/.test(phone)) {
    res.status(400).json({ error: 'Numéro de téléphone invalide' });
    return;
  }

  if (!client) {
    res.status(500).json({ error: 'RCS_API_KEY manquante: configurez la clé RCS SMSMode dans env/.env.keys ou .env' });
    return;
  }

  try {
    requireRcsConfig();
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
    return;
  }

  const appointmentType = type ?? 'doctor';
  if (appointmentType !== 'doctor') {
    res.status(400).json({ error: `Type inconnu: "${appointmentType}". Types supportés: doctor` });
    return;
  }

  try {
    const session = createSession(phone);
    await session.askForAppointment();
    res.json({ message: 'Message RCS en cours d\'envoi', phone, type: appointmentType });
  } catch (err) {
    console.error('Erreur envoi RCS:', err);
    res.status(500).json({ error: 'Erreur lors de l\'envoi' });
  }
});

function createSession(phone: string, progress?: ConversationProgress, bookedSlotId?: string): DoctorAppointement {
  const restoredProgress = progress
    ? { ...progress, bookedSlotId: progress.bookedSlotId ?? bookedSlotId }
    : bookedSlotId
      ? { appointmentStage: 'completed' as const, bookedSlotId }
      : undefined;
  const map = new MapAssistant(true, phone, client!, companyName, companyDestination, restoredProgress?.awaitingLocation);
  const session = new DoctorAppointement(true, phone, client!, map, companyName, restoredProgress);
  mapAssistants.set(phone, map);
  sessions.set(phone, session);
  return session;
}

async function getOrCreateSession(payload: RcsIncomingMessagePayload): Promise<DoctorAppointement | null> {
  if (!client) return null;
  const phone = payload.recipient.to;
  if (!sessions.has(phone)) {
    console.log('Session patient créée à la volée');
    const [progress, slots] = await Promise.all([getConversationProgress(phone), getAllSlots()]);
    const bookedSlotId = slots.find(slot => slot.booked && slot.bookedBy === phone)?.id;
    createSession(phone, progress, bookedSlotId);
  }
  return sessions.get(phone)!;
}

webhookApp.post(config.rcsWebhookRoute, async (req, res) => {
  const token = req.params.token;
  if (!isValidRcsWebhookSecret(typeof token === 'string' ? token : undefined)) {
    res.sendStatus(401);
    return;
  }
  console.log('Webhook RCS reçu');
  let payload: ReturnType<typeof parseWebhookPayload>;
  try {
    payload = parseWebhookPayload(req.body);
  } catch (error) {
    console.error('Webhook RCS invalide:', error);
    res.sendStatus(400);
    return;
  }

  try {
    if (isIncomingMessage(payload)) {
      const postbackData = extractPostbackData(payload.body);
      const phone = payload.recipient.to;
      const session = await getOrCreateSession(payload);
      if (session) {
        const handled = await session.waitForScheduleResponse(postbackData);
        if (!handled) {
          const mapAssistant = mapAssistants.get(phone);
          if (mapAssistant) await mapAssistant.waitForLocationResponse(payload);
        }
      }
    }
  } catch (error) {
    console.error('Échec du traitement du webhook RCS:', error);
    res.sendStatus(500);
    return;
  }
  res.sendStatus(200);
});

app.get('/api/slots', async (_req, res) => {
  try {
    const slots = await getAllSlots();
    res.json(slots);
  } catch {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.get('/api/slots/available', async (_req, res) => {
  try {
    res.json(await getAvailableSlots());
  } catch {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.get('/api/replies', async (_req, res) => {
  try {
    const data = await getAllReplies();
    res.json({ global: data.global, sessions: Object.fromEntries(
      Object.entries(data.sessions).map(([phone, s]) => [phone, s.customReplies])
    )});
  } catch {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.post('/api/replies/global', async (req, res) => {
  const { command, reply } = req.body;
  if (!command || !reply) { res.status(400).json({ error: 'command et reply requis' }); return; }
  await addGlobalReply(command, reply);
  res.json({ message: 'Réponse globale ajoutée' });
});

app.delete('/api/replies/global/:command', async (req, res) => {
  await removeGlobalReply(req.params.command);
  res.json({ message: 'Réponse globale supprimée' });
});

app.post('/api/replies/:phone', async (req, res) => {
  const { command, reply } = req.body;
  if (!command || !reply) { res.status(400).json({ error: 'command et reply requis' }); return; }
  await addPhoneReply(req.params.phone, command, reply);
  res.json({ message: 'Réponse ajoutée' });
});

app.delete('/api/replies/:phone/:command', async (req, res) => {
  await removePhoneReply(req.params.phone, req.params.command);
  res.json({ message: 'Réponse supprimée' });
});

app.get('/api/sessions/:phone/history', async (req, res) => {
  const history = await getHistory(req.params.phone);
  res.json(history);
});

app.listen(4001, '127.0.0.1', async () => {
  console.log('API du dashboard sur http://localhost:4001');
  await initSessionsForBookedSlots();
  if (client) {
    createNotificationManager(client, companyName).startScheduler();
  }
});

webhookApp.listen(4000, '127.0.0.1', () => {
  console.log('Webhook RCS isolé sur http://localhost:4000');
});
