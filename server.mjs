import http from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {handleApi} from './backend.mjs';
import {createSqliteDatabase} from './sqlite-adapter.mjs';

const root = fileURLToPath(new URL('./', import.meta.url));
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};
const port = Number(process.env.PORT || 4173);
const databasePath = process.env.DATABASE_PATH || path.join(root,'data','repcall.sqlite');
await mkdir(path.dirname(databasePath),{recursive:true});
const DB = createSqliteDatabase(databasePath);
http.createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if(pathname.startsWith('/api/')) {
      const chunks=[];let size=0;
      for await(const chunk of req) {size+=chunk.length;if(size>16384){res.writeHead(413,{'Content-Type':'application/json'}).end(JSON.stringify({error:'This request is too large.'}));return;}chunks.push(chunk);}
      const headers=new Headers();
      for(const [key,value] of Object.entries(req.headers))if(value)headers.set(key,Array.isArray(value)?value.join(','):value);
      headers.set('cf-connecting-ip',req.socket.remoteAddress||'local');
      const request=new Request(`http://127.0.0.1:${port}${req.url}`,{method:req.method,headers,...(chunks.length?{body:Buffer.concat(chunks)}:{})});
      const reply=await handleApi(request,{DB,ALLOWED_ORIGIN:process.env.ALLOWED_ORIGIN||`http://127.0.0.1:${port}`,APP_TIMEZONE:'America/Phoenix'});
      res.writeHead(reply.status,Object.fromEntries(reply.headers));res.end(Buffer.from(await reply.arrayBuffer()));return;
    }
    const asset = pathname === '/' ? '/index.html' : pathname;
    if (!['/index.html','/app.js','/auth.js','/api.js','/config.js','/domain.js','/styles.css','/icon.svg'].includes(asset)) { res.writeHead(404).end('Not found'); return; }
    const file = path.resolve(root, '.' + asset);
    if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
    const body = await readFile(file);
    res.writeHead(200, {'Content-Type':types[path.extname(file)] || 'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
    res.end(body);
  } catch { res.writeHead(404).end('Not found'); }
}).listen(port, '127.0.0.1', () => console.log(`RepCall local demo: http://127.0.0.1:${port}`));
