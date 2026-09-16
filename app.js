'use strict';
const $ = (selector) => document.querySelector(selector);
const config = window.SHOP_CONFIG;
const money = (agorot) => new Intl.NumberFormat('he-IL', {style:'currency', currency:'ILS', maximumFractionDigits:2}).format(agorot / 100);
let products = [], selected = null, pending = null, busy = false;
async function api(path, body) {
 const headers = {apikey:config.publishableKey,'Content-Type':'application/json'};
 if(config.publishableKey.startsWith('eyJ')) headers.Authorization = `Bearer ${config.publishableKey}`;
 const response = await fetch(`${config.supabaseUrl.replace(/\/$/,'')}/rest/v1/${path}`, {method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)});
 const data = await response.json();
 if(!response.ok) throw new Error(data.message || 'REQUEST_FAILED');
 return data;
}
function renderProducts() {
 const query = $('#search').value.trim().toLocaleLowerCase('he');
 const category = $('#category').value;
 const matches = products.filter(p => (!category || p.category === category) && `${p.name} ${p.description}`.toLocaleLowerCase('he').includes(query));
 $('#products').replaceChildren();
 $('#count').textContent = `${matches.length} מוצרים`;
 $('#status').textContent = matches.length ? '' : 'לא נמצאו מוצרים. נסו חיפוש אחר.';
 for(const p of matches) {
  const card = document.createElement('article');card.className='card';
  const art = document.createElement('div');art.className='product-art';art.setAttribute('aria-hidden','true');art.textContent= p.category==='מחברות'?'📓':p.category==='כלי כתיבה'?'🖊️':'🗓️';
  const content = document.createElement('div');content.className='card-content';
  const cat = document.createElement('span');cat.className='category';cat.textContent=p.category;
  const title=document.createElement('h3');title.textContent=p.name;
  const desc=document.createElement('p');desc.textContent=p.description;
  const bottom=document.createElement('div');bottom.className='card-bottom';
  const price=document.createElement('span');price.className='price';price.textContent=money(p.price_agorot);
  const button=document.createElement('button');button.textContent='להזמנה';button.setAttribute('aria-label',`הזמנת ${p.name}`);button.addEventListener('click',()=>openCheckout(p.id));
  bottom.append(price,button);content.append(cat,title,desc,bottom);card.append(art,content);$('#products').append(card);
 }
}
async function loadProducts() {
 $('#retry').hidden=true;$('#status').textContent='טוענים את המוצרים…';
 if(!config.supabaseUrl || !config.publishableKey){$('#status').textContent='החנות בהכנות לפתיחה. בקרוב תוכלו להזמין כאן.';return;}
 try {
  products=await api('products?select=id,name,description,category,price_agorot&active=eq.true&order=price_agorot.asc');
  $('#category').replaceChildren(new Option('כל המוצרים',''),...Array.from(new Set(products.map(p=>p.category))).map(c=>new Option(c,c)));
  renderProducts();
 } catch(error) {$('#status').textContent='לא הצלחנו לטעון את המוצרים. נסו שוב בעוד רגע.';$('#retry').hidden=false;}
}
function updateTotal(){const q=Number($('#quantity').value);$('#total').textContent=Number.isInteger(q)&&q>0?money(selected.price_agorot*q):'—';}
function openCheckout(id){
 selected=products.find(p=>p.id===id);if(!selected)throw new Error('PRODUCT_NOT_FOUND');
 pending=null;$('#order-form').reset();$('#order-form').hidden=false;$('#success').hidden=true;$('#order-error').textContent='';
 $('#order-title').textContent=selected.name;$('#unit-price').textContent=`${money(selected.price_agorot)} ליחידה`;updateTotal();$('#checkout').showModal();
}
function closeCheckout(){if(!busy)$('#checkout').close();}
$('#order-form').addEventListener('submit',async event=>{
 event.preventDefault();if(busy || !$('#order-form').reportValidity())return;
 const fields=new FormData(event.currentTarget);
 const body={p_product_id:selected.id,p_quantity:Number(fields.get('quantity')),p_name:String(fields.get('name')).trim(),p_email:String(fields.get('email')).trim()};
 if(body.p_name.length<2){$('#order-error').textContent='נא להזין שם עם לפחות שני תווים.';return;}
 const signature=JSON.stringify(body);
 if(!pending || pending.signature!==signature)pending={signature,id:crypto.randomUUID()};
 body.p_request_id=pending.id;busy=true;$('#submit').disabled=true;$('#submit').textContent='שולחים…';$('#order-error').textContent='';
 try{
  const order=await api('rpc/place_order',body);
  $('#order-id').textContent=order.id;$('#confirmed-total').textContent=`סכום ההזמנה: ${money(order.total_agorot)}`;
  $('#order-form').hidden=true;$('#success').hidden=false;$('#done').focus();
 }catch(error){$('#order-error').textContent=error.message.includes('PRODUCT_UNAVAILABLE')?'המוצר אינו זמין כרגע. בחרו מוצר אחר.':'לא הצלחנו לאשר את ההזמנה. הפרטים נשמרו בטופס; אפשר לנסות שוב.';}
 finally{busy=false;$('#submit').disabled=false;$('#submit').textContent='שליחת הזמנה';}
});
$('#search').addEventListener('input',renderProducts);$('#category').addEventListener('change',renderProducts);$('#quantity').addEventListener('input',updateTotal);$('#retry').addEventListener('click',loadProducts);$('#close').addEventListener('click',closeCheckout);$('#done').addEventListener('click',closeCheckout);$('#checkout').addEventListener('cancel',e=>{if(busy)e.preventDefault();});
if(document.modelContext?.registerTool){try{Promise.resolve(document.modelContext.registerTool({name:'filter_products',description:'Filter the visible store catalog by search text.',inputSchema:{type:'object',properties:{query:{type:'string'}},required:['query'],additionalProperties:false},annotations:{readOnlyHint:true},execute(input){if(typeof input.query!=='string')throw new Error('query must be a string');$('#search').value=input.query;renderProducts();return{visibleProducts:$('#products').children.length};}})).catch(()=>{});}catch{}}
loadProducts();
