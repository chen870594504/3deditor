<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import AppHeader from './components/AppHeader.vue'
import { useConfigIO } from './composables/useConfigIO'
import { ICON_EQUIPMENT } from './utils/libraryIcons'
import { SceneViewer, useSceneStore } from '../src'
import type { EditorPanelTab } from '../src'
import { pushEvent } from '../src/editor/composables/useEditorState'
import { ASSET_BASE } from './utils/editorAssets'

/*
  宿主外壳。

  这一页现在只做四件事，都是**宿主该做的**：一条自己的顶栏、一个高度、
  `⌘S` 保存，以及**往左右栏各加一页自己的东西**。三栏工作台整个由
  `<SceneViewer editable />` 渲染出来——左边挑料、中间画布、右边改属性、
  W/E/R 与 Esc 与 ⌘Z 全在库里面。

  它同时是这个仓库最诚实的一份用法示例：**库的公开面在这里被完整地用了一遍**
  （一个 prop 决定形态、一个 prop 换素材地址、两个 prop 声明自己的面板页、
  `getSceneData()` 取数据落盘），没有一处走后门 import 内部模块——
  `useEditorState` 那几条是公开导出，宿主自己画顶栏时按的就是同一组状态。
  **素材清单则一个字都不在这里**：那是库内置的，这一页只在开发期把根地址
  换成同源代理前缀。
*/
defineOptions({ name: 'App' })

const { saveScene } = useConfigIO()

const scene = useSceneStore()

/**
 * 宿主自己的两页面板。
 *
 * **声明与内容分在两处**，这正是那对 prop 的用法：名字 / 图标 / 顺序是数据
 * （库要拿去画导轨），页里画什么由具名插槽给（`#side-tab-device` /
 * `#inspector-tab-about`）。所以「有哪些页」在 setup 里看得到，
 * 「每页长什么样」在模板里看得到。
 *
 * 图标借的是 `utils/libraryIcons.ts` 里那个「设备」字形（插头），
 * 它与库里那套图标同约定（24 格、只用描边、只吃 currentColor），
 * 拿去当 `icon` 直接用——那一行注释里写着为什么这两个字形留在宿主这边。
 *
 * 两页的 key（`device` / `about`）**不要与内置分类撞名**
 * （`floor` / `wall` / `door` / `window` / `skybox`），理由见 `EditorPanelTab`。
 */
const HOST_SIDE_TABS: EditorPanelTab[] = [{ key: 'device', label: '设备', icon: ICON_EQUIPMENT }]

const HOST_INSPECTOR_TABS: EditorPanelTab[] = [{ key: 'about', label: '说明' }]

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

      编辑态的一切（三栏、事件弹窗、绘制工具、快捷键）都在这个组件里面，
      外加下面这两页宿主自己的面板——它们的正文本页自己画。
    -->
    <SceneViewer
      editable
      height="100%"
      :asset-base-url="ASSET_BASE"
      :side-tabs="HOST_SIDE_TABS"
      :inspector-tabs="HOST_INSPECTOR_TABS"
    >
      <!--
        左栏「设备」页的正文。库只给一个空槽位，所以宽度、内边距、滚动都归这里
        （`.pg-panel` 写在 `styles/base.scss`）。

        这一页**读**的是公开的 `useSceneStore`——宿主自己的面板想显示什么，
        依据就在这里，不需要库再开任何 API。
      -->
      <template #side-tab-device>
        <div class="pg-panel">
          <h3>设备</h3>
          <p>这一页不是库里的东西：声明在 <code>sideTabs</code> 里，内容在这个插槽里。</p>
          <p>场景里现在有 <b>{{ scene.models.length }}</b> 个模型。</p>
          <p>库不知道这一页里有什么，也不会替它保存任何东西。</p>
        </div>
      </template>

      <!-- 右栏「说明」页的正文。与左栏那页同一条路数，只是挂在另一根导轨上。 -->
      <template #inspector-tab-about>
        <div class="pg-panel">
          <h3>说明</h3>
          <p>右栏这一页同样由宿主提供，排在库那七个内置页之后。</p>
          <p>它没有图标，导轨上退回了库给的占位立方体。</p>
        </div>
      </template>
    </SceneViewer>
  </div>
</template>
