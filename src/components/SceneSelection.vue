<script setup lang="ts">
import { onUnmounted, shallowRef, watch } from 'vue'
import { useLoop } from '@tresjs/core'
import { TransformControls } from '@tresjs/cientos'
import { BoxHelper } from 'three'
import type { Material, Object3D } from 'three'
import type { ModelTransformPayload, TransformMode } from '../types'

defineOptions({ name: 'TdmSceneSelection' })

/**
 * 选中视觉：给**当前那一个**被选中的模型画一圈包围框、挂一副变换手柄。
 *
 * 为什么是「画布级的一个实例」而不是「每个模型节点里各放一份、按选中显示」：
 *
 * - 手柄是三维编辑器里的单件：同一时刻只可能有一个人被拖，做成逐模型一份
 *   只会得到「N 份代码等着被 v-if 掉」；
 * - 更要紧的是它**必须站在模型组的外面**。手柄的位置是拿**世界矩阵**算出来的，
 *   挂在模型组底下会多叠一次模型自身的变换，模型越远手柄偏得越离谱。
 *   这一层用一只无变换的 `<TresGroup>` 兜住，既保证父级是单位矩阵，
 *   也让本组件保持**单根**。
 *
 * 它由 props 完全驱动、不访问 store：物体从哪来、算不算选中，是外面那一层的事。
 * 这与 `ScenePicker` 是同一条约定（全仓库绕开注入链的那三处见 DESIGN.md 设计决定 4）。
 */
const props = defineProps<{
  /** 选中模型的 id。载荷里要带上它，而这一层自己不查配置 */
  modelId: string
  /** 要画框、要拖的那只 three 组；null 表示现在没有可显示的目标 */
  object: Object3D | null
  /** 是否画包围框 */
  box: boolean
  /** 是否挂手柄 */
  gizmo: boolean
  /** 手柄模式 */
  mode: TransformMode
}>()

const emit = defineEmits<{
  (e: 'transform', payload: ModelTransformPayload): void
  (e: 'transformEnd', payload: ModelTransformPayload): void
}>()

/** 包围框的颜色，与进度条、内置示例几何体同一支青绿，落在深色背景上足够清楚 */
const BOX_COLOR = '#5eead4'

/**
 * 判定「这一次拖拽到底动没动」的容差。
 *
 * 取 1e-6：世界坐标上一个远小于任何一次真实拖动的量，只用来挡掉浮点噪声。
 * 用它而不是严格相等，是因为手柄在一次按压里可能被相机同时带着写下
 * 第 15 位小数级别的差异。
 */
const EPSILON = 1e-6

// ---------- 包围框 ----------

/**
 * 包围框用 three 自己的 `BoxHelper`，而不是自己维护一个 `Box3` + `Box3Helper`。
 *
 * 差别在「谁负责跟着物体走」：`BoxHelper.update()` 会重新算一遍世界包围盒并把
 * 几何体刷成新的盒子，`Box3Helper` 则只认外部那只 `Box3` 里的数字。前者省掉
 * 一份需要自己同步的状态，而代价（每次 `setFromObject`）两者是一样的。
 */
const boxHelper = shallowRef<BoxHelper | null>(null)

function disposeBox(): void {
  const helper = boxHelper.value
  if (!helper) return

  helper.geometry.dispose()
  // BoxHelper 的材质是多边形材质，不是共享材质，跟着一起回收
  ;(helper.material as Material).dispose()
  boxHelper.value = null
}

watch(
  () => (props.box ? props.object : null),
  (object) => {
    disposeBox()
    if (!object) return

    const helper = new BoxHelper(object, BOX_COLOR)

    /**
     * 关掉它自己的射线检测。
     *
     * `BoxHelper` 继承 `LineSegments`，默认是能被打中的（线段也有 raycast），
     * 而画布级拾取是对整个场景做一次递归 raycast——留着它，选中框每次点击都会
     * 白进一次命中列表。cientos 的 `useHelper` 对宿主传进去的 helper 也做同一件事。
     */
    helper.raycast = () => {}

    boxHelper.value = helper
  },
  { immediate: true },
)

