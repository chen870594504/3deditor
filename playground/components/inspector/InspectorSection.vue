<script setup lang="ts">
import { computed, ref } from 'vue'
import { useSceneStore } from '../../../src'
import type { SectionDef } from '../../composables/useInspectorSchema'
import InspectorField from './InspectorField.vue'

defineOptions({ name: 'InspectorSection' })

const props = defineProps<{ section: SectionDef }>()

const scene = useSceneStore()

/**
 * 整节的显隐。
 *
 * 判据收在 `SectionDef.when` 里（那里写着为什么需要它：阴影那三组参数
 * 各管一种实现方式，只有一组是活的）。放在这个组件里而不是各个调用点，
 * 是因为「属性面板」有四处都在 `v-for` 同一批分区——模型页、平面图页、
 * 日照环境页与其余各页——收在这里，四处一起生效，而且以后新加的分区
 * 天生就带这个能力。
 */
const visible = computed(() => props.section.when?.(scene.config) ?? true)

/**
 * 折叠状态是组件本地状态。
 *
 * 它不写进 store，也不进历史栈：展开收起是「我怎么看这个面板」，
 * 不是「这个场景长什么样」。撤销按钮不该把某个分组折起来。
 */
const open = ref(props.section.open ?? true)
</script>

<template>
  <section v-if="visible" class="ed-sec" :class="{ 'ed-sec--closed': !open }">
    <button type="button" class="ed-sec-head" :aria-expanded="open" @click="open = !open">
      <span class="ed-sec-idx">{{ section.index }}</span>
      <span class="ed-sec-title">{{ section.title }}</span>
      <span class="ed-sec-caret" />
    </button>

    <div class="ed-sec-body">
      <InspectorField v-for="field in section.fields" :key="field.key" :field="field" />
    </div>
  </section>
</template>
