import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cron from 'node-cron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  initStorage, listCustomers, upsertCustomer, getCustomer, addNote, listNotes,
  listConversations, getConversation, markConversationRead, setConversationStatus,
  addMessage, listMessagesForCustomer, listAppointments, upsertAppointment,
  deleteAppointment, markReminderSent, normalizePhone, dbMode
} from './storage.js';
import { createInstance, getConnection, getQRCode, setWebhook, evolutionHealth, evolutionInstance } from './evolution.js';
import { queueMessage, queueStats } from './message-queue.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 3000);
const FRONTEND_URL = process.env.FRONTEND_URL || '*';

app.use(cors({ origin: FRONTEND_URL === '*' ? true : FRONTEND_URL }));
app.use(express.json({ limit: '200kb' }));

function authorizedWebhook(req) {
  const secret = process.env.EVOLUTION_WEBHOOK_SECRET;
  if (!secret) return true;
  const auth = req.get('authorization') || '';
  return auth === `Bearer ${secret}`;
}

function webhookUrl(req) {
  const explicit = process.env.WEBHOOK_PUBLIC_URL;
  if (explicit) return `${explicit.replace(/\/+$/, '')}/api/webhooks/evolution`;
  return `${req.protocol}://${req.get('host')}/api/webhooks/evolution`;
}

function extractWebhookMessage(payload) {
  const data = payload?.data || payload;
  const key = data?.key || {};
  const remoteJid = key?.remoteJid || data?.remoteJid || data?.sender || '';
  if (!remoteJid || remoteJid.includes('@g.us') || key?.fromMe) return null;
  const phone = normalizePhone(remoteJid.split('@')[0]);
  const text =
    data?.message?.conversation ||
    data?.message?.extendedTextMessage?.text ||
    data?.message?.imageMessage?.caption ||
    data?.body ||
    data?.text ||
    '';
  if (!phone || !text) return null;
  return { phone, text: String(text), id: key?.id || data?.id || '', name: data?.pushName || data?.senderName || 'Cliente WhatsApp' };
}

app.get('/api/health', async (_req,res) => {
  const evo = await evolutionHealth();
  res.json({ ok:true, storage:dbMode(), evolution:evo, instance:evolutionInstance(), queue:queueStats() });
});

app.get('/api/whatsapp/status', async (_req,res) => {
  try { res.json(await getConnection()); } catch(error) { res.status(503).json({ error:error.message }); }
});

app.post('/api/whatsapp/setup', async (req,res) => {
  try {
    const result = await createInstance(webhookUrl(req));
    res.json({ ok:true, result });
  } catch(error) { res.status(500).json({ error:error.message }); }
});

app.get('/api/whatsapp/qr', async (_req,res) => {
  try { res.json(await getQRCode()); } catch(error) { res.status(503).json({ error:error.message }); }
});

app.post('/api/whatsapp/webhook', async (req,res) => {
  try { await setWebhook(webhookUrl(req)); res.json({ok:true}); }
  catch(error) { res.status(500).json({error:error.message}); }
});

app.post('/api/webhooks/evolution', async (req,res) => {
  if (!authorizedWebhook(req)) return res.sendStatus(401);
  res.sendStatus(200);
  try {
    const event = req.body?.event || req.body?.type || '';
    if (String(event).toUpperCase().includes('MESSAGES_UPSERT') || req.body?.data?.key) {
      const message = extractWebhookMessage(req.body);
      if (message) {
        await addMessage({ phone:message.phone, direction:'inbound', body:message.text, externalId:message.id, senderName:message.name });
      }
    }
  } catch(error) { console.error('Webhook Evolution:', error.message); }
});

