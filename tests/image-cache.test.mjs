import test from 'node:test';
import assert from 'node:assert/strict';
import {createImageCache} from '../apps/web/stage/image-cache.js';

function fixture(){
 let clock=0,sequence=0;const timers=new Map(),requests=[],loaded=[];
 const cache=createImageCache({createImage:()=>{const image={};requests.push(image);return image;},onLoad:url=>loaded.push(url),schedule:(fn,delay)=>{const id=++sequence;timers.set(id,{fn,at:clock+delay});return id;},cancel:id=>timers.delete(id)});
 function advance(ms){const end=clock+ms;while(true){const next=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];if(!next||next[1].at>end)break;clock=next[1].at;timers.delete(next[0]);next[1].fn();}clock=end;}
 return {cache,requests,loaded,timers,advance};
}
test('image requests are deduplicated and successful loads notify exactly once',()=>{
 const f=fixture();f.cache.load('');f.cache.load('/avatar');f.cache.load('/avatar');assert.equal(f.requests.length,1);assert.equal(f.cache.get('/avatar'),null);
 const image=f.requests[0];assert.equal(image.crossOrigin,'anonymous');assert.equal(image.referrerPolicy,'no-referrer');image.onload();
 assert.equal(f.cache.get('/avatar'),image);assert.deepEqual(f.loaded,['/avatar']);assert.equal(f.timers.size,0);f.cache.load('/avatar');assert.equal(f.requests.length,1);
});
test('a failed image automatically retries then replaces its placeholder',()=>{
 const f=fixture();f.cache.load('/avatar');const staleLoad=f.requests[0].onload;f.requests[0].onerror();f.advance(999);assert.equal(f.requests.length,1);f.advance(1);assert.equal(f.requests.length,2);
 staleLoad();assert.equal(f.cache.get('/avatar'),null);f.requests[1].onload();assert.equal(f.cache.get('/avatar'),f.requests[1]);assert.equal(f.loaded.length,1);f.advance(60000);assert.equal(f.requests.length,2);
});
test('permanent failures stop after bounded backoff and can recover on reconnection',()=>{
 const f=fixture();f.cache.load('/avatar');
 for(const delay of [1000,3000,10000,30000]){const count=f.requests.length;f.requests.at(-1).onerror();f.advance(delay-1);assert.equal(f.requests.length,count);f.advance(1);assert.equal(f.requests.length,count+1);}
 f.requests.at(-1).onerror();f.advance(120000);assert.equal(f.requests.length,5);assert.equal(f.timers.size,0);
 f.cache.retryFailed();assert.equal(f.requests.length,6);f.requests.at(-1).onload();assert.equal(f.cache.get('/avatar'),f.requests.at(-1));
});
test('reconnection cancels scheduled retries without duplicating in-flight or ready images',()=>{
 const f=fixture();f.cache.load('/failed');f.cache.load('/ready');f.cache.load('/loading');f.requests[0].onerror();f.requests[1].onload();
 f.cache.retryFailed();assert.equal(f.requests.length,4);f.advance(1000);assert.equal(f.requests.length,4);f.cache.retryFailed();assert.equal(f.requests.length,4);
});
test('stalled loads time out and disposal cancels requests and callbacks',()=>{
 const f=fixture();f.cache.load('/stalled');const lateLoad=f.requests[0].onload;f.advance(15000);assert.equal(f.requests[0].src,'');f.advance(1000);assert.equal(f.requests.length,2);
 f.cache.dispose();lateLoad();f.advance(120000);f.cache.retryFailed();f.cache.load('/new');assert.equal(f.requests.length,2);assert.equal(f.timers.size,0);assert.deepEqual(f.loaded,[]);
});
