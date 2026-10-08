import { createApp } from 'vue'
import { createPinia } from 'pinia'

// reset 只在 playground 里引入，不会进入库产物
import '@unocss/reset/tailwind.css'

// 编辑器自己的视觉系统。放在 reset 之后，避免被 reset 覆盖
import './styles/editor.scss'

import { createThreeDMaker } from '../src'
import { EDITOR_ASSETS } from './utils/editorAssets'
import App from './App.vue'

const app = createApp(App)

/**
 * 这里刻意模拟一个「已经有自己 Pinia」的宿主应用：
 * 插件检测到宿主已安装 Pinia 后会直接复用，两边的状态都能在 Devtools 里看到。
 */
app.use(createPinia())

/**
 * 素材由**宿主**交给插件，而不是库自己内置一份。
 *
 * 那台服务器的域名与开发期代理都是这个示例自己的配置（`utils/editorAssets.ts`），
 * 库一个字面量地址都不含——否则 `vite build --mode lib` 会把
 * `import.meta.env.VITE_*` 直接内联进每一个宿主的产物。
 */
app.use(createThreeDMaker({ assets: EDITOR_ASSETS }))

app.mount('#app')
