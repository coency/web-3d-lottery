import { createApp,h } from 'vue';
import {ElConfigProvider} from 'element-plus';
import zhCn from 'element-plus/es/locale/lang/zh-cn';
import App from './App.vue';
import './style.css';
import './styles/tailwind.css';
import './styles/element.css';
document.documentElement.classList.add('dark');

createApp({render:()=>h(ElConfigProvider,{locale:zhCn},()=>h(App))}).mount('#app');

import './auth.css';
