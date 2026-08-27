let state={view:'dashboard',conversations:[],customers:[],appointments:[],selectedConversation:null};

document.addEventListener('DOMContentLoaded',()=>{
  document.querySelectorAll('.nav[data-view], [data-view]').forEach(b=>b.addEventListener('click',()=>showView(b.dataset.view)));
  document.getElementById('logoutBtn')?.addEventListener('click',()=>window.auth.logout());
  document.getElementById('refreshBtn')?.addEventListener('click',loadAll);
  document.getElementById('setupWaBtn')?.addEventListener('click',setupWhatsApp);
  document.getElementById('messageForm')?.addEventListener('submit',sendMessage);
  document.getElementById('chatStatus')?.addEventListener('change',async e=>{if(state.selectedConversation)await api.conversations.status(state.selectedConversation.id,e.target.value);});
  document.getElementById('customerSearch')?.addEventListener('input',e=>renderCustomers(e.target.value));
  document.getElementById('conversationSearch')?.addEventListener('input',()=>renderConversations());
  document.getElementById('newCustomerBtn')?.addEventListener('click',()=>openModal('customerModal'));
  document.getElementById('newAppointmentBtn')?.addEventListener('click',()=>openAppointmentModal());
  document.getElementById('newAppointmentMenuBtn')?.addEventListener('click',()=>openAppointmentModal());
  document.getElementById('newMenuBtn')?.addEventListener('click',toggleNewMenu);
  document.getElementById('customerForm')?.addEventListener('submit',saveCustomerForm);
  document.getElementById('appointmentForm')?.addEventListener('submit',saveAppointmentForm);
  document.querySelectorAll('[data-close-modal]').forEach(b=>b.addEventListener('click',()=>closeModal(b.dataset.closeModal)));
  document.querySelectorAll('.modal-overlay').forEach(m=>m.addEventListener('click',e=>{if(e.target===m)closeModal(m.id);}));
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){document.querySelectorAll('.modal-overlay.open').forEach(m=>closeModal(m.id));closeNewMenu();}});
  document.getElementById('appointmentSearch')?.addEventListener('input',renderAppointments);
  window.addEventListener('app:authenticated',loadAll);
});