/**
 * 每帧跟随。
 *
 * 不只是为了「物体动了框要跟着动」——拖动期间模型是被手柄直接改变换的，
 * 那时配置还没写回来，只有每帧重算才追得上。代价是每帧一次 `setFromObject`，
 * 而它只遍历**这一个**模型的网格（默认的 `precise = false` 用几何体自身的
 * 包围盒，不做逐顶点迭代），没有选中目标时一次都不跑。
 */
const loopHook = useLoop().onBeforeRender(() => {
  boxHelper.value?.update()
})

onUnmounted(() => {
  loopHook.off()
  disposeBox()
})

// ---------- 变换手柄 ----------

/** 三个三元组按配置的口径读出来：rotation 是 Euler 的 x/y/z（弧度） */
function payloadOf(object: Object3D): ModelTransformPayload {
  return {
    id: props.modelId,
    position: object.position.toArray() as [number, number, number],
    /**
     * 不用 `object.rotation.toArray()`：它返回的是**四元组**
     * `[x, y, z, order]`，多出来的那个 order 会把类型和配置都带偏。
     */
    rotation: [object.rotation.x, object.rotation.y, object.rotation.z],
    scale: object.scale.toArray() as [number, number, number],
  }
}

function sameTriple(a: readonly number[], b: readonly number[]): boolean {
  return a.every((value, index) => Math.abs(value - b[index]) < EPSILON)
}

/** 这一次拖拽开始时的变换，用来在松手那一刻判断它到底动没动 */
let dragStart: ModelTransformPayload | null = null

/**
 * 拖拽过程中每帧一次。
 *
 * 直接把值发出去，不在这里写回配置——这一层不碰 store（同 ScenePicker）。
 * 真正写回的是 SceneViewer，它同时负责把这一次变更通知给宿主。
 */
function onObjectChange() {
  const object = props.object
  if (!object) return
  emit('transform', payloadOf(object))
}

function onDragging(dragging: boolean) {
  const object = props.object
  if (!object) return

  if (dragging) {
    dragStart = payloadOf(object)
    return
  }

  const start = dragStart
  dragStart = null
  if (!start) return

  const end = payloadOf(object)

  /**
   * 没动过就什么都不发。
   *
   * 「在轴上按一下没拖就松手」也会走完一次 dragging 的开始与结束，而宿主要拿
   * 这个事件补一条历史标签——带标签的写入会绕过 store 里那道「空改动不入栈」的
   * 闸门，照发就会多出一条什么都没改的记录。判据只能在这里做：等事件发出去之后
   * 值已经写进配置了，外面再也分不出「改没改」。
   */
  if (
    sameTriple(start.position, end.position) &&
    sameTriple(start.rotation, end.rotation) &&
    sameTriple(start.scale, end.scale)
  ) {
    return
  }

  emit('transformEnd', end)
}
</script>

<template>
  <TresGroup>
    <!--
      包围框：挂一只现成的 three helper 进场景。
      `<primitive>` 是 TresJS 用「已经创建好的对象」的入口，helper 自己
      带几何体与材质，不需要再包一层组件。
    -->
    <primitive v-if="boxHelper" :object="boxHelper" />

    <!--
      变换手柄。它是 three-stdlib 的 TransformControls（`extends Object3D`），
      自己就是场景里的一个对象，所以能直接当 TresJS 组件用——
      three 0.186 自带的那个版本是 `extends Controls`，得手动把 `getHelper()`
      加进场景，两条路不是一回事。

      key 用物体的 uuid：换选中项时重挂一副新手柄，比赌它能干净地换 `object` 便宜。
      手柄内部已经处理了「拖动期间禁用轨道控制」，见 SceneContent 里 make-default 那段。
    -->
    <TransformControls
      v-if="gizmo && object"
      :key="object.uuid"
      :object="object"
      :mode="mode"
      @object-change="onObjectChange"
      @dragging="onDragging"
    />
  </TresGroup>
</template>
