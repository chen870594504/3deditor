<script setup lang="ts">
import { computed } from 'vue'
import { DoubleSide, Euler, Vector3 } from 'three'
import type { FloorplanPoint } from '../../src'
import { foundationDrag, hoverPoint, selectionHighlight, wallChain } from '../composables/useFloorplanTool'

defineOptions({ name: 'SceneFloorplanDraft' })

/**
 * 编辑态的东西：墙链的橡皮筋、拖到一半的地基矩形、选中的那个门窗或墙。
 *
 * **这是唯一一个不进库的平面图组件。** 库渲染的是配置里那份「用户已经确认存在」
 * 的房子，而草稿是编辑态——`SceneConfig` 只放可 JSON 往返的数据，所以这条线
 * 正好落在这里：能进配置的由库渲染，不能进配置的由游乐场渲染。
 * 它由 `SceneStage.vue` 塞进 `SceneViewer` 的 `#scene` 插槽（位置在 TresCanvas 内部），
 * 因此不必为了它给库加第二个 prop。
 *
 * 选中那一块是这条线上唯一**不是草稿**的东西（选中本身是界面状态，
 * 但它画的那个东西是既成事实），下面 `selectionMark` 上有说明。
 *
 * 与库那套的观感差别是**刻意的**：草稿一律是琥珀色的半透明细条，落成的墙是
 * 不透明的实体（2D 平面图那一档是石板灰的实色，3D 里是墙资产的贴面，两档都不是
 * 琥珀色）。用户要能一眼分出「这段已经画好了」和「这段还没松手」。
 */

/** 草稿离地多高。抬起来一点点，免得与网格共面打架 */
const DRAFT_Y = 0.02

/** 草稿条的截面尺寸（米）。比真墙（0.18）细，一眼能看出是「还没落成」 */
const DRAFT_THICKNESS = 0.12

/** 链上已确认那几段的透明度 */
const CHAIN_OPACITY = 0.85
/** 从最后一点拉到光标那一根橡皮筋的透明度——更淡，因为它在配置里还不存在 */
const RUBBER_OPACITY = 0.35

/**
 * 单位盒。
 *
 * 刻意用「一个单位几何 + `scale` 拉长」而不是每段算一个 `args`：
 * `args` 一变 TresJS 就重建几何体（`SceneGround.vue:54-60` 的注释是权威），
 * 而橡皮筋的长度**每次指针移动都在变**——那是每帧一个新 `BoxGeometry`。
 * `scale` 只是一个变换，几何体始终是这一个。
 *
 * 它必须是模块级的常量数组：写在模板里的数组字面量每次渲染都是新引用，
 * 同样会触发重建。
 */
const UNIT_BOX: [number, number, number] = [1, 1, 1]
const UNIT_PLANE: [number, number] = [1, 1]

/**
 * 草稿条的旋转。
 *
 * 与 `floorplan.ts` 的 `wallPieces` 同一套口径，推导见 `SceneFloorplanRoom.vue`：
 * three 的 `makeRotationX(θ)` 是 `y' = cosθ·y − sinθ·z`、`z' = sinθ·y + cosθ·z`，
 * 于是绕 y 转 θ 之后，局部 +x 轴指向世界 `(cosθ, 0, −sinθ)`。
 * 要让它落在 `(dx, dz)` 方向上，就得取 `θ = −atan2(dz, dx)`。
 */
function rotationOf(from: FloorplanPoint, to: FloorplanPoint): Euler {
  return new Euler(0, -Math.atan2(to[1] - from[1], to[0] - from[0]), 0)
}

/** 一段草稿条的描述数据。`position` / `rotation` / `scale` 都必须是新实例 */
interface DraftBar {
  key: string
  position: Vector3
  rotation: Euler
  scale: Vector3
  opacity: number
}

/** 把两个格点变成一根躺在地上的细条；两点重合时返回 null（零长度的盒子会算出 NaN 法线） */
function barOf(
  key: string,
  from: FloorplanPoint,
  to: FloorplanPoint,
  opacity: number,
): DraftBar | null {
  const length = Math.hypot(to[0] - from[0], to[1] - from[1])
  if (length < 1e-6) return null

  return {
    key,
    position: new Vector3(
      (from[0] + to[0]) / 2,
      DRAFT_Y + DRAFT_THICKNESS / 2,
      (from[1] + to[1]) / 2,
    ),
    rotation: rotationOf(from, to),
    scale: new Vector3(length, DRAFT_THICKNESS, DRAFT_THICKNESS),
    opacity,
  }
}

/**
 * 墙链 + 橡皮筋。
 *
 * 链上每一段各是一个 key（`wall-0`、`wall-1`……按起点在链里的下标），
 * 于是新落一点只会**追加**一根，前面那些的 key 与几何体都不动。
 * 橡皮筋的 key 固定是 `rubber`，它每帧改的只是 `scale` 与 `rotation`。
 */
const wallBars = computed<DraftBar[]>(() => {
  const chain = wallChain.value
  const bars: DraftBar[] = []

  for (let i = 0; i + 1 < chain.length; i += 1) {
    const piece = barOf(`wall-${i}`, chain[i]!, chain[i + 1]!, CHAIN_OPACITY)
    if (piece) bars.push(piece)
  }

  const tail = chain[chain.length - 1]
  const cursor = hoverPoint.value
  if (tail && cursor) {
    const rubber = barOf('rubber', tail, cursor, RUBBER_OPACITY)
    if (rubber) bars.push(rubber)
  }

  return bars
})

