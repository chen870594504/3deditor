<script setup lang="ts">
import { AccumulativeShadows, ContactShadows } from '@tresjs/cientos'
import type { ShadowType } from '../types'

defineOptions({ name: 'TdmSceneShadows' })

/**
 * 这一层位于 TresCanvas 内部，只收 props、不访问 Pinia
 * （见 DESIGN.md「TD 层不使用 Pinia」）。
 */
const props = withDefaults(
  defineProps<{
    /** 阴影实现方式 */
    type?: ShadowType
    /**
     * 重新烘焙令牌。
     *
     * ContactShadows 与 AccumulativeShadows 都是「烘一次、之后不再更新」的，
     * 而它们在挂载的第一帧就开始烘焙——那时 glTF 还没加载完，
     * 深度图里是空的，阴影会永远缺失。
     * 把这个令牌绑到 key 上，几何变化时重建组件即可重新烘焙。
     */
    revision?: number

    /** 接触阴影不透明度 */
    contactOpacity?: number
    /** 接触阴影模糊半径 */
    contactBlur?: number
    /** 接触阴影采样范围 */
    contactScale?: number
    /** 接触阴影渲染分辨率 */
    contactResolution?: number

    /** 累积帧数 */
    accFrames?: number
    /** 累积阴影不透明度 */
    accOpacity?: number
    /** 累积阴影采样范围 */
    accScale?: number
    /** 累积混合强度 */
    accBlend?: number
  }>(),
  {
    /**
     * 与 `DEFAULT_SCENE_CONFIG.shadow.type` 保持一致（`'map'`，见设计决定 61）。
     *
     * 这个兜底只在「没有走配置」时才用得到（`SceneContent` 总是显式传
     * `shadow.type`）；但两处不一致的代价是同一个场景在两条路上默认出两种阴影，
     * 而 `'map'` 这一档在本组件里**什么都不渲染**——影子由主光实时投出，
     * 看起来与「阴影没开」一样，只有对照配置才分得清。
     */
    type: 'map',
    revision: 0,
    contactOpacity: 0.55,
    contactBlur: 2.4,
    contactScale: 12,
    contactResolution: 512,
    accFrames: 40,
    accOpacity: 0.9,
    accScale: 12,
    accBlend: 30,
  },
)

/**
 * 两种阴影都会把自己的承影平面画在各自的局部 y = 0，
 * 和地面网格完全共面，深度测试打成平手，结果是整块阴影消失。
 *
 * 原先只把承影面抬高 4mm，只够躲开网格——**躲不开户型图**。地基板顶面在
 * `y = 0.005`（`SceneFloorplanFoundation.vue` 的 `TOP_GAP`），房间色块在
 * `y = 0.035`（`SceneFloorplanRoom.vue` 的 `FLOOR_Y`），两层都在 4mm 之上：
 * 承影面被它们整块盖住，于是「有地基的房子」里接触阴影**完全看不见**
 * （那时它还是默认方式——太阳怎么调都没用，看着就像阴影功能坏了）。
 *
 * 抬到色块之上（5cm）还有第二个作用：两种烘焙都是「在承影面高度架一台
 * 朝上的正交相机、把场景渲成深度」的，**低于承影面的东西根本不在相机里**。
 * 地基与房间色块因此不会被烘进深度图——否则它们会各自铺满整张图，
 * 烘出一块均匀的黑。家具、墙、模型都在 5cm 之上，照常进图。
 *
 * 这两条是接触阴影自己的事：它现在不是默认方式了（设计决定 61），但用户
 * 切到它、或者宿主显式写 `shadow.type: 'contact'` 时，抬高的必要性一点没变
 * ——早先「太阳怎么调都没用」就是在默认方式为接触阴影时踩出来的。
 *
 * 5cm 在建筑尺度上肉眼不可见，也不会撞上任何别的东西（房间色块 3.5cm）。
 * 往上再加就要担心与窗台、踢脚线打架，往下减则会被地板盖住。
 */
const SHADOW_PLANE_LIFT = 0.05
</script>

<template>
  <!--
    type === 'map' 时不渲染任何东西：
    原生 shadow map 完全由 SceneSun 里主光的 cast-shadow
    和 TresCanvas 的 shadows 开关驱动。
  -->
  <TresGroup v-if="type !== 'map'" :position-y="SHADOW_PLANE_LIFT">
    <ContactShadows
      v-if="type === 'contact'"
      :key="`contact-${revision}`"
      :opacity="contactOpacity"
      :blur="contactBlur"
      :scale="contactScale"
      :resolution="contactResolution"
      :frames="1"
    />

    <AccumulativeShadows
      v-else
      :key="`accumulative-${revision}`"
      :frames="accFrames"
      :opacity="accOpacity"
      :scale="accScale"
      :blend="accBlend"
    />
  </TresGroup>
</template>
