<script setup lang="ts">
import type { FieldOption } from '../../../composables/useInspectorSchema'

defineOptions({ name: 'SelectControl' })

const props = defineProps<{
  modelValue: string | number
  options: FieldOption[]
  disabled?: boolean
}>()

const emit = defineEmits<{ (e: 'update:modelValue', value: string | number): void }>()

/**
 * `<option>` 的 value 只能是字符串，所以不能直接把 DOM 上的值回传。
 * 用字符串反查原始选项，配置里的 number 字段（mapSize、contactResolution）
 * 才不会在切换一次之后悄悄变成字符串。
 */
function onChange(event: Event) {
  const raw = (event.target as HTMLSelectElement).value
  const matched = props.options.find((option) => String(option.value) === raw)
  emit('update:modelValue', matched ? matched.value : raw)
}
</script>

<template>
  <select class="ed-select" :disabled="disabled" :value="String(modelValue)" @change="onChange">
    <option v-for="option in options" :key="String(option.value)" :value="String(option.value)">
      {{ option.label }}
    </option>
  </select>
</template>
