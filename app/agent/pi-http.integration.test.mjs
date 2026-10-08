import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:https';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import { createModelGateway } from './model-gateway.mjs';
import { createProviderTransport } from './provider-transport.mjs';

const key=await readFile(new URL('./fixtures/synthetic-tls-key.pem',import.meta.url));
const cert=await readFile(new URL('./fixtures/synthetic-tls-cert.pem',import.meta.url));
const secret='synthetic-wire-key';
const chunk=(delta,finish_reason=null)=>`data: ${JSON.stringify({id:'synthetic',object:'chat.completion.chunk',created:0,model:'synthetic-m1',choices:[{index:0,delta,finish_reason}]})}\n\n`;
const complete=(text='synthetic reply')=>chunk({role:'assistant',content:text})+chunk({},'stop')+'data: [DONE]\n\n';
const rejected=error=>error.message==='Model request failed';
const approved=(signal)=>({providerId:'custom',model:'synthetic-m1',authorization:{provider:'custom',evidenceIds:['note']},payload:{providerId:'custom',model:'synthetic-m1',prompt:'整理',messages:[{role:'user',content:[{type:'text',text:'history question'}]},{role:'assistant',content:[{type:'text',text:'history answer'}]},{role:'user',content:[{type:'text',text:'整理\n合成材料'}]}],attachments:[{evidenceId:'note',representation:'extracted-text'}],scope:{evidenceIds:['note'],contextMessageIds:['u1','a1']}},signal});

async function fixture(t,respond,options={}) {
  const requests=[], connections=new Set(), pinned=[];
  const server=createServer({key,cert},async(req,res)=>{
    const buffers=[];
    for await(const data of req) buffers.push(data);
    const body=Buffer.concat(buffers).toString('utf8');
    requests.push({path:req.url,headers:req.headers,body:JSON.parse(body)});
    respond(req,res);
  });
  server.on('connection',socket=>{connections.add(socket);socket.on('close',()=>connections.delete(socket));});
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  t.after(async()=>{for(const socket of connections) socket.destroy();server.close();await once(server,'close');});
  // Any missed adapter injection fails locally, never reaches a real provider.
  t.mock.method(globalThis,'fetch',async()=>{throw new Error('Uncontrolled HTTP is forbidden');});
  const hostname=options.hostname??'api.manbo.test';
  const endpoint=`https://${hostname}:${server.address().port}/v1`;
  let resolutions=0;
  const transportFactory=args=>createProviderTransport(args,{
    ca:cert,
    resolveHost:async()=>{resolutions++;return options.addresses??[{address:'93.184.216.34',family:4}];},
    requestHttps(httpOptions,onResponse){
      assert.equal(httpOptions.rejectUnauthorized,true);
      assert.equal(httpOptions.hostname,hostname);
      assert.equal(httpOptions.servername,hostname);
      assert.equal(httpOptions.agent,false);
      httpOptions.lookup('api.manbo.test',{},(error,address,family)=>{assert.equal(error,null);pinned.push({address,family});});
      // Test-only TCP remap. TLS hostname/certificate checks remain enabled.
      return request({...httpOptions,lookup(_host,opts,callback){if(opts?.all)callback(null,[{address:'127.0.0.1',family:4}]);else callback(null,'127.0.0.1',4);}},onResponse);
    },
    ...options.transport,
  });
  const gateway=createModelGateway({providerStore:{async readProvider(){return {config:{id:'custom',name:'Synthetic',kind:'openai-compatible',endpoint,capabilities:{images:true}},secret};}},transportFactory});
  return {gateway,requests,pinned,connections,endpoint,get resolutions(){return resolutions;}};
}

test('real Pi sends history and image bytes through one pinned HTTPS/SSE request',async t=>{
  const f=await fixture(t,(_req,res)=>{res.writeHead(200,{'content-type':'text/event-stream'});res.end(complete());});
  const input=approved();
  const image='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aT3sAAAAASUVORK5CYII=';
  input.payload.messages.at(-1).content.push({type:'image_url',image_url:{url:`data:image/png;base64,${image}`}});
  assert.equal((await f.gateway.send(input)).text,'synthetic reply');
  assert.equal(f.requests.length,1);
  assert.equal(f.resolutions,1);
  assert.deepEqual(f.pinned,[{address:'93.184.216.34',family:4}]);
  const wire=f.requests[0];
  assert.equal(wire.path,'/v1/chat/completions');
  assert.equal(wire.headers.authorization,`Bearer ${secret}`);
  assert.equal(wire.headers.host,new URL(f.endpoint).host);
  assert.equal(wire.body.tools,undefined);
  assert.equal(wire.headers['x-session-id'],undefined);
  assert.deepEqual(wire.body.messages.slice(1).map(m=>m.role),['user','assistant','user']);
  const serialized=JSON.stringify(wire.body);
  assert.ok(serialized.includes(image));
  assert.ok(serialized.includes('history question'));
  assert.ok(serialized.includes('history answer'));
  assert.ok(serialized.includes('合成材料'));
  assert.ok(!serialized.includes(process.cwd().replaceAll('\\','/')));
  assert.ok(!serialized.includes(secret));
});

