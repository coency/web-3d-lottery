import type {PoolClient} from 'pg';
import type {Form} from './configuration.validation';

export function normalizeJoinForm(form:Form):Form{
 return {...form,signupFieldIds:form.signupFieldIds??[]};
}

// The activity version also changes during draws. Retain the form shown to the
// participant so unrelated activity changes do not invalidate their answers.
export async function snapshotJoinForm(c:PoolClient,activity:{id:string;version:string},cfg:{form:unknown;rule:unknown;prizes:unknown}){
 await c.query('INSERT INTO configuration_versions(activity_id,version,form,rule,prizes) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',[activity.id,activity.version,JSON.stringify(cfg.form),JSON.stringify(cfg.rule),JSON.stringify(cfg.prizes)]);
}

export async function matchesJoinForm(c:PoolClient,activityId:string,version:unknown,form:unknown){
 if((typeof version!=='string'&&typeof version!=='number')||!/^\d{1,18}$/.test(String(version)))return false;
 // Legacy forms omit this optional display setting. Missing and [] are equivalent;
 // actual field/display changes must still invalidate the submitted version.
 const result=await c.query(`SELECT 1 FROM configuration_versions WHERE activity_id=$1 AND version=$2
  AND ('{"signupFieldIds":[]}'::jsonb || form)=('{"signupFieldIds":[]}'::jsonb || $3::jsonb)`,[activityId,String(version),JSON.stringify(form)]);
 return result.rowCount===1;
}
