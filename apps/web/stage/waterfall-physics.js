import RAPIER from '@dimforge/rapier3d-compat';
import {WATERFALL_COUNT,WATERFALL_COLUMNS,WATERFALL_LAYERS,WATERFALL_HALF,WATERFALL_SCALE,WATERFALL_GRAVITY,WATERFALL_ENTRY_WIDTH,waterfallSeed,waterfallQuaternion} from './waterfall-layout.js';

let initialized;
export function initWaterfallPhysics(){return initialized??=RAPIER.init();}
export const PHYSICS_STEP=1/120,PHYSICS_STRIDE=9;
const zero={x:0,y:0,z:0},contactHalf=WATERFALL_HALF+.008;
const smooth=t=>{t=Math.max(0,Math.min(1,t));return t*t*(3-2*t);};

export function createWaterfallPhysics({view,slots,random=Math.random,recycling=true,staticLayout=false}){
 const world=new RAPIER.World({x:0,y:-WATERFALL_GRAVITY,z:0});
 world.timestep=PHYSICS_STEP;world.numSolverIterations=8;
 world.integrationParameters.normalizedAllowedLinearError=.0005;world.integrationParameters.maxCcdSubsteps=2;
 world.integrationParameters.normalizedPredictionDistance=.12;world.integrationParameters.contact_natural_frequency=120;
 const events=new RAPIER.EventQueue(true);
 const floor=world.createCollider(RAPIER.ColliderDesc.cuboid(100,.5,40).setTranslation(0,view.ground-.5,-8).setFriction(.65).setRestitution(.35));
 world.createCollider(RAPIER.ColliderDesc.cuboid(100,100,.5).setTranslation(0,0,3));
 world.createCollider(RAPIER.ColliderDesc.cuboid(100,100,.5).setTranslation(0,0,-20));
 const handles=new Map(),bodies=[],colliders=[],states=[];
 let time=0,accumulator=0,bodyContacts=0,groundContacts=0,recycled=0,stepCount=0;
 let highlights=new Set(),highlightRate=1;
 for(let i=0;i<WATERFALL_COUNT;i++){
  const slot=slots[i],p=waterfallSeed(slot,view);
  const body=world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(p.x,p.y,p.z).setRotation(waterfallQuaternion(slot.angle))
   .setAngvel({x:slot.spin[0],y:slot.spin[1],z:slot.spin[2]}).setLinearDamping(.04).setAngularDamping(.28).setCanSleep(true).setCcdEnabled(true));
  const collider=world.createCollider(RAPIER.ColliderDesc.cuboid(contactHalf,contactHalf,contactHalf).setDensity(1).setFriction(.6)
   .setRestitution(slot.restitution).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),body);
  handles.set(collider.handle,i);bodies.push(body);colliders.push(collider);
  // Interleave depth bands and columns; the first arrival uses the same entry as recycling.
  const lane=slot.layer*WATERFALL_COLUMNS+slot.column,lanes=WATERFALL_LAYERS*WATERFALL_COLUMNS;
  const spawnAt=slot.row*.65+((lane*17)%lanes)/lanes*.65;
  if(!staticLayout)body.setEnabled(false);
  states.push({born:0,landed:-1,fade:-1,scale:staticLayout?1:0,boost:1,generation:0,waiting:!staticLayout,entered:staticLayout,spawnAt,hold:2.8+random()*1.4});
 }
 function spawn(index){
  const body=bodies[index],s=states[index],slot=slots[index],seed=waterfallSeed(slot,view);
  let p;
  // A new body must not materialize inside a falling neighbour.
  for(let attempt=0;attempt<8;attempt++){
   const candidate={x:(seed.x+(random()-.5)*.5)*WATERFALL_ENTRY_WIDTH,y:seed.top+.8+attempt*.35,z:seed.z+(random()-.5)*.5};
   if(bodies.every((other,j)=>{if(j===index||states[j].waiting)return true;const q=other.translation(),distance=Math.max(1.85,3*contactHalf**2*(1+states[j].scale*states[j].boost)**2);return (q.x-candidate.x)**2+(q.y-candidate.y)**2+(q.z-candidate.z)**2>distance;})){p=candidate;break;}
  }
  if(!p)return;
  s.boost=1;colliderSize(index,1);body.setTranslation(p,false);body.setRotation(waterfallQuaternion(slot.angle.map(a=>a+random()*.8)),false);
  body.setLinvel({x:(random()-.5)*.25,y:0,z:(random()-.5)*.12},false);body.setAngvel({x:slot.spin[0],y:slot.spin[1],z:slot.spin[2]},false);
  body.setEnabled(true);body.wakeUp();s.waiting=false;s.born=time;s.landed=-1;s.fade=-1;s.scale=1;
  if(s.entered){s.generation++;recycled++;}else s.entered=true;
 }
 function colliderSize(index,scale){const h=Math.max(.025,contactHalf*scale);colliders[index].setHalfExtents({x:h,y:h,z:h});bodies[index].recomputeMassPropertiesFromColliders();}
 function step(){
  time+=PHYSICS_STEP;
  // Resize before solving contacts so the published render size has already been resolved.
  for(let i=0;i<bodies.length;i++){
   const s=states[i],body=bodies[i];if(s.waiting)continue;
   const target=highlights.has(i)&&s.landed<0&&body.linvel().y<-.1&&s.fade<0?2:1;
   const next=s.boost+Math.max(-PHYSICS_STEP*8/highlightRate,Math.min(PHYSICS_STEP*8/highlightRate,target-s.boost));
   if(next!==s.boost){s.boost=next;colliderSize(i,s.scale*s.boost);body.wakeUp();}
  }
  world.step(events);stepCount++;
  events.drainCollisionEvents((a,b,started)=>{
   if(!started)return;
   const i=handles.get(a),j=handles.get(b);
   if(i!==undefined&&j!==undefined){bodyContacts++;if(states[i].landed>=0&&states[j].landed<0)states[j].landed=time;if(states[j].landed>=0&&states[i].landed<0)states[i].landed=time;}
   if(a===floor.handle||b===floor.handle){const index=i??j;if(index!==undefined){groundContacts++;if(states[index].landed<0)states[index].landed=time;}}
  });
  for(let i=0;i<bodies.length;i++){
   const body=bodies[i],s=states[i];if(s.waiting){if(time>=s.spawnAt)spawn(i);continue;}
   const p=body.translation(),v=body.linvel(),age=time-s.born,landedAge=s.landed<0?0:time-s.landed;
   if(!recycling)continue;
   const offscreen=Math.abs(p.x*view.focal/(view.cameraZ-p.z))>view.width*.58||p.y<view.ground-2;
   if(s.fade<0&&((landedAge>s.hold&&(body.isSleeping()||v.x*v.x+v.y*v.y+v.z*v.z<1.5||landedAge>6))||age>15||offscreen))s.fade=time;
   if(s.fade>=0){
    s.scale=1-smooth((time-s.fade)/.5);colliderSize(i,s.scale*s.boost);
    if(s.scale<.07){body.setEnabled(false);s.waiting=true;s.scale=0;}
   }
  }
 }
 return {
  world,bodies,colliders,states,
  setHighlights(indices=[],rate=1){highlights=new Set(indices);highlightRate=Math.max(1,rate);},
  advance(dt){accumulator=Math.min(.15,accumulator+Math.max(0,dt));while(accumulator>=PHYSICS_STEP){step();accumulator-=PHYSICS_STEP;}},
  snapshot(){
   const data=new Float32Array(WATERFALL_COUNT*PHYSICS_STRIDE),falling=new Uint8Array(WATERFALL_COUNT);
   for(let i=0;i<bodies.length;i++){const p=bodies[i].translation(),q=bodies[i].rotation(),s=states[i];data.set([p.x,p.y,p.z,q.x,q.y,q.z,q.w,WATERFALL_SCALE*s.scale*s.boost,s.generation],i*PHYSICS_STRIDE);falling[i]=!s.waiting&&s.landed<0&&s.fade<0&&bodies[i].linvel().y<-.1?1:0;}
   return {data,falling,stats:{bodyContacts,groundContacts,recycled,stepCount,bodies:bodies.length,time}};
  },
  resize(next){const dy=next.ground-view.ground;view=next;floor.setTranslation({x:0,y:view.ground-.5,z:-8});for(const b of bodies){const p=b.translation();b.setTranslation({x:p.x,y:p.y+dy,z:p.z},true);}},
  dispose(){events.free();world.free();}
 };
}
