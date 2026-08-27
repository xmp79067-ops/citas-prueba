const API = (window.APP_CONFIG?.API_URL || '').replace(/\/+$/,'');

async function request(path, options={}) {
  const r=await fetch(`${API}${path}`,{headers:{'Content-Type':'application/json',...(options.headers||{})},...options});
  const data=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(data.error||data.message||`HTTP ${r.status}`);
  return data;
}
window.api={
  health:()=>request('/api/health'),
  whatsapp:{
    status:()=>request('/api/whatsapp/status'),
    setup:()=>request('/api/whatsapp/setup',{method:'POST'}),
    qr:()=>request('/api/whatsapp/qr'),
    webhook:()=>request('/api/whatsapp/webhook',{method:'POST'})
  },
  conversations:{
    all:()=>request('/api/conversations'),
    get:id=>request(`/api/conversations/${id}`),
    read:id=>request(`/api/conversations/${id}/read`,{method:'POST'}),
    status:(id,status)=>request(`/api/conversations/${id}/status`,{method:'PATCH',body:JSON.stringify({status})}),
    send:(id,body)=>request(`/api/conversations/${id}/messages`,{method:'POST',body:JSON.stringify({body})})
  },
  customers:{
    all:q=>request(`/api/customers?search=${encodeURIComponent(q||'')}`),
    get:id=>request(`/api/customers/${id}`),
    save:data=>request('/api/customers',{method:'POST',body:JSON.stringify(data)}),
    note:(id,body)=>request(`/api/customers/${id}/notes`,{method:'POST',body:JSON.stringify({body})})
  },
  appointments:{
    all:()=>request('/api/appointments'),
    save:data=>request('/api/appointments',{method:'POST',body:JSON.stringify(data)}),
    delete:id=>request(`/api/appointments/${id}`,{method:'DELETE'})
  }
};
