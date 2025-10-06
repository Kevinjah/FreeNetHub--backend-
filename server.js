/* FreeNetHub-backend v3 (summary version) */
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { join } = require('path');
const fetch = require('node-fetch');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { Low, JSONFile } = require('lowdb');
const shortid = require('shortid');
require('dotenv').config();

// Google OAuth dependencies (passport)
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;

const app = express();
app.use(cors());
app.use(bodyParser.json());

// lowdb
const dbFile = join(__dirname, 'db.json');
const adapter = new JSONFile(dbFile);
const db = new Low(adapter);

async function initDB(){
  await db.read();
  db.data = db.data || { users: [], marketplace: [], tasks: [], transactions: [], leaderboard: [], analytics: {}, sims: [], wifi_sources: [], subscriptions: [] };
  if(!db.data.subscriptions || db.data.subscriptions.length===0){
    db.data.subscriptions = [{id:'sub_basic',name:'Basic',price:0},{id:'sub_pro',name:'Pro',price:299},{id:'sub_premium',name:'Premium',price:499}];
  }
  await db.write();
}
initDB();

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret';
function createToken(u){ return jwt.sign({ id: u.id, email: u.email, name: u.name, is_admin: u.is_admin||false }, JWT_SECRET, { expiresIn: '30d' }); }

// Simple status
app.get('/api/status', async (req,res)=>{ await db.read(); db.data.analytics.visits = (db.data.analytics.visits||0) + 1; await db.write(); res.json({ ok:true, time: Date.now() }); });

// register/login (local)
app.post('/api/register', async (req,res)=>{
  const { name, email, password } = req.body;
  if(!email || !password) return res.status(400).json({ error:'missing' });
  await db.read();
  if(db.data.users.find(u=>u.email===email)) return res.status(400).json({ error:'exists' });
  const hashed = await bcrypt.hash(password, 8);
  const user = { id: shortid.generate(), name: name||'User', email, password: hashed, credits:0, is_admin:false, referralCode:('REF'+Math.random().toString(36).slice(2,8).toUpperCase()), data_balance_mb:0 };
  db.data.users.push(user);
  await db.write();
  res.json({ user: { id:user.id, name:user.name, email:user.email, credits:user.credits, referralCode:user.referralCode, data_balance_mb:user.data_balance_mb }, token: createToken(user) });
});

app.post('/api/login', async (req,res)=>{
  const { email, password } = req.body;
  await db.read();
  const user = db.data.users.find(u=>u.email===email);
  if(!user) return res.status(400).json({ error:'invalid' });
  const ok = await bcrypt.compare(password, user.password);
  if(!ok) return res.status(400).json({ error:'invalid' });
  res.json({ user: { id:user.id, name:user.name, email:user.email, credits:user.credits, referralCode:user.referralCode, data_balance_mb:user.data_balance_mb }, token: createToken(user) });
});

// create-admin convenience
app.get('/api/create-admin', async (req,res)=>{
  const email = req.query.email;
  if(!email) return res.status(400).json({ error:'missing_email' });
  await db.read();
  const user = db.data.users.find(u=>u.email===email);
  if(!user) return res.status(404).json({ error:'user_not_found' });
  user.is_admin = true;
  await db.write();
  return res.json({ ok:true, message: `User ${email} promoted to admin.` });
});

// Google OAuth (light integration)
// Note: passport and cookie/session omitted in lightweight version for Render mobile deploy convenience.
// This route provides an info message and instructions; full passport flow requires sessions and callback URL setup.
app.get('/auth/google', (req,res)=>{
  res.send({ message: "Use full Google OAuth by enabling passport and SESSION in production. Visit the README for setup." });
});

// Marketplace, tasks, leaderboards, subscriptions (basic)
app.get('/api/marketplace', async (req,res)=>{ await db.read(); res.json({ items: db.data.marketplace || [] }); });
app.get('/api/tasks', async (req,res)=>{ await db.read(); res.json({ tasks: db.data.tasks || [] }); });
app.get('/api/leaderboard', async (req,res)=>{ await db.read(); res.json({ leaderboard: db.data.leaderboard || [] }); });
app.get('/api/subscriptions', async (req,res)=>{ await db.read(); res.json({ subscriptions: db.data.subscriptions || [] }); });

