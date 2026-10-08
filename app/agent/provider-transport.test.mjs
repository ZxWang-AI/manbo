import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProviderTransport, isPublicAddress, validateProviderEndpoint } from './provider-transport.mjs';

const endpoint = 'https://api.manbo.test/v1';
const secret = 'synthetic-transport-key';
const input = {method: 'POST', headers: {'authorization': `Bearer ${secret}`}, body: '{"stream":true}'};
const rejected = (error) => error.message === 'Model request failed';

test('public IP classification rejects special IPv4 and all non-global or transition IPv6', () => {
  for (const address of ['0.0.0.0','0.1.2.3','10.0.0.1','100.64.0.1','100.127.255.254','127.0.0.2','169.254.1.2','172.31.2.3','192.0.0.9','192.0.2.4','192.88.99.1','192.168.1.1','198.18.1.2','198.51.100.4','203.0.113.2','224.0.0.2','255.255.255.255','::','::1','::ffff:8.8.8.8','::ffff:127.0.0.1','64:ff9b::1','fc00::1','fe80::1','ff00::1','2001::1','2001:db8::1','2002::1','3fff::1','invalid']) assert.equal(isPublicAddress(address), false, address);
  for (const address of ['8.8.8.8','93.184.216.34','1.1.1.1','2606:4700:4700::1111','2001:4860:4860::8888']) assert.equal(isPublicAddress(address), true, address);
});

test('endpoint canonicalization rejects embedded authentication and hidden routing fields', () => {
  assert.equal(validateProviderEndpoint('https://PUBLIC.example/v1/'), 'https://public.example/v1');
  for (const value of ['http://public.example','https://localhost/v1','https://a.local/v1','https://[::1]/v1','https://user:pass@public.example/v1','https://public.example/v1?x=1','https://public.example/v1#x']) assert.throws(() => validateProviderEndpoint(value), /endpoint|private|local/i);
});

test('private or mixed DNS never opens a socket and the attempt cannot be replayed', async () => {
  for (const addresses of [[{address:'127.0.0.1',family:4}],[{address:'93.184.216.34',family:4},{address:'::ffff:127.0.0.1',family:6}],[],[{address:'8.8.8.8',family:6}]]) {
    let sockets = 0;
    const transport = createProviderTransport({endpoint,secret}, {resolveHost:async()=>addresses,requestHttps(){sockets++;throw new Error('must not connect');}});
    await assert.rejects(transport.fetch(endpoint+'/chat/completions',input), rejected);
    await assert.rejects(transport.fetch(endpoint+'/chat/completions',input), rejected);
    assert.equal(sockets, 0);
    transport.dispose();
  }
});

test('method, path, auth and wire request limit are checked before DNS', async () => {
  for (const [url, init] of [[endpoint+'/models',input],[endpoint+'/chat/completions',{...input,method:'GET'}],[endpoint+'/chat/completions',{...input,headers:{authorization:'Bearer wrong'}}],[endpoint+'/chat/completions',{...input,body:'x'.repeat(65)}]]) {
    let resolutions=0;
    const transport=createProviderTransport({endpoint,secret},{maxRequestBytes:64,resolveHost:async()=>{resolutions++;return [];}});
    await assert.rejects(transport.fetch(url,init),rejected);
    assert.equal(resolutions,0);
    transport.dispose();
  }
});

test('deadline bounds stalled DNS and no socket opens after late resolution', {timeout:2000}, async () => {
  let finish, sockets=0;
  const transport=createProviderTransport({endpoint,secret},{timeoutMs:30,resolveHost:()=>new Promise(resolve=>{finish=resolve;}),requestHttps(){sockets++;throw new Error('unexpected');}});
  await assert.rejects(transport.fetch(endpoint+'/chat/completions',input),rejected);
  finish([{address:'8.8.8.8',family:4}]);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(sockets,0);
  transport.dispose();
});

test('pre-abort and disposal prevent DNS, while abort interrupts pending DNS', async () => {
  for (const action of ['before','dispose','during']) {
    const controller=new AbortController();
    let resolutions=0;
    if (action==='before') controller.abort();
    const transport=createProviderTransport({endpoint,secret,signal:controller.signal},{resolveHost:()=>{resolutions++;return new Promise(()=>{});}});
    if (action==='dispose') transport.dispose();
    const pending=transport.fetch(endpoint+'/chat/completions',input);
    if (action==='during') controller.abort();
    await assert.rejects(pending,rejected);
    assert.equal(resolutions,action==='during'?1:0);
    transport.dispose();
  }
});
