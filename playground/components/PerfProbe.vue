<script setup lang="ts">
import { useLoop } from '@tresjs/core'
import type { WebGLRenderer } from 'three'
import type { SceneStats } from '../../src'

defineOptions({ name: 'PerfProbe' })

/**
 * 渲染统计探针。
 *
 * 它通过 SceneViewer 的 #scene 插槽注入画布内部——这是插槽存在的意义之一：
 * 宿主可以在不修改插件的前提下往场景里塞自己的东西。
 *
 * 这个组件被 TresJS 当成一个渲染返回 null 的节点，会被安全跳过，
 * 不会在场景图里留下任何东西（cientos 的 Stats / BakeShadows 也是这么写的）。
 */
const emit = defineEmits<{
  (e: 'stats', payload: SceneStats): void
}>()

/**
 * 上报间隔。
 *
 * 每帧 emit 会让整个编辑器跟着每帧重渲染，得不偿失；
 * 而读数本身也不需要比人眼更快。2Hz 足够把「相机面板跳数」这类问题
 * 暴露出来，又不会让 Vue 成为新的瓶颈。
 */
const REPORT_INTERVAL = 0.5

const { onRender } = useLoop()

let frames = 0
let elapsed = 0

// onRender 返回的 { off } 会随组件作用域自动注销，无需手动清理
onRender(({ delta, renderer }) => {
  frames += 1
  elapsed += delta

  if (elapsed < REPORT_INTERVAL) return

  const info = (renderer as WebGLRenderer).info

  emit('stats', {
    fps: Math.round(frames / elapsed),
    triangles: info.render.triangles,
    drawCalls: info.render.calls,
  })

  frames = 0
  elapsed = 0
})
</script>

<template>
  <!-- 渲染返回 null 的组件：TresJS 有专门分支跳过，不会污染场景图 -->
</template>
