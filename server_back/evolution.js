import 'dotenv/config';

const base = (process.env.EVOLUTION_API_URL || '').replace(/\/+$/, '');
const apiKey = process.env.EVOLUTION_API_KEY || '';
const instance = process.env.EVOLUTION_INSTANCE || 'divina-vanidad';

function headers() {
  return { 'Content-Type': 'application/json', apikey: apiKey };
}

async function call(path, options = {}) {
  if (!base) throw new Error('EVOLUTION_API_URL no está configurada.');
  const response = await fetch(`${base}${path}`, { ...options, headers: { ...headers(), ...(options.headers || {}) } });
  const text = await response.text();
  let data; try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!response.ok) throw new Error(data?.message || data?.error || `Evolution API respondió ${response.status}`);
  return data;
}

export async function evolutionHealth() {
  if (!base) return { configured: false };
  try { return { configured: true, ok: true, data: await call(`/instance/connectionState/${encodeURIComponent(instance)}`) }; }
  catch (error) { return { configured: true, ok: false, error: error.message }; }
}

export async function createInstance(webhookUrl) {
  return call('/instance/create', {
    method: 'POST',
    body: JSON.stringify({
      instanceName: instance,
      integration: 'WHATSAPP-BAILEYS',
      qrcode: true,
      webhook: {
        url: webhookUrl,
        byEvents: false,
        base64: true,
        events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE'],
        headers: { authorization: `Bearer ${process.env.EVOLUTION_WEBHOOK_SECRET || ''}` }
      }
    })
  });
}

export async function getConnection() {
  return call(`/instance/connectionState/${encodeURIComponent(instance)}`);
}

export async function getQRCode() {
  return call(`/instance/connect/${encodeURIComponent(instance)}`);
}

export async function sendText(phone, text) {
  const number = String(phone).replace(/\D/g, '');
  try {
    return await call(`/message/sendText/${encodeURIComponent(instance)}`, {
      method: 'POST',
      body: JSON.stringify({
        number,
        options: { delay: 1200, presence: 'composing' },
        textMessage: { text: String(text) }
      })
    });
  } catch (firstError) {
    // Algunas versiones recientes de Evolution esperan `text` en el nivel superior.
    return call(`/message/sendText/${encodeURIComponent(instance)}`, {
      method: 'POST',
      body: JSON.stringify({ number, text: String(text) })
    });
  }
}

export async function setWebhook(webhookUrl) {
  return call(`/webhook/set/${encodeURIComponent(instance)}`, {
    method: 'POST',
    body: JSON.stringify({
      webhook: { url: webhookUrl, byEvents: false, base64: true, events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE'],
        headers: { authorization: `Bearer ${process.env.EVOLUTION_WEBHOOK_SECRET || ''}` } }
    })
  });
}

export function evolutionInstance() { return instance; }
