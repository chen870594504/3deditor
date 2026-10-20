<script setup lang="ts">
import { computed } from 'vue'
import { Euler, Vector3 } from 'three'
import { walkMarker } from '../composables/useWalkMode'

defineOptions({ name: 'SceneWalkMarker' })

/**
 * 平面图上那枚「第一人称起点」标记。
 *
 * 它**由 `SceneCanvas` 渲染在 `TresCanvas` 内部**，与视角胶囊、漫游入口
 * 同属画布自己的能力：编辑态与纯画布（`editable: false`）看到的
 * 是同一个起点标记（见 DESIGN.md 设计决定 70）。
 *
 * 它**直接读 `useWalkMode` 的模块级状态**而不是收 props：起点不是场景的一部分
 * （见 `useWalkMode.ts`），所以它不能、也不该出现在库的配置面或导出物里。
 * 这也意味着标记与入口天然同步——两处都从同一个模块读，不存在「入口放了个点、
 * 标记却画在别处」的两份状态。
 *
 * 造型是**一个环 + 一根针 + 一颗头**：俯视（落点的实际视角）时看到的是环里一个点，
 * 侧视时是一枚立着的记号。不用箭头表示朝向——进入漫游时的朝向是「面朝地基中心」，
 * 由户型决定，这里画一个固定方向的箭头只会指错。
 *
 * 颜色沿用草稿的琥珀：它同样表示「这里即将发生一件还没发生的事」。
 */
const position = computed(() => {
  const point = walkMarker.value
  return point ? new Vector3(point[0], 0, point[1]) : null
})

/*
  几何参数与位置都必须是模块级常量：模板里的数组 / 对象字面量每次渲染都是新引用，
  而 `args` 换引用会让 TresJS **重建几何体**（理由与 `SceneFloorplanDraft.vue`
  里 `UNIT_BOX` 那段相同）。这枚标记在拖动落点时会跟着指针每次移动重渲染，
  按字面量写就是每一步重建三个几何体。
*/
const RING_ARGS: [number, number, number] = [0.34, 0.46, 40]
const BODY_ARGS: [number, number, number, number] = [0.09, 0.09, 1, 12]
const HEAD_ARGS: [number, number, number] = [0.17, 20, 14]

/** 环躺在水平面上：默认的环在局部 XY 平面，绕 X 转 -90° 之后朝上 */
const RING_ROTATION = new Euler(-Math.PI / 2, 0, 0)
const RING_POSITION = new Vector3(0, 0.03, 0)
const BODY_POSITION = new Vector3(0, 0.62, 0)
const HEAD_POSITION = new Vector3(0, 1.24, 0)
</script>

<template>
  <TresGroup v-if="position" :position="position">
    <TresMesh :position="RING_POSITION" :rotation="RING_ROTATION">
      <TresRingGeometry :args="RING_ARGS" />
      <TresMeshBasicMaterial
        color="#fbbf24"
        :opacity="0.75"
        transparent
        :depth-write="false"
      />
    </TresMesh>

    <TresMesh :position="BODY_POSITION">
      <TresCylinderGeometry :args="BODY_ARGS" />
      <TresMeshBasicMaterial color="#f59e0b" :depth-write="false" />
    </TresMesh>

    <TresMesh :position="HEAD_POSITION">
      <TresSphereGeometry :args="HEAD_ARGS" />
      <TresMeshBasicMaterial color="#fbbf24" :depth-write="false" />
    </TresMesh>
  </TresGroup>
</template>
