import { SmsmodeRcsClient, type RcsBody, type RcsMessage } from '@smsmode/rcs';
import { config, requireRcsCallbackUrl } from '../config.js';
import { getAvailableSlots, getAllSlots, bookSlot, getSlotById, Slot, cancelSlot, updateSlot } from '../slots.js';
import { MapAssistant } from './map.js';
import { sendSMS } from './sms.js';
import { AppointmentStage, ConversationProgress, findReply, appendToHistory, addPhoneReply, setAppointmentProgress, setPatientName } from './sessions.js';

const DELIVERY_STATUS_POLL_INTERVAL = 30_000;
const MAX_DELIVERY_STATUS_CHECKS = 5;

function toSmsmodeDateTime(value: string): string {
    return new Date(value).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export class DoctorAppointement
{
    isA2P: boolean;
    phoneNb: string;
    client: SmsmodeRcsClient;
    askForAppointmentMsg: RcsMessage | undefined;
    private state: AppointmentStage;
    private locationAssistant?: MapAssistant;
    private clinicName: string;
    private bookedSlotId?: string;

    constructor(isA2P: boolean, phone_nb: string, client: SmsmodeRcsClient, locationAssistant?: MapAssistant, clinicName: string = 'Cabinet Médical', progress?: ConversationProgress)
    {
        this.isA2P = isA2P;
        this.phoneNb = phone_nb;
        this.client = client;
        this.locationAssistant = locationAssistant;
        this.clinicName = clinicName;
        this.state = progress?.appointmentStage ?? 'idle';
        this.bookedSlotId = progress?.bookedSlotId;
    };

    private async persistProgress(bookedSlotId: string | null = this.bookedSlotId ?? null): Promise<void> {
        this.bookedSlotId = bookedSlotId ?? undefined;
        try {
            await setAppointmentProgress(this.phoneNb, this.state, bookedSlotId);
        } catch (error) {
            console.error('État de conversation non sauvegardé:', error);
        }
    }

    private async sendMessage(body: RcsBody): Promise<RcsMessage> {
        const callbackUrlMo = requireRcsCallbackUrl();
        const result = await this.client.send({
            recipient: { to: this.phoneNb },
            callbackUrlMo,
            body
        });
        const text = 'text' in body ? body.text : JSON.stringify(body);
        try {
            await appendToHistory(this.phoneNb, {
                direction: 'out',
                text,
                timestamp: Date.now(),
                senderName: this.clinicName
            });
        } catch (error) {
            console.error('Message envoyé, mais son historique n’a pas pu être enregistré:', error);
        }
        return result;
    }

    async addCustomReply(command: string, reply: string): Promise<void> {
        await addPhoneReply(this.phoneNb, command, reply);
    }

    async askForAppointment()
    {
        this.askForAppointmentMsg = await this.sendMessage({
            type: "TEXT",
            text: "Bonjour, souhaitez vous prendre un rendez-vous ?",
            suggestions: [
                { type: "REPLY", text: "Oui", postbackData: "oui" },
                { type: "REPLY", text: "Plus tard", postbackData: "plus tard" },
                { type: "REPLY", text: "Pas intéressé", postbackData: "non" },
            ]
        });
        this.state = 'awaiting_confirmation';
        await this.persistProgress();
        console.log('Message RCS accepté', {
            messageId: this.askForAppointmentMsg?.messageId,
            status: this.askForAppointmentMsg?.status?.value
        });

        const messageId = this.askForAppointmentMsg?.messageId;
        if (messageId) {
            setTimeout(() => {
                void this.checkDeliveryStatus(messageId, MAX_DELIVERY_STATUS_CHECKS);
            }, DELIVERY_STATUS_POLL_INTERVAL);
        }
    }

    private async checkDeliveryStatus(messageId: string, checksRemaining: number): Promise<void> {
        if (!config.rcsApiKey) return;

        try {
            const response = await fetch(`https://rest.smsmode.com/rcs/v1/messages/${messageId}`, {
                headers: {
                    'X-Api-Key': config.rcsApiKey,
                    'Accept': 'application/json'
                }
            });
            if (!response.ok) {
                throw new Error(`Vérification du statut RCS refusée (${response.status})`);
            }

            const data = await response.json();
            const status = data.status?.value;
            if (status === 'DELIVERED' || status === 'READ') return;

            if (status === 'UNDELIVERED' || status === 'UNDELIVERABLE') {
                if (!config.smsApiKey) {
                    console.warn('Repli SMS ignoré: configurez SMS_API_KEY avec une clé liée à un canal SMS.');
                    return;
                }
                console.log('Échec définitif RCS, tentative de repli SMS');
                await sendSMS(
                    this.phoneNb,
                    'Bonjour, souhaitez-vous prendre un RDV ? Répondez OUI ou NON.',
                    config.smsApiKey
                );
                return;
            }

            if (status === 'ENROUTE' || status === 'SCHEDULED') {
                if (checksRemaining > 1) {
                    setTimeout(() => {
                        void this.checkDeliveryStatus(messageId, checksRemaining - 1);
                    }, DELIVERY_STATUS_POLL_INTERVAL);
                } else {
                    console.warn('RCS toujours en attente; repli SMS non envoyé pour éviter un doublon.');
                }
                return;
            }

            console.warn(`Statut RCS non reconnu (${String(status)}); aucun repli SMS envoyé.`);
        } catch (error) {
            console.error('Impossible de vérifier le statut RCS ou d’envoyer le SMS de repli:', error);
        }
    }

    async askForName(): Promise<void> {
        await this.sendMessage({
            type: "TEXT" as const,
            text: "Quel est votre prénom ?"
        });
        this.state = 'awaiting_name';
        await this.persistProgress();
        console.log('Question prénom envoyée ✅');
    }

    async askForSchedule() {
        const slots = await getAvailableSlots();
        if (slots.length === 0) {
            this.state = 'completed';
            await this.sendMessage({
                type: 'TEXT' as const,
                text: 'Aucun créneau n’est disponible pour le moment. Vous pourrez réessayer plus tard en envoyant RDV.'
            });
            await this.persistProgress();
            return;
        }

        const suggestions: Array<{ type: "REPLY"; text: string; postbackData: string }> = slots.slice(0, 11).map((slot: Slot) => ({
            type: "REPLY" as const,
            text: slot.label,
            postbackData: slot.id
        }));

        await this.sendMessage({
            type: "TEXT" as const,
            text: "Quel créneau vous convient le mieux ?",
            suggestions
        });

        this.state = 'awaiting_schedule';
        await this.persistProgress();
        console.log('Créneaux envoyés ✅');
    }

    async waitForScheduleResponse(text: string) {

        const customReply = await findReply(text, this.phoneNb);
        if (customReply) {
            await appendToHistory(this.phoneNb, {
                direction: 'in', text, timestamp: Date.now(), senderName: this.phoneNb
            });
            await this.sendMessage({ type: "TEXT" as const, text: customReply });
            return true;
        }

        const lowerText = text.toLowerCase().trim();

        if (lowerText === 'rdv') {
            if (this.state === 'idle' || this.state === 'completed') {
                await appendToHistory(this.phoneNb, {
                    direction: 'in', text, timestamp: Date.now(), senderName: this.phoneNb
                });
                await this.askForAppointment();
                return true;
            }
            return false;
        }

        if (lowerText === 'annuler') {
            await appendToHistory(this.phoneNb, {
                direction: 'in', text, timestamp: Date.now(), senderName: this.phoneNb
            });
            await this.sendCancelMenu();
            return true;
        }

        if (lowerText === 'modifier') {
            await appendToHistory(this.phoneNb, {
                direction: 'in', text, timestamp: Date.now(), senderName: this.phoneNb
            });
            await this.sendModifyMenu();
            return true;
        }

        if (text === 'calendar_event_confirmed' || text === 'calendar_declined') {
            await appendToHistory(this.phoneNb, {
                direction: 'in', text, timestamp: Date.now(), senderName: this.phoneNb
            });
            if (this.locationAssistant) {
                await this.locationAssistant.askForLocation();
            }
            return true;
        }

        if (text === 'reschedule_appointment' && this.bookedSlotId) {
            await appendToHistory(this.phoneNb, {
                direction: 'in', text, timestamp: Date.now(), senderName: this.phoneNb
            });
            await this.sendModificationMessage(this.bookedSlotId);
            return true;
        }

        if (text === 'cancel_appointment' && this.bookedSlotId) {
            await appendToHistory(this.phoneNb, {
                direction: 'in', text, timestamp: Date.now(), senderName: this.phoneNb
            });
            await this.sendCancellationMessage(this.bookedSlotId);
            return true;
        }

        if (text.startsWith('appointment_confirmed_')) {
            await appendToHistory(this.phoneNb, {
                direction: 'in', text, timestamp: Date.now(), senderName: this.phoneNb
            });
            const slotId = text.replace('appointment_confirmed_', '');
            await this.sendConfirmationMessage(slotId);
            return true;
        }

        if (text.startsWith('appointment_cancel_')) {
            await appendToHistory(this.phoneNb, {
                direction: 'in', text, timestamp: Date.now(), senderName: this.phoneNb
            });
            const slotId = text.replace('appointment_cancel_', '');
            await this.sendCancellationMessage(slotId);
            return true;
        }

        if (text.startsWith('appointment_modify_')) {
            await appendToHistory(this.phoneNb, {
                direction: 'in', text, timestamp: Date.now(), senderName: this.phoneNb
            });
            const slotId = text.replace('appointment_modify_', '');
            await this.sendModificationMessage(slotId);
            return true;
        }

        if (this.state === 'awaiting_confirmation' && text === 'oui') {
            await appendToHistory(this.phoneNb, {
                direction: 'in', text, timestamp: Date.now(), senderName: this.phoneNb
            });
            await this.askForName();
            return true;

        } else if (this.state === 'awaiting_name') {
            const name = text.trim();
            await setPatientName(this.phoneNb, name);
            await appendToHistory(this.phoneNb, {
                direction: 'in', text: name, timestamp: Date.now(), senderName: name
            });
            await this.askForSchedule();
            return true;

        } else if (this.state === 'awaiting_confirmation' && text === 'non') {
            await appendToHistory(this.phoneNb, {
                direction: 'in', text, timestamp: Date.now(), senderName: this.phoneNb
            });
            await this.sendGoodbye();
            this.state = 'idle';
            await this.persistProgress(null);
            return true;

        } else if (this.state === 'awaiting_confirmation' && text === 'plus tard') {
            await appendToHistory(this.phoneNb, {
                direction: 'in', text, timestamp: Date.now(), senderName: this.phoneNb
            });
            await this.sendReminder();
            this.state = 'idle';
            await this.persistProgress(null);
            return true;

        } else if (this.state === 'awaiting_schedule') {
            await appendToHistory(this.phoneNb, {
                direction: 'in', text, timestamp: Date.now(), senderName: this.phoneNb
            });
            const booked = await bookSlot(text, this.phoneNb);
            if (!booked) {
                await this.sendMessage({
                    type: 'TEXT' as const,
                    text: 'Ce créneau vient d’être pris ou n’existe plus. Choisissez-en un autre.'
                });
                await this.askForSchedule();
                return true;
            }
            await updateSlot(text, { bookingTime: Date.now(), notificationSent: false });
            try {
                await this.sendCalendar(text);
                this.state = 'completed';
                await this.persistProgress();
            } catch (error) {
                await cancelSlot(text, this.phoneNb);
                this.state = 'completed';
                await this.persistProgress(null);
                console.error('Confirmation RCS refusée; le créneau est libéré:', error);
                try {
                    await this.sendMessage({
                        type: 'TEXT' as const,
                        text: 'Nous n’avons pas pu confirmer ce créneau et l’avons libéré. Envoyez RDV pour choisir un autre créneau.'
                    });
                } catch (messageError) {
                    console.error('Impossible d’informer le patient de l’échec de confirmation:', messageError);
                }
            }
            return true;
        }

        return false;
    }

    async sendCancelMenu() {
        const allSlots = await getAllSlots();
        const mySlots = allSlots.filter((s: Slot) => s.booked && s.bookedBy === this.phoneNb);

        if (mySlots.length === 0) {
            await this.sendMessage({
                type: "TEXT" as const,
                text: "Vous n'avez aucun rendez-vous à annuler."
            });
            return;
        }

        const suggestions = mySlots.map((s: Slot) => ({
            type: "REPLY" as const,
            text: s.label,
            postbackData: `appointment_cancel_${s.id}`
        }));

        const text = mySlots.length === 1
            ? `Voulez-vous annuler votre rendez-vous du ${mySlots[0].label} ?`
            : "Quel rendez-vous souhaitez-vous annuler ?";

        await this.sendMessage({
            type: "TEXT" as const,
            text,
            suggestions
        });
    }

    async sendModifyMenu() {
        const allSlots = await getAllSlots();
        const mySlots = allSlots.filter((s: Slot) => s.booked && s.bookedBy === this.phoneNb);

        if (mySlots.length === 0) {
            await this.sendMessage({
                type: "TEXT" as const,
                text: "Vous n'avez aucun rendez-vous à modifier."
            });
            return;
        }

        if (mySlots.length === 1) {
            await this.sendModificationMessage(mySlots[0].id);
            return;
        }

        const suggestions = mySlots.map((s: Slot) => ({
            type: "REPLY" as const,
            text: s.label,
            postbackData: `appointment_modify_${s.id}`
        }));

        await this.sendMessage({
            type: "TEXT" as const,
            text: "Quel rendez-vous souhaitez-vous modifier ?",
            suggestions
        });
    }

    async sendGoodbye() {
        await this.sendMessage({
            type: "TEXT" as const,
            text: "D'accord, n'hésitez pas à nous recontacter si vous changez d'avis ! 😊"
        });
        console.log('Message au revoir envoyé ✅');
    }

    async sendReminder() {
        await this.sendMessage({
            type: "TEXT" as const,
            text: "Pas de souci, on vous recontacte bientôt ! 😊"
        });
        console.log('Message rappel envoyé ✅');
    }

    async sendCalendar(slotId: string) {
        const slot = await getSlotById(slotId);

        if (!slot || !slot.booked || slot.bookedBy !== this.phoneNb || !slot.calendarToken) {
            throw new Error('Créneau réservé ou jeton calendrier introuvable');
        }

        const callbackUrl = new URL(requireRcsCallbackUrl());
        const calendarUrl = new URL(
            `/calendar/${encodeURIComponent(slot.id)}/${slot.calendarToken}`,
            callbackUrl.origin
        ).toString();

        this.bookedSlotId = slotId;
        await this.sendMessage({
            type: "TEXT" as const,
            text: "Merci ! Votre RDV est confirmé. Ajoutez-le à votre calendrier :",
            suggestions: [
                {
                    type: "CREATE_CALENDAR_EVENT" as const,
                    text: "Ajouter au calendrier",
                    postbackData: "calendar_event_confirmed",
                    title: "RDV Dr Dubois",
                    description: "Consultation médicale",
                    startTime: toSmsmodeDateTime(slot.isoStart),
                    endTime: toSmsmodeDateTime(slot.isoEnd)
                },
                {
                    type: 'OPEN_URL' as const,
                    text: 'Télécharger .ics',
                    postbackData: 'download_calendar_ics',
                    url: calendarUrl,
                    webviewSize: 'FULL'
                },
                { type: "REPLY" as const, text: "Non merci", postbackData: "calendar_declined" },
                { type: "REPLY" as const, text: "Choisir un autre créneau", postbackData: "reschedule_appointment" },
                { type: "REPLY" as const, text: "Annuler le RDV", postbackData: "cancel_appointment" },
            ]
        });
        console.log('Message calendrier envoyé ✅');
    }

    async sendConfirmationMessage(slotId: string) {
        const slot = await getSlotById(slotId);
        if (!slot || !slot.booked || slot.bookedBy !== this.phoneNb) {
            console.error('Slot non trouvé pour confirmation');
            return;
        }

        await this.sendMessage({
            type: 'TEXT' as const,
            text: `✅ Merci pour votre confirmation! Votre rendez-vous du ${slot.label} est bien confirmé. À bientôt!`,
        });

        console.log(`✅ Message de confirmation envoyé pour le créneau ${slotId}`);
    }

    async sendCancellationMessage(slotId: string) {
        const slot = await getSlotById(slotId);
        if (!slot || !slot.booked || slot.bookedBy !== this.phoneNb) {
            console.error('Slot non trouvé pour annulation');
            return;
        }

        const cancelled = await cancelSlot(slotId, this.phoneNb);
        if (!cancelled) {
            await this.sendMessage({ type: 'TEXT' as const, text: 'Ce rendez-vous a déjà été annulé ou n’est pas associé à votre numéro.' });
            return;
        }
        if (this.bookedSlotId === slotId) this.bookedSlotId = undefined;

        await this.sendMessage({
            type: 'TEXT' as const,
            text: `❌ Votre rendez-vous du ${slot.label} a été annulé. N'hésitez pas à nous recontacter pour en prendre un autre!`,
        });
        this.state = 'completed';
        await this.persistProgress(null);

        console.log(`❌ Rendez-vous ${slotId} annulé`);
    }

    async sendModificationMessage(slotId: string) {
        const currentSlot = await getSlotById(slotId);

        if (!currentSlot || !currentSlot.booked || currentSlot.bookedBy !== this.phoneNb) {
            console.error('Slot non trouvé pour modification');
            return;
        }

        const cancelled = await cancelSlot(slotId, this.phoneNb);
        if (!cancelled) {
            await this.sendMessage({ type: 'TEXT' as const, text: 'Ce rendez-vous a déjà été annulé ou n’est pas associé à votre numéro.' });
            return;
        }
        if (this.bookedSlotId === slotId) this.bookedSlotId = undefined;

        const availableSlots = await getAvailableSlots();

        const suggestions: Array<{ type: "REPLY"; text: string; postbackData: string }> = availableSlots.slice(0, 11).map((slot: Slot) => ({
            type: "REPLY" as const,
            text: slot.label,
            postbackData: slot.id
        }));

        await this.sendMessage({
            type: 'TEXT' as const,
            text: `🔄 Votre rendez-vous du ${currentSlot.label} a été annulé. Quel autre créneau vous convient?`,
            suggestions
        });

        this.state = 'awaiting_schedule';
        await this.persistProgress(null);
        console.log(`🔄 Demande de modification envoyée pour le créneau ${slotId}`);
    }
}
