<script setup lang="ts">
import { sceneName } from '../composables/useEditorState'
import { exitPreview } from '../composables/useSceneActions'

defineOptions({ name: 'PreviewBar' })

/**
 * 右上角那枚 2D / 3D 胶囊在不在（公开 prop `showViewSwitch` 透传下来）。
 *
 * 它只影响下面那句说明：宿主写 `:show-view-switch="false"` 时胶囊不渲染，
 * 「右上角可换视角」就成了假话。关掉时也**不提**「可走进屋里」——漫游入口
 * 只在 2D 里出现，而胶囊不在时界面上没有任何手段切到 2D（机位由配置决定，
 * 进来是 3D 就只能停在 3D）。说明宁可少一句，也不能指一个不存在的按钮。
 *
 * 默认 `true`：这一层不给默认值时，缺失的布尔 prop 会被 Vue 转成 `false`，
 * 于是正常预览里那句提示也会被删掉（见 `SceneViewer` 里同一类注释）。
 */
withDefaults(defineProps<{ viewSwitch?: boolean }>(), { viewSwitch: true })

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
  <div class="tdm-preview-bar">
    <span class="tdm-micro">预览</span>
    <b class="tdm-preview-name">{{ sceneName }}</b>
    <!-- 两种文案的分界见上面 `viewSwitch` 那段：胶囊不在时后半句整句删掉 -->
    <span v-if="viewSwitch" class="tdm-preview-note">只读——模型点不动、绘制工具已收起；右上角可换视角、可走进屋里</span>
    <span v-else class="tdm-preview-note">只读——模型点不动、绘制工具已收起</span>

    <span class="tdm-spacer" />

    <button type="button" class="tdm-btn" @click="exitPreview()">
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
      <span class="tdm-kbd">Esc</span>
    </button>
  </div>
</template>
