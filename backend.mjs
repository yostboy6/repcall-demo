import {randomBytes,randomUUID,createHash,scrypt as nodeScrypt,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {PROCEDURES} from './domain.js';

const scrypt=promisify(nodeScrypt);
const SESSION_MS=30*24*60*60*1000;
const CLAIM_MS=10*60*1000;
const PARTICIPATION=['performed','assisted','observed'];
const CURRENT=['open','claimed','in_progress'];
const sha=value=>createHash('sha256').update(value).digest('hex');
const options={N:16384,r:8,p:5,maxmem:32*1024*1024};
class ApiError extends Error { constructor(status,message){super(message);this.status=status;} }
const fail=(status,message)=>{throw new ApiError(status,message);};
const all=async(db,sql,...values)=>(await db.prepare(sql).bind(...values).all()).results;
const first=(db,sql,...values)=>db.prepare(sql).bind(...values).first();
const run=(db,sql,...values)=>db.prepare(sql).bind(...values).run();

function text(value,label,max,required=true) {
  if(typeof value!=='string' && value!=null)fail(400,`${label} must be text.`);
  const result=(value||'').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,'').trim();
  if(required&&!result)fail(400,`${label} is required.`);
  if(result.length>max)fail(400,`${label} is too long.`);
  return result;
}
function emailAddress(value) {
  const email=text(value,'Email',254).toLowerCase();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))fail(400,'Enter a valid email address.');
  return email;
}
function passwordText(value) {
  if(typeof value!=='string'||value.length<8||value.length>128)fail(400,'Use a password with 8 to 128 characters.');
  return value;
}
function actorFields(body) {
  if(['userId','staffId','learnerId'].some(key=>Object.hasOwn(body,key)))fail(403,'Account identity is managed by your signed-in session.');
}
function role(user,roles) { if(!roles.includes(user.role))fail(403,'Your role cannot perform this action.'); }
function participation(value) { if(!PARTICIPATION.includes(value))fail(400,'Choose performed, assisted, or observed participation.');return value; }
function procedure(value) { if(!PROCEDURES.includes(value))fail(400,'Choose a listed procedure.');return value; }

async function readBody(request) {
  if(Number(request.headers.get('content-length'))>16_384)fail(413,'This request is too large.');
  if(!request.body)return {};
  if(!request.headers.get('content-type')?.toLowerCase().includes('application/json'))fail(400,'Send a JSON request.');
  const reader=request.body.getReader();const chunks=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>16_384){await reader.cancel();fail(413,'This request is too large.');}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  let parsed;try{parsed=JSON.parse(new TextDecoder().decode(bytes));}catch{fail(400,'Enter valid request details.');}
  if(!parsed||Array.isArray(parsed)||typeof parsed!=='object')fail(400,'Enter valid request details.');
  return parsed;
}

