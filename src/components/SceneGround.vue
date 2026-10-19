<script setup lang="ts">
import { computed } from 'vue'
import { Grid } from '@tresjs/cientos'
import { Euler, Vector3 } from 'three'

defineOptions({ name: 'TdmSceneGround' })

/**
 * 这一层位于 TresCanvas 内部，只收 props、不访问 Pinia
 * （见 DESIGN.md「TD 层不使用 Pinia」）。
 */
const props = withDefaults(
  defineProps<{
    /** 是否显示地面网格 */
    visible?: boolean
    /**
     * 是否铺一块**只接收阴影**的承影面（只有 Shadow Map 方式需要）。
     *
     * 为什么需要它：下面那个 `Grid` 是 cientos 的一个着色器平面，
     * 片元在格子里直接 `discard`，**根本没有「材质接收阴影」这条路**——
     * 它连 `MeshStandardMaterial` 都不是。于是原生 shadow map 在空场景里
     * 投出来的影子找不到落点，表现正是「主光开了投影、画面上什么都没有」。
     * 接触阴影与累积阴影各自在局部 y = 0 画了自己的承影面（`SceneShadows.vue`），
     * 所以这一块只归 `type === 'map'`。
     */
    shadowCatcher?: boolean
    /** 网格平面边长 */
    size?: number
    /** 单格尺寸 */
    cellSize?: number
    /** 单格线宽 */
    cellThickness?: number
    /** 单格线颜色 */
    cellColor?: string
    /** 每多少格出现一条主分隔线 */
    sectionSize?: number
    /** 主分隔线宽 */
    sectionThickness?: number
    /** 主分隔线颜色 */
    sectionColor?: string
    /** 是否使用无限网格 */
    infiniteGrid?: boolean
    /** 开始淡出的距离 */
    fadeDistance?: number
    /** 淡出强度 */
    fadeStrength?: number
    /** 网格是否跟随相机移动 */
    followCamera?: boolean
  }>(),
  {
    visible: true,
    shadowCatcher: false,
    size: 120,
    cellSize: 0.6,
    cellThickness: 0.5,
    cellColor: '#1e293b',
    sectionSize: 5,
    sectionThickness: 1,
    sectionColor: '#334155',
    infiniteGrid: false,
    fadeDistance: 150,
    fadeStrength: 1,
    followCamera: false,
  },
)

/**
 * Grid 的 args 是底层 PlaneGeometry 的构造参数，而不是普通 prop。
 * TresJS 会在 args 变化时重建几何体，所以 size 用 computed 包一层，
 * 既拿到响应式更新，也避免每次渲染都产生新数组导致几何体被反复重建
 * ——computed 只在 size 真正改变时才返回新引用。
 */
const gridArgs = computed<[number, number]>(() => [props.size, props.size])

/**
 * 承影面离网格的高度。
 *
 * 2 毫米而不是 0：与网格共面时两者在深度缓冲里打成平手，2D 档（相机在 110 米高，
 * 那里一个深度单位约 7 毫米）会逐像素闪烁。往上抬 2 毫米是「几何上分开」，
 * 而**真正决定谁赢的是下面材质上的 `polygonOffset`**——这一点与地基板
 * （`SceneFloorplanFoundation.vue` 的 `TOP_GAP`）完全同源，那边有完整推导。
 */
const SHADOW_CATCHER_Y = 0.002

/**
 * 承影面朝上。
 *
 * `PlaneGeometry` 的法线是局部 +z，绕 x 轴转 `-π/2` 之后正好指向世界 +y。
 * 写成模块常量而不是模板里的数组/字面量：TresJS 的 `rotation` 要求 three 的
 * `Euler` 实例，且引用恒定才能避免每次都当成「变了」。
 */
const FLAT_ROTATION = new Euler(-Math.PI / 2, 0, 0)

/**
 * 承影面的位置。
 *
 * x / z 恒为 0、边长取网格的 `size`：它不是另一块「地面」，只是给影子一个落点，
 * 所以跟着可见地面走。**`visible` 为假时它仍然渲染**——地面网格是画给眼睛看的，
 * 而影子是场景内容的一部分，宿主关掉网格不代表要连影子一起关掉（接触阴影
 * 那两档也不看 `ground.visible`）。
 */
const catcherPosition = new Vector3(0, SHADOW_CATCHER_Y, 0)

/**
 * 承影面的不透明度。
 *
 * `ShadowMaterial` 只在**被影子覆盖的像素**上出颜色（黑色），其余像素完全透明；
 * 1.0 会让影子成为一块纯黑，与接触阴影默认的 0.55 差得太多。取同一档，
 * 两种方式切换时浓淡不跳。
 */
const SHADOW_CATCHER_OPACITY = 0.55

</script>

<template>
  <Grid
    v-if="visible"
    :args="gridArgs"
    :cell-size="cellSize"
    :cell-thickness="cellThickness"
    :cell-color="cellColor"
    :section-size="sectionSize"
    :section-thickness="sectionThickness"
    :section-color="sectionColor"
    :infinite-grid="infiniteGrid"
    :fade-distance="fadeDistance"
    :fade-strength="fadeStrength"
    :follow-camera="followCamera"
  />

  <!--
    Shadow Map 的承影面（理由见 `shadowCatcher` 那段）。

    - `ShadowMaterial` 本身透明、只有被影子盖住的像素才出黑色，所以它不改变
      地面的观感，只是把主光投下来的影子接住。
    - `depth-write=false`：它不遮挡任何东西，也让透明队列里排在它后面的
      房间色块（`SceneFloorplanRoom.vue` 的半透明色块）照常叠上去。
    - `polygonOffset` 把承影面按**深度单位**往后推（正数是远离相机）。
      2 毫米的几何缝在 110 米高的 2D 档里不足一个深度单位，光靠它仍会与网格线
      逐像素掷骰子；推 2 个单位之后网格线稳定压在承影面之上，格子里又没有东西
      可抢（Grid 的着色器在空格子 `discard`、不写深度），两边都干净。
    - `receive-shadow` 必须显式写：three 的阴影是**逐对象**判定的，
      不写就是 false，届时这块面在画面上与不存在没有区别。
  -->
  <TresMesh
    v-if="shadowCatcher"
    :position="catcherPosition"
    :rotation="FLAT_ROTATION"
    receive-shadow
  >
    <TresPlaneGeometry :args="gridArgs" />
    <TresShadowMaterial
      :opacity="SHADOW_CATCHER_OPACITY"
      transparent
      :depth-write="false"
      :polygon-offset="true"
      :polygon-offset-factor="0"
      :polygon-offset-units="2"
    />
  </TresMesh>
</template>
