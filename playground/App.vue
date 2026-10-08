<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import AppHeader from './components/AppHeader.vue'
import { useConfigIO } from './composables/useConfigIO'
import { SceneViewer } from '../src'
import { pushEvent } from '../src/editor/composables/useEditorState'
import { ASSET_BASE } from './utils/editorAssets'

/*
  宿主外壳。

  这一页现在只做三件事，都是**宿主该做的**：一条自己的顶栏、一个高度、`⌘S` 保存。
  三栏工作台整个由 `<SceneViewer editable />` 渲染出来——左边挑料、中间画布、
  右边改属性、W/E/R 与 Esc 与 ⌘Z 全在库里面。

  它同时是这个仓库最诚实的一份用法示例：**库的公开面在这里被完整地用了一遍**
  （一个 prop 决定形态、一个 prop 换素材地址、`getSceneData()` 取数据落盘），
  没有一处走后门 import 内部模块——`useEditorState` 那几条是公开导出，
  宿主自己画顶栏时按的就是同一组状态。**素材清单则一个字都不在这里**：
  那是库内置的，这一页只在开发期把根地址换成同源代理前缀。

  **左右栏的宿主页（`sideTabs` / `inspectorTabs`）这一页不摆样例。** 原先左栏
  挂过一页「设备」、右栏挂过一页「说明」，现在都撤了：那是**宿主自己该写的**
  东西，把一页假数据摆在库的导轨上，读起来像是库内置了这些分类
  （导轨上除了宿主自己挂的页，其余每一格都是真分类）。这条路本身是
  `panelSlots` 按前缀挑一遍、`SceneViewer` 与 `SceneEditor` 各透一轮，
  两个前缀在 `scripts/smoke.mjs` 里各有一组自己的断言守着，不靠这一页验。
  真要看效果，就在下面 `<SceneViewer>` 上临时挂 `:side-tabs` / `:inspector-tabs`
  配一个具名插槽——**正文那一页的宽度 / 内边距 / 滚动全归宿主自己给**，
  库交出来的只是一个空槽位；`playground/utils/libraryIcons.ts` 里备着两笔导轨
  图标可以拿去当 `icon`（不写就在导轨上退回占位立方体）。写法与要看的现象
  见目视清单 148-150。
*/
defineOptions({ name: 'App' })

const { saveScene } = useConfigIO()

/**
 * 宿主自己那一条快捷键：`⌘S` 保存。
 *
 * 它**必须留在宿主**：库既不知道「保存到哪」，也不做任何落盘
 * （组件只产出数据，走公开的 `getSceneData()`）。编辑器内部那几条
 * （W/E/R、Esc、⌘Z）在库里，由 `SceneEditor` 自己挂上。
 *
 * `preventDefault` 是必需的：不挡住的话浏览器会弹「保存网页」对话框，
 * 与页面上这个「保存」按钮抢同一个键。
 */
function onKeydown(event: KeyboardEvent) {
  if (!event.metaKey && !event.ctrlKey) return
  if (event.key.toLowerCase() !== 's') return
  // 在输入框里按 ⌘S 仍然是保存场景——这一条不受焦点影响
  event.preventDefault()
  saveScene()
}

onMounted(() => {
  /*
   * 页面不恢复任何草稿——编辑器已经不落盘了。
   * 「场景从哪来」是宿主的决定：宿主拿到组件实例之后调 `loadSceneData`，
   * 编辑器这一层不替它猜。所以每次打开都是一张空场景。
   */
  pushEvent('编辑器就绪 · 拖入 glTF / GLB 或从左侧选择模型')

  window.addEventListener('keydown', onKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <!-- tdm-entrance 让整个工作台淡入 -->
  <div class="tdm-app tdm-entrance">
    <AppHeader />

    <!--
      `height="100%"`：`.tdm-app` 是一条竖排 flex，顶栏之外剩下的高度全给它。
      不写的话组件根会用默认的 480px，底下一大片空白。

      `asset-base-url` 只在**开发期**有值：那时把素材根地址换成同源代理前缀，
      绕开那台服务器不发 CORS 头的问题（见 `utils/editorAssets.ts`）。
      生产构建下它是 `undefined`，也就是**不覆盖**——清单和地址都取库内置那份，
      这一页一个字都不用配。所以这一行同时是「库内置默认」与「只换地址」
      两条路各自的示例。

      编辑态的一切（三栏、事件弹窗、绘制工具、快捷键）都在这个组件里面。
      它没有插槽——左右栏的宿主页这一页不摆样例（理由见上面那段注释）。
    -->
    <SceneViewer editable height="100%" :asset-base-url="ASSET_BASE" />
  </div>
</template>
