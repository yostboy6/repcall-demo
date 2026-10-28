import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {handleApi} from './backend.mjs';
import {createSqliteDatabase} from './sqlite-adapter.mjs';

const PASSWORD='practice1234';
function harness(db=createSqliteDatabase()) {
  const env={DB:db,ALLOWED_ORIGIN:'https://yostboy6.github.io',APP_TIMEZONE:'America/Phoenix'};
  async function call(path,{method='GET',token,body,origin='https://yostboy6.github.io'}={}) {
    const headers={'Origin':origin};
    if(token)headers.Authorization=`Bearer ${token}`;
    if(body!==undefined)headers['Content-Type']='application/json';
    const response=await handleApi(new Request(`https://api.repcall.test${path}`,{method,headers,...(body!==undefined?{body:typeof body==='string'?body:JSON.stringify(body)}:{})}),env);
    const data=response.status===204?null:await response.json();
    return {status:response.status,data,response};
  }
  async function signup(role='learner',name='Jordan Kim',email=`${crypto.randomUUID()}@example.org`) {
    const result=await call('/api/auth/register',{method:'POST',body:{name,email,password:PASSWORD,role,extension:'4210',...(role==='resident'?{pgy:4}:{})}});
    assert.equal(result.status,201,JSON.stringify(result.data));
    return {...result.data,email};
  }
  const active=async user=>call('/api/me/availability',{method:'PATCH',token:user.token,body:{active:true}});
  const post=async nurse=>call('/api/requests',{method:'POST',token:nurse.token,body:{procedure:'Venipuncture',location:'Medicine ward · Station 5',contact:'Ext. 4210',note:'Supplies ready.'}});
  return {db,env,call,signup,active,post};
}

test('registration is the sole account creation path and stores only password/session verifiers',async t=>{
  const h=harness();t.after(()=>h.db.close());
  const failed=await h.call('/api/auth/login',{method:'POST',body:{email:'new@example.org',password:PASSWORD}});
  assert.equal(failed.status,401);
  assert.equal(await h.db.prepare('SELECT count(*) AS n FROM users').first('n'),0);
  const user=await h.signup('resident','Taylor Reed','taylor@example.org');
  assert.equal(typeof user.serverTime,'number');
  assert.ok(Math.abs(user.serverTime-Date.now())<5000);
  assert.equal(user.state.version,2);
  assert.equal(user.state.users.length,1);
  assert.equal(user.state.users[0].pgy,4);
  assert.deepEqual(user.state.requests,[]);
  assert.equal(user.state.users[0].active,false);
  const stored=await h.db.prepare('SELECT * FROM users').first();
  assert.notEqual(stored.password_hash,PASSWORD);
  assert.ok(stored.password_salt.length>16);
  assert.equal(JSON.stringify(user.state).includes('password_hash'),false);
  const session=await h.db.prepare('SELECT token_hash FROM sessions').first();
  assert.notEqual(session.token_hash,user.token);
  assert.equal(user.token.length>=40,true);
});

test('a fresh device can sign in to the same persistent account and logout revokes its session',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'repcall-backend-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const path=join(directory,'app.sqlite');let h=harness(createSqliteDatabase(path));
  const user=await h.signup('learner','Jordan Kim','jordan@example.org');
  await h.call('/api/me/goals',{method:'PUT',token:user.token,body:{targets:{Venipuncture:9}}});
  h.db.close();h=harness(createSqliteDatabase(path));t.after(()=>h.db.close());
  const login=await h.call('/api/auth/login',{method:'POST',body:{email:'JORDAN@example.org',password:PASSWORD}});
  assert.equal(login.status,200);
  assert.equal(login.data.userId,user.userId);
  assert.notEqual(login.data.token,user.token);
  assert.equal(login.data.state.goals[user.userId].Venipuncture,9);
  assert.equal((await h.call('/api/state',{token:user.token})).status,200);
  assert.equal((await h.call('/api/auth/logout',{method:'POST',token:login.data.token})).status,200);
  assert.equal((await h.call('/api/state',{token:login.data.token})).status,401);
  assert.equal((await h.call('/api/state',{token:user.token})).status,200);
  const wrong=await h.call('/api/auth/login',{method:'POST',body:{email:user.email,password:'wrongpassword'}});
  assert.equal(wrong.status,401);
});

test('nurse posts are shared across devices and only active learners receive in-app alerts',async t=>{
  const h=harness();t.after(()=>h.db.close());
  const nurse=await h.signup('staff','Maya Patel');const student=await h.signup();const inactive=await h.signup('learner','Dev Morgan');
  assert.equal((await h.active(student)).status,200);
  const posted=await h.post(nurse);assert.equal(posted.status,201);
  const id=posted.data.state.requests[0].id;
  const seen=await h.call('/api/state',{token:student.token});
  assert.equal(seen.data.state.requests[0].id,id);
  assert.equal(seen.data.state.alerts.length,1);
  assert.equal(seen.data.state.alerts[0].userId,student.userId);
  assert.equal((await h.call('/api/state',{token:inactive.token})).data.state.alerts.length,0);
  const outsider=seen.data.state.users.find(u=>u.id===nurse.userId);
  assert.equal('email' in outsider,false);
  assert.equal(seen.data.state.users.find(u=>u.id===student.userId).email,student.email);
  assert.equal(posted.data.state.alerts[0].userId,student.userId);
});

