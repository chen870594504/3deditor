<script setup lang="ts">
import { computed, watch } from 'vue'
import { useGLTF } from '@tresjs/cientos'
import { Box3, Vector3 } from 'three'
import type { Mesh } from 'three'
import { wallFaceIsSheet } from '../../src'

defineOptions({ name: 'ModelMeasureProbe' })

/**
 * 为一件洞口资产量一次包围盒，把宽高报给调用方。
 *
 * ## 它解决的是哪一个问题
 *
 * `PickedAsset.width` / `height` 是「这件料要占一个多大的洞口」，落笔时洞口按
 * 这两个数开（`placeOpeningAt`），装进去时缩放系数是「洞高 ÷ 资产高」。
 * 这两个数一直靠人在清单里手写，**写错了不报错**：用户报的「窗户大小不对，
 * 没有根据模型大小显示」就是清单写 1.2、资产实际 2.7，系数被算成 0.444，
 * 3.6 米宽的幕墙被画成 1.6 米、两侧嵌进墙里被吞掉。
 * 让编辑器自己去量一遍，**新加的、还没人量过的资产**就不必等谁手抄。
 *
 * ## 它量出来的数**不覆盖**清单里写好的数
 *
 * 这一条是拿一道真门换来的，别改回去（机制写在 `applyMeasuredAssetSize` 上）：
 * 清单里那个数是「**洞口**要开多大」，是一件设计决定；这里量的是**资产的外廓**，
 * 是一件事实。而资产的外廓可以是脏的——服务器上那份 `doubleGlassDoor.glb`
 * 带着地面与三面墙，量出来 14 × 3.42 米，覆盖上去洞口就变成 14 米、
 * 落笔得到「这面墙太短，放不下一个门」。
 *
 * 所以这个组件的定位是**填空题，不是校对**：清单没写时才补，
 * 写了就照写，只有两边差到 3 倍以上时才点一句名（也是 `applyMeasuredAssetSize` 干的）。
 *
 * 量的时机是「在左栏点中那一格」：从点完到把鼠标移到墙上点下去，
 * 中间有几百毫秒，90 KB 的资产足够量完（实测 161 ms）。量不回来（还没加载完、
 * 404、资产全是片）就什么都不做，清单里那个数继续当兜底——所以清单仍然要写对。
 *
 * ## 为什么这段逻辑能待在画布外
 *
 * 它是这一份组件存在的**唯一**技术理由，值得记下来免得下次重新推一遍：
 * `useGLTF`（cientos）→ `useLoader`（core）走到底只用到 `useAsyncState`
 * （vueuse）、`watch` 与 `onUnmounted`——**没有一处 `useTres()` / `inject`**，
 * 所以它不要求在 `<TresCanvas>` 里，只要求**在一个组件实例里**（`onUnmounted` 要用）。
 * 于是这个组件挂在左栏、与视口无关，也就不用把一份「只是为了量尺寸」的加载
 * 塞进场景树。
 *
 * ## 代价：这份 glb 会被加载两次
 *
 * 一次在这里量尺寸，一次在洞口真的落到墙上时由 `SceneFloorplanOpeningModel`
 * 加载。全仓库没开 `three.Cache`，两次加载是两次网络请求加两次解析。
 * **不能靠共用 `state.scene` 省掉**：同一个 `state.scene` 交给两个组件是
 * `SceneFloorplanWallSkin.vue` 文件头点名禁止的（`useLoader` 卸载时会
 * `disposeObject3D`，先卸载的那一份把另一份正在用的几何体释放掉）。
 * 资产都是百 KB 量级、且只在选中时发生一次，这个代价换来「尺寸不会错」，值。
 *
 * ## 量的口径与渲染端一字不差
 *
 * 同一份筛法在 `SceneFloorplanOpeningModel.vue` 的 `measured` 里，两处必须一致，
 * 否则会出现「量出来 2.7 米、装上去不是这个数」的错位。三处要点：
 * `updateMatrixWorld(true)` 必须先刷（`Box3.expandByObject` 只更新自己、
 * 不更新祖先），**逐网格判片**（一块几十米见方的背景板会把资产量成 80 米宽），
 * 以及丢弃最小轴 < 1 毫米的片（`wallFaceIsSheet`，与渲染端同一个门槛）。
 */

const props = defineProps<{
  /**
   * 要量的那件资产。**父级用 `:key="url"` 挂这个组件**，所以同一个实例里
   * 它是常量：换一件料就是一个新实例，正好一次加载。
   *
   * 不靠 `useGLTF` 内部那条 `watch(path)` 换地址——那条路会先
   * `disposeObject3D` 再重新 load，同样的事分成两条路走只会多一个
   * 「什么时候是复用、什么时候是重载」要记的东西。
   */
  url: string
}>()

