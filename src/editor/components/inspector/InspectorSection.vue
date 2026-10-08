<script setup lang="ts">
import { computed, ref } from 'vue'
import { useSceneStore } from '../../../stores/scene'
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
  <!--
    根元素是 `div` 而不是 `section`，理由与两栏那两处（SidePanel.vue / InspectorPanel.vue）
    同源：宿主按**标签**写的全局样式会整片压上来，而 `.tdm-root` 的作用域只赢
    「两边都声明了的属性」。这一处比那两处更密——属性面板每一页都是若干个这一块，
    宿主一条 `section { padding: 8px 24px; margin-bottom: 20px }` 就能把每一节都推出
    一圈内边距、彼此拉开一条缝（**不报错**，只有眼睛看得出来）。
    切成 `div` 不损失语义：这里的 `section` **没有可访问名**（标题在折叠按钮里面、
    不是 `aria-labelledby` 指过来的），所以它本来就不是 region 地标，读屏那边没有变化。
    这一条同守 `scripts/smoke.mjs` 里那条「容器根不用语义标签」的源码扫描。
  -->
  <div v-if="visible" class="tdm-sec" :class="{ 'tdm-sec--closed': !open }">
    <button type="button" class="tdm-sec-head" :aria-expanded="open" @click="open = !open">
      <span class="tdm-sec-idx">{{ section.index }}</span>
      <span class="tdm-sec-title">{{ section.title }}</span>
      <span class="tdm-sec-caret" />
    </button>

    <div class="tdm-sec-body">
      <InspectorField v-for="field in section.fields" :key="field.key" :field="field" />
    </div>
  </div>
</template>
