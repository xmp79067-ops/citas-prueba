import { db, ref, get } from './firebase-config.js';

let authenticated = false;
const KEY='spa_license_key';

document.addEventListener('DOMContentLoaded', async ()=>{
  const form=document.getElementById('authForm');
  form?.addEventListener('submit', async e=>{
    e.preventDefault();
    const key=document.getElementById('authKey').value.trim();
    if(!key)return showError('Ingresa una llave de acceso.');
    await validate(key,true);
  });
  const saved=localStorage.getItem(KEY);
  if(saved && await validate(saved,false)) return;
  showAuth();
});

async function validate(key,save){
  try{
    const snap=await get(ref(db,`licencias/${key}`));
    const data=snap.val();
    if(snap.exists() && data?.estado===true){
      if(save)localStorage.setItem(KEY,key);
      authenticated=true;
      document.getElementById('authScreen').style.display='none';
      document.getElementById('appShell').style.display='grid';
      window.dispatchEvent(new Event('app:authenticated'));
      return true;
    }
    if(save)showError('Acceso denegado. Verifica tu llave.');
  }catch(e){if(save)showError('No se pudo validar la licencia. Revisa tu conexión.');}
  return false;
}
function showError(msg){const e=document.getElementById('authError');if(e){e.textContent=msg;e.classList.add('show');}}
function showAuth(){document.getElementById('authScreen').style.display='flex';document.getElementById('appShell').style.display='none';}
window.auth={isAuthenticated:()=>authenticated,logout(){localStorage.removeItem(KEY);location.reload();}};
