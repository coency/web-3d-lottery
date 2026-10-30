import {readFile} from 'node:fs/promises';
import path from 'node:path';
import type {PoolClient} from 'pg';
import {fail} from '../auth/security';
import {object,uuid} from './validation';
export type Materials={buttonText:string;type:'images'|'link';link:string;images:{id:string;name:string}[]};
export const emptyMaterials=():Materials=>({buttonText:'查看活动流程',type:'images',link:'',images:[]});
export function materialsInput(value:unknown):Materials{
 const b=object(value,['buttonText','type','link','images']);
 if(typeof b.buttonText!=='string'||!b.buttonText.trim()||[...b.buttonText.trim()].length>12)fail(422,'INVALID_MATERIALS','按钮文字须为 1–12 个字');
 if(b.type!=='images'&&b.type!=='link')fail(422,'INVALID_MATERIALS','请选择图片或链接');
 if(typeof b.link!=='string'||b.link.length>2048||!Array.isArray(b.images)||b.images.length>10)fail(422,'INVALID_MATERIALS','最多上传 10 张图片，链接不能超过 2048 个字符');
 let link='';
 if(b.type==='link'&&b.link.trim()){
  try{const url=new URL(b.link.trim());if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw new Error();link=url.href;}
  catch{fail(422,'INVALID_MATERIALS','请填写完整的 http:// 或 https:// 网页链接');}
 }
 const ids=new Set<string>();
 const images=b.type==='images'?b.images.map(value=>{
  const image=object(value,['id','name']);
  if(!uuid(image.id)||ids.has(image.id)||typeof image.name!=='string'||!image.name.trim()||image.name.length>160)fail(422,'INVALID_MATERIALS','图片信息无效或重复');
  ids.add(image.id);return {id:image.id,name:image.name.trim()};
 }):[];
 return {buttonText:b.buttonText.trim(),type:b.type,link,images};
}
export async function readMaterials(c:PoolClient,id:string):Promise<Materials>{
 return (await c.query('SELECT content FROM activity_materials WHERE activity_id=$1',[id])).rows[0]?.content??emptyMaterials();
}
export async function writeMaterials(c:PoolClient,activityId:string,ownerId:string,content:Materials){
 for(const image of content.images){
  const asset=await c.query("SELECT 1 FROM assets WHERE id=$1 AND owner_id=$2 AND activity_id=$3 AND purpose='activity_material' AND status='ready'",[image.id,ownerId,activityId]);
  if(!asset.rowCount)fail(422,'ASSET_REJECTED','请选择已上传到本场活动的资料图片');
 }
 await c.query('INSERT INTO activity_materials(activity_id,content) VALUES($1,$2) ON CONFLICT(activity_id) DO UPDATE SET content=EXCLUDED.content,updated_at=clock_timestamp()',[activityId,JSON.stringify(content)]);
}
export async function publishedMaterials(c:PoolClient,activityId:string,base:string){
 const content=await readMaterials(c,activityId);
 if(content.type==='link')return content.link?{...content,images:[]}:null;
 if(!content.images.length)return null;
 return {...content,images:content.images.map(image=>({...image,url:base+'/materials/images/'+image.id}))};
}
export async function materialImage(c:PoolClient,activity:{id:string;owner_id:string},id:string){
 if(!uuid(id))fail(404,'NOT_FOUND','资料图片不存在');
 const content=await readMaterials(c,activity.id);
 if(content.type!=='images'||!content.images.some(image=>image.id===id))fail(404,'NOT_FOUND','资料图片已更新，请重新打开');
 const row=(await c.query("SELECT object_key FROM assets WHERE id=$1 AND owner_id=$2 AND activity_id=$3 AND purpose='activity_material' AND status='ready'",[id,activity.owner_id,activity.id])).rows[0];
 if(!row||!/^[-0-9a-f]+\.webp$/.test(row.object_key))fail(404,'NOT_FOUND','资料图片不存在');
 try{return await readFile(path.join(path.resolve(process.env.ASSET_DIRECTORY??path.join(process.cwd(),'.local','uploads')),row.object_key));}
 catch{fail(404,'NOT_FOUND','图片暂不可用，请稍后重试');}
}
