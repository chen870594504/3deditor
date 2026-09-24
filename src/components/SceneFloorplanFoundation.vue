<script setup lang="ts">
import { computed } from 'vue'
import { Vector3 } from 'three'
import { FOUNDATION_THICKNESS } from '../utils/floorplan'
import type { FloorplanFoundation } from '../types'

defineOptions({ name: 'TdmSceneFloorplanFoundation' })

/**
 * 这一层位于 TresCanvas 内部，只收 props、不访问 Pinia
 * （见 README「TD 层不使用 Pinia」）。
 */
const props = defineProps<{
  foundation: FloorplanFoundation
}>()

/**
 * 板子顶面比网格高出的那一丁点。
 *
 * **不能是 0。** 网格与板顶都在 `y = 0` 时两者共面，深度缓冲分不出谁在前，
 * 从正上方看下去就是一片闪烁的摩尔纹（2D 档恰好就是正上方）。
 *
 * 但**光靠这一点几何高度也不够**——5 毫米当初是按「肉眼看不出板子浮着」定的，
 * 没有量过深度缓冲。2D 档的相机在 110 米高（`useViewMode` 的 `TOP_DISTANCE`），
 * 而 `near = 0.1` / `far = 200` 下透视深度缓冲在这一距离上的分辨率约为
 * `z²·(1/near − 1/far)/2²⁴ ≈ 7 毫米`：5 毫米正落在这条噪声带里，逐像素比大小，
 * 网格线就会在地基上闪。真让板子胜出的是下面材质上那组 `polygonOffset`，
 * 它按**深度缓冲的单位**把板子往前推、与相机远近无关；几何缝留着是为了
 * 3D 档贴近看时也干净。
 */
const TOP_GAP = 0.005

/**
 * 中心的世界 y。
 *
 * 配置里存的是**中心点**（见 `FloorplanFoundation` 的注释），而渲染关心的是
 * **顶面**：墙与房间都长在 `y = 0` 附近，板子得在它们下面。所以中心要往下
 * 沉半个板厚，让顶面落在那条 5 毫米的缝上。
 */
const centerY = TOP_GAP - FOUNDATION_THICKNESS / 2

/**
 * 尺寸与位置各用**一个** computed 固定引用。
 *
 * TresJS 在 `args` 换引用时会重建几何体（`SceneGround.vue:54-60` 的注释是
 * 这条约定的出处），模板里现造一个 `[w, 0.12, d]` 就等于每次重渲染都重建一次。
 *
 * 位置写成 `Vector3` 而不是数组，照 `SceneModelNode.vue:74-76` 的先例：
 * TresJS 的全局组件类型把 `position` 标注成严格的 `Vector3`，
 * 数组只在运行时可用、类型上不接受（`SceneContent.vue:97-99` 有完整说明）。
 * 每次重算返回**新实例**也是必要的——TresJS 按引用比较，
 * 原地改同一只会被当成「没变」。
 */
const boxArgs = computed<[number, number, number]>(
  () => [props.foundation.width, FOUNDATION_THICKNESS, props.foundation.depth],
)

const boxPosition = computed(
  () => new Vector3(props.foundation.x, centerY, props.foundation.z),
)
</script>

<template>
  <TresMesh :position="boxPosition">
    <TresBoxGeometry :args="boxArgs" />
    <!--
      `polygonOffset` 是这块板子**不跟网格线打架**的真正原因（见 `TOP_GAP` 的注释）：
      把这一块的片元深度按深度缓冲的单位整体往前推，于是不管相机在 110 米还是
      3 米，板子都稳定压住底下的网格。

      推的是**板子**而不是把网格往后推：`Grid` 是 cientos 的组件，它那套
      `GridMaterial` 不从外面收材质，改不了；而且语义上「地基盖住网格」本来
      就该由地基自己主张。

      `factor` 给 **0**、只用 `units`：`factor` 是乘以深度斜率的项，斜视（3D 档
      贴着地面看）时斜率可以很大，会把板子按着一个与视角相关的量往前推，
      大到能穿出墙脚。这里要比的是两块**朝向几乎相同的平面**，斜率项不需要，
      常数项也不会随视角变。

      `-2` 是量着定的：5 毫米在 110 米处折合约 0.7 个深度单位，加 2 个单位后
      与网格拉开约 2.7 个单位，判断不再逐像素掷骰子；而房间色块在板子上方
      30 毫米（约 4.2 个单位），推完仍留着 2 个出头的余量，不会被板子反过来盖住。
    -->
    <TresMeshStandardMaterial
      color="#94a3b8"
      :roughness="0.95"
      :metalness="0.05"
      :polygon-offset="true"
      :polygon-offset-factor="0"
      :polygon-offset-units="-2"
    />
  </TresMesh>
</template>
