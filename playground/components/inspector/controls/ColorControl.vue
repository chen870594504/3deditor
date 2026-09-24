<script setup lang="ts">
import { computed, ref } from 'vue'

defineOptions({ name: 'ColorControl' })

const props = defineProps<{ modelValue: string; disabled?: boolean }>()
const emit = defineEmits<{ (e: 'update:modelValue', value: string): void }>()

const HEX = /^#[0-9a-f]{6}$/i

/**
 * 配置里的颜色不一定是十六进制——`background` 允许 `transparent`，
 * 而 `<input type="color">` 只认 `#rrggbb`。非法值退成黑色给色块用，
 * 文本输入框里仍然原样显示真实值。
 */
const swatch = computed(() => (HEX.test(props.modelValue) ? props.modelValue : '#000000'))

const draft = ref<string | null>(null)
const display = computed(() => draft.value ?? props.modelValue)

function onText(event: Event) {
  const text = (event.target as HTMLInputElement).value
  draft.value = text
  // 输到一半的「#1e2」不该写进配置，等满了六位才提交
  if (HEX.test(text)) emit('update:modelValue', text.toLowerCase())
}

/**
 * 失焦时收口：只接受十六进制色值，或 `transparent` 这个明确写进类型里的特例。
 * 其余一律丢弃——draft 清空后输入框自动还原成真实值。
 * 让一个解析不了的字符串流进 three 的 Color，报错会发生在渲染循环里，
 * 堆栈完全指不到这个输入框。
 */
function onBlur() {
  const text = (draft.value ?? '').trim().toLowerCase()
  draft.value = null

  if (HEX.test(text) || text === 'transparent') emit('update:modelValue', text)
}
</script>

<template>
  <div class="ed-color">
    <input
      type="color"
      :value="swatch"
      :disabled="disabled"
      aria-label="选择颜色"
      @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
    />
    <input
      type="text"
      spellcheck="false"
      :value="display"
      :disabled="disabled"
      aria-label="颜色值"
      @input="onText"
      @blur="onBlur"
    />
  </div>
</template>