const emit = defineEmits<{
  /**
   * 量好了。**地址跟着一起报回去**，这不是冗余。
   *
   * 测量是异步的，报回来的时候用户可能已经换了一格料、或者取消了选用。
   * 调用方拿着这个地址去写，写之前还能与「现在待用的是哪一件」比一次
   * （`applyMeasuredAssetSize` 里那道判断），比的是**量的是谁**这一个事实。
   * 换成调用方自己回头去读「现在选的是哪一件」，就会把这一件的尺寸写到
   * 那一件头上——表现是「选了窗却按门的尺寸开洞」，而且完全不报错。
   */
  measured: [{ url: string; width: number; height: number }]
}>()

/*
  `draco` 写死 false：这边没有 DRACOLoader，传 true 只会静默失败，
  表现是「尺寸永远量不出来、永远退回清单」。与渲染端同一条。
*/
const { state } = useGLTF(props.url, { draco: false })

/** 毫米。再细没有意义，而这三个小数会一路进配置 JSON 与提示行的文案 */
function round3(value: number): number {
  return Math.round(value * 1000) / 1000
}

/**
 * 量出来的宽与高（米），`null` 表示还没加载完、或者一块实体都没有。
 *
 * 形状是 `[宽(X), 高(Y)]` 而不是整个包围盒：洞口只用得上这两个数
 * （`wallFaceFit` 自己会从完整包围盒里算厚度那一轴的缩放），
 * 报两个数比报一个盒子少一处「拿到盒子之后还要记得取哪两个分量」。
 */
const measured = computed<{ width: number; height: number } | null>(() => {
  const scene = state.value?.scene
  if (!scene) return null

  scene.updateMatrixWorld(true)

  const solid = new Box3()
  let hasSolid = false

  scene.traverse((object) => {
    const mesh = object as Mesh
    if (!mesh.isMesh) return

    const box = new Box3().setFromObject(mesh)
    if (wallFaceIsSheet({ min: box.min.toArray(), max: box.max.toArray() })) return

    solid.union(box)
    hasSolid = true
  })

  if (!hasSolid) return null

  const size = solid.getSize(new Vector3())
  const width = round3(size.x)
  const height = round3(size.y)

  /*
    只挡「一定是垃圾」的值：非有限、以及不是正数。

    非有限的来源是资产的 `matrix` 里真有 NaN / Infinity（导出的模型里见过），
    它会一路写进配置、写进 `wallPieces`，而那里的算术**不会报错**，
    只会让整面墙的碎片位置全变成 NaN——那个症状离原因非常远，
    所以在源头挡住。零宽同理：一个零宽的洞口在 `placeOpeningAt` 的
    「重叠」判据里是除零，行为不确定。

    **明显离谱但仍有限的值照报**（比如资产里混进一块 80 米的地面，量出来宽 80 米）：
    这里不是判「这个数像不像话」的地方——那是下游 `applyMeasuredAssetSize` 的事，
    它拿这个数与清单里的数一比，差三倍以上就点一句名，而且**清单写了的仍然听清单**。
    在这里悄悄按自己的口味筛掉，会让「为什么没量出来」变成一件查不出来的事：
    值到这里就没了，下游连一句话都说不出来。
  */
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null
  if (width <= 0 || height <= 0) return null

  return { width, height }
})

/*
  `immediate` 不能省：`measured` 是个 computed，从 `null` 变成数字时
  watch 才会第一次触发；不给 immediate 的话，**资产在挂载的同一帧里就量完了**
  这种最快的情况反而报不出去（首帧 before 起 watch 就晚了）。
*/
watch(
  measured,
  (value) => {
    if (value) emit('measured', { url: props.url, ...value })
  },
  { immediate: true },
)
</script>

<template>
  <!--
    一个**纯逻辑组件**，不画任何东西，所以这里渲染的是一个注释节点、**不是一个元素**。

    这一条不能改成 `<span />`：父级 `ModelLibrary.vue` 的根要么是宫格
    （`display: grid`，多一个子元素会挤出一格空白）要么是 `.ed-side-body` 那个
    flex 列（多一个子元素会多一条 `gap`），两种都会让版面凭空空出一块。
    `<span v-if="false" />` 编译成 `createCommentVNode`（已核对编译产物），
    元素一个都不建。
  -->
  <span v-if="false" />
</template>
