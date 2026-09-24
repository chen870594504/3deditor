<script setup lang="ts">
import { computed, useTemplateRef } from 'vue'
import { useSceneStore } from '../../../src'
import { activeTab } from '../../composables/useEditorState'
import { createInspectorTabs } from '../../composables/useInspectorSchema'
import { useRailTip } from '../../composables/useRailTip'
import HistoryPanel from './HistoryPanel.vue'
import FloorplanRoomList from './FloorplanRoomList.vue'
import FloorplanStructureList from './FloorplanStructureList.vue'
import InspectorSection from './InspectorSection.vue'
import ModelList from './ModelList.vue'
import PresetList from './PresetList.vue'

defineOptions({ name: 'InspectorPanel' })

/**
 * schema 只在面板创建时构建一次。
 *
 * 字段本身是静态数据，只有里面的 read / apply 闭包持有 store；
 * 每次切 tab 重建既没必要，也会让 v-for 的 key 无谓地失效。
 */
const tabs = createInspectorTabs()

const current = computed(() => tabs.find((tab) => tab.key === activeTab.value) ?? tabs[0]!)

/** 「模型属性」是唯一有主从结构的一页，布局上要单独对待 */
const isModelTab = computed(() => current.value.key === 'model')

/**
 * 「平面图」页在两节字段之后还要接三份清单（墙 / 门窗 / 房间）。
 *
 * 它们没有做成第三节：一行的内容各不相同（房那行有输入框与色块，另两份是一段
 * 只读的位置说明），还要按下标或 id 定位到配置里的某一条，字段声明那套
 * （一字段一控件、路径是定长字符串）表达不了。序号 03 / 04 / 05 由那两个组件
 * 自己写着，加一节就要跟着改它们。
 */
const isFloorplanTab = computed(() => current.value.key === 'floorplan')

/**
 * 「日照环境」页在两节字段（天空 / 光照）之后接一块「03 场景预设」。
 *
 * 它也是自绘的（`PresetList.vue` 里写着为什么），但不是清单而是四个按钮——
 * 与「平面图」页同一种做法：**定制的块在面板这一层显式接在 schema 各节之后**，
 * 于是「01 天空 → 02 光照 → 03 场景预设」这个顺序在这一段模板里看得见。
 *
 * 这一块原先在左栏（一个独立的「场景预设」页）。搬进来的理由写在
 * `PresetList.vue` 的文件头，一句话说：预设改的就是这一页的字段。
 */
const isSunTab = computed(() => current.value.key === 'sun')

/**
 * 场景里是否还有模型。
 *
 * 「模型属性」这三节的字段路径全都指向 `models.<当前下标>.<字段>`，
 * 空场景下每一条都会读到 `undefined`——渲染出来是一屏空白控件，
 * 比什么都不显示更像坏了。所以空场景只留下拉列表那句提示。
 *
 * 它同时也是「上下分栏」的开关：空场景时下面那 3/5 没有任何东西可放，
 * 分出来就是一大片空白，不如让列表照常铺满整页。
 */
const hasModels = computed(() => useSceneStore().models.length > 0)

const inspectorRef = useTemplateRef<HTMLElement>('inspector')

/** 悬停提示的坐标推导在 useRailTip 里，左栏导轨用的是同一份 */
const { tip, showTip, hideTip } = useRailTip(() => inspectorRef.value)
</script>

<template>
  <aside class="ed-col ed-col--right">
    <nav ref="inspector" class="ed-inspector">
      <!--
        图标导轨。
        7 个中文标签横排要 420px 以上，右栏总共才 306px，
        所以导轨只占 40px、固定用图标表示；名称由悬停提示和 aria-label 补上。
        图标路径本身在 useInspectorSchema 的 NAV_ICONS 里声明。
      -->
      <div class="ed-rail" @mouseleave="hideTip">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          type="button"
          class="ed-rail-item"
          :class="{ 'ed-rail-item--active': tab.key === activeTab }"
          :aria-label="tab.label"
          :aria-current="tab.key === activeTab"
          @click="activeTab = tab.key"
          @mouseenter="showTip(tab.label, $event)"
          @focus="showTip(tab.label, $event)"
          @blur="hideTip"
        >
          <!-- 描边粗细/端点交给 CSS，fill 由属性决定：两者控制不同的属性，不会互相覆盖 -->
          <svg class="ed-rail-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path
              v-for="(part, i) in tab.icon"
              :key="i"
              :d="part.d"
              :fill="part.fill ? 'currentColor' : 'none'"
            />
          </svg>
        </button>
      </div>

      <!--
        提示挂在 .ed-inspector 下、导轨之外：导轨是滚动容器，
        提示放在里面就可能被它的裁剪范围吃掉。
      -->
      <span v-if="tip" class="ed-rail-tip" :style="{ top: `${tip.top}px` }">{{ tip.label }}</span>

      <!-- key 绑 tab：切 tab 时整块重建，让 tabpanel 的淡入动画每次都能重放 -->
      <div
        :key="current.key"
        class="ed-inspector-body ed-scroll ed-tabpanel"
        :class="{ 'ed-inspector-body--split': isModelTab && hasModels }"
      >
        <HistoryPanel v-if="current.key === 'history'" />
        <template v-else-if="isModelTab">
          <!--
            「模型属性」这一页是主从结构：上面是场景里的模型列表，下面是选中那个的属性。
            列表自己带表头与空态提示，所以它不吃 hasModels 的 v-if。
          -->
          <ModelList />
          <!--
            两块各自滚动：模型多到装不下时列表自己在框内滚，不动下面的字段；
            字段长到装不下时也不把列表顶走。比例写在 .ed-inspector-body--split 里。
          -->
          <div v-if="hasModels" class="ed-models-detail ed-scroll">
            <InspectorSection
              v-for="section in current.sections"
              :key="section.index"
              :section="section"
            />
          </div>
        </template>
        <template v-else-if="isFloorplanTab">
          <!--
            两节字段（墙体 / 地基）+ 三份清单（墙 / 门窗 / 房间）。
            三份清单都不在 `current.sections` 里，所以它们没有跟着上面两节一起被
            v-for 出去，得在这里显式接上——顺序就是
            「01 墙体 → 02 地基 → 03 墙 → 04 门窗 → 05 房间」。
          -->
          <InspectorSection v-for="section in current.sections" :key="section.index" :section="section" />
          <FloorplanStructureList />
          <FloorplanRoomList />
        </template>
        <template v-else-if="isSunTab">
          <!-- 顺序就是「01 天空 → 02 光照 → 03 场景预设」，最后那块不来自 current.sections -->
          <InspectorSection v-for="section in current.sections" :key="section.index" :section="section" />
          <PresetList />
        </template>
        <template v-else>
          <InspectorSection v-for="section in current.sections" :key="section.index" :section="section" />
        </template>
      </div>
    </nav>
  </aside>
</template>
