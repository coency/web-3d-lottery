import ExcelJS from 'exceljs';
import type { Form,Field } from './configuration.validation';
export type Participant={id:string;avatar_url?:string|null;nickname:string;created_at:string;eligible:boolean;form_version:string;answers:Record<string,unknown>;form:Form};
export type Snapshot={activityName:string;mode:string;generation:number;createdAt:string;rows:Participant[]};
export function answerLabel(field:Field,value:unknown):string{
 if(value===null||value===undefined)return '';
 if((field.type==='text'||field.type==='number'))return typeof value==='string'?value:'';
 const option=(id:unknown)=>field.options.find(o=>o.id===id)?.label??'未知选项';
 return Array.isArray(value)?value.map(option).join('、'):option(value);
}
export function publicParticipant(p:Participant){
 return {id:p.id,avatarUrl:p.avatar_url??null,nickname:p.nickname,createdAt:p.created_at,eligible:p.eligible,formVersion:p.form_version,
  fields:p.form.fields.map(f=>({id:f.id,name:f.name,type:f.type,value:answerLabel(f,p.answers[f.id])}))};
}
export function beijing(value:string){return new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date(value));}
export async function rosterWorkbook(snapshot:Snapshot):Promise<Buffer>{
 const book=new ExcelJS.Workbook();book.creator='星遇';book.created=new Date(snapshot.createdAt);
 const sheet=book.addWorksheet(snapshot.mode==='formal'?'正式签到名单':'彩排签到名单',{views:[{state:'frozen',ySplit:1}]});
 const fields=new Map<string,{field:Field;header:string}>(),names=new Map<string,number>();
 // Preserve renamed fields while merging unchanged fields across form versions.
 const fieldKey=(f:Field)=>JSON.stringify([f.id,f.name,f.type]);
 for(const p of snapshot.rows)for(const f of p.form.fields){
  const key=fieldKey(f);if(fields.has(key))continue;
  const count=(names.get(f.name)??0)+1;names.set(f.name,count);
  fields.set(key,{field:f,header:f.name+(count>1?'（'+count+'）':'')});
 }
 if(fields.size>16000)throw new Error('TOO_MANY_COLUMNS');
 sheet.columns=[{header:'序号',key:'index',width:8},{header:'微信昵称',key:'nickname',width:22},
 ...Array.from(fields,([key,{header}])=>({header,key,width:24})),
 {header:'签到时间',key:'time',width:24},{header:'抽奖资格',key:'eligibility',width:16}];
 snapshot.rows.forEach((p,index)=>{
  const values:Record<string,string|number>={index:index+1,nickname:p.nickname,time:beijing(p.created_at),eligibility:p.eligible?'未排除':'已排除'};
  for(const f of p.form.fields)values[fieldKey(f)]=answerLabel(f,p.answers[f.id]);
  // Assign primitive strings, never formula objects or CSV expressions.
  const row=sheet.addRow(values);row.eachCell(cell=>{cell.numFmt='@';cell.alignment={vertical:'top',wrapText:true};});
 });
 sheet.autoFilter={from:{row:1,column:1},to:{row:Math.max(1,sheet.rowCount),column:sheet.columnCount}};
 sheet.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};sheet.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF40365C'}};sheet.getRow(1).height=26;
 return Buffer.from(await book.xlsx.writeBuffer());
}
