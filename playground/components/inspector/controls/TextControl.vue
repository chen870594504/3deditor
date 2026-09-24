<script setup lang="ts">
import { computed, ref } from 'vue'

defineOptions({ name: 'TextControl' })

const props = withDefaults(
  defineProps<{
    modelValue: string
    placeholder?: string
    disabled?: boolean
    /**
     * 只读。
     *
     * 刻意不复用 disabled：灰显的输入框点不动、内容也选不中，
     * 而只读字段（比如从地址派生出来的模型 id）恰恰是要拿来复制的。
     */
    readonly?: boolean
  }>(),
  { placeholder: '', disabled: false, readonly: false },
)

const emit = defineEmits<{ (e: 'update:modelValue', value: string): void }>()

/**
 * 只在失焦或回车时提交，输入过程中不回写。
 *
 * 这个控件目前唯一的用途是模型地址，而写一次地址就会触发一次模型加载。
 * 边打字边提交，等于每敲一个字符都去拉一次 glTF。
 */
const focused = ref(false)
const draft = ref('')

const display = computed(() => (focused.value ? draft.value : props.modelValue))

function onFocus() {
  focused.value = true
  draft.value = props.modelValue
}

function commit() {
  if (!focused.value) return
  focused.value = false

  const next = draft.value.trim()
  if (next !== props.modelValue) emit('update:modelValue', next)
}

/** Esc 放弃这次编辑：先摘掉焦点标记再失焦，blur 里的 commit 就成了空转 */
function onKeydown(event: KeyboardEvent) {
  const input = event.target as HTMLInputElement

  if (event.key === 'Enter') input.blur()
  else if (event.key === 'Escape') {
    focused.value = false
    input.value = props.modelValue
    input.blur()
  }
}
</script>

<template>
  <input
    class="ed-text"
    type="text"
    spellcheck="false"
    :value="display"
    :placeholder="placeholder"
    :readonly="readonly"
    :disabled="disabled"
    @focus="onFocus"
    @input="draft = ($event.target as HTMLInputElement).value"
    @blur="commit"
    @keydown="onKeydown"
  />
</template>