async function throttle(db,key,limit,windowMs,now) {
  const results=await db.batch([
    db.prepare('DELETE FROM rate_limits WHERE reset_at < ?').bind(now-24*60*60*1000),
    db.prepare('INSERT INTO rate_limits(key,count,reset_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN reset_at<=? THEN 1 ELSE count+1 END, reset_at=CASE WHEN reset_at<=? THEN excluded.reset_at ELSE reset_at END').bind(key,now+windowMs,now,now),
    db.prepare('SELECT count FROM rate_limits WHERE key=?').bind(key),
  ]);
  if(results[2].results[0].count>limit)fail(429,'Too many attempts. Please try again later.');
}
async function hashPassword(password,salt) { return Buffer.from(await scrypt(password,salt,64,options)).toString('base64'); }
async function newSession(db,userId,now) {
  const token=randomBytes(32).toString('base64url');
  await run(db,'INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)',sha(token),userId,now+SESSION_MS,now);
  return token;
}
async function authenticate(request,db,now) {
  const match=/^Bearer ([A-Za-z0-9_-]{40,100})$/.exec(request.headers.get('authorization')||'');
  if(!match)fail(401,'Sign in to continue.');
  const tokenHash=sha(match[1]);
  const user=await first(db,'SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?',tokenHash,now);
  if(!user)fail(401,'Your session has ended. Sign in again.');
  return {user,tokenHash};
}
function profile(user,currentId) {
  const title=user.role==='staff'?'Nurse':user.role==='learner'?'Fourth-year medical student':`Surgical resident · PGY-${user.pgy}`;
  return {id:user.id,name:user.name,initials:user.name.split(/\s+/).map(part=>part[0]).slice(0,2).join('').toUpperCase(),role:user.role,title,extension:user.extension,active:!!user.active,createdAt:user.created_at,...(user.role==='resident'?{pgy:user.pgy}:{}),...(user.id===currentId?{email:user.email}:{})};
}
function requestRecord(row) {
  return {id:row.id,procedure:row.procedure,location:row.location,contact:row.contact,note:row.note,staffId:row.staff_id,learnerId:row.learner_id,status:row.status,createdAt:row.created_at,expiresAt:row.expires_at,claimedAt:row.claimed_at,coordinatedAt:row.coordinated_at,completedAt:row.completed_at,cancelledAt:row.cancelled_at,expiredAt:row.expired_at,etaMinutes:row.eta_minutes,contacted:!!row.contacted,supervisorId:row.supervisor_id,participation:row.participation,manual:!!row.manual,cancellationReason:row.cancellation_reason,...(row.manual?{performedAt:row.completed_at}:{})};
}
async function expireRequests(db,now) { await run(db,"UPDATE requests SET status='expired',expired_at=expires_at WHERE status='open' AND expires_at<=?",now); }
async function stateFor(db,userId,now) {
  await expireRequests(db,now);
  const [users,requests,alerts,goals]=await Promise.all([
    all(db,'SELECT id,name,email,role,pgy,extension,active,created_at FROM users ORDER BY created_at,rowid'),
    all(db,"SELECT * FROM requests WHERE (manual=0 AND status IN ('open','claimed','in_progress')) OR staff_id=? OR learner_id=? ORDER BY created_at DESC,rowid DESC",userId,userId),
    all(db,'SELECT a.* FROM alerts a LEFT JOIN requests r ON r.id=a.request_id WHERE a.user_id=? OR r.staff_id=? ORDER BY a.created_at DESC,a.rowid DESC',userId,userId),
    all(db,'SELECT procedure,target FROM goals WHERE user_id=?',userId),
  ]);
  const profiles=users.map(user=>profile(user,userId));
  return {version:2,users:profiles,requests:requests.map(requestRecord),alerts:alerts.map(a=>({id:a.id,requestId:a.request_id,userId:a.user_id,createdAt:a.created_at,read:!!a.read})),goals:{[userId]:Object.fromEntries(goals.map(g=>[g.procedure,g.target]))},supervisors:profiles.filter(u=>u.role==='resident').map(u=>({id:u.id,name:u.name,initials:u.initials,role:u.title,title:u.title,pgy:u.pgy,extension:u.extension,coverage:'Surgery',available:u.active}))};
}
async function supervisor(db,id,actorId) {
  if(typeof id!=='string'||id===actorId||!await first(db,"SELECT id FROM users WHERE id=? AND role='resident'",id))fail(400,'Choose a supervising resident other than yourself.');
  return id;
}
async function findRequest(db,id) { const row=await first(db,'SELECT * FROM requests WHERE id=?',id);if(!row)fail(404,'This procedure request could not be found.');return row; }
function ownRequest(row,userId,field) { if(row[field]!==userId)fail(403,'This procedure request is assigned to another account.'); }
function changed(result) { if(!result.meta.changes)fail(409,'The procedure request changed. Refresh and try again.'); }
function dateKey(value,timeZone) {
  const parts=new Intl.DateTimeFormat('en-US',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(value);
  return ['year','month','day'].map(type=>parts.find(p=>p.type===type).value).join('-');
}
function performedTime(value,now,timeZone) {
  if(value==null||value==='')return now;
  let timestamp;
  if(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)){
    timestamp=Date.parse(`${value}T19:00:00Z`);
    if(!Number.isFinite(timestamp)||new Date(timestamp).toISOString().slice(0,10)!==value)fail(400,'Enter a valid procedure date.');
  }else if(typeof value==='number'&&Number.isFinite(value))timestamp=value;
  else fail(400,'Enter a valid procedure date.');
  if(timestamp<Date.UTC(1900,0,1)||dateKey(timestamp,timeZone)>dateKey(now,timeZone))fail(400,'Choose today or an earlier procedure date.');
  return timestamp;
}

