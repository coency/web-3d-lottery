import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import materials from '../apps/api/build/activities/materials.js';
const {materialsInput,emptyMaterials}=materials;
const rejects=value=>assert.throws(()=>materialsInput(value),e=>e.getStatus()===422);
test('materials accept optional images or links with custom short button text',()=>{
 const blank=emptyMaterials();assert.deepEqual(materialsInput(blank),blank);
 const image={id:randomUUID(),name:'议程.png'};
 assert.deepEqual(materialsInput({...blank,images:[image]}).images,[image]);
 assert.equal(materialsInput({...blank,type:'link',link:'https://example.com/agenda',images:[image]}).images.length,0);
 assert.equal(materialsInput({...blank,type:'link',link:''}).link,'');
 assert.equal(materialsInput({...blank,buttonText:'  会议议程  '}).buttonText,'会议议程');
});
test('materials reject executable URLs, credentials, invalid images and oversized input',()=>{
 const blank=emptyMaterials(),image={id:randomUUID(),name:'议程.png'};
 for(const link of ['javascript:alert(1)','data:text/html,hi','file:///C:/test','//example.com','https://user:secret@example.com','not a url'])rejects({...blank,type:'link',link});
 for(const buttonText of ['', '   ', '一'.repeat(13)])rejects({...blank,buttonText});
 rejects({...blank,type:'pdf'});rejects({...blank,images:[image,image]});rejects({...blank,images:[{...image,id:'../private'}]});
 rejects({...blank,images:[{...image,name:'x'.repeat(161)}]});
 rejects({...blank,images:Array.from({length:11},()=>({...image,id:randomUUID()}))});
});
