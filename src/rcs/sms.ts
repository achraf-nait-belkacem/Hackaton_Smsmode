export async function sendSMS(to: string, text: string, apiKey: string) {
  const response = await fetch('https://rest.smsmode.com/sms/v1/messages', {
    method: 'POST',
    headers: {
      'X-Api-Key': apiKey,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify({
      recipient: { to: to },
      body: { text: text }
    })
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const errorCode = data?.errorCode ?? data?.details?.errorCode;
    const detail = data?.detail ?? data?.details?.detail;
    throw new Error(`Échec de l’envoi SMS (HTTP ${response.status}${errorCode ? `, ${errorCode}` : ''})${detail ? `: ${detail}` : ''}`);
  }
  console.log('SMS de repli accepté');
  return data;
}