/** A D1-backed HTTP API. Credentials and ownership checks never leave the server. */
export async function handleApi(request,env) {
  const allowed=env.ALLOWED_ORIGIN||'https://yostboy6.github.io';
  const origin=request.headers.get('origin');
  const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Vary':'Origin'};
  if(origin===allowed){headers['Access-Control-Allow-Origin']=origin;headers['Access-Control-Allow-Methods']='GET, POST, PATCH, PUT, OPTIONS';headers['Access-Control-Allow-Headers']='Authorization, Content-Type';headers['Access-Control-Max-Age']='600';}
  const response=(data,status=200)=>new Response(JSON.stringify({...data,serverTime:Date.now()}),{status,headers});
  try {
    if(origin&&origin!==allowed)fail(403,'This website cannot access the API.');
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
    if(!env.DB)fail(503,'The shared service is temporarily unavailable.');
    const db=env.DB;const now=Date.now();const url=new URL(request.url);const path=url.pathname.replace(/\/$/,'');const method=request.method;
    if(path==='/api/auth/register'&&method==='POST'){
      const body=await readBody(request);actorFields(body);
      await throttle(db,`register:${sha(request.headers.get('cf-connecting-ip')||'local')}`,10,60*60*1000,now);
      const name=text(body.name,'Name',80),email=emailAddress(body.email),password=passwordText(body.password),extension=text(body.extension,'Contact extension',20);
      if(!['staff','learner','resident'].includes(body.role))fail(400,'Choose nurse, fourth-year medical student, or surgical resident.');
      const pgy=body.role==='resident'?body.pgy:null;
      if(body.role==='resident'&&(!Number.isInteger(pgy)||pgy<1||pgy>5))fail(400,'Choose a PGY year from 1 to 5.');
      if(body.role!=='resident'&&body.pgy!=null&&body.pgy!=='')fail(400,'PGY year applies only to residents.');
      const id=randomUUID(),salt=randomBytes(16).toString('base64'),hash=await hashPassword(password,salt),token=randomBytes(32).toString('base64url');
      try{await db.batch([
        db.prepare('INSERT INTO users(id,name,email,password_hash,password_salt,role,pgy,extension,active,created_at) VALUES(?,?,?,?,?,?,?,?,0,?)').bind(id,name,email,hash,salt,body.role,pgy,extension,now),
        db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)').bind(sha(token),id,now+SESSION_MS,now),
      ]);}catch(error){if(String(error.message).includes('UNIQUE'))fail(409,'An account with this email already exists. Sign in instead.');throw error;}
      return response({token,userId:id,state:await stateFor(db,id,now)},201);
    }
    if(path==='/api/auth/login'&&method==='POST'){
      const body=await readBody(request);actorFields(body);const email=emailAddress(body.email),password=passwordText(body.password);
      await throttle(db,`login-ip:${sha(request.headers.get('cf-connecting-ip')||'local')}`,30,15*60*1000,now);
      await throttle(db,`login-email:${sha(email)}`,10,15*60*1000,now);
      const user=await first(db,'SELECT * FROM users WHERE email=? COLLATE NOCASE',email);
      const candidate=await hashPassword(password,user?.password_salt||'not-a-registered-account-salt');
      if(!user||!timingSafeEqual(Buffer.from(candidate,'base64'),Buffer.from(user.password_hash,'base64')))fail(401,'Check your email and password.');
      return response({token:await newSession(db,user.id,now),userId:user.id,state:await stateFor(db,user.id,now)});
    }
    const {user,tokenHash}=await authenticate(request,db,now);
    if(path==='/api/auth/logout'&&method==='POST'){
      await run(db,'DELETE FROM sessions WHERE token_hash=?',tokenHash);
      return response({userId:null,state:null});
    }
    if(path==='/api/state'&&method==='GET')return response({userId:user.id,state:await stateFor(db,user.id,now)});
    await expireRequests(db,now);
    const body=await readBody(request);actorFields(body);let status=200;
    if(path==='/api/me/availability'&&method==='PATCH'){
      role(user,['learner','resident']);if(typeof body.active!=='boolean')fail(400,'Choose available or off duty.');
      await run(db,'UPDATE users SET active=? WHERE id=?',body.active?1:0,user.id);
    }else if(path==='/api/requests'&&method==='POST'){
      role(user,['staff','resident']);const chosen=procedure(body.procedure),location=text(body.location,'Location',100),contact=text(body.contact,'Callback extension',80),note=text(body.note,'Note',500,false),id=randomUUID();
      await db.batch([
        db.prepare("INSERT INTO requests(id,procedure,location,contact,note,staff_id,status,created_at,expires_at) VALUES(?,?,?,?,?,?,'open',?,?)").bind(id,chosen,location,contact,note,user.id,now,now+CLAIM_MS),
        db.prepare("INSERT INTO alerts(id,request_id,user_id,created_at,read) SELECT lower(hex(randomblob(16))),?,id,?,0 FROM users WHERE active=1 AND role IN ('learner','resident') AND id<>?").bind(id,now,user.id),
      ]);status=201;
    }else if(path==='/api/logs'&&method==='POST'){
      role(user,['learner','resident']);const chosen=procedure(body.procedure),part=participation(body.participation),supervisorId=await supervisor(db,body.supervisorId,user.id),performed=performedTime(body.performedAt,now,env.APP_TIMEZONE||'America/Phoenix');
      await run(db,"INSERT INTO requests(id,procedure,location,contact,note,learner_id,status,created_at,expires_at,completed_at,supervisor_id,participation,manual) VALUES(?,?,'Procedure log','','',?,'completed',?,?,?,?,?,1)",randomUUID(),chosen,user.id,now,now,performed,supervisorId,part);status=201;
    }else if(path==='/api/me/goals'&&method==='PUT'){
      role(user,['learner','resident']);const targets=body.targets;
      if(!targets||typeof targets!=='object'||Array.isArray(targets)||Object.keys(targets).length>PROCEDURES.length)fail(400,'Enter valid procedure targets.');
      const statements=[db.prepare('DELETE FROM goals WHERE user_id=?').bind(user.id)];
      for(const [chosen,target]of Object.entries(targets)){procedure(chosen);if(!Number.isInteger(target)||target<1||target>999)fail(400,'Targets must be whole numbers from 1 to 999.');statements.push(db.prepare('INSERT INTO goals(user_id,procedure,target) VALUES(?,?,?)').bind(user.id,chosen,target));}
      await db.batch(statements);
    }else if(path==='/api/alerts/read'&&method==='POST'){
      await run(db,'UPDATE alerts SET read=1 WHERE user_id=?',user.id);
    }else{
      const match=/^\/api\/requests\/([^/]+)\/(claim|coordinate|complete|cancel|release)$/.exec(path);
      if(!match||method!=='POST')fail(404,'This action could not be found.');
      const id=decodeURIComponent(match[1]),action=match[2],row=await findRequest(db,id);
      if(action==='claim'){
        role(user,['learner','resident']);if(!user.active)fail(403,'Turn on availability before claiming.');if(row.staff_id===user.id)fail(403,'You cannot claim your own posted procedure.');
        if(![3,5,10].includes(body.etaMinutes))fail(400,'Choose an arrival estimate of 3, 5, or 10 minutes.');
        try{const result=await run(db,"UPDATE requests SET status='claimed',learner_id=?,eta_minutes=?,claimed_at=? WHERE id=? AND status='open' AND expires_at>? AND staff_id<>? AND EXISTS(SELECT 1 FROM users WHERE id=? AND active=1 AND role IN ('learner','resident'))",user.id,body.etaMinutes,now,id,now,user.id,user.id);if(!result.meta.changes)fail(409,'This opportunity is no longer available.');}
        catch(error){if(String(error.message).includes('UNIQUE'))fail(409,'Finish your current procedure before claiming another.');throw error;}
      }else if(action==='coordinate'){
        ownRequest(row,user.id,'learner_id');if(row.status!=='claimed')fail(409,'This procedure is not awaiting coordination.');
        if(body.contacted!==true||body.supervision!==true)fail(400,'Confirm staff contact and your supervisor’s agreement.');
        const supervisorId=await supervisor(db,body.supervisorId,user.id);
        changed(await run(db,"UPDATE requests SET status='in_progress',contacted=1,supervisor_id=?,coordinated_at=? WHERE id=? AND learner_id=? AND status='claimed'",supervisorId,now,id,user.id));
      }else if(action==='complete'){
        if(row.staff_id!==user.id&&row.learner_id!==user.id)fail(403,'Only the assigned learner or posting clinician can complete this procedure.');
        if(row.status!=='in_progress')fail(409,'Confirm coordination before completing this procedure.');
        const part=participation(body.participation);
        changed(await run(db,"UPDATE requests SET status='completed',completed_at=?,participation=? WHERE id=? AND status='in_progress' AND (staff_id=? OR learner_id=?)",now,part,id,user.id,user.id));
      }else if(action==='cancel'){
        role(user,['staff','resident']);ownRequest(row,user.id,'staff_id');if(!CURRENT.includes(row.status))fail(409,'This procedure request is already closed.');
        changed(await run(db,"UPDATE requests SET status='cancelled',cancelled_at=? WHERE id=? AND staff_id=? AND status IN ('open','claimed','in_progress')",now,id,user.id));
      }else if(action==='release'){
        role(user,['learner','resident']);ownRequest(row,user.id,'learner_id');if(!['claimed','in_progress'].includes(row.status))fail(409,'This procedure request is already closed.');
        changed(await run(db,"UPDATE requests SET status='cancelled',cancelled_at=?,cancellation_reason='Learner returned request to care team' WHERE id=? AND learner_id=? AND status IN ('claimed','in_progress')",now,id,user.id));
      }
    }
    return response({userId:user.id,state:await stateFor(db,user.id,now)},status);
  }catch(error){
    return response({error:error instanceof ApiError?error.message:'The shared service could not complete this action. Please try again.'},error instanceof ApiError?error.status:500);
  }
}
