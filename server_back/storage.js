import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const localFile = path.resolve(__dirname, process.env.LOCAL_DATA_FILE || './data/app.json');

const empty = {
  customers: [],
  tags: [],
  conversations: [],
  messages: [],
  notes: [],
  appointments: []
};

let pool = null;
if (process.env.DATABASE_URL) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes('railway') ? { rejectUnauthorized: false } : undefined,
    max: 5
  });
}

export function dbMode() {
  return pool ? 'postgres' : 'json-local';
}

function id(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

async function localRead() {
  try {
    return { ...empty, ...(JSON.parse(await fs.readFile(localFile, 'utf8'))) };
  } catch {
    await fs.mkdir(path.dirname(localFile), { recursive: true });
    await fs.writeFile(localFile, JSON.stringify(empty, null, 2));
    return structuredClone(empty);
  }
}

let localWriteTimer = null;
async function localWrite(data) {
  if (localWriteTimer) clearTimeout(localWriteTimer);
  localWriteTimer = setTimeout(async () => {
    await fs.mkdir(path.dirname(localFile), { recursive: true });
    await fs.writeFile(localFile, JSON.stringify(data, null, 2));
  }, 100);
}

async function ensureSchema() {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS crm_customers (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, phone TEXT NOT NULL UNIQUE,
      email TEXT, birthday DATE, notes TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS crm_tags (
      id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS crm_customer_tags (
      customer_id TEXT NOT NULL REFERENCES crm_customers(id) ON DELETE CASCADE,
      tag_id TEXT NOT NULL REFERENCES crm_tags(id) ON DELETE CASCADE,
      PRIMARY KEY(customer_id, tag_id)
    );
    CREATE TABLE IF NOT EXISTS crm_conversations (
      id TEXT PRIMARY KEY, customer_id TEXT REFERENCES crm_customers(id) ON DELETE SET NULL,
      phone TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'bot',
      unread_count INTEGER NOT NULL DEFAULT 0, last_message_at TIMESTAMPTZ,
      last_message_preview TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS crm_messages (
      id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES crm_conversations(id) ON DELETE CASCADE,
      direction TEXT NOT NULL CHECK(direction IN ('inbound','outbound')), sender_name TEXT,
      body TEXT NOT NULL, message_type TEXT NOT NULL DEFAULT 'text', external_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_crm_messages_conversation_created
      ON crm_messages(conversation_id, created_at);
    CREATE TABLE IF NOT EXISTS crm_notes (
      id TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES crm_customers(id) ON DELETE CASCADE,
      body TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS appointments (
      id TEXT PRIMARY KEY, client_name TEXT NOT NULL, client_phone TEXT NOT NULL,
      date DATE NOT NULL, time TIME NOT NULL, service_name TEXT NOT NULL DEFAULT 'Servicio',
      duration INTEGER NOT NULL DEFAULT 60, status TEXT NOT NULL DEFAULT 'pendiente',
      reminder_sent JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_appointments_date ON appointments(date);
  `);
}

export async function initStorage() {
  await ensureSchema();
}

function normalizePhone(phone) {
  let d = String(phone || '').replace(/\D/g, '');
  if (d.length === 10 && d.startsWith('3')) d = `57${d}`;
  return d;
}

export async function listCustomers(search = '') {
  if (pool) {
    const q = `%${search.trim()}%`;
    const { rows } = await pool.query(
      `SELECT * FROM crm_customers
       WHERE ($1 = '' OR name ILIKE $2 OR phone ILIKE $2)
       ORDER BY updated_at DESC LIMIT 200`, [search.trim(), q]);
    return rows;
  }
  const d = await localRead();
  return d.customers.filter(c => !search || c.name.toLowerCase().includes(search.toLowerCase()) || c.phone.includes(search));
}

export async function upsertCustomer(input) {
  const phone = normalizePhone(input.phone);
  const name = String(input.name || 'Cliente').trim();
  if (!phone) throw new Error('El teléfono es obligatorio.');
  if (pool) {
    const { rows } = await pool.query(
      `INSERT INTO crm_customers (id,name,phone,email,birthday,notes,status)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT(phone) DO UPDATE SET name=EXCLUDED.name,email=EXCLUDED.email,
       birthday=EXCLUDED.birthday,notes=EXCLUDED.notes,status=EXCLUDED.status,updated_at=NOW()
       RETURNING *`,
      [input.id || id('cus'), name, phone, input.email || null, input.birthday || null, input.notes || '', input.status || 'active']);
    return rows[0];
  }
  const d = await localRead();
  let c = d.customers.find(x => x.phone === phone);
  if (!c) { c = { id: input.id || id('cus'), name, phone, email: input.email || '', birthday: input.birthday || '', notes: input.notes || '', status: input.status || 'active', created_at: new Date().toISOString(), updated_at: new Date().toISOString() }; d.customers.push(c); }
  else Object.assign(c, { name, email: input.email || '', birthday: input.birthday || '', notes: input.notes || '', status: input.status || 'active', updated_at: new Date().toISOString() });
  await localWrite(d); return c;
}

export async function getCustomer(idValue) {
  if (pool) {
    const { rows } = await pool.query('SELECT * FROM crm_customers WHERE id=$1', [idValue]);
    return rows[0] || null;
  }
  const d = await localRead(); return d.customers.find(x => x.id === idValue) || null;
}

export async function addNote(customerId, body) {
  const note = { id: id('note'), customer_id: customerId, body: String(body).trim(), created_at: new Date().toISOString() };
  if (pool) {
    const { rows } = await pool.query('INSERT INTO crm_notes(id,customer_id,body) VALUES($1,$2,$3) RETURNING *', [note.id, customerId, note.body]);
    return rows[0];
  }
  const d = await localRead(); d.notes.push(note); await localWrite(d); return note;
}

export async function listNotes(customerId) {
  if (pool) {
    const { rows } = await pool.query('SELECT * FROM crm_notes WHERE customer_id=$1 ORDER BY created_at DESC', [customerId]); return rows;
  }
  const d = await localRead(); return d.notes.filter(n => n.customer_id === customerId).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
}

async function findOrCreateCustomerByPhone(phone, name = 'Cliente WhatsApp') {
  const normalized = normalizePhone(phone);
  if (pool) {
    const { rows } = await pool.query('SELECT * FROM crm_customers WHERE phone=$1', [normalized]);
    if (rows[0]) return rows[0];
    return upsertCustomer({ name, phone: normalized });
  }
  const d = await localRead();
  let c = d.customers.find(x => x.phone === normalized);
  if (!c) { c = await upsertCustomer({ name, phone: normalized }); }
  return c;
}

export async function upsertConversation(phone, customerName='Cliente WhatsApp') {
  const normalized = normalizePhone(phone);
  const customer = await findOrCreateCustomerByPhone(normalized, customerName);
  if (pool) {
    const { rows } = await pool.query(
      `INSERT INTO crm_conversations(id,customer_id,phone)
       VALUES($1,$2,$3)
       ON CONFLICT(phone) DO UPDATE SET customer_id=COALESCE(crm_conversations.customer_id,EXCLUDED.customer_id),updated_at=NOW()
       RETURNING *`, [id('conv'), customer.id, normalized]);
    return rows[0];
  }
  const d = await localRead();
  let c = d.conversations.find(x => x.phone === normalized);
  if (!c) { c = { id: id('conv'), customer_id: customer.id, phone: normalized, status: 'bot', unread_count: 0, last_message_at: null, last_message_preview: '', created_at: new Date().toISOString(), updated_at: new Date().toISOString() }; d.conversations.push(c); }
  await localWrite(d); return c;
}

export async function addMessage({ phone, direction, body, externalId='', senderName='Cliente WhatsApp', messageType='text' }) {
  const conv = await upsertConversation(phone, senderName);
  const msg = { id: id('msg'), conversation_id: conv.id, direction, body: String(body || ''), external_id: externalId || null, sender_name: senderName || null, message_type: messageType || 'text', created_at: new Date().toISOString() };
  if (pool) {
    const { rows } = await pool.query(
      `INSERT INTO crm_messages(id,conversation_id,direction,sender_name,body,message_type,external_id)
       VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [msg.id, conv.id, direction, msg.sender_name, msg.body, msg.message_type, msg.external_id]);
    await pool.query(
      `UPDATE crm_conversations SET last_message_at=NOW(),last_message_preview=$1,
       unread_count=CASE WHEN $2='inbound' THEN unread_count+1 ELSE unread_count END,updated_at=NOW()
       WHERE id=$3`, [msg.body.slice(0,180), direction, conv.id]);
    return { conversation: conv, message: rows[0] };
  }
  const d = await localRead(); d.messages.push(msg);
  const lc = d.conversations.find(x => x.id === conv.id);
  Object.assign(lc, { last_message_at: msg.created_at, last_message_preview: msg.body.slice(0,180), unread_count: direction === 'inbound' ? (lc.unread_count || 0)+1 : lc.unread_count, updated_at: msg.created_at });
  await localWrite(d); return { conversation: lc, message: msg };
}

export async function listConversations() {
  if (pool) {
    const { rows } = await pool.query(
      `SELECT c.*, u.name AS customer_name FROM crm_conversations c
       LEFT JOIN crm_customers u ON u.id=c.customer_id
       ORDER BY c.last_message_at DESC NULLS LAST LIMIT 200`);
    return rows;
  }
  const d = await localRead();
  return d.conversations.map(c => ({...c, customer_name: d.customers.find(x=>x.id===c.customer_id)?.name || 'Cliente'}))
    .sort((a,b)=>new Date(b.last_message_at||0)-new Date(a.last_message_at||0));
}

export async function getConversation(idValue) {
  if (pool) {
    const c = await pool.query(`SELECT c.*,u.name AS customer_name,u.email,u.birthday,u.notes AS customer_notes
      FROM crm_conversations c LEFT JOIN crm_customers u ON u.id=c.customer_id WHERE c.id=$1`, [idValue]);
    if (!c.rows[0]) return null;
    const m = await pool.query('SELECT * FROM crm_messages WHERE conversation_id=$1 ORDER BY created_at ASC', [idValue]);
    return { ...c.rows[0], messages: m.rows };
  }
  const d = await localRead();
  const c = d.conversations.find(x=>x.id===idValue); if (!c) return null;
  return {...c, customer_name:d.customers.find(x=>x.id===c.customer_id)?.name || 'Cliente', messages:d.messages.filter(m=>m.conversation_id===idValue).sort((a,b)=>new Date(a.created_at)-new Date(b.created_at))};
}

export async function markConversationRead(idValue) {
  if (pool) { await pool.query('UPDATE crm_conversations SET unread_count=0 WHERE id=$1',[idValue]); return; }
  const d=await localRead(); const c=d.conversations.find(x=>x.id===idValue); if(c)c.unread_count=0; await localWrite(d);
}

export async function setConversationStatus(idValue,status) {
  if (!['bot','human','paused'].includes(status)) throw new Error('Estado de conversación inválido.');
  if (pool) { const {rows}=await pool.query('UPDATE crm_conversations SET status=$1,updated_at=NOW() WHERE id=$2 RETURNING *',[status,idValue]); return rows[0]; }
  const d=await localRead(); const c=d.conversations.find(x=>x.id===idValue); if(!c)throw new Error('Conversación no encontrada.'); c.status=status; await localWrite(d); return c;
}

export async function listMessagesForCustomer(customerId) {
  if (pool) {
    const { rows } = await pool.query(`SELECT m.*,c.phone FROM crm_messages m JOIN crm_conversations c ON c.id=m.conversation_id WHERE c.customer_id=$1 ORDER BY m.created_at DESC LIMIT 200`, [customerId]); return rows;
  }
  const d=await localRead(); const convIds=d.conversations.filter(c=>c.customer_id===customerId).map(c=>c.id); return d.messages.filter(m=>convIds.includes(m.conversation_id));
}

export async function listAppointments() {
  if (pool) { const {rows}=await pool.query('SELECT * FROM appointments ORDER BY date,time'); return rows; }
  const d=await localRead(); return d.appointments;
}
export async function upsertAppointment(a) {
  const record={id:String(a.id||id('apt')),client_name:String(a.clientName||a.client_name||'').trim(),client_phone:normalizePhone(a.clientPhone||a.client_phone),date:String(a.date),time:String(a.time),service_name:String(a.serviceName||a.service_name||'Servicio'),duration:Number(a.duration)||60,status:a.status||'pendiente',reminder_sent:a.reminderSent||a.reminder_sent||{}};
  if(!record.client_name||!record.client_phone||!record.date||!record.time) throw new Error('La cita está incompleta.');
  if(pool){
    const {rows}=await pool.query(`INSERT INTO appointments(id,client_name,client_phone,date,time,service_name,duration,status,reminder_sent)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT(id) DO UPDATE SET client_name=EXCLUDED.client_name,client_phone=EXCLUDED.client_phone,date=EXCLUDED.date,time=EXCLUDED.time,service_name=EXCLUDED.service_name,duration=EXCLUDED.duration,status=EXCLUDED.status,reminder_sent=EXCLUDED.reminder_sent,updated_at=NOW()
      RETURNING *`,[record.id,record.client_name,record.client_phone,record.date,record.time,record.service_name,record.duration,record.status,JSON.stringify(record.reminder_sent)]);
    await upsertCustomer({name:record.client_name,phone:record.client_phone});
    return rows[0];
  }
  const d=await localRead(); const i=d.appointments.findIndex(x=>x.id===record.id); if(i>=0)d.appointments[i]=record;else d.appointments.push(record); await localWrite(d); await upsertCustomer({name:record.client_name,phone:record.client_phone}); return record;
}
export async function deleteAppointment(idValue) {
  if(pool){await pool.query('DELETE FROM appointments WHERE id=$1',[idValue]);return;}
  const d=await localRead();d.appointments=d.appointments.filter(x=>x.id!==idValue);await localWrite(d);
}
export async function markReminderSent(idValue,key) {
  if(pool){await pool.query(`UPDATE appointments SET reminder_sent=COALESCE(reminder_sent,'{}'::jsonb) || $1::jsonb,updated_at=NOW() WHERE id=$2`,[JSON.stringify({[key]:new Date().toISOString()}),idValue]);return;}
  const d=await localRead();const a=d.appointments.find(x=>x.id===idValue);if(a){a.reminder_sent={...(a.reminder_sent||{}),[key]:new Date().toISOString()};await localWrite(d);}
}

export { normalizePhone };
