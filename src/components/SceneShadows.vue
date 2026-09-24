<script setup lang="ts">
import { AccumulativeShadows, ContactShadows } from '@tresjs/cientos'
import type { ShadowType } from '../types'

defineOptions({ name: 'TdmSceneShadows' })

/**
 * 这一层位于 TresCanvas 内部，只收 props、不访问 Pinia
 * （见 README「TD 层不使用 Pinia」）。
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
    type: 'contact',
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
 * 统一把承影面抬高 4mm：在这个尺度下肉眼不可见，但足以让深度测试分出胜负。
 * 放在外层 Group 上而不是各自组件内部，是因为两者都没有 position prop，
 * 而 cientos 的 Sky 之外的组件也不保证会透传 attrs。
 */
const SHADOW_PLANE_LIFT = 0.004
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
