// Test-only native HTTPS boundary. Never package this module.
import assert from 'node:assert/strict';
import { createServer, request } from 'node:https';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import { createModelGateway as realGateway } from '../../agent/model-gateway.mjs';
import { createProviderTransport } from '../../agent/provider-transport.mjs';

const key = await readFile(new URL('../../agent/fixtures/synthetic-tls-key.pem',import.meta.url));
const cert = await readFile(new URL('../../agent/fixtures/synthetic-tls-cert.pem',import.meta.url));
const chunk = (delta,finish_reason=null) => 'data: '+JSON.stringify({id:'synthetic-native',object:'chat.completion.chunk',created:0,model:'synthetic-m1',choices:[{index:0,delta,finish_reason}]})+'\n\n';
const state = { mode:'complete', requests:[], connections:new Set(), pinned:[] };
globalThis.__manboNativeNetwork = state;
const server = createServer({key,cert},async(req,res)=>{
  const buffers=[];
  for await(const data of req) buffers.push(data);
  const body=JSON.parse(Buffer.concat(buffers).toString('utf8'));
  assert.equal(req.headers.authorization,'Bearer synthetic-native-key-no-production-access');
  assert.equal(req.url,'/v1/chat/completions');
  assert.equal(body.tools,undefined);
  state.requests.push({path:req.url,body,credentialMatches:true});
  res.writeHead(200,{'content-type':'text/event-stream'});
  res.write(chunk({role:'assistant',content:'合成原生回复：本地保存与云端处理应分别说明。'}));
  if(state.mode==='complete') res.end(chunk({},'stop')+'data: [DONE]\n\n');
});
server.on('connection',socket=>{state.connections.add(socket);socket.on('close',()=>state.connections.delete(socket));});
server.listen(0,'127.0.0.1');
await once(server,'listening');
server.unref();
globalThis.__manboNativeTest.app.on('before-quit',()=>{
  for(const socket of state.connections) socket.destroy();
  server.close();
});

export function createModelGateway(options) {
  return realGateway({...options,transportFactory:args=>{
    assert.equal(new URL(args.endpoint).hostname,'api.manbo.test');
    assert.equal(args.secret,'synthetic-native-key-no-production-access');
    return createProviderTransport(args,{
      ca:cert,
      resolveHost:async()=>[{address:'93.184.216.34',family:4}],
      requestHttps(httpOptions,onResponse){
        assert.equal(httpOptions.rejectUnauthorized,true);
        assert.equal(httpOptions.servername,'api.manbo.test');
        httpOptions.lookup('api.manbo.test',{},(error,address,family)=>{
          assert.equal(error,null);state.pinned.push({address,family});
        });
        // Only TCP destination/port are remapped, not hostname/SNI/TLS identity.
        return request({...httpOptions,port:server.address().port,lookup(_host,opts,callback){
          if(opts?.all) callback(null,[{address:'127.0.0.1',family:4}]);
          else callback(null,'127.0.0.1',4);
        }},onResponse);
      },
    });
  }});
}