function showView(view){
  state.view=view;
  document.querySelectorAll('.view').forEach(x=>x.classList.remove('active-view'));
  document.getElementById(`view-${view}`)?.classList.add('active-view');
  document.querySelectorAll('.nav[data-view]').forEach(x=>x.classList.toggle('active',x.dataset.view===view));
  const titles={dashboard:'Resumen',calendar:'Agenda de citas',inbox:'Inbox WhatsApp',customers:'Clientes'};
  document.getElementById('viewTitle').textContent=titles[view]||'Resumen';
  if(view==='inbox')loadConversations(); if(view==='customers')renderCustomers();
}
async function loadAll(){try{await Promise.all([loadAppointments(),loadCustomers(),loadConversations(),loadWhatsApp()]);renderDashboard();}catch(e){toast(e.message,true)}}
async function loadAppointments(){state.appointments=await api.appointments.all();renderAppointments();}
async function loadCustomers(){state.customers=await api.customers.all('');renderCustomers();populateAppointmentCustomers();}
async function loadConversations(){state.conversations=await api.conversations.all();renderConversations();updateUnread();}
async function loadWhatsApp(){try{const s=await api.whatsapp.status();const connected=String(s?.instance?.state||s?.state||s?.status||'').toLowerCase().includes('open')||s?.instance?.state==='open';document.getElementById('statWA').textContent=connected?'Conectado':'Desconectado';document.getElementById('waState').textContent=connected?'Conectado':'Desconectado';document.getElementById('waState').className='pill '+(connected?'ok':'bad');document.getElementById('waMini').textContent=connected?'● WhatsApp conectado':'○ WhatsApp desconectado';}catch(e){document.getElementById('statWA').textContent='Offline';}}
function renderDashboard(){const today=new Date().toISOString().slice(0,10);const todayA=state.appointments.filter(a=>String(a.date).slice(0,10)===today);document.getElementById('statToday').textContent=todayA.length;document.getElementById('statCustomers').textContent=state.customers.length;document.getElementById('dashboardAppointments').innerHTML=todayA.slice(0,8).map(a=>rowAppointment(a)).join('')||'<div class="empty">No hay citas hoy.</div>';document.getElementById('statUnread').textContent=state.conversations.reduce((n,c)=>n+(Number(c.unread_count)||0),0);}
function rowAppointment(a){return `<div class="row"><div class="time">${String(a.time).slice(0,5)}</div><div class="row-main"><strong>${esc(a.client_name||a.clientName)}</strong><span>${esc(a.service_name||a.serviceName)} · ${esc(a.client_phone||a.clientPhone)}</span></div><span class="pill">${esc(a.status||'pendiente')}</span></div>`;}
function renderAppointments(){const q=(document.getElementById('appointmentSearch')?.value||'').toLowerCase();document.getElementById('appointmentsList').innerHTML=state.appointments.filter(a=>!q||`${a.client_name} ${a.client_phone}`.toLowerCase().includes(q)).map(a=>rowAppointment(a)+`<div class="row-actions"><button class="danger-link" onclick="deleteA('${a.id}')">Eliminar</button></div>`).join('')||'<div class="empty">No hay citas.</div>';}
window.deleteA=async id=>{if(!confirm('¿Eliminar esta cita?'))return;await api.appointments.delete(id);await loadAppointments();renderDashboard();};
function renderConversations(){const q=(document.getElementById('conversationSearch')?.value||'').toLowerCase();const list=state.conversations.filter(c=>(c.customer_name||'').toLowerCase().includes(q)||c.phone.includes(q));document.getElementById('conversationList').innerHTML=list.map(c=>`<button class="conversation ${state.selectedConversation?.id===c.id?'selected':''}" onclick="openConversation('${c.id}')"><div class="avatar">${initials(c.customer_name||'WA')}</div><div><strong>${esc(c.customer_name||'Cliente')}</strong><span>${esc(c.last_message_preview||'Sin mensajes')}</span></div>${c.unread_count?`<b class="badge">${c.unread_count}</b>`:''}</button>`).join('')||'<div class="empty">No hay conversaciones.</div>';}
window.openConversation=async id=>{state.selectedConversation=await api.conversations.get(id);await api.conversations.read(id);document.getElementById('chatEmpty').style.display='none';document.getElementById('chatView').style.display='flex';document.getElementById('chatName').textContent=state.selectedConversation.customer_name||'Cliente';document.getElementById('chatPhone').textContent=state.selectedConversation.phone;document.getElementById('chatStatus').value=state.selectedConversation.status;renderMessages();renderCustomerCard();await loadConversations();};
function renderMessages(){const m=document.getElementById('messages');m.innerHTML=(state.selectedConversation?.messages||[]).map(x=>`<div class="bubble ${x.direction==='outbound'?'out':'in'}"><span>${esc(x.body)}</span><small>${new Date(x.created_at).toLocaleString('es-CO',{hour:'2-digit',minute:'2-digit'})}</small></div>`).join('');m.scrollTop=m.scrollHeight;}
async function sendMessage(e){e.preventDefault();if(!state.selectedConversation)return;const input=document.getElementById('messageInput');const body=input.value.trim();if(!body)return;input.disabled=true;try{await api.conversations.send(state.selectedConversation.id,body);input.value='';state.selectedConversation=await api.conversations.get(state.selectedConversation.id);renderMessages();await loadConversations();}catch(err){toast(err.message,true)}finally{input.disabled=false;input.focus();}}
function renderCustomers(q=''){const list=state.customers.filter(c=>!q||`${c.name} ${c.phone}`.toLowerCase().includes(q.toLowerCase()));document.getElementById('customersList').innerHTML=list.map(c=>`<button class="customer" onclick="openCustomer('${c.id}')"><div class="avatar">${initials(c.name)}</div><div><strong>${esc(c.name)}</strong><span>${esc(c.phone)}</span></div></button>`).join('')||'<div class="empty">No hay clientes.</div>'; }
window.openCustomer=async id=>{try{const c=await api.customers.get(id);openCustomerDetail(c);}catch(e){toast(e.message,true)}};
function renderCustomerCard(){const c=state.selectedConversation;document.getElementById('chatCustomer').innerHTML=`<h3>Cliente</h3><div class="customer-big"><div class="avatar">${initials(c.customer_name||'')}</div><strong>${esc(c.customer_name||'Cliente')}</strong><span>${esc(c.phone)}</span></div><p>${esc(c.customer_notes||'Sin notas')}</p>`;}
async function setupWhatsApp(){try{await api.whatsapp.setup();await loadWhatsApp();const qr=await api.whatsapp.qr();const raw=qr?.base64||qr?.qrcode?.base64||qr?.code||qr?.qrcode?.code;document.getElementById('qrBox').innerHTML=raw?(String(raw).startsWith('data:')?`<img src="${raw}" alt="QR WhatsApp">`:`<pre>${esc(raw)}</pre>`):'Instancia creada. Abre QR en unos segundos y pulsa actualizar.';}catch(e){toast(e.message,true)}}
function openModal(id){
  const modal=document.getElementById(id);
  if(!modal)return;
  modal.classList.add('open');
  modal.setAttribute('aria-hidden','false');
  document.body.classList.add('modal-open');
  setTimeout(()=>modal.querySelector('input,select,textarea')?.focus(),50);
}
function closeModal(id){
  const modal=document.getElementById(id);
  if(!modal)return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden','true');
  if(!document.querySelector('.modal-overlay.open'))document.body.classList.remove('modal-open');
}
function toggleNewMenu(){
  document.getElementById('newMenuDropdown')?.classList.toggle('open');
}
function closeNewMenu(){
  document.getElementById('newMenuDropdown')?.classList.remove('open');
}
document.addEventListener('click',e=>{
  const menu=document.querySelector('.new-menu');
  if(menu && !menu.contains(e.target))closeNewMenu();
});

