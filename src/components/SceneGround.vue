<script setup lang="ts">
import { computed } from 'vue'
import { Grid } from '@tresjs/cientos'

defineOptions({ name: 'TdmSceneGround' })

/**
 * 这一层位于 TresCanvas 内部，只收 props、不访问 Pinia
 * （见 DESIGN.md「TD 层不使用 Pinia」）。
 */
const props = withDefaults(
  defineProps<{
    /** 是否显示地面网格 */
    visible?: boolean
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
</template>
