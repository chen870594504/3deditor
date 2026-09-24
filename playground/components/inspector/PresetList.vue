<script setup lang="ts">
import { computed } from 'vue'
import { useSceneStore } from '../../../src'
import { SCENE_PRESETS, activePresetKey } from '../../composables/usePresets'
import { pushEvent } from '../../composables/useEditorState'

defineOptions({ name: 'PresetList' })

/**
 * 「日照环境」页的第三块：四个时间点的光照与光影预设。
 *
 * ## 为什么它是一块自绘清单，而不是 schema 里的一节
 *
 * 与「平面图」页那三份清单（`FloorplanStructureList` 等）同一条理由：schema 那套是
 * **一个字段一个控件**，而这里的四行不是字段——它们不读也不写某一个配置项，
 * 点一下是**一次 `applyConfig`**（打一个含 sun+shadow 两组的补丁）。硬塞进
 * `select` 也表达不了：高亮不是「当前值等于某个选项」，而是「当前配置整个命中
 * 某个补丁」，见下面 `activePreset`。
 *
 * 它加在这一页的两节字段之后，序号是紧接的 03。**序号由本组件自己写着**，
 * 与那三份清单一致——schema 那一层不知道它存在（见 `useInspectorSchema` 里
 * 日照环境那节末尾的注释）。
 *
 * ## 它是从左栏搬过来的
 *
 * 原先左栏是「图标导轨 + 场景预设页 + 模型库」，预设与光照的那些字段隔着半个屏幕；
 * 现在预设就贴在「太阳高度 / 三盏灯强度 / 阴影」那几行旁边，点一下就能看见
 * 面板里的数字跟着动。左栏因此只剩模型库一类东西，导轨上那七个分类不再与
 * 一个「页面」混在同一个列表里。
 */
const scene = useSceneStore()

/**
 * 高亮由配置反推，而不是记住「上次点了谁」——手动改完参数高亮会自动消失。
 *
 * 判据只有补丁里那十几个数（`matches` 逐项比），所以挪相机、关地面、换天空盒
 * 都不会把高亮弄灭。
 */
const activePreset = computed(() => activePresetKey(scene.config))

function applyPreset(key: string) {
  const preset = SCENE_PRESETS.find((item) => item.key === key)
  if (!preset) return

  // 显式给标签：预设是有语义的一步操作，历史里不该出现自动拼出来的「相机 · 地面 · 日照环境」
  scene.applyConfig(preset.patch, `预设 · ${preset.label}`)
  pushEvent(`应用预设「${preset.label}」`)
}
</script>

<template>
  <div class="ed-preset">
    <div class="ed-preset-head">
      <span class="ed-sec-idx">03</span>
      <span class="ed-sec-title">场景预设</span>
    </div>

    <div class="ed-list">
      <!--
        用 .ed-item / .ed-item-note：这四个按钮的观感与左栏那些分类项一模一样
        （整行点击、悬停变亮、左侧一道琥珀条标出当前命中哪个），换一套样式
        只会让「同一类东西长得不一样」。它不是 .ed-item--active 的既有语义吗？
        是——所以这里连 hover 与激活态都不用重写。
      -->
      <button
        v-for="preset in SCENE_PRESETS"
        :key="preset.key"
        type="button"
        class="ed-item"
        :class="{ 'ed-item--active': preset.key === activePreset }"
        :title="`应用预设「${preset.label}」`"
        @click="applyPreset(preset.key)"
      >
        {{ preset.label }}
        <span class="ed-item-note">{{ preset.note }}</span>
      </button>

      <!--
        脚注写在列表**里面**（不是外面），因此白拿 `.ed-list` 那 5px 内边距，
        与上面四个按钮**左对齐**；换成 12px 会多缩进一截，看起来像另一层级的说明。

        **它是这一页唯一说清「预设管到哪」的地方，不能省。** 预设曾经连相机、
        地面、底色、环境贴图一起改，收窄成「只管光照与光影」之后，若不说一句，
        用户点下去看见画面只有明暗变了，第一反应是预设坏了。最后那句给的是
        **例外**：累积阴影那一组参数一改就要重烘 40 帧，所以预设一个字都不写它，
        不说的话，用累积阴影的人会以为预设对影子失效了。
      -->
      <p class="ed-hint ed-hint--quiet">
        预设只改光照与光影——主光的角度、三盏灯的强弱、接触阴影的浓淡与柔度。相机、地面、底色、天空盒都原样不动（各有各的地方：本栏「阴影」「地面」两页，左栏「地板」「天空盒」两类），切换因此是瞬时的。用累积阴影时只有光会变：那一组参数改一次要重烘 40 帧，所以预设不碰。
      </p>
    </div>
  </div>
</template>