for(const status of [302,307,429,500]) test(`real Pi refuses ${status} without retry, redirect or error body echo`,async t=>{
  let second=0;
  const f=await fixture(t,(req,res)=>{if(req.url==='/unapproved')second++;res.writeHead(status,{'location':'/unapproved','content-type':'text/event-stream'});res.end('合成敏感正文不允许回显');});
  await assert.rejects(f.gateway.send(approved()),rejected);
  assert.equal(f.requests.length,1);
  assert.equal(second,0);
});

for(const [name,body,headers] of [
  ['no finish reason',chunk({content:'partial'})+'data: [DONE]\n\n',{}],
  ['no DONE',chunk({content:'partial'})+chunk({},'stop'),{}],
  ['oversized wire',complete('x'.repeat(530_000)),{}],
  ['oversized text',complete('x'.repeat(20_001)),{}],
  ['bad UTF8',Buffer.concat([Buffer.from(chunk({content:'partial'})),Buffer.from([0xff]),Buffer.from('data: [DONE]\n\n')]),{}],
  ['non SSE',complete(),{'content-type':'application/json'}],
  ['compressed',complete(),{'content-encoding':'gzip'}],
]) test(`real Pi rejects ${name} without delivery or retry`,async t=>{
  const f=await fixture(t,(_req,res)=>{res.writeHead(200,{'content-type':'text/event-stream',...headers});res.end(body);});
  await assert.rejects(f.gateway.send(approved()),rejected);
  assert.equal(f.requests.length,1);
});

test('real Pi refuses a truncated HTTP response even after a stop chunk',async t=>{
  const f=await fixture(t,(_req,res)=>{res.writeHead(200,{'content-type':'text/event-stream','content-length':9999});res.write(complete());setImmediate(()=>res.destroy());});
  await assert.rejects(f.gateway.send(approved()),rejected);
  assert.equal(f.requests.length,1);
});

for(const mode of ['deadline','abort']) test(`real Pi ${mode} interrupts a slow stream and destroys its connection`,{timeout:5000},async t=>{
  const controller=new AbortController();
  const f=await fixture(t,(_req,res)=>{res.writeHead(200,{'content-type':'text/event-stream'});res.write(chunk({content:'partial'}));if(mode==='abort')setImmediate(()=>controller.abort());},{transport:{timeoutMs:100}});
  await assert.rejects(f.gateway.send(approved(controller.signal)),rejected);
  for(let i=0;i<20&&f.connections.size;i++)await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(f.requests.length,1);
  assert.equal(f.connections.size,0);
});

test('real Pi rejects a private/mixed DNS answer before opening HTTPS',async t=>{
  const f=await fixture(t,(_req,res)=>res.end(complete()),{addresses:[{address:'93.184.216.34',family:4},{address:'::ffff:127.0.0.1',family:6}]});
  await assert.rejects(f.gateway.send(approved()),rejected);
  assert.equal(f.requests.length,0);
  assert.equal(f.pinned.length,0);
});

test('normal TLS verification refuses the untrusted fixture before any HTTP body',async t=>{
  const f=await fixture(t,(_req,res)=>res.end(complete()),{transport:{ca:undefined}});
  await assert.rejects(f.gateway.send(approved()),rejected);
  assert.equal(f.requests.length,0);
});

test('trusted test CA does not bypass TLS hostname verification',async t=>{
  const f=await fixture(t,(_req,res)=>res.end(complete()),{hostname:'wrong.manbo.test'});
  await assert.rejects(f.gateway.send(approved()),rejected);
  assert.equal(f.requests.length,0);
});

test('real HTTPS rejects response headers larger than the 16 KiB ceiling',async t=>{
  const f=await fixture(t,(_req,res)=>{res.writeHead(200,{'content-type':'text/event-stream','x-synthetic':'x'.repeat(17*1024)});res.end(complete());});
  await assert.rejects(f.gateway.send(approved()),rejected);
  assert.equal(f.requests.length,1);
});

test('real Pi pins a public IPv6 DNS answer without a second resolver call',async t=>{
  const address='2606:4700:4700::1111';
  const f=await fixture(t,(_req,res)=>{res.writeHead(200,{'content-type':'text/event-stream'});res.end(complete());},{addresses:[{address,family:6}]});
  assert.equal((await f.gateway.send(approved())).text,'synthetic reply');
  assert.deepEqual(f.pinned,[{address,family:6}]);
  assert.equal(f.resolutions,1);
});

test('redirect to another HTTPS origin never sends credentials to that origin',async t=>{
  const destination=await fixture(t,(_req,res)=>{res.writeHead(200,{'content-type':'text/event-stream'});res.end(complete());});
  const source=await fixture(t,(_req,res)=>{res.writeHead(307,{location:destination.endpoint+'/chat/completions'});res.end('synthetic private response');});
  await assert.rejects(source.gateway.send(approved()),rejected);
  assert.equal(source.requests.length,1);
  assert.equal(destination.requests.length,0);
});
