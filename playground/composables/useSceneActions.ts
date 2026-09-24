import { useSceneStore } from '../../src'
import { previewMode, pushEvent } from './useEditorState'
import { cancelFloorplanTool, clearSelection } from './useFloorplanTool'

/**
 * 编辑器的「动作层」。
 *
 * 同一件事有三条触发路径——按钮、键盘快捷键、属性面板里的按钮，
 * 而它们分散在不同的组件里。动作集中在这里，三条路径就不会各自长出一份
 * 略有出入的实现（最典型的是日志文案：只有一处写，就不会出现
 * 「撤销」和「撤销 → 相机」两种格式）。
 */

/** 当前历史位置的标签，用来把撤销/重做写成一条能读懂的事件 */
function currentLabel(): string {
  const scene = useSceneStore()
  return scene.history[scene.historyIndex]?.label ?? '初始状态'
}

/** 撤销一步，返回是否真的撤销了 */
export function undo(): boolean {
  const scene = useSceneStore()
  if (!scene.canUndo) return false

  scene.undo()
  pushEvent(`撤销 → 回到「${currentLabel()}」`)
  return true
}

/** 重做一步，返回是否真的重做了 */
export function redo(): boolean {
  const scene = useSceneStore()
  if (!scene.canRedo) return false

  scene.redo()
  pushEvent(`重做 → 前进到「${currentLabel()}」`)
  return true
}

/** 进入预览模式 */
export function enterPreview() {
  /*
    预览是**只读**的：绘制工具那一整块在预览里根本不摆出来（`planView` 那三条闸
    之一就是预览，见 `FloorplanTools.vue`），但工具状态本身不归它管——留着的话
    回到编辑态时那一枚按钮会「自己又亮起来」，所以这里仍然显式落回空档，
    而不是靠界面假装它不在。
  */
  cancelFloorplanTool()
  /*
    选中的门窗或墙也要一起放开，理由与上面那条一样是「只读」：选中之后**拖一下
    就会改配置**，而空档这条路（`floorplanEnabled` 之外的那条）会真的写 `openings`。
    今天挡住它的是 `planView` 里那个 `previewMode`——所以两条路其实都拦住了，
    这里再清一次是因为**高亮**：预览是给别人看成品的样子，墙上留着一块琥珀色的
    选中板，看着像「这个还没做完」。
  */
  clearSelection()

  previewMode.value = true
  /*
    「Esc 退出」这句只进控制台，界面上看不见——真正让出口可见的是预览窗口
    顶上那条标题栏里的按钮（`PreviewBar.vue`）。这里照旧记一条日志，
    它是事后排查时间线的落点，不是给用户看的提示。
  */
  pushEvent('进入预览模式（Esc 退出）')
}

/** 退出预览模式，返回是否真的退出过 */
export function exitPreview(): boolean {
  if (!previewMode.value) return false

  previewMode.value = false
  pushEvent('退出预览模式')
  return true
}

export function togglePreview() {
  if (previewMode.value) exitPreview()
  else enterPreview()
}
