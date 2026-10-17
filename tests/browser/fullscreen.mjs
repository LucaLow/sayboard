import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const { chromium } = createRequire(import.meta.url)('playwright');
const base = process.env.SAYBOARD_TEST_URL || 'http://127.0.0.1:5173/tests/browser/fullscreen.html';
const browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',args:['--no-sandbox']});
await mkdir('test-results/fullscreen',{recursive:true});
let checks = 0;
async function verify(condition, label) { assert.ok(await condition, label); checks++; }
async function active(page, expected) {
  await page.waitForFunction((value) => document.querySelector('#app').classList.contains('communication-fullscreen') === value,expected);
}
async function exit(page) {
  await page.getByRole('button',{name:'Exit fullscreen',exact:true}).click();
  await verify(page.getByRole('button',{name:'Keep communicating'}).evaluate(n=>n===document.activeElement),'safe confirmation focus');
  await page.getByRole('button',{name:'Leave fullscreen',exact:true}).click();
  await active(page,false);
}
try {
  for (const variant of ['native','unsupported','denied']) {
    const page = await browser.newPage({viewport:{width:1280,height:900}});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    if(variant==='unsupported') await page.addInitScript(()=>Object.defineProperty(document,'fullscreenEnabled',{value:false}));
    if(variant==='denied') await page.addInitScript(()=>HTMLElement.prototype.requestFullscreen=()=>Promise.reject(new Error('Denied')));
    await page.goto(base);
    for(let cycle=0;cycle<3;cycle++) {
      await page.getByRole('button',{name:'Enter fullscreen communication board'}).click();
      await active(page,true);
      if(variant==='native') await page.waitForFunction(()=>document.fullscreenElement?.id==='app');
      else await verify(page.evaluate(()=>document.fullscreenElement===null),'fallback without native fullscreen');
      await verify(page.locator('[data-fullscreen-chrome]').evaluate(n=>n.hidden&&n.inert),'hidden controls are inert');
      await page.keyboard.press('Tab');
      await verify(page.evaluate(()=>!document.activeElement.closest('[data-fullscreen-chrome]')),'Tab skips hidden chrome');
      await verify(page.locator('.grid').evaluate(n=>getComputedStyle(n).gridTemplateColumns.split(' ').length===3),'saved columns retained');
      await page.locator('.tile').first().focus();
      await page.keyboard.press('Enter');
      await active(page,true);
      await verify(page.evaluate(()=>window.testState().category),'category rerender retains mode');
      await verify(page.getByRole('button',{name:'Home',exact:true}).evaluate(n=>n===document.activeElement),'category keyboard focus retained');
      await page.getByRole('button',{name:'Stop speaking',exact:true}).click();
      await verify(page.locator('#status').textContent().then(t=>t==='Speech stopped.'),'Stop remains usable');
      await page.getByRole('button',{name:cycle%2?'Back':'Home',exact:true}).click();
      await verify(page.evaluate(()=>!window.testState().category),'Back/Home remains usable');
      if(cycle===1) { await page.evaluate(()=>window.testFullscreen.exit());await active(page,false); }
      else await exit(page);
      await verify(page.getByRole('button',{name:'Enter fullscreen communication board'}).evaluate(n=>n===document.activeElement),'focus restored to current entry');
      await verify(page.getByRole('button',{name:'Login unavailable'}).isDisabled(),'disabled account state preserved');
    }
    await page.getByRole('button',{name:'Enter fullscreen communication board'}).click();await active(page,true);
    // DOM Escape exercises the app handler. Real browser exit is checked separately.
    await page.evaluate(()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
    await active(page,false);
    if(variant==='native') {
      await page.getByRole('button',{name:'Enter fullscreen communication board'}).click();
      await page.waitForFunction(()=>document.fullscreenElement?.id==='app');
      await page.evaluate(()=>document.exitFullscreen());await active(page,false);
      await verify(page.locator('[data-fullscreen-chrome]').evaluate(n=>!n.hidden&&!n.inert),'browser exit restores chrome');
    }
    await verify(errors.length===0,`${variant}: no runtime errors`);
    await page.close();
  }
  const races = await browser.newPage();
  await races.goto(base);
  await races.evaluate(() => {
    let element = null;
    let resolveExit;
    Object.defineProperty(document,'fullscreenEnabled',{value:true,configurable:true});
    Object.defineProperty(document,'fullscreenElement',{get:()=>element,configurable:true});
    const root=document.querySelector('#app');
    root.requestFullscreen=()=>{element=root;document.dispatchEvent(new Event('fullscreenchange'));return Promise.resolve();};
    document.exitFullscreen=()=>{element=null;document.dispatchEvent(new Event('fullscreenchange'));return new Promise(resolve=>{resolveExit=resolve;});};
    window.finishExit=()=>resolveExit();
  });
  await races.getByRole('button',{name:'Enter fullscreen communication board'}).click();await active(races,true);
  await races.evaluate(()=>{void window.testFullscreen.exit();});await active(races,false);
  await races.getByRole('button',{name:'Enter fullscreen communication board'}).click();await active(races,true);
  await races.evaluate(()=>window.finishExit());
  await verify(races.evaluate(()=>document.fullscreenElement?.id==='app'&&document.querySelector('#app').classList.contains('communication-fullscreen')),'late exit completion cannot clear new session');
  await races.close();
  const pending = await browser.newPage();await pending.goto(base);
  await pending.evaluate(()=>{
    let element=null;
    Object.defineProperty(document,'fullscreenEnabled',{value:true,configurable:true});
    Object.defineProperty(document,'fullscreenElement',{get:()=>element,configurable:true});
    const root=document.querySelector('#app');
    root.requestFullscreen=()=>new Promise(resolve=>{window.finishEntry=()=>{element=root;document.dispatchEvent(new Event('fullscreenchange'));resolve();};});
    document.exitFullscreen=()=>{element=null;document.dispatchEvent(new Event('fullscreenchange'));return Promise.resolve();};
  });
  await pending.getByRole('button',{name:'Enter fullscreen communication board'}).click();await active(pending,true);
  await pending.evaluate(()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));await active(pending,false);
  await verify(pending.getByRole('button',{name:'Enter fullscreen communication board'}).isDisabled(),'no overlapping native requests');
  await pending.evaluate(()=>window.finishEntry());
  await pending.waitForFunction(()=>!document.querySelector('.fullscreen-entry').disabled);
  await verify(pending.evaluate(()=>document.fullscreenElement===null&&!document.querySelector('#app').classList.contains('communication-fullscreen')),'late native entry is unwound after Escape');
  await verify(pending.getByRole('button',{name:'Enter fullscreen communication board'}).evaluate(n=>n===document.activeElement),'focus restored after pending entry settles');
  await pending.close();
  const mobile = await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  await mobile.addInitScript(()=>Object.defineProperty(document,'fullscreenEnabled',{value:false}));
  await mobile.goto(base);await mobile.getByRole('button',{name:'Enter fullscreen communication board'}).click();await active(mobile,true);
  for(const size of [{width:390,height:844},{width:844,height:390},{width:320,height:568}]) {
    await mobile.setViewportSize(size);
    await verify(mobile.locator('#app').evaluate(n=>Math.abs(n.getBoundingClientRect().height-innerHeight)<2),'fallback follows orientation viewport');
    await verify(mobile.getByRole('button',{name:'Exit fullscreen',exact:true}).evaluate(n=>{const r=n.getBoundingClientRect();return r.x>=0&&r.right<=innerWidth&&r.y>=0&&r.bottom<=innerHeight;}),'exit remains in viewport');
    await verify(mobile.getByRole('button',{name:'Stop speaking',exact:true}).isVisible(),'mobile Stop visible');
    await verify(mobile.locator('.empty-slot').count().then(n=>n===1),'empty slot retained');
  }
  await mobile.setViewportSize({width:390,height:844});await mobile.screenshot({path:'test-results/fullscreen/mobile-fallback.png'});
  await exit(mobile);await mobile.close();
  console.log(`Passed ${checks} browser assertions across native, denied, unsupported, repeated entry/exit, focus, navigation and mobile orientations.`);
} finally { await browser.close(); }
