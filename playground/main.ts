import { createApp } from 'vue'
import { createPinia } from 'pinia'

// reset 只在 playground 里引入，不会进入库产物
import '@unocss/reset/tailwind.css'

/*
  这一页的底座（`html` / `body` / `#app` 的高度与底色）。放在 reset 之后，避免被它覆盖。

  **编辑器自己的样式不在这里**——它已经随库一起加载了（下面 `../src` 那条会带进
  `src/styles/index.scss`，顺序是 tokens → canvas → editor）。搬进库之前这一行引的是
  `./styles/editor.scss`，而库往宿主页面上写 `body {` 是禁止的，所以搬的时候把
  「这一页的底座」摘出来留在了 playground，见 `styles/base.scss`。
*/
import './styles/base.scss'

import { createThreeDMaker } from '../src'
import { EDITOR_ASSETS } from './utils/editorAssets'
import { runModelEvent } from './composables/useEventRunner'
import App from './App.vue'

const app = createApp(App)

/**
 * 这里刻意模拟一个「已经有自己 Pinia」的宿主应用：
 * 插件检测到宿主已安装 Pinia 后会直接复用，两边的状态都能在 Devtools 里看到。
 */
app.use(createPinia())

/**
 * 素材与回调都由**宿主**交给插件，而不是库自己内置一份。
 *
 * 素材：那台服务器的域名与开发期代理都是这个示例自己的配置（`utils/editorAssets.ts`），
 * 库一个字面量地址都不含——否则 `vite build --mode lib` 会把
 * `import.meta.env.VITE_*` 直接内联进每一个宿主的产物。
 *
 * 回调：`runEventCode` 是「把模型事件绑定里的那段字符串跑起来」。它只能靠
 * `new Function` 实现，而库产物里不许出现这四个字（冒烟测试钉着这一条），
 * 所以这份实现留在 playground，作为**宿主自己那一份决定**的一个参照——
 * 不接这个回调也完全合法（编辑器照常存代码，只是不执行）。
 */
app.use(
  createThreeDMaker({
    assets: EDITOR_ASSETS,
    hooks: { runEventCode: runModelEvent },
  }),
)

app.mount('#app')