async function saveCustomerForm(e){
  e.preventDefault();
  const form=e.currentTarget;
  const name=document.getElementById('customerName').value.trim();
  const phone=document.getElementById('customerPhone').value.trim();
  const notes=document.getElementById('customerNotes').value.trim();
  if(!name||!phone)return;
  const submit=form.querySelector('button[type="submit"]');
  submit.disabled=true;
  try{
    await api.customers.save({name,phone,notes});
    form.reset();
    closeModal('customerModal');
    await loadCustomers();
    toast('Cliente guardado correctamente.');
  }catch(err){toast(err.message,true);}
  finally{submit.disabled=false;}
}

function populateAppointmentCustomers(){
  const select=document.getElementById('appointmentCustomer');
  if(!select)return;
  const current=select.value;
  select.innerHTML='<option value="">Selecciona un cliente...</option>'+
    state.customers
      .slice()
      .sort((a,b)=>String(a.name).localeCompare(String(b.name),'es'))
      .map(c=>`<option value="${escAttr(c.id)}">${esc(c.name)} · ${esc(c.phone)}</option>`)
      .join('');
  if(current && state.customers.some(c=>String(c.id)===String(current)))select.value=current;
}

function openAppointmentModal(){
  closeNewMenu();
  populateAppointmentCustomers();
  const date=document.getElementById('appointmentDate');
  if(date&&!date.value)date.value=new Date().toISOString().slice(0,10);
  openModal('appointmentModal');
}

async function saveAppointmentForm(e){
  e.preventDefault();
  const customerId=document.getElementById('appointmentCustomer').value;
  const customer=state.customers.find(c=>String(c.id)===String(customerId));
  const date=document.getElementById('appointmentDate').value;
  const time=document.getElementById('appointmentTime').value;
  const service=document.getElementById('appointmentService').value.trim();
  if(!customer||!date||!time||!service)return;
  const submit=e.currentTarget.querySelector('button[type="submit"]');
  submit.disabled=true;
  try{
    await api.appointments.save({
      clientName:customer.name,
      clientPhone:customer.phone,
      date,
      time,
      serviceName:service,
      customerId:customer.id
    });
    e.currentTarget.reset();
    document.getElementById('appointmentDate').value=new Date().toISOString().slice(0,10);
    document.getElementById('appointmentTime').value='10:00';
    closeModal('appointmentModal');
    await loadAppointments();
    renderDashboard();
    toast('Cita guardada correctamente.');
  }catch(err){toast(err.message,true);}
  finally{submit.disabled=false;}
}

function openCustomerDetail(c){
  document.getElementById('detailCustomerName').textContent=c.name||'Cliente';
  document.getElementById('customerDetailContent').innerHTML=`
    <div class="detail-avatar avatar">${initials(c.name||'')}</div>
    <div class="detail-field"><span>Teléfono</span><strong>${esc(c.phone||'—')}</strong></div>
    <div class="detail-field"><span>Notas</span><p>${esc(c.notes||'Sin notas registradas.')}</p></div>
  `;
  openModal('customerDetailModal');
}

function updateUnread(){document.getElementById('unreadBadge').textContent=state.conversations.reduce((n,c)=>n+(Number(c.unread_count)||0),0)||'';}
function initials(s){return String(s).split(/\s+/).slice(0,2).map(x=>x[0]).join('').toUpperCase();}
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));}
function escAttr(s){return esc(s);}
function toast(msg,bad=false){alert((bad?'Error: ':'')+msg);}
setInterval(()=>{if(window.auth?.isAuthenticated())loadAll().catch(()=>{});},15000);
