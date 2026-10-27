// Optional maintenance tool; normal use generates images through the admin page.
import path from 'node:path';
import {root} from './lib/config.mjs';
import {SimulationPortraitStore} from '../apps/api/build/activities/simulation-portrait-store.js';
const count=Number(process.argv[2]);
if(!Number.isInteger(count)||count<1||count>5000)throw new Error('Build the API first, then pass a count from 1 to 5000.');
const store=new SimulationPortraitStore(path.resolve(process.env.ASSET_DIRECTORY??path.join(root,'.local','uploads'),'simulation','portraits-v1'));
try{await store.warm(count);console.info('Prepared '+count+' synthetic portraits in '+store.directory);}finally{await store.close();}
