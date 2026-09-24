<script setup lang="ts">
import { computed } from 'vue'
import NumberControl from './NumberControl.vue'

defineOptions({ name: 'VectorControl' })

const props = withDefaults(
  defineProps<{
    modelValue: [number, number, number]
    step?: number
    precision?: number
    disabled?: boolean
  }>(),
  { step: 0.1, precision: 2, disabled: false },
)

const emit = defineEmits<{ (e: 'update:modelValue', value: [number, number, number]): void }>()

/**
 * 每个分量一个可写 computed。
 *
 * 写入时构造新元组整体提交，而不是就地改 `modelValue[index]`——
 * 这样 store 里那次赋值的粒度就是「一次完整的向量修改」，
 * 历史面板上记的是「相机 · 位置」一条，而不是三个分量各一条。
 */
function makeCell(index: 0 | 1 | 2) {
  return computed({
    get: () => props.modelValue[index],
    set: (value: number) => {
      const next: [number, number, number] = [...props.modelValue]
      next[index] = value
      emit('update:modelValue', next)
    },
  })
}

const x = makeCell(0)
const y = makeCell(1)
const z = makeCell(2)
</script>

<template>
  <div class="ed-vector">
    <div class="ed-vector-cell">
      <span class="ed-vector-axis">X</span>
      <NumberControl v-model="x" :step="step" :precision="precision" :disabled="disabled" />
    </div>
    <div class="ed-vector-cell">
      <span class="ed-vector-axis">Y</span>
      <NumberControl v-model="y" :step="step" :precision="precision" :disabled="disabled" />
    </div>
    <div class="ed-vector-cell">
      <span class="ed-vector-axis">Z</span>
      <NumberControl v-model="z" :step="step" :precision="precision" :disabled="disabled" />
    </div>
  </div>
</template>
