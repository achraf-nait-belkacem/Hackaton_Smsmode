import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomBytes, timingSafeEqual } from 'crypto';
import { Mutex } from 'async-mutex';

export interface Slot {
  id: string;
  label: string;
  isoStart: string;
  isoEnd: string;
  booked: boolean;
  bookedBy: string | null;
  notificationSent?: boolean;
  notificationMessageId?: string;
  notificationAttempts?: number;
  bookingTime?: number;
  calendarToken?: string;
} 

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const slotsFilePath = path.join(__dirname, '..', 'data', 'slots.json');
const slotsExampleFilePath = path.join(__dirname, '..', 'data', 'slots.example.json');
const mutex = new Mutex();

export function isAvailableSlot(slot: Slot, now = Date.now()): boolean {
  const startTime = Date.parse(slot.isoStart);
  return !slot.booked && Number.isFinite(startTime) && startTime > now;
}

function saveSlots(slots: Slot[]): void {
  const temporaryPath = `${slotsFilePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(slots, null, 2));
  fs.renameSync(temporaryPath, slotsFilePath);
}

function loadSlots(): Slot[] {
  try {
    return JSON.parse(fs.readFileSync(slotsFilePath, 'utf-8')) as Slot[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const slots = JSON.parse(fs.readFileSync(slotsExampleFilePath, 'utf-8')) as Slot[];
    saveSlots(slots);
    return slots;
  }
}

export async function getAllSlots(): Promise<Slot[]> {
  return mutex.runExclusive(async () => {
    return loadSlots();
  });
}

export async function getAvailableSlots(): Promise<Slot[]> {
  const slots = await getAllSlots();
  const now = Date.now();
  return slots.filter(slot => isAvailableSlot(slot, now));
}

export async function getSlotById(slotId: string): Promise<Slot | null> {
  const slots = await getAllSlots();
  return slots.find(slot => slot.id === slotId) || null;
}

export async function bookSlot(slotId: string, phone: string): Promise<boolean> {
  return mutex.runExclusive(async () => {
    const slots = loadSlots();

    const slot = slots.find(s => s.id === slotId);
    if (!slot) {
      throw new Error(`Slot ${slotId} not found`);
    }

    if (!isAvailableSlot(slot)) return false;

    slot.booked = true;
    slot.bookedBy = phone;
    slot.calendarToken = randomBytes(32).toString('hex');

    saveSlots(slots);
    console.log(`✓ Slot ${slotId} booked`);
    return true;
  });
}

export async function cancelSlot(slotId: string, phone: string): Promise<boolean> {
  return mutex.runExclusive(async () => {
    const slots = loadSlots();

    const slot = slots.find(s => s.id === slotId);
    if (!slot) {
      throw new Error(`Slot ${slotId} not found`);
    }

    if (!slot.booked || slot.bookedBy !== phone) {
      return false;
    }

    slot.booked = false;
    slot.bookedBy = null;
    slot.bookingTime = undefined;
    slot.notificationSent = false;
    slot.notificationMessageId = undefined;
    slot.notificationAttempts = 0;
    slot.calendarToken = undefined;

    saveSlots(slots);
    console.log(`✓ Slot ${slotId} cancelled`);
    return true;
  });
}

export async function getSlotByCalendarToken(slotId: string, token: string): Promise<Slot | null> {
  const slot = await getSlotById(slotId);
  if (!slot?.booked || !slot.calendarToken) return null;

  const expected = Buffer.from(slot.calendarToken);
  const received = Buffer.from(token);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;
  return slot;
}

export async function getBookingInfo(slotId: string): Promise<{ booked: boolean; bookedBy: string | null }> {
  const slot = await getSlotById(slotId);
  if (!slot) {
    throw new Error(`Slot ${slotId} not found`);
  }
  return {
    booked: slot.booked,
    bookedBy: slot.bookedBy
  };
}

export async function updateSlot(slotId: string, updates: Partial<Slot>): Promise<Slot | null> {
  return mutex.runExclusive(async () => {
    const slots = loadSlots();

    const slot = slots.find(s => s.id === slotId);
    if (!slot) {
      return null;
    }

    Object.assign(slot, updates);
    saveSlots(slots);
    return slot;
  });
}

export async function getBookedSlots(): Promise<Slot[]> {
  const slots = await getAllSlots();
  return slots.filter(slot => slot.booked === true);
}
