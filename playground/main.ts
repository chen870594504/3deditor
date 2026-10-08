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
import { runModelEvent } from './composables/useEventRunner'
import App from './App.vue'

const app = createApp(App)

/**
 * 这里刻意模拟一个「已经有自己 Pinia」的宿主应用：
 * 插件检测到宿主已安装 Pinia 后会直接复用，两边的状态都能在 Devtools 里看到。
 */
app.use(createPinia())

/**
 * 这里**只接一个回调**，素材一个字都不配——那正是这次改造要演示的事情：
 * 装完插件、写一句 `<SceneViewer editable />`，左栏那五个分类就该有货。
 *
 * 素材缺省是库内置那份标准表（`src/editor/defaultAssets.ts`）。开发期需要的
 * 同源代理前缀是**这一页自己的事**，走 `<SceneViewer>` 的 `assetBaseUrl`
 * （见 `App.vue`，值在 `utils/editorAssets.ts`）——它只覆盖根地址，清单仍取
 * 库那一份。要整份换成自己那套目录才写 `createThreeDMaker({ assets })`。
 *
 * 回调：`runEventCode` 是「把模型事件绑定里的那段字符串跑起来」。它只能靠
 * `new Function` 实现，而库产物里不许出现这四个字（冒烟测试钉着这一条），
 * 所以这份实现留在 playground，作为**宿主自己那一份决定**的一个参照——
 * 不接这个回调也完全合法（编辑器照常存代码，只是不执行）。
 */
app.use(createThreeDMaker({ hooks: { runEventCode: runModelEvent } }))

app.mount('#app')
