import { fail } from '../auth/security';
export const uuid = (v: unknown): v is string => typeof v==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
export function object(value: unknown, keys: string[]): Record<string, unknown> {
 if(!value || typeof value!=='object' || Array.isArray(value) || Object.keys(value).some(k=>!keys.includes(k)))
   fail(422,'INVALID_FIELDS','提交字段不正确');
 return value as Record<string,unknown>;
}
export function text(value: unknown, max: number, required=false): string {
 if(typeof value!=='string' || value.trim().length>max || (required&&!value.trim()))
   fail(422,'INVALID_TEXT',required?'请填写有效活动名称或原因':'文字长度超出限制');
 return value.trim();
}
export function date(value: unknown): string {
 if(typeof value!=='string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value)))
   fail(422,'INVALID_DATE','请填写有效的结束时间');
 return new Date(value).toISOString();
}
export const displayKeys=['logo','tagline','organizer','coorganizer','h5Background','stageBackground'];
export function activityInput(value: unknown) {
 const b=object(value,['name','expiresAt','logoAssetId','h5BackgroundAssetId','stageBackgroundAssetId','tagline','organizer','coorganizer','display']);
 if((b.logoAssetId!==null&&!uuid(b.logoAssetId))||(b.h5BackgroundAssetId!==null&&!uuid(b.h5BackgroundAssetId))||(b.stageBackgroundAssetId!==null&&!uuid(b.stageBackgroundAssetId))) fail(422,'ASSET_REQUIRED','图片标识不正确，请重新上传或使用系统样式');
 const display=object(b.display,displayKeys);
 if(displayKeys.some(k=>typeof display[k]!=='boolean'))fail(422,'INVALID_DISPLAY','显示设置不正确');
 return { name:text(b.name,100,true), expiresAt:date(b.expiresAt), logoAssetId:b.logoAssetId as string|null,
 h5BackgroundAssetId:b.h5BackgroundAssetId as string|null, stageBackgroundAssetId:b.stageBackgroundAssetId as string|null,
 tagline:text(b.tagline,200),organizer:text(b.organizer,100),coorganizer:text(b.coorganizer,100),display };
}