// Telco: SIM register, WiFi sources, bundles, provisioning
app.post('/api/telco/register-sim', async (req,res)=>{
  const { msisdn, operator, ownerEmail } = req.body;
  if(!msisdn) return res.status(400).json({ error:'missing' });
  await db.read();
  let s = db.data.sims.find(x=>x.msisdn===msisdn);
  if(!s){ s = { id: shortid.generate(), msisdn, operator: operator||'unknown', ownerEmail: ownerEmail||null, bundles: [] }; db.data.sims.push(s); await db.write(); }
  res.json({ sim: s });
});
app.post('/api/admin/wifi-source', async (req,res)=>{
  // simple admin through query param for demo: ?admin=1
  if(req.query.admin!=='1') return res.status(403).json({ error:'forbidden' });
  const { name, ssid, bundles } = req.body;
  await db.read();
  const w = { id: shortid.generate(), name, ssid, bundles: bundles || [] };
  db.data.wifi_sources.push(w);
  await db.write();
  res.json(w);
});
app.get('/api/telco/bundles', async (req,res)=>{
  await db.read();
  const built = [{ code:'SIM-100MB', label:'100MB', mb:100 }, { code:'SIM-1GB', label:'1GB', mb:1024 }, { code:'SIM-5GB', label:'5GB', mb:5120 }];
  const wifiBundles = (db.data.wifi_sources||[]).flatMap(w=>w.bundles||[]);
  res.json({ source:'local', bundles: built.concat(wifiBundles) });
});
app.post('/api/telco/provision', async (req,res)=>{
  const { msisdn, bundle_code, wifi_id, ownerEmail } = req.body;
  if(!msisdn && !wifi_id) return res.status(400).json({ error:'missing' });
  await db.read();
  const ref = 'prov_'+Date.now();
  db.data.transactions.push({ id: shortid.generate(), provider:'telco', type:'provision', external_order_id: ref, msisdn, wifi_id, bundle_code, credited:0, raw_payload:{requested:true} });
  // simulate provisioning
  if(wifi_id){
    const wifi = (db.data.wifi_sources||[]).find(x=>x.id===wifi_id);
    const bundle = wifi && wifi.bundles && wifi.bundles.find(b=>b.code===bundle_code);
    const mb = bundle ? (bundle.mb||100) : 100;
    // add to first user with ownerEmail or to no user
    let user = null;
    if(ownerEmail){ user = (db.data.users||[]).find(u=>u.email===ownerEmail); }
    if(user){ user.data_balance_mb = (user.data_balance_mb||0) + mb; }
    await db.write();
    return res.json({ success:true, simulated:true, added_mb: mb, new_balance: user?user.data_balance_mb:null });
  } else {
    const bundles = [{ code:'SIM-100MB', mb:100 }, { code:'SIM-1GB', mb:1024 }, { code:'SIM-5GB', mb:5120 }];
    const b = bundles.find(x=>x.code===bundle_code) || { code:bundle_code, mb:100 };
    // look up ownerEmail if provided
    let user = null;
    if(ownerEmail){ user = (db.data.users||[]).find(u=>u.email===ownerEmail); if(user){ user.data_balance_mb = (user.data_balance_mb||0) + b.mb; } }
    await db.write();
    return res.json({ success:true, simulated:true, added_mb: b.mb, new_balance: user?user.data_balance_mb:null });
  }
});

// Simple public demo front-end
const publicDir = join(__dirname, 'public');
if(!fs.existsSync(publicDir)) fs.mkdirSync(publicDir);
fs.writeFileSync(join(publicDir, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FreeNetHub</title></head><body><h1>FreeNetHub Backend v3</h1><p>Visit /api/status</p></body></html>');

const PORT = process.env.PORT || 3000;
app.use('/', express.static(publicDir));
app.listen(PORT, ()=> console.log('FreeNetHub-backend v3 listening on', PORT));