test('server claims have one winner for a request and one current request per learner',async t=>{
  const h=harness();t.after(()=>h.db.close());
  const nurse=await h.signup('staff');const a=await h.signup();const b=await h.signup('learner','Ana Lopez');await h.active(a);await h.active(b);
  const first=(await h.post(nurse)).data.state.requests[0].id;
  const race=await Promise.all([a,b].map(u=>h.call(`/api/requests/${first}/claim`,{method:'POST',token:u.token,body:{etaMinutes:3}})));
  assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);
  const winner=race.find(r=>r.status===200).data.userId;
  assert.equal((await h.db.prepare('SELECT learner_id FROM requests WHERE id=?').bind(first).first()).learner_id,winner);
  const free=winner===a.userId?b:a;
  const ids=[];for(let i=0;i<2;i++)ids.push((await h.post(nurse)).data.state.requests[0].id);
  const sameLearner=await Promise.all(ids.map(id=>h.call(`/api/requests/${id}/claim`,{method:'POST',token:free.token,body:{etaMinutes:5}})));
  assert.deepEqual(sameLearner.map(r=>r.status).sort(),[200,409]);
  assert.equal(await h.db.prepare("SELECT count(*) AS n FROM requests WHERE learner_id=? AND status='claimed'").bind(free.userId).first('n'),1);
});

test('server expiry rejects late claims and records the exact original cutoff',async t=>{
  const h=harness();t.after(()=>h.db.close());const nurse=await h.signup('staff');const learner=await h.signup();await h.active(learner);
  const id=(await h.post(nurse)).data.state.requests[0].id;const cutoff=Date.now()-1000;
  await h.db.prepare('UPDATE requests SET expires_at=? WHERE id=?').bind(cutoff,id).run();
  const claim=await h.call(`/api/requests/${id}/claim`,{method:'POST',token:learner.token,body:{etaMinutes:3}});
  assert.equal(claim.status,409);
  const row=await h.db.prepare('SELECT status,expired_at FROM requests WHERE id=?').bind(id).first();
  assert.deepEqual(row,{status:'expired',expired_at:cutoff});
});

test('coordination, completion, logs, and goals enforce identity and stay private',async t=>{
  const h=harness();t.after(()=>h.db.close());const nurse=await h.signup('staff','Maya Patel');const learner=await h.signup();const supervisor=await h.signup('resident','Asha Patel');const other=await h.signup('learner','Ana Lopez');await h.active(learner);
  const id=(await h.post(nurse)).data.state.requests[0].id;
  await h.call(`/api/requests/${id}/claim`,{method:'POST',token:learner.token,body:{etaMinutes:3}});
  assert.equal((await h.call(`/api/requests/${id}/complete`,{method:'POST',token:learner.token,body:{participation:'performed'}})).status,409);
  const missing=await h.call(`/api/requests/${id}/coordinate`,{method:'POST',token:learner.token,body:{contacted:true,supervisorId:supervisor.userId}});assert.equal(missing.status,400);
  const stolen=await h.call(`/api/requests/${id}/coordinate`,{method:'POST',token:other.token,body:{contacted:true,supervision:true,supervisorId:supervisor.userId}});assert.equal(stolen.status,403);
  const coordinated=await h.call(`/api/requests/${id}/coordinate`,{method:'POST',token:learner.token,body:{contacted:true,supervision:true,supervisorId:supervisor.userId}});assert.equal(coordinated.status,200);
  const done=await h.call(`/api/requests/${id}/complete`,{method:'POST',token:nurse.token,body:{participation:'performed'}});assert.equal(done.status,200);
  assert.equal((await h.call(`/api/requests/${id}/complete`,{method:'POST',token:nurse.token,body:{participation:'performed'}})).status,409);
  const manual=await h.call('/api/logs',{method:'POST',token:learner.token,body:{procedure:'Peripheral IV',supervisorId:supervisor.userId,participation:'assisted'}});assert.equal(manual.status,201);
  const goals=await h.call('/api/me/goals',{method:'PUT',token:learner.token,body:{targets:{Venipuncture:7,'Peripheral IV':4}}});assert.equal(goals.status,200);
  assert.equal(goals.data.state.requests.filter(r=>r.status==='completed').length,2);
  const hidden=(await h.call('/api/state',{token:other.token})).data.state;
  assert.equal(hidden.requests.some(r=>r.id===id),false);
  assert.deepEqual(hidden.goals,{[other.userId]:{}});
  const freshLogin=await h.call('/api/auth/login',{method:'POST',body:{email:learner.email,password:PASSWORD}});
  assert.equal(freshLogin.data.state.requests.filter(r=>r.status==='completed').length,2);
  assert.equal(freshLogin.data.state.goals[learner.userId].Venipuncture,7);
  assert.equal(freshLogin.data.state.supervisors[0].id,supervisor.userId);
});