/**
 * 当前这一点的落点标记。
 *
 * 没有它的话，「上一点落在哪一格」只能靠橡皮筋的起点去猜——
 * 而链上最后一点恰恰是接下来所有约束的基准（只能与它同行同列）。
 */
const chainTip = computed(() => {
  const tail = wallChain.value[wallChain.value.length - 1]
  if (!tail) return null

  return {
    position: new Vector3(tail[0], DRAFT_Y + DRAFT_THICKNESS / 2, tail[1]),
    // 比细条粗一圈的小方块，压在交点上
    scale: new Vector3(0.34, DRAFT_THICKNESS * 1.4, 0.34),
  }
})

/**
 * 拖到一半的地基。
 *
 * 用一整块半透明平面而不是四条边框：地基本身就是一块板，拖动过程中最要紧的信息
 * 是「这块板会铺在哪、多大」，一块半透明的板正是它落成之后的样子。
 *
 * 平面几何躺在局部 XY 平面上，绕 X 转 +π/2 之后局部 `(x, y)` 落到世界 `(x, 0, y)`
 * ——存进去的 z 原样成为世界的 z（推导见 `SceneFloorplanRoom.vue`）。
 * 转过去之后法线朝下，所以材质要用 `DoubleSide`。
 */
const FOUNDATION_ROTATION = new Euler(Math.PI / 2, 0, 0)

const foundationPreview = computed(() => {
  const drag = foundationDrag.value
  if (!drag) return null

  return {
    position: new Vector3(
      (drag.from[0] + drag.to[0]) / 2,
      DRAFT_Y,
      (drag.from[1] + drag.to[1]) / 2,
    ),
    scale: new Vector3(
      Math.abs(drag.to[0] - drag.from[0]),
      Math.abs(drag.to[1] - drag.from[1]),
      1,
    ),
  }
})

/**
 * 选中的那个门窗或墙。
 *
 * 这是这一层里唯一**不是草稿**的东西：它画的是一个既成事实（配置里那个洞口摆在
 * 哪、多宽，那面墙从哪到哪），只是「哪一个是选中的」在配置里没地方放——
 * `SceneConfig` 只放可 JSON 往返的数据，而选中是编辑器的界面状态。所以它和草稿
 * 落在同一层。
 *
 * 颜色沿用草稿的琥珀，但**更实**（0.85）：草稿的淡表示「还没落成」，
 * 而选中的是已经存在的东西，画得一样淡会看着像「又要往这儿落一笔」。
 *
 * 位置 / 朝向 / 跨度全部由 `selectionHighlight` 给（那边有完整说明：为什么必须抬到
 * 墙顶之上、洞口为什么从渲染出来的那一片碎片上取而是整面墙通长一条），这里只把它
 * 摆成一个盒子，一个三角函数都不写。
 *
 * 洞口与墙**最多只会有一样被选中**（互斥是按构造成立的，见那个 composable 里的
 * `selection`），所以这里不必分辨拿到的是哪一种。
 */
const selectionMark = computed(() => {
  const mark = selectionHighlight.value
  if (!mark) return null

  return {
    key: mark.key,
    position: new Vector3(...mark.position),
    rotation: new Euler(0, mark.rotationY, 0),
    scale: new Vector3(...mark.size),
  }
})
</script>

<template>
  <!--
    每根草稿条是「单位盒 + 缩放」，几何体全场共用这一个 args 引用。
    材质按 key 各自一份：opacity 是每根条自己的（链上的实、橡皮筋的淡）。
  -->
  <TresMesh v-for="bar in wallBars" :key="bar.key" :position="bar.position" :rotation="bar.rotation" :scale="bar.scale">
    <TresBoxGeometry :args="UNIT_BOX" />
    <TresMeshBasicMaterial color="#fbbf24" :opacity="bar.opacity" transparent :depth-write="false" />
  </TresMesh>

  <TresMesh v-if="chainTip" :position="chainTip.position" :scale="chainTip.scale">
    <TresBoxGeometry :args="UNIT_BOX" />
    <TresMeshBasicMaterial color="#f59e0b" :depth-write="false" />
  </TresMesh>

  <TresMesh v-if="foundationPreview" :position="foundationPreview.position" :rotation="FOUNDATION_ROTATION" :scale="foundationPreview.scale">
    <TresPlaneGeometry :args="UNIT_PLANE" />
    <TresMeshBasicMaterial
      color="#fbbf24"
      :opacity="0.22"
      transparent
      :side="DoubleSide"
      :depth-write="false"
    />
  </TresMesh>

  <!--
    选中的那个门窗或墙：一块盖在墙顶上的琥珀板，与上面几条一样是「单位盒 + 缩放」。
    `key` 取被选中的那个东西自己的 id，于是换一个选中的是换一块板（几何体按同一个
    args 引用重建一次，一次点击一次，不是每帧）；同一次拖动里 id 不变，那一段不会重建。
  -->
  <TresMesh v-if="selectionMark" :key="selectionMark.key" :position="selectionMark.position" :rotation="selectionMark.rotation" :scale="selectionMark.scale">
    <TresBoxGeometry :args="UNIT_BOX" />
    <TresMeshBasicMaterial color="#fbbf24" :opacity="0.85" transparent :depth-write="false" />
  </TresMesh>
</template>
