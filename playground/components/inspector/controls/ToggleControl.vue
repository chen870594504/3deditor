<script setup lang="ts">
import { computed } from 'vue'

defineOptions({ name: 'ToggleControl' })

const props = defineProps<{ modelValue: boolean; disabled?: boolean }>()
const emit = defineEmits<{ (e: 'update:modelValue', value: boolean): void }>()

/**
 * 默认值取反。
 *
 * 刻意不用 `@click="emit('update:modelValue', !modelValue)"`：
 * 那样写，父组件若因为某种原因没更新值，开关的状态就永远停在原地，
 * 看起来像坏了。反转交给父级、这里只报告意图，实际显示由 modelValue 决定。
 */
function toggle() {
  if (props.disabled) return
  emit('update:modelValue', !props.modelValue)
}

const label = computed(() => (props.modelValue ? '已开启' : '已关闭'))
</script>

<template>
  <button
    type="button"
    class="ed-toggle"
    :class="{ 'ed-toggle--on': modelValue }"
    role="switch"
    :aria-checked="modelValue"
    :aria-label="label"
    :disabled="disabled"
    @click="toggle"
  />
</template>
