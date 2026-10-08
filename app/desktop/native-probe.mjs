// Test-only native probe; never distribute or launch against user profiles.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const here=dirname(fileURLToPath(import.meta.url));
const root=join(here,'..','..');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

export async function evaluate(port, expression, main=true) {
  const discovery=await fetch(`http://127.0.0.1:${port}/json`).then(r=>r.json());
  const target=main?discovery[0]:discovery.find(t=>/app[\\/]desktop[\\/]index\.html/.test(t.url));
  assert.ok(target?.webSocketDebuggerUrl,'Only the selected synthetic debugger target is allowed');
  const ws=new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
  try {
    return await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('Native probe timed out')),15_000);
      ws.onmessage=event=>{
        const message=JSON.parse(event.data);
        if(message.id!==1)return;
        clearTimeout(timer);
        if(message.error||message.result?.exceptionDetails)reject(new Error('Native evaluation failed'));
        else resolve(message.result.result.value);
      };
      ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true}}));
    });
  } finally {ws.close();}
}

const [mode,portArg,expressionArg]=process.argv.slice(2);
if(mode==='eval') {
  const result=await evaluate(Number(portArg),Buffer.from(expressionArg,'base64').toString('utf8'));
  console.log(JSON.stringify(result));
} else if(mode==='launch') {
  assert.equal(process.platform,'win32','This probe records Windows only');
  const profile=portArg??await mkdtemp(join(await realpath(tmpdir()),'manbo-native-safety-'));
  assert.ok(profile.startsWith(join(await realpath(tmpdir()),'manbo-native-safety-')));
  const inspector=9457, cdp=9458;
  for(const port of [inspector,cdp]) {
    let found=false;
    try {await fetch(`http://127.0.0.1:${port}/json`);found=true;}catch{}
    assert.equal(found,false,'Refuse to connect to an existing debugger');
  }
  const binary=join(root,'node_modules','electron','dist','electron.exe');
  const child=spawn(binary,[`--inspect=127.0.0.1:${inspector}`,`--remote-debugging-port=${cdp}`,join(here,'fixtures','native-entry.cjs'),`--native-test-root=${profile}`],{cwd:root,windowsHide:true,stdio:['ignore','ignore','pipe']});
  child.stderr.on('data',data=>{if(/Debugger listening|DevTools listening|Uncaught Exception|Error:/.test(data.toString()))process.stderr.write(data);});
  try {
    let report;
    for(let i=0;i<40;i++){
      try {report=await evaluate(inspector,"({root:__manboNativeTest.root,userData:__manboNativeTest.app.getPath('userData'),ready:__manboNativeTest.app.isReady(),windows:__manboNativeTest.BrowserWindow.getAllWindows().length,versions:process.versions})");if(report?.ready&&report.windows)break;}catch{}
      if(child.exitCode!==null)throw new Error('Native process exited before validation');
      await delay(250);
    }
    assert.equal(report?.root,profile);assert.equal(report?.userData,profile);
    console.log(JSON.stringify({profile,inspector,cdp,pid:child.pid,versions:report.versions}));
    await new Promise(resolve=>child.once('exit',resolve));
  } finally {if(child.exitCode===null)child.kill();}
} else if(mode!==undefined) {
  throw new Error('Use launch or eval; no production profile operations are supported');
}
