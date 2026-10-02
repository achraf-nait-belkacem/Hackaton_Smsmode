import ICalGenerator from 'ical-generator';
import { Slot } from './slots.js';

export function generateCalendarFile(slot: Slot): string {
  const cal = ICalGenerator({
    prodId: '//RCS Booking//smsmode//EN',
    name: 'RCS Booking Event',
    timezone: process.env.CALENDAR_TIMEZONE || 'Europe/Paris',
    events: [
      {
        id: slot.id,
        start: new Date(slot.isoStart),
        end: new Date(slot.isoEnd),
        summary: slot.label,
        description: `Événement réservé via RCS Booking\nCréneau: ${slot.label}`,
        location: 'En ligne'
      }
    ]
  });

  return cal.toString();
}
