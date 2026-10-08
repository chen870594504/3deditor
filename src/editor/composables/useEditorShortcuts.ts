import { onMounted, onUnmounted } from 'vue'
import type { TransformMode } from '../../types'
import { eventDialogOpen, gizmoMode, previewMode } from './useEditorState'
import {
  cancelFloorplanTool,
  clearSelection,
  floorplanTool,
  selectedOpening,
  selectedWall,
} from './useFloorplanTool'
import { exitPreview, redo, undo } from './useSceneActions'

/**
 * 编辑器的全局快捷键。**由 `SceneEditor` 在 setup 里调一次**。
 *
 * 它守着自己挂 / 摘监听器（`onMounted` / `onUnmounted`），所以调用方只需要
 * 一句 `useEditorShortcuts()`——没有返回值，也没有开关。
 *
 * ## 为什么在库里而不是留在宿主
 *
 * 因为这几条键**只对编辑器有意义**：W/E/R 切的是手柄档位、Esc 那四级关的是
 * 事件弹窗与绘制工具、⌘Z 撤销的是编辑器历史——宿主自己的页面上没有这些东西，
 * 它想复用也无从复用。搬进库之前这段住在 `playground/App.vue`，而「宿主必须
 * 自己抄一遍快捷键」正是三栏进库时要一并解决的那类问题。
 *
 * 留在宿主的是**策略**那一类：`⌘S` 保存。库连「保存到哪」都不知道
 * （组件本身不落盘，只经 `getSceneData()` 把数据交出去），
 * 所以那一条由宿主的 keydown 处理（`playground/App.vue` 就是这么做的）。
 *
 * ## 挂在 window 上而不是某个容器
 *
 * 焦点可能落在画布的 canvas、属性面板的输入框、或者某处被点过的按钮上，
 * 容器级监听会漏掉其中大半。
 */
export function useEditorShortcuts(): void {
  /**
   * 变换手柄的快捷键。
   *
   * 取 W / E / R 是与 Blender、Unity、Godot 一致的排布——用这套快捷键的人手指有
   * 肌肉记忆，换一套（比如 1/2/3）只会让人按错。
   * `EditorStage.vue` 里那条切换条的 title 写的是同一组字母，两处必须一起改。
   *
   * 用大写字母做键、比较前统一小写，于是 CapsLock 开着也照常工作。
   */
  const GIZMO_KEYS: Record<string, TransformMode> = {
    w: 'translate',
    e: 'rotate',
    r: 'scale',
  }

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

    /**
     * 撤销 / 重做。只有 `z` 一支——`⌘S` 保存不在这里，它属于**宿主**：
     * 库连「保存到哪」都不知道，组件本身不落盘（只经 `getSceneData()` 把数据交出去）。
     */
    switch (event.key.toLowerCase()) {
      case 'z':
        // 光标在输入框里时让浏览器自己撤销，否则用户输错一位就要丢掉整段编辑
        if (typing) return
        event.preventDefault()
        if (event.shiftKey) redo()
        else undo()
        return

      default:
        return
    }
  }

  onMounted(() => {
    window.addEventListener('keydown', onKeydown)
  })

  onUnmounted(() => {
    window.removeEventListener('keydown', onKeydown)
  })
}
