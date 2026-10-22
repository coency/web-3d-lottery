import type {PoolClient} from 'pg';
import type {Form} from './configuration.validation';

export function signupDisplay(form:Form, savedForm:Form, answers:Record<string,string|string[]>){
 return (form.signupFieldIds??[]).flatMap(id=>{
  const field=savedForm.fields.find(f=>f.id===id),raw=answers[id];
  if(!field||raw===undefined)return [];
  const value=(Array.isArray(raw)?raw:[raw]).map(v=>field.type==='text'||field.type==='number'?v:field.options.find(o=>o.id===v)?.label??'').filter(Boolean).join('、');
  return value.trim()?[{id,label:field.name,value}]:[];
 });
}
export async function joinPerson(c:PoolClient,p:any,form:Form){
 if(!p)return null;
 const saved=(await c.query('SELECT form FROM configuration_versions WHERE activity_id=$1 AND version=$2',[p.activity_id,p.form_version])).rows[0]?.form;
 return {id:p.id,nickname:p.nickname,avatarUrl:p.avatar_url,createdAt:p.created_at,answers:p.answers,
  displayFields:signupDisplay(form,saved??form,p.answers??{})};
}
