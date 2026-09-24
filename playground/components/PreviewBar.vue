<script setup lang="ts">
import { sceneName } from '../composables/useEditorState'
import { exitPreview } from '../composables/useSceneActions'

defineOptions({ name: 'PreviewBar' })

/**
 * 预览窗口顶上那一条。
 *
 * 它是**窗口的标题栏**，只做三件事：说明这是什么、说明现在能做什么、
 * 给一个看得见的出口。
 *
 * 第三条不是装饰。改成浮层之前，进预览的唯一出口是 Esc，而那句
 * 「进入预览模式（Esc 退出）」走的是 `pushEvent`——**只往控制台打日志**，
 * 用户在界面上根本看不见（`useEditorState.ts` 里那条注释写得很清楚：
 * 编辑器没有 toast 体系）。于是点一下「预览」的体验是「整页换掉了，
 * 不知道怎么回去」。所以这一条横杆存在的主要理由是**那个按钮**，
 * 其余的说明文字是顺带。
 *
 * 它自己不持有任何状态：进出都走 `useSceneActions` 那对函数，
 * 与按钮、Esc 是同一条路径（那两条已经有各自的触发器，这里不新开一条）。
 */
</script>

<template>
  <div class="ed-preview-bar">
    <span class="ed-micro">预览</span>
    <b class="ed-preview-name">{{ sceneName }}</b>
    <span class="ed-preview-note">只读——模型点不动、相机不响应拖拽、绘制工具已收起</span>

    <span class="ed-spacer" />

    <button type="button" class="ed-btn" @click="exitPreview()">
      <!-- 四角箭头朝内，与顶栏「预览」那枚朝外的正好相反 -->
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M9 4v4a1 1 0 0 1-1 1H4" />
        <path d="M15 4v4a1 1 0 0 0 1 1h4" />
        <path d="M4 15h4a1 1 0 0 1 1 1v4" />
        <path d="M20 15h-4a1 1 0 0 0-1 1v4" />
      </svg>
      退出预览
      <span class="ed-kbd">Esc</span>
    </button>
  </div>
</template>
