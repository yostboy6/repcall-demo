import {mountAuth} from './auth.js';
import {PROCEDURES, getActiveLearners} from './domain.js';
import {api} from './api.js';

const EMPTY = {version:2,users:[],requests:[],alerts:[],goals:{},supervisors:[]};
const app = document.querySelector('#app');
const modal = document.querySelector('#modal');
const icons = {
  grid:'<rect x=3 y=3 width=7 height=7 rx=1.5/><rect x=14 y=3 width=7 height=7 rx=1.5/><rect x=3 y=14 width=7 height=7 rx=1.5/><rect x=14 y=14 width=7 height=7 rx=1.5/>',
  book:'<path d="M4 4h6a3 3 0 0 1 3 3v14a4 4 0 0 0-4-2H4zM13 7a3 3 0 0 1 3-3h5v15h-5a3 3 0 0 0-3 2"/>',
  target:'<circle cx=12 cy=12 r=9/><circle cx=12 cy=12 r=5/><circle cx=12 cy=12 r=1/>',
  people:'<circle cx=9 cy=8 r=3/><path d="M3 21v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6M17 15a5 5 0 0 1 4 4v2"/>',
  clock:'<circle cx=12 cy=12 r=9/><path d="M12 7v5l3 2"/>',
  check:'<path d="m5 12 4 4L19 6"/>',
  pin:'<path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 0 1 14 0Z"/><circle cx=12 cy=10 r=2/>',
  bell:'<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  arrow:'<path d="M5 12h14m-5-5 5 5-5 5"/>',
  chevron:'<path d="m9 6 6 6-6 6"/>',
  close:'<path d="m6 6 12 12M6 18 18 6"/>',
  phone:'<path d="m5 3 4 5-3 3a14 14 0 0 0 7 7l3-3 5 4-2 3C9 23 1 15 2 5Z"/>',
  swap:'<path d="M4 7h16m-4-4 4 4-4 4M20 17H4m4-4-4 4 4 4"/>',
  shield:'<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z"/><path d="m8 12 3 3 5-6"/>',
  exit:'<path d="M9 4H4v16h5m6-13 5 5-5 5M9 12h11"/>',
  info:'<circle cx=12 cy=12 r=9/><path d="M12 11v6M12 7v.1"/>',
  stethoscope:'<path d="M5 3v5a5 5 0 0 0 10 0V3M3 3h4M13 3h4M10 13v3a5 5 0 0 0 10 0v-1"/><circle cx=20 cy=12 r=3/>',
};
const icon = name => `<svg class='icon' viewBox='0 0 24 24' aria-hidden='true'>${(icons[name] || icons.grid).replace(/\/>/g, ' />')}</svg>`;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const labels = {open:'Open',claimed:'Claimed',in_progress:'In progress',completed:'Completed',expired:'Expired',cancelled:'Closed'};
const badge = status => `<span class='badge ${status}'><i class='status-dot'></i>${labels[status]}</span>`;
const userTitle = u => u.role === 'resident' ? `Surgical resident · PGY-${u.pgy}` : u.role === 'learner' ? 'Fourth-year medical student' : 'Nurse';
const isLearner = u => u.role === 'learner' || u.role === 'resident';
const canPost = u => u.role === 'staff' || u.role === 'resident';
const countLearners = (n, adjective='') => `${n} ${adjective?adjective+' ':''}learner${n===1?'':'s'}`;
let state = structuredClone(EMPTY);
let userId = null;
let refreshing = false;
let connectionLost = false;
let clockOffset = 0;
let view = 'board';
let filter = 'open';
let selectedId = null;
let toastTimer;
let lastModalFocus;