app.get('/api/conversations', async (_req,res) => res.json(await listConversations()));
app.get('/api/conversations/:id', async (req,res) => {
  const data=await getConversation(req.params.id); if(!data)return res.status(404).json({error:'Conversación no encontrada'}); res.json(data);
});
app.post('/api/conversations/:id/read', async (req,res)=>{await markConversationRead(req.params.id);res.json({ok:true});});
app.patch('/api/conversations/:id/status', async (req,res)=>{try{res.json(await setConversationStatus(req.params.id,req.body.status));}catch(e){res.status(400).json({error:e.message});}});
app.post('/api/conversations/:id/messages', async (req,res)=>{
  try {
    const c=await getConversation(req.params.id); if(!c)return res.status(404).json({error:'Conversación no encontrada'});
    const body=String(req.body.body||'').trim(); if(!body)return res.status(400).json({error:'Mensaje vacío'});
    const result=await queueMessage({phone:c.phone,body,conversationId:c.id,automated:false});
    res.json({ok:true,result});
  } catch(e){res.status(503).json({error:e.message});}
});

app.get('/api/customers', async(req,res)=>res.json(await listCustomers(String(req.query.search||''))));
app.get('/api/customers/:id', async(req,res)=>{const c=await getCustomer(req.params.id);if(!c)return res.status(404).json({error:'Cliente no encontrado'});res.json({...c,notesHistory:await listNotes(c.id),messages:await listMessagesForCustomer(c.id)});});
app.post('/api/customers', async(req,res)=>{try{res.json(await upsertCustomer(req.body));}catch(e){res.status(400).json({error:e.message});}});
app.post('/api/customers/:id/notes', async(req,res)=>{try{res.json(await addNote(req.params.id,req.body.body));}catch(e){res.status(400).json({error:e.message});}});

app.get('/api/appointments', async(_req,res)=>res.json(await listAppointments()));
app.post('/api/appointments', async(req,res)=>{try{res.json(await upsertAppointment(req.body));}catch(e){res.status(400).json({error:e.message});}});
app.delete('/api/appointments/:id', async(req,res)=>{await deleteAppointment(req.params.id);res.json({ok:true});});

function appointmentDateTime(a) { return new Date(`${String(a.date).slice(0,10)}T${String(a.time).slice(0,8)}`); }
function reminderText(a,hours) {
  const dt=appointmentDateTime(a);
  const date=dt.toLocaleDateString('es-CO',{weekday:'long',day:'2-digit',month:'long',timeZone:process.env.TIMEZONE||'America/Bogota'});
  const time=dt.toLocaleTimeString('es-CO',{hour:'numeric',minute:'2-digit',hour12:true,timeZone:process.env.TIMEZONE||'America/Bogota'});
  return `Hola ${a.client_name} 👋\n\nTe recordamos que ${hours===24?'mañana':'hoy'} tienes una cita en DIVINA VANIDAD BS:\n\n📅 ${date}\n🕐 ${time}\n💅 ${a.service_name}\n\nSi necesitas reprogramar, escríbenos por este medio.`;
}
async function processReminders() {
  const appointments=await listAppointments();
  if(process.env.AUTOMATION_ENABLED==='false')return;
  const now=Date.now();
  const hoursList=(process.env.REMINDER_HOURS_BEFORE||'24,2').split(',').map(Number).filter(Number.isFinite);
  for(const a of appointments){
    const target=appointmentDateTime(a).getTime(); const diff=(target-now)/3600000;
    for(const h of hoursList){
      const key=String(h); if(a.reminder_sent?.[key])continue;
      if(Math.abs(diff-h)>0.05)continue;
      try { await queueMessage({phone:a.client_phone,body:reminderText(a,h),automated:true}); await markReminderSent(a.id,key); }
      catch(e){ console.error(`Recordatorio ${a.client_name}:`,e.message); }
    }
  }
}
cron.schedule('* * * * *', processReminders);

const publicDir=path.resolve(__dirname,'../public');
app.use(express.static(publicDir));
app.use((req,res,next)=>{
  if(req.path.startsWith('/api/')) return res.status(404).json({error:'Ruta no encontrada'});
  res.sendFile(path.join(publicDir,'index.html'));
});

await initStorage();
app.listen(PORT,()=>console.log(`🚀 Backend Divina Vanidad en puerto ${PORT} | DB: ${dbMode()} | Evolution: ${evolutionInstance()}`));
