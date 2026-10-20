import { computed, ref } from 'vue'
import type { FloorplanPoint } from '../types'

/**
 * 第一人称漫游的**界面状态**。
 *
 * 与 `gizmoMode` / `floorplanTool` 同一条约定：它不进配置、不进历史、不进导出物。
 * 「人站在哪、朝哪看」是这一刻的观察方式，不是场景的一部分——把它写进
 * `config.camera` 会让每走一步都产生一条历史记录，撤销栈里立刻全是走路。
 *
 * **这一份住在画布层**（`src/composables/`），不在编辑器里：漫游入口现在由
 * `SceneCanvas` 渲染，纯画布（`editable: false`）与编辑态共用同一枚入口、
 * 同一套状态。编辑器层因此只剩「点击平面图落点」这条分流与事件日志，
 * 它们都通过这份模块级状态与画布交接（见 DESIGN.md 设计决定 70）。
 *
 * 分成四个量，各自管一件事：
 *
 * - `walking`：正在漫游。相机由 `SceneWalkControls` 接管，轨道控制让位。
 * - `walkArmed`：等待在平面图上落点（视角胶囊下方那枚人形按钮按下去之后）。
 * - `walkPreview`：拖动 / 悬停时跟随指针的预览点，只在 `walkArmed` 时有意义。
 * - `walkSpawn`：上一次确认的起点。**退出漫游之后仍然留着**——
 *   平面图上那枚标记因此能告诉用户「上次从这里走」，而不是走完就凭空消失。
 *
 * 它们都是模块级 ref，与编辑器里其余界面状态一致：单页应用里模块级单例
 * 等价于一个 store，但少一层概念。
 */
export const walking = ref(false)
export const walkArmed = ref(false)
export const walkPreview = ref<FloorplanPoint | null>(null)
export const walkSpawn = ref<FloorplanPoint | null>(null)

/**
 * 平面图上那枚标记现在该画在哪；不画时是 `null`。
 *
 * 漫游中不画：人已经站在那儿了，脚边再放一个琥珀色的桩子只会挡住视线。
 * 未布点时也不画：空场景里凭空出现一个标记，看起来像场景里多了一件东西。
 *
 * 优先级是「正在跟着指针的预览」高于「上一次的起点」——拖动时用户看的是
 * 即将落下的那一点，旧起点让位。
 */
export const walkMarker = computed<FloorplanPoint | null>(() => {
  if (walking.value) return null
  return walkArmed.value ? walkPreview.value : walkSpawn.value
})

/**
 * 等待落点时底部那条提示。
 *
 * 与绘制工具的提示行同一个落点（视口底部居中）：这套交互同样没有别的
 * 发现路径——按钮按下去之后什么都不会立刻发生，不说清楚就只是「点了没反应」。
 *
 * 提示里那句「Esc 取消」在纯画布里同样成立：`SceneWalkEntry` 自己挂着
 * 这一条键（编辑器的 `useEditorShortcuts` 也管，两处同时命中只是幂等，
 * 谁先谁后都不改变结果）。
 */
export const walkHint = computed(() =>
  walkArmed.value
    ? '把按钮拖到平面图上松开（或直接点平面图上的一点），就从那里开始第一人称行走；Esc 取消'
    : '',
)

/**
 * 按下那枚人形按钮之后：进入待落点状态。
 *
 * **这里不再顺手切到 2D。** 按钮只在 2D 里渲染（判据在 `SceneWalkEntry`），
 * 正常路径走到这里时配置已经是 2D；而「防守一次配置与画面不同步」需要
 * `setViewMode`，那是编辑器层的动作，纯画布没有它——把编辑器的 composable
 * import 进画布层，等于让只读画布白背上一层编辑器状态（与设计决定 69
 * 里胶囊「自己不移档」同一条理由）。真要那一层防守，编辑器的入口已经由
 * 模板条件挡住，代价只是极端时序下多拖一次。
 */
export function armWalkPlacement(): void {
  if (walking.value) return

  walkArmed.value = true
  walkPreview.value = null
}

/** 指针挪到地面上的哪一点（落不到地面时传 `null`） */
export function previewWalkAt(point: FloorplanPoint | null): void {
  if (!walkArmed.value) return
  walkPreview.value = point
}

/** 放弃这次落点（Esc、松手在视口外、点视角胶囊切档） */
export function cancelWalkPlacement(): void {
  walkArmed.value = false
  walkPreview.value = null
}

/**
 * 从这一点开始走。
 *
 * 起点原样存下，**不在这一层夹取**：碰撞与「站到墙外」由 3D 控制层在
 * `begin()` 里用 `resolveWalkPosition` 做一次，那里才有户型图的几何。
 * 在这里再算一遍等于同一规则两份实现。
 *
 * 事件日志不在这里写：`pushEvent` 是编辑器的界面状态，纯画布没有事件面板。
 * 编辑态由 `EditorStage` 监听 `walking` 的两条沿自己补上，文案逐字不变。
 */
export function startWalkAt(point: FloorplanPoint): void {
  walkArmed.value = false
  walkPreview.value = null
  walkSpawn.value = [point[0], point[1]]
  walking.value = true
}

/** 退出漫游。相机由 `SceneWalkControls` 自己按配置还原 */
export function stopWalk(): void {
  if (!walking.value) return
  walking.value = false
}

/**
 * 整个画布卸载时清干净。
 *
 * 这些是模块级状态，不随组件实例消失——带着 `walking: true` 进入下一个页面时，
 * 新实例一挂上就处在「正在漫游」而没有任何控制器接管的半截状态，
 * 且这种状态不报错、只表现为「相机转不动」。
 */
export function resetWalkMode(): void {
  walking.value = false
  walkArmed.value = false
  walkPreview.value = null
  walkSpawn.value = null
}
