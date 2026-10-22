import {ElMessage,type MessageOptions} from 'element-plus';
import 'element-plus/es/components/message/style/css';
import './styles/messages.css';

export function showNotice(message:MessageOptions['message'],type:MessageOptions['type']='info',options:Partial<MessageOptions>={}){
 return ElMessage({message,type,grouping:true,placement:'top',offset:20,showClose:true,duration:3000,zIndex:10000,customClass:'starlit-message',...options});
}
