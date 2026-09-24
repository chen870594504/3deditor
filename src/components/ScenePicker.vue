<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { useTresContext } from '@tresjs/core'
import { Raycaster, Vector2 } from 'three'
import { isClickGesture, trackPress } from '../utils/pointerClick'
import type { PressRecord } from '../utils/pointerClick'
import { modelNodeOf } from '../utils/modelNodeRegistry'
import type { ModelPickPayload } from '../types'

defineOptions({ name: 'TdmScenePicker' })

/**
 * 画布级的「点一下选中一个模型」。
 *
 * 为什么不让每个模型给自己的包裹组挂一个指针监听器（那是代码量最少的路）：
 * pmndrs 的过滤门是 `parentHasListener || hasObjectListeners(type, object)`，
 * 只要挂了**一个**监听器，那个模型的整棵子树就会在指针移动时每帧被 raycast。
 * 库把这条开销刻意做成了 `events` 的 opt-in，而「在编辑器里选中一个模型」是
 * 常驻能力，不该拿它去换逐帧的射线检测。
 *
 * 所以这条通道走画布的 DOM 事件：只多两个监听器，射线只在真的抬起指针那一刻
 * 走一次（见 `onPointerUp`），静止时一切开销为零，也不需要任何模型开 `events`。
 *
 * 它自己**不访问 store、也不认识配置**：命中之后只说「这个 id 被点了」，
 * 由宿主决定这意味着什么。
 */
const emit = defineEmits<{
  (e: 'pick', payload: ModelPickPayload): void
}>()

const { scene, camera, renderer } = useTresContext()

/**
 * 一套可复用的射线工具，不每次点击新建。
 *
 * `Vector2` 是 NDC 坐标的载体，`Raycaster` 内部只保存方向与近远平面，
 * 两者都是无状态的中间量，跨次复用没有副作用。
 */
const raycaster = new Raycaster()
const pointer = new Vector2()

/** 按下记录。一次单击只由一根手指构成，所以只留一份，不按 pointerId 分开存 */
let press: PressRecord | null = null

/** 画布元素，挂载时取一次、卸载时用它摘监听器 */
let canvas: HTMLCanvasElement | null = null

function onPointerDown(event: PointerEvent) {
  // 这里什么都**不做**，尤其不能 stopPropagation：OrbitControls 的
  // pointerdown 也挂在这张画布上，拦下来就等于把转视角一起拦掉了。
  press = trackPress(press, event)
}

/**
 * 抬起指针：够得上一次单击才拾取，且只拾取一次。
 *
 * 判定用的是与 `SceneModelNode` 同一个 `isClickGesture`——两套阈值一旦漂移，
 * 用户拖着转视角时就会顺手选中一个模型。
 */
function onPointerUp(event: PointerEvent) {
  const record = press
  press = null

  // 只认左键。中键与右键各有各的宿主通道（右键是 events.contextmenu），不在这里抢
  if (event.button !== 0) return
  if (!isClickGesture(record, event)) return

  const activeCamera = camera.activeCamera.value
  if (!activeCamera || !canvas) return

  /**
   * 自己算 NDC，公式与 pmndrs 转发 DOM 事件时用的那一份**逐字相同**
   * （`@pmndrs/pointer-events/dist/forward.js` 的 `htmlEventToCoords`）：
   *
   * - 用 `getBoundingClientRect()` 的宽高，也就是 **CSS 像素**；
   * - 不乘 `devicePixelRatio`——canvas 的 drawingBuffer 尺寸是另一回事，
   *   射线吃的是归一化坐标，乘了反而会偏。
   *
   * 两处不一致的后果是「点得中，但点偏」，所以这里刻意照抄而不是自己推一遍。
   */
  const rect = canvas.getBoundingClientRect()
  if (rect.width === 0 || rect.height === 0) return

  pointer.set(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1,
  )

  /**
   * 近远平面取相机自己的那一对。
   *
   * `Raycaster` 的默认值是 `0 / Infinity`，会把相机远裁面之外、根本没画出来的
   * 东西也算成命中——那属于「看得见才点得中」的例外，不如直接对齐相机。
   */
  raycaster.near = activeCamera.near
  raycaster.far = activeCamera.far
  raycaster.setFromCamera(pointer, activeCamera)

  /**
   * 世界矩阵要自己刷新一次，**非强制**：`Raycaster.intersectObjects` 不像
   * `Box3.setFromObject` 那样替你更新。
   *
   * 不加 `force`：`renderMode` 默认是 `always`，渲染循环每帧已经把矩阵刷过一遍，
   * 而用户瞄准的正是**上一帧看到的那幅画面**。为还没渲染出来的变换强算一遍，
   * 命中位置反而与眼睛看到的对不上。
   */
  scene.value.updateMatrixWorld()

  /**
   * 一次调用、一次排序，按距离从近到远扫，取第一个「属于某个模型、且那一组可见」
   * 的交点。
   *
   * 跳过不可见的那几个（three 的射线检测不看 `visible`，隐藏的模型照样会被命中）：
   * 这样选中**跟眼睛看到的一致**——看不见的模型既不会被选中，也不会挡住它后面那个。
   * 反过来「只看最近那一个」的话，用户点了看得见的 B 却会被前面一个隐藏的 A 顶掉。
   */
  const intersections = raycaster.intersectObjects([scene.value], true)

  for (const intersection of intersections) {
    const node = modelNodeOf(intersection.object)
    if (!node || !node.group.visible) continue

    const { point } = intersection
    emit('pick', {
      id: node.id,
      point: [point.x, point.y, point.z],
      distance: intersection.distance,
      object: intersection.object,
    })
    return
  }

  // 扫完没有：点到的是地面 / 网格 / 空白，什么都不发生（选中项保持不变）
}

/**
 * 在 onMounted 里直接读 `renderer.instance`，而不是等某个就绪标志。
 *
 * 因为**本组件的挂载本身就是 renderer 就绪的结果**：TresCanvas 把插槽内容放在
 * `renderer.onReady` 的回调里才去挂（tres.js 的 `renderer.onReady(() => mountCustomRenderer(...))`），
 * 而 onReady 由 `hasTriggeredReady` 守成一次性钩子。等这个组件的 setup / onMounted
 * 跑起来时，renderer 一定已经建好、画布也已经有尺寸了。
 *
 * 反过来写——`watch(() => renderer.isInitialized.value, ...)` 或在这里注册
 * `renderer.onReady`——是个**静默失效**的写法：那个值在我们能观察它时早就是 true，
 * 钩子也早触发过了，回调永远不来，监听器一个都没挂上，而哪里都不报错。
 */
onMounted(() => {
  const element = renderer.instance?.domElement
  if (!element) return

  canvas = element
  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointerup', onPointerUp)
})

onUnmounted(() => {
  canvas?.removeEventListener('pointerdown', onPointerDown)
  canvas?.removeEventListener('pointerup', onPointerUp)
  canvas = null
  press = null
})
</script>

<template>
  <!-- 渲染返回 null 的组件：TresJS 有专门分支跳过，不会污染场景图（同 PerfProbe） -->
</template>
