'use strict';
const $=s=>document.querySelector(s),config=window.SHOP_CONFIG;
const money=n=>new Intl.NumberFormat('he-IL',{style:'currency',currency:'ILS'}).format(n/100);
const statusNames={new:'חדשה',in_progress:'בטיפול',completed:'הושלמה'};
let session=null,refreshPromise=null,orders=[],loading=false,hasMore=false,epoch=0;
function el(tag,cls,text){const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;}
async function request(path,{body,method='GET',token,headers={}}={}){
 const r=await fetch(config.supabaseUrl.replace(/\/$/,'')+path,{method,headers:{apikey:config.publishableKey,'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`} : {}),...headers},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
 const text=await r.text();let data;try{data=text?JSON.parse(text):null;}catch{data=null;}
 if(!r.ok){const error=new Error(data?.message||data?.msg||'REQUEST_FAILED');error.status=r.status;throw error;}return data;
}
function clearSession(message=''){
 epoch++;session=null;refreshPromise=null;orders=[];loading=false;hasMore=false;$('#orders').replaceChildren();$('#account-email').textContent='';$('#order-count').textContent='';$('#dashboard').hidden=true;$('#logout').hidden=true;$('#login-panel').hidden=false;$('#login-error').textContent=message;$('#login-form').reset();
}
async function getToken(){
 if(!session)throw new Error('AUTH_REQUIRED');
 if(Date.now()<session.expires_at*1000-45000)return session.access_token;
 if(!refreshPromise){const activeEpoch=epoch,refreshToken=session.refresh_token;refreshPromise=request('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:{refresh_token:refreshToken}}).then(data=>{if(epoch!==activeEpoch)throw new Error('AUTH_REQUIRED');session=data;return data.access_token;}).catch(error=>{if(epoch===activeEpoch)clearSession('החיבור הסתיים. התחברי שוב כדי להמשיך.');throw error;}).finally(()=>{refreshPromise=null;});}
 return refreshPromise;
}
async function api(path,options={}){const token=await getToken();try{return await request('/rest/v1/'+path,{...options,token});}catch(error){if(error.status===401)clearSession('החיבור הסתיים. התחברי שוב כדי להמשיך.');throw error;}}
function message(text,error=false){$('#admin-message').textContent=text;$('#admin-message').className=error?'error':'';}
function controlsDisabled(disabled){$('#refresh').disabled=disabled;$('#status-filter').disabled=disabled;$('#load-more').disabled=disabled;}
function renderOrders(){
 $('#orders').replaceChildren();$('#order-count').textContent=orders.length===1?'מוצגת הזמנה אחת':`${orders.length} הזמנות מוצגות`;$('#load-more').hidden=!hasMore;
 for(const order of orders){
  const card=el('article','order-card'),head=el('div','order-card-header'),info=el('div');
  info.append(el('h2','',`הזמנה ${order.id.slice(0,8)}`));
  const date=new Date(order.created_at).toLocaleString('he-IL',{dateStyle:'medium',timeStyle:'short'});info.append(el('p','order-meta',date));
  const state=el('div','order-status'),pill=el('span',`status-pill ${order.status}`,statusNames[order.status]||order.status),select=el('select');
  select.setAttribute('aria-label',`סטטוס הזמנה ${order.id.slice(0,8)}`);for(const [value,label]of Object.entries(statusNames))select.append(new Option(label,value));select.value=order.status;
  state.append(pill,select);head.append(info,state);
  const customer=el('div','order-customer');customer.append(el('strong','',order.customer_name),el('span','',order.customer_email));
  const details=el('details'),list=order.order_items||[],itemCount=list.reduce((n,p)=>n+p.quantity,0);details.append(el('summary','',`פירוט ${itemCount} פריטים · ${money(order.total_agorot)}`));
  for(const item of list){const row=el('div','order-detail-row');row.append(el('span','',`${item.product_name} × ${item.quantity}`),el('span','',money(item.unit_price_agorot*item.quantity)));details.append(row);}
  const id=el('p','order-meta order-number',order.id);details.append(id);
  const feedback=el('p','order-feedback');feedback.setAttribute('role','status');
  select.addEventListener('change',async()=>{
   const before=order.status,next=select.value,activeEpoch=epoch;select.disabled=true;feedback.textContent='שומרים סטטוס…';feedback.classList.remove('error');
   try{const data=await api(`cart_orders?id=eq.${encodeURIComponent(order.id)}&status=eq.${encodeURIComponent(before)}&select=id,status`,{method:'PATCH',body:{status:next},headers:{Prefer:'return=representation'}});
    if(epoch!==activeEpoch)return;if(!Array.isArray(data)||data.length!==1)throw new Error('CONCURRENT_CHANGE');order.status=data[0].status;pill.textContent=statusNames[order.status];pill.className=`status-pill ${order.status}`;feedback.textContent='הסטטוס עודכן';
   }catch(error){if(epoch!==activeEpoch)return;select.value=before;feedback.classList.add('error');feedback.textContent=error.message==='CONCURRENT_CHANGE'?'ההזמנה השתנתה מאז הטעינה. רענני את הרשימה.':'העדכון לא נשמר. נסי שוב.';}
   finally{select.disabled=false;}
  });
  card.append(head,customer,details,feedback);$('#orders').append(card);
 }
}
async function loadOrders(append=false){
 if(loading||!session)return;loading=true;controlsDisabled(true);message('טוענים הזמנות…');const activeEpoch=epoch;
 const offset=append?orders.length:0,filter=$('#status-filter').value;
 try{const data=await api(`cart_orders?select=id,customer_name,customer_email,total_agorot,created_at,status,order_items(product_name,quantity,unit_price_agorot)&order=created_at.desc,id.desc&limit=50&offset=${offset}${filter?'&status=eq.'+encodeURIComponent(filter):''}`);
  if(epoch!==activeEpoch)return;orders=append?[...orders,...data]:data;hasMore=data.length===50;renderOrders();message(orders.length?'':'אין הזמנות להצגה בסטטוס הזה.');
 }catch(error){if(epoch===activeEpoch)message('לא הצלחנו לטעון את ההזמנות. לחצי על רענון כדי לנסות שוב.',true);}
 finally{if(epoch===activeEpoch){loading=false;controlsDisabled(false);}}
}
$('#login-form').addEventListener('submit',async event=>{
 event.preventDefault();if(!event.currentTarget.reportValidity())return;$('#login-submit').disabled=true;$('#login-submit').textContent='מתחברים…';$('#login-error').textContent='';const fields=new FormData(event.currentTarget);
 try{const data=await request('/auth/v1/token?grant_type=password',{method:'POST',body:{email:String(fields.get('email')).trim(),password:String(fields.get('password'))}});session=data;epoch++;
  const admin=await api('rpc/is_shop_admin',{method:'POST',body:{}});
  if(!admin){await request('/auth/v1/logout?scope=local',{method:'POST',token:session.access_token}).catch(()=>{});clearSession('לחשבון הזה אין הרשאת ניהול.');return;}
  $('#login-form').reset();$('#status-filter').value='';$('#login-panel').hidden=true;$('#dashboard').hidden=false;$('#logout').hidden=false;$('#account-email').textContent=data.user.email;await loadOrders();
 }catch(error){clearSession(error.status===400||error.status===401?'האימייל או הסיסמה אינם נכונים.':'לא הצלחנו להתחבר. בדקי את החיבור ונסי שוב.');$('#login-form').elements.email.value=String(fields.get('email')).trim();}
 finally{$('#login-submit').disabled=false;$('#login-submit').textContent='כניסה לניהול';}
});
$('#logout').onclick=async()=>{const token=session?.access_token;clearSession();if(token)await request('/auth/v1/logout?scope=local',{method:'POST',token}).catch(()=>{});};
$('#refresh').onclick=()=>loadOrders();$('#status-filter').onchange=()=>loadOrders();$('#load-more').onclick=()=>loadOrders(true);
