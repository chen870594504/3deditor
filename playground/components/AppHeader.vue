<script setup lang="ts">
import { computed, ref } from 'vue'
import { useSceneStore } from '../../src'
import { useConfigIO } from '../composables/useConfigIO'
import { sceneName } from '../composables/useEditorState'
import { redo, togglePreview, undo } from '../composables/useSceneActions'

defineOptions({ name: 'AppHeader' })

const scene = useSceneStore()
const { dirty, everSaved, savedLabel, exportFile, importFile, saveScene } = useConfigIO()

/** 隐藏的 file input：导入按钮点它，视觉部分完全自绘 */
const filePicker = ref<HTMLInputElement>()

/** 三态保存点：灰=从未保存，琥珀=有改动，绿=已保存 */
const dotClass = computed(() => {
  if (dirty.value) return 'ed-dot ed-dot--dirty'
  return everSaved.value ? 'ed-dot ed-dot--saved' : 'ed-dot'
})

const dotTitle = computed(() => {
  if (dirty.value) return '有未保存的改动'
  return everSaved.value ? `已保存于 ${savedLabel.value}` : '尚未保存'
})

function pickFile() {
  filePicker.value?.click()
}

async function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) await importFile(file)
  // 清空以便连续导入同一个文件时也能触发 change
  input.value = ''
}
</script>

<template>
  <header class="ed-header">
    <div class="ed-brand">
      <!-- 轴测立方体：外轮廓用发丝灰，三条内棱用琥珀，暗示「可建造的结构」 -->
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M12 2.4 20.4 7v10L12 21.6 3.6 17V7z"
          stroke="var(--text-lo)"
          stroke-width="1.1"
          stroke-linejoin="round"
        />
        <path d="M12 2.4v9.6" stroke="var(--signal)" stroke-width="1.4" />
        <path d="M12 12 3.6 7" stroke="var(--signal)" stroke-width="1.4" />
        <path d="m12 12 8.4-5" stroke="var(--signal)" stroke-width="1.4" />
      </svg>
      <span class="ed-brand-name">3DMAKER</span>
    </div>

    <div class="ed-scene-name">
      <span class="ed-header-divider" />
      <input v-model="sceneName" spellcheck="false" aria-label="场景名称" />
      <span :class="dotClass" :title="dotTitle" />
      <span class="ed-micro">{{ dirty ? '未保存' : savedLabel }}</span>
    </div>

    <div class="ed-actions">
      <input
        ref="filePicker"
        type="file"
        accept=".json,application/json"
        class="hidden"
        @change="onFileChange"
      />

      <button type="button" class="ed-btn" @click="pickFile">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M12 3v12m0 0 4-4m-4 4-4-4" />
          <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
        </svg>
        导入配置
      </button>

      <button type="button" class="ed-btn" @click="exportFile">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M12 15V3m0 0 4 4m-4-4-4 4" />
          <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
        </svg>
        导出配置
      </button>

      <span class="ed-header-divider" />

      <button type="button" class="ed-btn" :disabled="!scene.canUndo" @click="undo()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M9 14 4 9l5-5" />
          <path d="M4 9h10a6 6 0 0 1 0 12h-3" />
        </svg>
        撤销
        <span class="ed-kbd">⌘Z</span>
      </button>

      <button type="button" class="ed-btn" :disabled="!scene.canRedo" @click="redo()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="m15 14 5-5-5-5" />
          <path d="M20 9H10a6 6 0 0 0 0 12h3" />
        </svg>
        重做
        <span class="ed-kbd">⌘⇧Z</span>
      </button>

      <span class="ed-header-divider" />

      <button type="button" class="ed-btn" @click="togglePreview()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M4 9V5a1 1 0 0 1 1-1h4M20 15v4a1 1 0 0 1-1 1h-4M15 4h4a1 1 0 0 1 1 1v4M9 20H5a1 1 0 0 1-1-1v-4" />
        </svg>
        预览
      </button>

      <button type="button" class="ed-btn ed-btn--primary" @click="saveScene">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M5 3h11l3 3v15a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
          <path d="M8 3v6h7V3M8 21v-7h8v7" />
        </svg>
        保存
        <span class="ed-kbd">⌘S</span>
      </button>
    </div>
  </header>
</template>
