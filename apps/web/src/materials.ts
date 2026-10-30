export type MaterialImage={id:string;name:string;url:string};
export type ActivityMaterials={buttonText:string;type:'images'|'link';link:string;images:MaterialImage[]};
export function safeMaterialLink(value:string){
 try{const url=new URL(value.trim());return ['https:','http:'].includes(url.protocol)&&!url.username&&!url.password?url.href:'';}catch{return '';}
}
