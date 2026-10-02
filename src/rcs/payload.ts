type JsonRecord = Record<string, unknown>;

export type ClientLocation = {
  latitude: number;
  longitude: number;
};

function asRecord(value: unknown): JsonRecord | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return value as JsonRecord;
}

export function extractPostbackData(body: unknown): string {
  const record = asRecord(body);
  if (typeof record?.postbackData === 'string') return record.postbackData;
  if (typeof record?.text === 'string') return record.text;
  return '';
}

export function extractClientLocation(payload: unknown): ClientLocation | null {
  const body = asRecord(asRecord(payload)?.body);
  if (!body) return null;

  const location = asRecord(body.location);
  const latitude = body.latitude ?? location?.latitude;
  const longitude = body.longitude ?? location?.longitude;
  if (typeof latitude === 'number' && typeof longitude === 'number') {
    return isValidLocation(latitude, longitude) ? { latitude, longitude } : null;
  }

  if (typeof body.text !== 'string') return null;
  const match = body.text.trim().match(/(-?\d{1,3}(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:[.,]\d+)?)/);
  if (!match) return null;

  const parsedLatitude = Number.parseFloat(match[1].replace(',', '.'));
  const parsedLongitude = Number.parseFloat(match[2].replace(',', '.'));
  return isValidLocation(parsedLatitude, parsedLongitude)
    ? { latitude: parsedLatitude, longitude: parsedLongitude }
    : null;
}

function isValidLocation(latitude: number, longitude: number): boolean {
  return Number.isFinite(latitude)
    && Number.isFinite(longitude)
    && latitude >= -90
    && latitude <= 90
    && longitude >= -180
    && longitude <= 180;
}