function serverNow() { return Date.now()+clockOffset; }
function accept(payload) {
  if(typeof payload.serverTime==='number')clockOffset=payload.serverTime-Date.now();
  state = payload.state || structuredClone(EMPTY);
  userId = payload.userId || null;
}
function supervisors() { return state.supervisors || []; }
async function refresh() {
  if (!userId || refreshing) return;
  refreshing = true;
  try {
    const payload = await api.state();
    const changed = JSON.stringify(payload.state) !== JSON.stringify(state);
    accept(payload);
    const recovered = connectionLost;
    connectionLost = false;
    if ((changed || recovered) && !modal.open && !document.activeElement?.closest('form')) render();
  } catch (error) {
    if (error.status === 401) { accept({}); render(); }
    else if (!connectionLost) { connectionLost = true; notify('Connection lost. Reconnecting…'); }
  } finally { refreshing = false; }
}
function me() { return state.users.find(u => u.id === userId); }
function person(id) { return state.users.find(u => u.id === id); }
function request(id) { return state.requests.find(r => r.id === id); }
function date(value) { return new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(value); }
function ago(time) { const m = Math.max(0,Math.floor((serverNow()-time)/60000)); return m < 1 ? 'Just now' : m < 60 ? `${m} min ago` : `${Math.floor(m/60)}h ago`; }
function countdown(time) { const s = Math.max(0,Math.ceil((time-serverNow())/1000)); return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`; }
function notify(message) { const el = document.querySelector('#toast'); el.textContent = message; el.classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(()=>el.classList.remove('visible'),4200); }
function signIn(payload) { accept(payload);view='board';filter='open';selectedId=null;connectionLost=false;render(); }
async function change(path, method, body, success) {
  try { accept(await api.mutate(path,method,body));render();if(success)notify(success);return true; }
  catch(error) { if(error.status===401){accept({});render();}notify(error.message);return false; }
}
async function signOut() {
  try { await api.logout(); } catch {}
  accept({});render();
}
function requestPath(id, action) { return `/api/requests/${encodeURIComponent(id)}/${action}`; }
function showModal(title, subtitle, body) {
  lastModalFocus=document.activeElement;
  modal.innerHTML=`<div class='modal-header'><div><h2 id='modal-title'>${esc(title)}</h2><p>${esc(subtitle)}</p></div><button class='modal-close' data-close aria-label='Close'>${icon('close')}</button></div><div class='modal-body'>${body}</div>`;
  modal.showModal();modal.querySelector('[data-close]').onclick=()=>modal.close();
}
modal.addEventListener('click',e=>{if(e.target===modal){const b=modal.getBoundingClientRect();if(e.clientX<b.left||e.clientX>b.right||e.clientY<b.top||e.clientY>b.bottom)modal.close();}});
modal.addEventListener('close',()=>lastModalFocus?.isConnected && lastModalFocus.focus());

function render() {
  const u=me();
  if(!u) { if(modal.open)modal.close();mountAuth(app,{onLogin:signIn});return; }
  const nav=[['board','grid',u.role==='staff'?'Requests':'Opportunities'],['log','book',u.role==='staff'?'Activity':'Procedure log'],...(isLearner(u)?[['goals','target','My goals']]:[]),['directory','people','Supervisors']];
  const openCount=state.requests.filter(r=>r.status==='open').length;
  const unread=state.alerts.filter(a=>a.userId===u.id&&!a.read).length;
  app.innerHTML=`<div class='workspace'><aside class='sidebar'><div class='brand'><img src='./icon.svg' alt=''>RepCall<span class='dot'>.</span></div><div class='nav-label'>Your workspace</div><nav aria-label='Main navigation'>${nav.map(([v,i,label])=>`<button class='nav-item' data-nav='${v}' ${view===v?"aria-current='page'":''}>${icon(i)}${label}${v==='board'&&openCount?`<span class='nav-count'>${openCount}</span>`:''}</button>`).join('')}</nav><div class='sidebar-help'><div class='eyebrow'>A little time. A real opportunity.</div><p>Connect with your team.<br>Make every procedure count.</p><button data-how>How it works ${icon('arrow')}</button></div><div class='sidebar-user'><div class='avatar ${isLearner(u)?'learner':''}'>${esc(u.initials)}</div><div><strong>${esc(u.name)}</strong><small>${u.role==='resident'?`Surgery · PGY-${u.pgy}`:u.role==='learner'?'Medicine · MS4':'Clinical staff'}</small></div><button data-logout aria-label='Sign out'>${icon('exit')}</button></div></aside><div class='main-shell'><header class='topbar'><div class='brand mobile-brand'><img src='./icon.svg' alt=''>RepCall<span class='dot'>.</span></div><div class='breadcrumb'>Workspace ${icon('chevron')}<b>${nav.find(n=>n[0]===view)?.[2]||'How it works'}</b></div><div class='topbar-actions'><button class='switch-role' data-logout aria-label='Sign out'>${icon('exit')}<span>Sign out</span></button><button class='icon-btn' data-notifications aria-label='Notifications${unread?`, ${unread} unread`:''}'>${icon('bell')}${unread?`<span class='notification-count'>${unread}</span>`:''}</button><div class='avatar ${isLearner(u)?'learner':''}' title='${esc(u.name)}'>${esc(u.initials)}</div></div></header><main id='main' class='page-content' tabindex='-1'>${view==='board'?board(u):view==='log'?logView(u):view==='goals'?goalsView(u):view==='directory'?directoryView():howView()}</main></div></div>`;
  bindEvents();
}

function heading(eyebrow,title,description,controls='') { return `<div class='page-heading'><div><div class='eyebrow'>${eyebrow}</div><h1>${title}</h1><p>${description}</p></div><div class='heading-controls'>${controls}</div></div>`; }
function footer() { return `<footer class='demo-footer'><span>${icon('shield')}Keep patient details in the medical record.</span><span>RepCall · A better way to find your next rep.</span></footer>`; }
function board(u) {
  const active=state.requests.filter(r=>['open','claimed','in_progress'].includes(r.status));
  const mine=state.requests.filter(r=>r.learnerId===u.id&&['claimed','in_progress'].includes(r.status));
  const closed=state.requests.filter(r=>['completed','expired','cancelled'].includes(r.status));
  let list=filter==='mine'?(u.role==='staff'?active.filter(r=>r.staffId===u.id):mine):filter==='closed'?closed:active.filter(r=>r.status==='open'||r.learnerId===u.id||r.staffId===u.id);
  if(!selectedId||!list.some(r=>r.id===selectedId))selectedId=list[0]?.id||null;
  const controls=`${isLearner(u)?`<div class='availability'><button class='toggle' role='switch' aria-label='Available for opportunities' aria-checked='${u.active}' data-availability></button>${u.active?'Available':'Off duty'}</div>`:''}${canPost(u)?`<button class='btn btn-primary' data-new>${icon('plus')}Post a procedure</button>`:''}`;
  return `${heading('Make the connection',u.role==='staff'?'Procedure requests.':`Find a procedure.`,u.role==='staff'?'Post a procedure for an available learner.':'Claim an opportunity and connect with the team.',controls)}<section class='metrics' aria-label='Workspace overview'><div class='metric'><div class='metric-icon'>${icon('grid')}</div><div><strong>${state.requests.filter(r=>r.status==='open').length}</strong><p>Open opportunities</p></div><span class='metric-note'>Ready to claim</span></div><div class='metric'><div class='metric-icon'>${icon('people')}</div><div><strong>${getActiveLearners(state).length}</strong><p>Available learners</p></div><span class='metric-note'>On duty now</span></div><div class='metric'><div class='metric-icon'>${icon('check')}</div><div><strong>${state.requests.filter(r=>r.status==='completed'&&(u.role==='staff'?r.staffId===u.id:r.learnerId===u.id)).length}</strong><p>${u.role==='staff'?'Procedures connected':'Procedures completed'}</p></div><span class='metric-note'>Every rep counts</span></div></section><div class='board-grid'><section class='list-section' aria-label='Procedure opportunities'><div class='section-header'><h2>${u.role==='staff'?'Procedure requests':'Procedure opportunities'}</h2><span>· Updated live</span></div><div class='tabs' role='tablist' aria-label='Filter opportunities'>${[['open','Open',active.filter(r=>r.status==='open').length],['mine',u.role==='staff'?'My requests':'My current',u.role==='staff'?active.filter(r=>r.staffId===u.id).length:mine.length],['closed','Closed',closed.length]].map(([f,l,c])=>`<button class='tab' role='tab' aria-selected='${filter===f}' data-filter='${f}'>${l}<span>${c}</span></button>`).join('')}</div><div class='request-list'>${list.length?list.map(r=>requestCard(r,u)).join(''):`<div class='empty-state'>${icon('check')}<h3>${filter==='mine'?'You’re all caught up.':'No opportunities right now.'}</h3><p>${filter==='mine'?'Your next opportunity is waiting on the board.':'New procedures will appear here when posted.'}</p>${canPost(u)?`<button class='btn btn-secondary btn-sm' data-new>Post a procedure</button>`:''}</div>`}</div></section><aside class='rail' aria-label='Selected opportunity'>${selectedId?detailPanel(request(selectedId),u):workflowCard()}<div class='care-note'>${icon('clock')}<span>Unclaimed after 10 minutes? The usual care team takes it from here. Time-sensitive care always comes first.</span></div>${selectedId?workflowCard():''}</aside></div>${footer()}`;
}

function requestCard(r,u) {
  const staff=person(r.staffId);
  return `<article class='request-card ${r.id===selectedId?'selected':''}'><div class='card-head'><button class='card-main-button' data-select='${esc(r.id)}'><div class='procedure-category'>${r.manual?'Procedure log':'Procedure opportunity'}</div><h3>${esc(r.procedure)}</h3></button>${badge(r.status)}</div><div class='card-meta'><span>${icon('pin')}${esc(r.location)}</span><span>${icon('clock')}${r.status==='open'?`<span class='time-left' data-countdown='${r.expiresAt}'></span> to claim`:r.status==='claimed'?`${r.etaMinutes} min ETA`:ago(r.completedAt||r.createdAt)}</span></div>${r.status==='expired'?`<p class='expired-text'>No learner claimed this request. Returned to the usual care team.</p>`:''}<div class='card-bottom'><span class='posted-by'><span class='avatar'>${esc(staff?.initials||'RC')}</span>${r.manual?'Added to your log':`Posted by ${esc(staff?.name||'Care team')}`}</span><button class='view-button' data-select='${esc(r.id)}'>${r.id===selectedId?'Viewing details':'View details'}${icon('arrow')}</button></div></article>`;
}

function detailPanel(r,u) {
  const staff=person(r.staffId); const assigned=person(r.learnerId); const sup=supervisors().find(s=>s.id===r.supervisorId); const owner=r.staffId===u.id;const own=r.learnerId===u.id;const current=['claimed','in_progress'].includes(r.status);
  let actions='';
  if(r.status==='open') {
    actions=`<div class='countdown-box'>${icon('clock')}<div><span>Time left to claim</span><strong data-countdown='${r.expiresAt}'></strong></div></div>`;
    if(isLearner(u)&&!owner) {
      const busy=state.requests.some(x=>x.learnerId===u.id&&['claimed','in_progress'].includes(x.status));
      actions+=`<form id='claim-form'><span class='eta-label'>I can be there in</span><div class='eta-options'>${[3,5,10].map((t,i)=>`<label class='eta-option'><input type='radio' name='eta' value='${t}' ${i===0?'checked':''}>${t} min</label>`).join('')}</div><button class='btn btn-primary btn-wide' ${!u.active||busy?'disabled':''}>Claim opportunity ${icon('arrow')}</button></form>${!u.active?`<p class='detail-footnote'>Turn on availability to claim.</p>`:busy?`<p class='detail-footnote'>Finish your current opportunity first.</p>`:`<p class='detail-footnote'>Next: contact staff and confirm your supervisor.</p>`}`;
    } else actions+=`<div class='terminal-box'><strong>Waiting for a learner</strong>${countLearners(state.alerts.filter(a=>a.requestId===r.id).length)} notified in RepCall.</div><button class='btn btn-secondary btn-wide' data-recipients='${esc(r.id)}'>View recipients</button>`;
  }
  if(current) {
    actions=`<div class='assignment'><div class='avatar learner'>${esc(assigned?.initials||'')}</div><div><strong>${own?'You claimed this opportunity':esc(assigned?.name||'Learner assigned')}</strong><p>${r.status==='claimed'?`${r.etaMinutes} min arrival estimate`:'Staff contacted · Supervision arranged'}</p></div></div>`;
    if(r.status==='claimed') {
      const deadline=r.claimedAt+r.etaMinutes*60000;
      actions+=`<div class='care-note arrival-note' data-arrival='${deadline}'>${icon('clock')}<span>${serverNow()>deadline?'Arrival estimate passed. Contact the team to confirm the plan.':`Expected by ${new Intl.DateTimeFormat('en-US',{hour:'numeric',minute:'2-digit'}).format(deadline)}`}</span></div>`;
      if(own) actions+=`<form id='coordinate-form' class='coordination-step'><label class='check-field'><input type='checkbox' name='contacted' required><span>I contacted ${esc(staff?.name||'the posting clinician')} at ${esc(r.contact)}.</span></label><label class='field'><span>Confirmed supervisor</span><select name='supervisorId' required><option value=''>Choose supervisor</option>${supervisors().filter(s=>s.id!==userId).map(s=>`<option value='${s.id}'>${esc(s.name)} · Ext. ${esc(s.extension)}</option>`).join('')}</select></label><label class='check-field'><input type='checkbox' required name='supervision'><span>My supervisor agreed to be present.</span></label><button class='btn btn-primary btn-wide'>Ready to start ${icon('arrow')}</button></form>`;
      else actions+=`<p class='detail-note'>${esc(assigned?.name||'The learner')} will contact you and arrange supervision before starting.</p>`;
    }
    if(r.status==='in_progress') actions+=`<div class='detail-label'>Supervising clinician</div><p class='detail-note'>${esc(sup?.name||'Supervisor confirmed')} · Ext. ${esc(sup?.extension||'')}</p>${(own||owner)?`<button class='btn btn-primary btn-wide' data-complete='${esc(r.id)}'>${icon('check')}Mark complete</button>`:''}`;
    if(own)actions+=`<button class='btn btn-quiet btn-wide btn-sm' data-release='${esc(r.id)}'>Can’t attend? Return to care team</button>`;
  }
  if(r.status==='completed')actions=`<div class='terminal-box'><strong>Recorded in the procedure log</strong>${date(r.completedAt)}${r.participation?` · ${esc(r.participation)}`:''}<br>${esc(sup?.name||'Supervisor confirmed')}</div>`;
  if(r.status==='expired'||r.status==='cancelled')actions=`<div class='terminal-box'><strong>${r.status==='expired'?'Claim window closed':'Returned to the care team'}</strong>${r.status==='expired'?'No learner claimed this opportunity within 10 minutes.':esc(r.cancellationReason||'This request was closed by the posting clinician.')} The usual care team continues care.</div>${owner?`<button class='btn btn-secondary btn-wide' data-repost='${esc(r.id)}'>Post again</button>`:''}`;
  if(owner&&['open','claimed','in_progress'].includes(r.status))actions+=`<button class='btn btn-quiet btn-wide btn-sm' data-cancel='${esc(r.id)}'>Close request</button>`;
  return `<section class='detail-panel' id='request-detail'><div class='eyebrow'>Opportunity details</div>${badge(r.status)}<h2>${esc(r.procedure)}</h2><div class='detail-location'>${icon('pin')}${esc(r.location)}</div><div class='detail-divider'></div><div class='detail-label'>${r.manual?'Logged by':'Staff contact'}</div><div class='contact-person'><div class='avatar'>${esc(staff?.initials||assigned?.initials||'RC')}</div><div><strong>${esc(staff?.name||assigned?.name||'Care team')}</strong><p>${staff?userTitle(staff):'Procedure log'}</p></div>${r.contact?`<span class='contact-ext'>${esc(r.contact)}</span>`:''}</div>${r.note?`<p class='detail-note'>${esc(r.note)}</p>`:''}${actions}</section>`;
}
function workflowCard() { return `<div class='workflow-card'><div class='eyebrow'>One simple connection</div>${[['Post','A procedure, a location, a staff contact.'],['Claim','An available learner steps in.'],['Connect','Call staff. Confirm supervision.'],['Complete','Finish the procedure. Keep the record.']].map(([t,d],i)=>`<div class='workflow-step ${i===0?'active':''}'><span class='step-number'>${i+1}</span><div><strong>${t}</strong><p>${d}</p></div></div>`).join('')}</div>`; }

function logView(u) {
  const records=state.requests.filter(r=>u.role==='staff'?r.staffId===u.id&&r.status!=='open':r.learnerId===u.id&&r.status==='completed').sort((a,b)=>(b.completedAt||b.createdAt)-(a.completedAt||a.createdAt));
  return `${heading('Every rep counts',u.role==='staff'?'Your team’s activity.':'Your procedure log.',u.role==='staff'?'A record of the opportunities you connected.':'Your completed procedures, all in one place.',isLearner(u)?`<button class='btn btn-primary' data-log>${icon('plus')}Log a procedure</button>`:'')}<div class='activity-table-wrap'><table class='activity-table'><thead><tr><th>Procedure</th><th>${u.role==='staff'?'Learner':'Participation'}</th><th>Supervisor</th><th>Date</th><th>Status</th></tr></thead><tbody>${records.length?records.map(r=>`<tr><td><strong>${esc(r.procedure)}</strong><small>${esc(r.location)}</small></td><td>${u.role==='staff'?esc(person(r.learnerId)?.name||'Unclaimed'):esc(r.participation||'Performed')}</td><td>${esc(supervisors().find(s=>s.id===r.supervisorId)?.name||'—')}</td><td>${date(r.completedAt||r.createdAt)}</td><td>${badge(r.status)}</td></tr>`).join(''):`<tr><td colspan='5'><div class='empty-state'><h3>Your next rep starts here.</h3><p>Completed procedures will appear in your log.</p></div></td></tr>`}</tbody></table></div>${footer()}`;
}

const coreGoals=[['Venipuncture','EPA 12'],['Peripheral IV','EPA 12'],['Foley catheter','EPA 12'],['Basic CPR','EPA 12'],['Bag-mask ventilation','EPA 12'],['Sterile technique','EPA 12']];
function goalsView(u) {
  const records=state.requests.filter(r=>r.status==='completed'&&r.learnerId===u.id&&(!r.participation||r.participation==='performed'));
  const personal=state.goals?.[u.id]||{};
  const goals=[...coreGoals,...(u.role==='resident'?[['Suturing','Personal'],['Central line','Personal'],['Chest tube','Personal']]:[])];
  return `${heading('Build with every rep','Your goals. Your progress.',u.role==='resident'?`Surgery · PGY-${u.pgy}`:'Fourth year · AAMC Core EPA 12',`<button class='btn btn-secondary' data-targets>${icon('target')}Set targets</button>`)}<div class='goals-summary'><div><span class='eyebrow'>Procedure experience</span><h2>${records.length} <span>completed</span></h2></div><p>${goals.filter(([p])=>records.filter(r=>r.procedure===p).length>=(personal[p]||5)).length} of ${goals.length} personal targets reached</p></div><div class='section-header'><h2>Personal targets</h2><span>· Performed procedures</span></div><div class='goal-grid'>${goals.map(([p,source])=>{const n=records.filter(r=>r.procedure===p).length;const target=personal[p]||5;return `<section class='goal-card'><div class='goal-top'><span class='goal-icon'>${icon(n>=target?'check':'target')}</span><span class='goal-source'>${source}</span></div><h3>${p}</h3><div class='goal-count'><strong>${n}</strong><span>/ ${target}</span></div><div class='progress-track' role='progressbar' aria-label='${p}' aria-valuenow='${Math.min(n,target)}' aria-valuemin='0' aria-valuemax='${target}'><span style='width:${Math.min(100,n/target*100)}%'></span></div><p>${n>=target?'Target reached':`${target-n} more to your target`}</p></section>`;}).join('')}</div><div class='goal-reference'><div>${icon('book')}<strong>${u.role==='resident'?'ACGME surgical training':'AAMC Core EPA 12'}</strong></div>${u.role==='resident'?`<p>General surgery case minimums: 850 major cases across residency · 250 before PGY-3 · 200 in the chief year · 25 as teaching assistant.</p><a href='https://www.acgme.org/globalassets/pfassets/programrequirements/2026-prs/440_generalsurgery_2026.pdf' target='_blank' rel='noopener noreferrer'>ACGME requirements ${icon('arrow')}</a><small>Bedside procedure logs do not count automatically toward major operative cases.</small>`:`<p>General procedure skills for entering residency. Your count targets are personal goals.</p><a href='https://www.aamc.org/about-us/mission-areas/medical-education/cbme/core-epas' target='_blank' rel='noopener noreferrer'>AAMC Core EPAs ${icon('arrow')}</a><small>AAMC does not prescribe procedure counts. Completion records experience, not competency.</small>`}</div>${footer()}`;
}
function directoryView() { return `${heading('Connect before you start','Find your supervisor.','Call to confirm availability and supervision.')}<div class='supervisor-grid'>${supervisors().map(s=>`<section class='supervisor-card'><div class='avatar'>${esc(s.initials)}</div><h3>${esc(s.name)}</h3><p>${esc(s.role)}</p><div class='coverage'>${icon('pin')}${esc(s.coverage)}</div><div class='extension'>${icon('phone')}Ext. ${esc(s.extension)}</div></section>`).join('')}</div>${!supervisors().length?`<div class='empty-state'>${icon('people')}<h3>No residents registered yet.</h3><p>Your team’s residents will appear here after they create an account.</p></div>`:''}<div class='info-banner' style='margin-top:24px'>Supervision must be confirmed with the clinician before the procedure.</div>${footer()}`; }
function howView() { return `${heading('Keep it simple','From opportunity to experience.','Four steps. One connected team.')}<div class='guide-grid'>${[['Post the opportunity','Staff add a procedure, location, and callback extension. Available learners receive an in-app notification.'],['Claim within 10 minutes','One learner claims the request and shares an arrival estimate. Unclaimed requests close after 10 minutes.'],['Contact and coordinate','The learner calls staff and confirms a supervisor before starting. If plans change, return the request to the care team.'],['Complete and record','Mark the procedure complete to add it to the learner’s log and update personal goals.']].map(([t,d],i)=>`<section class='guide-card'><span class='step-number'>${i+1}</span><h3>${t}</h3><p>${d}</p></section>`).join('')}</div>${footer()}`; }

function bindEvents() {
  app.querySelectorAll('[data-nav]').forEach(el=>el.onclick=()=>{view=el.dataset.nav;render();});
  app.querySelectorAll('[data-filter]').forEach(el=>el.onclick=()=>{filter=el.dataset.filter;selectedId=null;render();});
  app.querySelectorAll('[data-select]').forEach(el=>el.onclick=()=>{selectedId=el.dataset.select;render();if(innerWidth<=820)document.querySelector('#request-detail')?.scrollIntoView({behavior:'smooth',block:'start'});});
  app.querySelectorAll('[data-new]').forEach(el=>el.onclick=()=>newRequestModal());
  app.querySelectorAll('[data-repost]').forEach(el=>el.onclick=()=>newRequestModal(request(el.dataset.repost)));
  app.querySelector('[data-availability]')?.addEventListener('click',()=>{const active=!me().active;change('/api/me/availability','PATCH',{active},active?'You’re available for new opportunities.':'You’re off duty. New alerts are paused.');});
  app.querySelectorAll('[data-logout]').forEach(el=>el.addEventListener('click',signOut));
  app.querySelector('[data-notifications]')?.addEventListener('click',notificationModal);
  app.querySelector('[data-how]')?.addEventListener('click',()=>{view='how';render();});
  app.querySelector('[data-log]')?.addEventListener('click',logModal);
  app.querySelector('[data-targets]')?.addEventListener('click',targetsModal);
  app.querySelectorAll('[data-recipients]').forEach(el=>el.onclick=()=>recipientsModal(el.dataset.recipients));
  app.querySelectorAll('[data-cancel]').forEach(el=>el.onclick=()=>closeRequestModal(el.dataset.cancel,false));
  app.querySelectorAll('[data-release]').forEach(el=>el.onclick=()=>closeRequestModal(el.dataset.release,true));
  app.querySelectorAll('[data-complete]').forEach(el=>el.onclick=()=>completeModal(el.dataset.complete));
  app.querySelector('#claim-form')?.addEventListener('submit',async e=>{
    e.preventDefault();const etaMinutes=Number(new FormData(e.target).get('eta'));const id=selectedId;
    e.target.querySelector('button').disabled=true;
    if(await change(requestPath(id,'claim'),'POST',{etaMinutes},'Claimed. Contact staff to confirm the plan.')) {filter='mine';selectedId=id;render();}
    else render();
  });
  app.querySelector('#coordinate-form')?.addEventListener('submit',async e=>{
    e.preventDefault();const form=new FormData(e.target);e.target.querySelector('button').disabled=true;
    if(!await change(requestPath(selectedId,'coordinate'),'POST',{contacted:form.has('contacted'),supervision:form.has('supervision'),supervisorId:form.get('supervisorId')},'Coordination confirmed. You’re ready to start.'))render();
  });
  updateClocks();
}

function newRequestModal(existing) {
  showModal('Post a procedure','An opportunity for the next available learner.',`<form id='new-form'><label class='field'><span>Procedure</span><select name='procedure' required>${PROCEDURES.map(p=>`<option ${p===existing?.procedure?'selected':''}>${esc(p)}</option>`).join('')}</select></label><label class='field'><span>Location</span><input name='location' required maxlength='100' placeholder='e.g. Emergency department · Bay 4' value='${esc(existing?.location||'')}'></label><label class='field'><span>Callback extension</span><input name='contact' required maxlength='80' placeholder='e.g. Ext. 4210' value='${esc(existing?.contact||`Ext. ${me().extension||''}`)}'></label><label class='field'><span>Note <span class='muted'>(optional)</span></span><textarea name='note' maxlength='500' placeholder='e.g. Supplies are ready at the bedside.'>${esc(existing?.note||'')}</textarea></label><div class='modal-info'>${icon('bell')}<span>${countLearners(getActiveLearners(state).filter(u=>u.id!==userId).length,'available')} will receive an in-app notification. The claim window is 10 minutes.</span></div><p class='form-error' id='new-error' role='alert'></p><button class='btn btn-primary btn-wide'>Post opportunity ${icon('arrow')}</button></form>`);
  modal.querySelector('#new-form').onsubmit=async e=>{e.preventDefault();const button=e.target.querySelector('button');button.disabled=true;try{const data=Object.fromEntries(new FormData(e.target));accept(await api.mutate('/api/requests','POST',data));selectedId=state.requests.find(r=>r.staffId===userId&&r.status==='open')?.id;filter='open';view='board';modal.close();render();notify('Opportunity posted. Available learners notified in RepCall.');}catch(err){modal.querySelector('#new-error').textContent=err.message;button.disabled=false;}};
}
function recipientsModal(id) { const recipients=state.alerts.filter(a=>a.requestId===id).map(a=>person(a.userId)).filter(Boolean);showModal('Learners notified',request(id).procedure,`<div class='modal-info'>${icon('bell')}<span>Sent to learners who were available when posted.</span></div>${recipients.length?recipients.map(u=>`<div class='recipient-row'><span class='avatar learner'>${esc(u.initials)}</span><span>${esc(u.name)}</span><span class='badge open'>In-app</span></div>`).join(''):`<p class='muted small'>No learners were available when posted.</p>`}`); }
function notificationModal() {
  const alerts=state.alerts.filter(a=>a.userId===userId).sort((a,b)=>b.createdAt-a.createdAt);
  showModal('Notifications','Your latest opportunities.',alerts.length?alerts.slice(0,12).map(a=>{const r=request(a.requestId);return r?`<div class='notification-item'><strong>${esc(r.procedure)}</strong><p>${esc(r.location)} · ${labels[r.status]}</p><div class='small'>${ago(a.createdAt)}</div><button class='view-button' data-open-alert='${esc(r.id)}'>View opportunity ${icon('arrow')}</button></div>`:`<div class='notification-item'><strong>Opportunity closed</strong><p>This opportunity is no longer available.</p><div class='small'>${ago(a.createdAt)}</div></div>`;}).join(''):`<div class='empty-state'>${icon('bell')}<h3>You’re up to date.</h3><p>${isLearner(me())?'Turn on availability to receive new opportunities.':'Your request activity appears on the board.'}</p></div>`);
  api.mutate('/api/alerts/read','POST',{}).then(payload=>{accept(payload);app.querySelector('.notification-count')?.remove();app.querySelector('[data-notifications]')?.setAttribute('aria-label','Notifications');}).catch(error=>notify(error.message));
  modal.querySelectorAll('[data-open-alert]').forEach(el=>el.onclick=()=>{const r=request(el.dataset.openAlert);selectedId=r.id;filter=['open','claimed','in_progress'].includes(r.status)?'open':'closed';view='board';modal.close();render();});
}
function closeRequestModal(id,release) {
  showModal(release?'Return to care team?':'Close this request?',request(id).procedure,`<p class='muted small'>${release?'Contact the posting clinician to confirm you cannot attend.':'The usual care team will continue care.'}</p><form id='close-form'>${release?`<label class='check-field'><input type='checkbox' required>I let the posting clinician know.</label>`:''}<button class='btn btn-danger btn-wide' style='margin-top:20px'>${release?'Return to care team':'Close request'}</button></form>`);
  modal.querySelector('#close-form').onsubmit=async e=>{e.preventDefault();e.target.querySelector('button').disabled=true;if(await change(requestPath(id,release?'release':'cancel'),'POST',{},'Request closed.'))modal.close();else e.target.querySelector('button').disabled=false;};
}
function completeModal(id) {
  showModal('Complete procedure',request(id).procedure,`<form id='complete-form'><label class='field'><span>Learner participation</span><select name='participation'><option value='performed'>Performed</option><option value='assisted'>Assisted</option><option value='observed'>Observed</option></select></label><label class='check-field'><input type='checkbox' required>The procedure is finished and the care team is aware.</label><button class='btn btn-primary btn-wide'>${icon('check')}Complete and record</button></form>`);
  modal.querySelector('#complete-form').onsubmit=async e=>{e.preventDefault();const participation=new FormData(e.target).get('participation');e.target.querySelector('button').disabled=true;if(await change(requestPath(id,'complete'),'POST',{participation},'Procedure recorded. Your log and goals are up to date.')){modal.close();view='log';render();}else e.target.querySelector('button').disabled=false;};
}
function logModal() {
  showModal('Log a procedure','Add a completed procedure to your record.',`<form id='log-form'><label class='field'><span>Procedure</span><select name='procedure' required>${PROCEDURES.map(p=>`<option>${esc(p)}</option>`).join('')}</select></label><div class='field-row'><label class='field'><span>Date</span><input type='date' name='performedAt' required max='${localDate()}' value='${localDate()}'></label><label class='field'><span>Participation</span><select name='participation'><option value='performed'>Performed</option><option value='assisted'>Assisted</option><option value='observed'>Observed</option></select></label></div><label class='field'><span>Supervisor</span><select name='supervisorId' required><option value=''>Choose supervisor</option>${supervisors().filter(s=>s.id!==userId).map(s=>`<option value='${s.id}'>${esc(s.name)}</option>`).join('')}</select></label><p id='log-error' class='form-error' role='alert'></p><button class='btn btn-primary btn-wide'>Save to procedure log ${icon('arrow')}</button></form>`);
  modal.querySelector('#log-form').onsubmit=async e=>{e.preventDefault();const button=e.target.querySelector('button');button.disabled=true;try{const data=Object.fromEntries(new FormData(e.target));accept(await api.mutate('/api/logs','POST',data));modal.close();view='log';render();notify('Procedure added. Your goals are up to date.');}catch(err){modal.querySelector('#log-error').textContent=err.message;button.disabled=false;}};
}
function localDate() {const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
function targetsModal() {
  const goals=[...coreGoals,...(me().role==='resident'?[['Suturing'],['Central line'],['Chest tube']]:[])];
  showModal('Set your targets','Personal goals for performed procedures.',`<form id='targets-form'>${goals.map(([p])=>`<label class='target-field'><span>${p}</span><input type='number' name='${p}' min='1' max='999' required value='${state.goals?.[userId]?.[p]||5}' aria-label='${p} target'></label>`).join('')}<button class='btn btn-primary btn-wide' style='margin-top:20px'>Save targets</button></form>`);
  modal.querySelector('#targets-form').onsubmit=async e=>{e.preventDefault();const targets=Object.fromEntries([...new FormData(e.target)].map(([k,v])=>[k,Number(v)]));e.target.querySelector('button').disabled=true;if(await change('/api/me/goals','PUT',{targets},'Targets saved.'))modal.close();else e.target.querySelector('button').disabled=false;};
}
function updateClocks() { document.querySelectorAll('[data-countdown]').forEach(el=>el.textContent=countdown(Number(el.dataset.countdown))); document.querySelectorAll('[data-arrival]').forEach(el=>{if(serverNow()>Number(el.dataset.arrival))el.querySelector('span').textContent='Arrival estimate passed. Contact the team to confirm the plan.';}); }
setInterval(updateClocks,1000);
setInterval(()=>{if(!document.hidden)refresh();},5000);
window.addEventListener('focus',refresh);
async function start() {
  app.innerHTML="<main id='main' class='loading-screen'><img src='./icon.svg' alt=''><p>Connecting to RepCall…</p></main>";
  try { if(api.hasSession())accept(await api.state()); }
  catch(error) { if(error.status!==401)notify(error.message); }
  render();
}
start();
