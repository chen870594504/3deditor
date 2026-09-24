<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import AppHeader from './components/AppHeader.vue'
import EventBindingDialog from './components/inspector/EventBindingDialog.vue'
import InspectorPanel from './components/inspector/InspectorPanel.vue'
import SceneStage from './components/SceneStage.vue'
import SidePanel from './components/side/SidePanel.vue'
import { useConfigIO } from './composables/useConfigIO'
import { eventDialogOpen, gizmoMode, previewMode, pushEvent } from './composables/useEditorState'
import { cancelFloorplanTool, clearSelection, floorplanTool, selectedOpening, selectedWall } from './composables/useFloorplanTool'
import { exitPreview, redo, undo } from './composables/useSceneActions'
import type { TransformMode } from '../src'

defineOptions({ name: 'App' })

const { loadFromLocal, saveToLocal } = useConfigIO()

/**
 * 变换手柄的快捷键。
 *
 * 取 W / E / R 是与 Blender、Unity、Godot 一致的排布——用这套快捷键的人手指有肌肉记忆，
 * 换一套（比如 1/2/3）只会让人按错。SceneStage 那条切换条的 title 里也写着同一组字母，
 * 两处必须一起改。
 *
 * 用大写字母做键、比较前统一小写，于是 CapsLock 开着也照常工作。
 */
const GIZMO_KEYS: Record<string, TransformMode> = {
  w: 'translate',
  e: 'rotate',
  r: 'scale',
}

/**
 * 全局快捷键。
 *
 * 挂在 window 上而不是某个容器：焦点可能落在画布的 canvas、属性面板的
 * 输入框、或者某处被点过的按钮上，容器级监听会漏掉其中大半。
 */
function onKeydown(event: KeyboardEvent) {
  /**
   * 焦点在不在输入态，下面三条分支都要用，所以先算好。
   *
   * Esc 那条**不能**因为 typing 而跳过：弹窗打开时焦点就在它的对话框里，
   * 按 Esc 正是要关掉它。
   */
  const target = event.target as HTMLElement | null
  const typing =
    !!target &&
    (target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.isContentEditable ||
      target.tagName === 'SELECT')

  /**
   * Esc 分四级：先关弹窗，再退出绘制工具，再放开选中的那个门窗或墙，最后退出预览。
   *
   * 这一步必须在这里做，不能指望弹窗自己 stopPropagation：
   * Esc 的落点取决于焦点在哪儿（触发按钮、文本域、视口、body），
   * 而要挡住的是「按一次 Esc 把弹窗和预览一起关了」。
   */
  if (event.key === 'Escape') {
    if (eventDialogOpen.value) {
      eventDialogOpen.value = false
      return
    }
    /*
      绘制工具在预览之前，因为绘制**只在编辑态存在**：进了预览它已经被
      `enterPreview` 落回空档，这一条在那里是空转——顺序反过来也不会错，
      但写成「先处理更靠近当前操作的那一层」更好读。

      加 `typing` 这一道：在输入框里按 Esc 的意思是「放弃这次编辑」
      （`TextControl` 自己会处理），不该顺手把画到一半的墙链也丢掉。
      「退出预览」那条不设这道闸——预览下根本没有可编辑的输入框。
    */
    if (!typing && floorplanTool.value !== 'select') {
      cancelFloorplanTool()
      return
    }
    /*
      选中排在工具**之后**：工具开着时按 Esc 的意思一直是「先把工具收掉」，
      而工具开着时本来就选不中东西（只有空档能选），两条不会同时成立。

      排在「退出预览」**之前**：选着东西时按 Esc，用户要的是「把刚才点中的
      那个放开」，不是「退出预览」——预览是下一步很重的一个动作（相机、面板、
      历史都换一套），不该被一次想要取消选中的按键带走。

      `typing` 那一道与工具那条同一个理由：输入框里 Esc 是「放弃这次编辑」。

      判的是 `selectedOpening` / `selectedWall` 而不是选中状态本身：撤销把那个东西
      撤掉之后 id 会悬空，此时画面上已经没有任何东西是选中的，Esc 就该继续往下走
      （去退出预览），而不是被一个看不见的选中状态吃掉。两处判据同一条口径。
    */
    if (!typing && (selectedOpening.value || selectedWall.value)) {
      clearSelection()
      return
    }
    exitPreview()
    return
  }

  /**
   * 变换手柄的模式：W / E / R。
   *
   * 落在下面那道 ⌘/Ctrl 闸门**之前**，因为它本来就是不带修饰键的单键——
   * 与 Blender / Unity 同一种手感。因此这里得自己再挡一遍修饰键，
   * 免得「⌘R 刷新页面」这类浏览器快捷键被吃掉（⌘R 是刷新，抢它会有严重后果）。
   *
   * 输入框里打字时不切模式：模型名字、事件代码里满是 w / e / r。
   * 直接拿 `event.key` 查表即可——多字符的键名（`ArrowUp`、`Enter`）天然查不到，
   * 而中文输入法在拼音阶段的 key 是 `Process`，同样落不到表里。
   */
  if (!typing && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
    const mode = GIZMO_KEYS[event.key.toLowerCase()]
    if (mode && !previewMode.value) {
      event.preventDefault()
      gizmoMode.value = mode
      return
    }
  }

  if (!event.metaKey && !event.ctrlKey) return

  switch (event.key.toLowerCase()) {
    case 'z':
      // 光标在输入框里时让浏览器自己撤销，否则用户输错一位就要丢掉整段编辑
      if (typing) return
      event.preventDefault()
      if (event.shiftKey) redo()
      else undo()
      return

    case 's':
      // 保存不受输入焦点影响：在输入框里按 ⌘S 仍然是保存场景
      event.preventDefault()
      saveToLocal()
      return

    default:
      return
  }
}

onMounted(() => {
  // 有草稿就恢复。首次访问时静默跳过，不必为此弹一条提示
  const restored = loadFromLocal()
  if (!restored) pushEvent('编辑器就绪 · 拖入 glTF / GLB 或从左侧选择模型')

  window.addEventListener('keydown', onKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <!-- ed-entrance 让两块 chrome 依次淡入，落差 55ms -->
  <div class="ed-app ed-entrance">
    <AppHeader />

    <div class="ed-body">
      <SidePanel />
      <SceneStage />
      <InspectorPanel />
    </div>

    <!--
      事件绑定弹窗用 Teleport 挂到 body 上，不受这里 stacking context 的影响，
      放在模板哪一层都行，放在最后是为了让它在源码里也排在「最上面」。
    -->
    <EventBindingDialog />
  </div>
</template>