test('role checks and actor validation reject forged actions and self-assignment',async t=>{
  const h=harness();t.after(()=>h.db.close());const nurse=await h.signup('staff');const learner=await h.signup();const resident=await h.signup('resident');
  assert.equal((await h.active(nurse)).status,403);
  assert.equal((await h.post(learner)).status,403);
  assert.equal((await h.call('/api/me/goals',{method:'PUT',token:nurse.token,body:{targets:{Venipuncture:2}}})).status,403);
  assert.equal((await h.call('/api/requests',{method:'POST',token:nurse.token,body:{procedure:'Venipuncture',location:'Ward',contact:'4210',staffId:resident.userId}})).status,403);
  await h.active(resident);const id=(await h.post(resident)).data.state.requests[0].id;
  assert.equal((await h.call(`/api/requests/${id}/claim`,{method:'POST',token:resident.token,body:{etaMinutes:3}})).status,403);
  assert.equal((await h.call('/api/logs',{method:'POST',token:resident.token,body:{procedure:'Venipuncture',supervisorId:resident.userId,participation:'performed'}})).status,400);
  assert.equal((await h.call('/api/me/availability',{method:'PATCH',token:learner.token,body:{active:true,userId:resident.userId}})).status,403);
});

test('closing and releasing requests cannot alter other users requests or reopen completed work',async t=>{
  const h=harness();t.after(()=>h.db.close());const nurse=await h.signup('staff');const otherNurse=await h.signup('staff');const learner=await h.signup();await h.active(learner);
  const id=(await h.post(nurse)).data.state.requests[0].id;
  assert.equal((await h.call(`/api/requests/${id}/cancel`,{method:'POST',token:otherNurse.token,body:{}})).status,403);
  await h.call(`/api/requests/${id}/claim`,{method:'POST',token:learner.token,body:{etaMinutes:3}});
  const released=await h.call(`/api/requests/${id}/release`,{method:'POST',token:learner.token,body:{}});assert.equal(released.status,200);
  assert.equal(released.data.state.requests.find(r=>r.id===id).status,'cancelled');
  assert.equal((await h.call(`/api/requests/${id}/release`,{method:'POST',token:learner.token,body:{}})).status,409);
  const second=(await h.post(nurse)).data.state.requests[0].id;
  assert.equal((await h.call(`/api/requests/${second}/cancel`,{method:'POST',token:nurse.token,body:{}})).status,200);
  assert.equal((await h.call(`/api/requests/${second}/claim`,{method:'POST',token:learner.token,body:{etaMinutes:3}})).status,409);
});

test('validation rejects invalid signup, target counts, future logs, and oversized bodies',async t=>{
  const h=harness();t.after(()=>h.db.close());
  const body={name:'Taylor',email:'taylor@example.org',password:PASSWORD,role:'resident',pgy:6,extension:'5305'};
  assert.equal((await h.call('/api/auth/register',{method:'POST',body})).status,400);
  body.pgy=5;const registered=await h.call('/api/auth/register',{method:'POST',body});assert.equal(registered.status,201);
  assert.equal((await h.call('/api/auth/register',{method:'POST',body})).status,409);
  const learner=await h.signup();
  for(const target of [0,1000,1.5,'5']) assert.equal((await h.call('/api/me/goals',{method:'PUT',token:learner.token,body:{targets:{Venipuncture:target}}})).status,400);
  assert.equal((await h.call('/api/me/goals',{method:'PUT',token:learner.token,body:{targets:{Invented:5}}})).status,400);
  const future=await h.call('/api/logs',{method:'POST',token:learner.token,body:{procedure:'Venipuncture',supervisorId:registered.data.userId,participation:'performed',performedAt:'2999-01-01'}});assert.equal(future.status,400);
  const huge=await h.call('/api/auth/register',{method:'POST',body:JSON.stringify({...body,name:'x'.repeat(20_000)})});assert.equal(huge.status,413);
});

test('login throttling and CORS protect the public API without exposing private errors',async t=>{
  const h=harness();t.after(()=>h.db.close());const learner=await h.signup();
  for(let i=0;i<10;i++)assert.equal((await h.call('/api/auth/login',{method:'POST',body:{email:learner.email,password:'wrongpass'}})).status,401);
  assert.equal((await h.call('/api/auth/login',{method:'POST',body:{email:learner.email,password:'wrongpass'}})).status,429);
  const denied=await h.call('/api/state',{token:learner.token,origin:'https://evil.example'});assert.equal(denied.status,403);assert.equal(denied.response.headers.get('access-control-allow-origin'),null);
  const preflight=await h.call('/api/state',{method:'OPTIONS'});assert.equal(preflight.status,204);assert.equal(preflight.response.headers.get('access-control-allow-origin'),'https://yostboy6.github.io');
  const missing=await h.call('/api/state');assert.equal(missing.status,401);assert.equal(JSON.stringify(missing.data).includes('SELECT'),false);
});
