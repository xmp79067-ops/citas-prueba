import 'dotenv/config';
import { sendText } from './evolution.js';
import { addMessage, getConversation } from './storage.js';

const queue = [];
let running = false;
let sentTimestamps = [];

function now() { return Date.now(); }
function inBusinessHours() {
  const hour = Number(new Intl.DateTimeFormat('es-CO', { timeZone: process.env.TIMEZONE || 'America/Bogota', hour: '2-digit', hour12: false }).format(new Date()));
  const start = Number(process.env.BUSINESS_START_HOUR || 8);
  const end = Number(process.env.BUSINESS_END_HOUR || 19);
  return hour >= start && hour < end;
}
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
function randomDelay() {
  const min = Number(process.env.MESSAGE_MIN_DELAY_MS || 1800);
  const max = Number(process.env.MESSAGE_MAX_DELAY_MS || 4500);
  return Math.floor(min + Math.random() * Math.max(1, max-min));
}
function rateAllowed() {
  const max = Number(process.env.MAX_OUTBOUND_PER_HOUR || 30);
  const cutoff = now() - 3600000;
  sentTimestamps = sentTimestamps.filter(t => t > cutoff);
  return sentTimestamps.length < max;
}

export function queueMessage({ phone, body, conversationId, automated = false }) {
  return new Promise((resolve, reject) => {
    queue.push({ phone, body, conversationId, automated, resolve, reject, enqueuedAt: now() });
    processQueue();
  });
}

async function processQueue() {
  if (running) return;
  running = true;
  while (queue.length) {
    const job = queue.shift();
    try {
      if (job.automated && process.env.AUTOMATION_ENABLED === 'false') throw new Error('Automatización desactivada.');
      if (job.automated && !inBusinessHours()) throw new Error('Fuera del horario de atención.');
      if (!rateAllowed()) { queue.unshift(job); await delay(60000); continue; }
      const conversation = job.conversationId ? await getConversation(job.conversationId) : null;
      if (conversation?.status === 'human' && job.automated) throw new Error('La conversación está tomada por un humano.');
      await delay(randomDelay());
      const result = await sendText(job.phone, job.body);
      sentTimestamps.push(now());
      await addMessage({ phone: job.phone, direction: 'outbound', body: job.body, externalId: result?.key?.id || result?.message?.key?.id || '', senderName: 'Divina Vanidad' });
      job.resolve(result);
    } catch (error) {
      job.reject(error);
    }
  }
  running = false;
}

export function queueStats() {
  return { pending: queue.length, sentLastHour: sentTimestamps.filter(t => t > now()-3600000).length };
}
