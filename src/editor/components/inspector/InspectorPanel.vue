<script setup lang="ts">
import { computed, ref, useTemplateRef } from 'vue'
import { useSceneStore } from '../../../stores/scene'
import { activeTab } from '../../composables/useEditorState'
import type { InspectorTab } from '../../composables/useEditorState'
import { createInspectorTabs } from '../../composables/useInspectorSchema'
import { useRailTip } from '../../composables/useRailTip'
import { ICON_HOST_FALLBACK } from '../../utils/panelIcons'
import { INSPECTOR_TAB_PREFIX } from '../../utils/panelSlots'
import type { EditorPanelTab } from '../../../types'
import HistoryPanel from './HistoryPanel.vue'
import FloorplanRoomList from './FloorplanRoomList.vue'
import FloorplanStructureList from './FloorplanStructureList.vue'
import InspectorSection from './InspectorSection.vue'
import ModelList from './ModelList.vue'
import PresetList from './PresetList.vue'

defineOptions({ name: 'InspectorPanel' })

const props = withDefaults(
  defineProps<{
    /**
     * 宿主**追加**的页：接在那七个内置页之后（`#inspector-tab-<key>` 插槽）。
     *
     * 与左栏那个 `tabs` 是同一条路数、同一份类型，只是挂在另一根导轨上。
     * 命名空间也各是各的：左右两边都叫 `device` 互不影响。
     *
     * 不传时导轨上只有那七个内置页，正文那个 `v-if` 链的第一支恒为假，
     * 整块与没有这个 prop 之前逐字一致。
     *
     * 顺带一句左栏没有的：右栏只有 **306px** 宽，宿主页的正文要自己管好横向
     * 溢出（内置那几页都是 `tdm-scroll` + 定宽控件这么做的）。
     */
    tabs?: EditorPanelTab[]
  }>(),
  { tabs: () => [] },
)

/**
 * schema 只在面板创建时构建一次。
 *
 * 字段本身是静态数据，只有里面的 read / apply 闭包持有 store；
 * 每次切 tab 重建既没必要，也会让 v-for 的 key 无谓地失效。
 *
 * **叫 `builtinTabs` 而不是 `tabs`**：后者现在是宿主追加的那一份（上面的 prop）。
 * 内置七页与宿主页在下面各处是分开算的，合成一个数组只会让
 * 「`current.sections` 在宿主页上不存在」这件事藏进类型里。
 */
const builtinTabs = createInspectorTabs()

/**
 * 当前停在哪个**宿主页**。`null` = 没停在宿主页上（导轨亮的是内置那一格）。
 *
 * 与左栏那个 `activePageKey` 同一条路数：**本组件本地状态，不进 `useEditorState`**
 * ——整个仓库只有这一处读它。内置那一格仍然住在 `activeTab` 里（它是公开导出，
 * 宿主自己画顶栏时按的就是它）。
 *
 * 两者是**互斥**的，`litKey` 管这件事：宿主页一旦选上，`activeTab` 就只是
 * 「上次停在内置的哪一页」——点宿主页**不动它**，于是宿主把那一页撤掉时，
 * 落回的是用户上一刻停的那一页，而不是第一页。
 */
const hostTabKey = ref<string | null>(null)

/**
 * 当前停在哪个**宿主页**。（`undefined` = 没停在宿主页上，或者宿主把这一页撤掉了。）
 *
 * 判据取「数组里还在不在」而不是直接比 key：宿主中途把一个 tab 从数组里拿掉时，
 * `hostTabKey` 会留在那个已经不存在的 key 上，只看它就会停在一页空白上。
 * 过一遍 `find` 之后，撤页的表现是**落回内置那一页**——与左栏那个兜底同一个走向。
 * 重新加回来时它会自己再亮起来，那正是用户上一刻停的地方。
 */
const activeHostTab = computed(() => props.tabs.find((tab) => tab.key === hostTabKey.value))

/**
 * 当前该亮哪一格。宿主页优先——判定顺序与正文那支链一致（见模板里那段注释）。
 */
const litKey = computed(() => activeHostTab.value?.key ?? activeTab.value)

/**
 * 当前停在哪个**内置页**。
 *
 * 判据是 `litKey` 而不是 `activeTab`：宿主页亮着时 `activeTab` 还留在上一格上，
 * 拿它算会让下面那几个 `isXxxTab` 与 `--split` 类**照旧生效**——宿主页的正文
 * 会莫名其妙地吃到「模型属性」那一页的上下列分栏。宿主页的 key 落不进
 * `builtinTabs`，于是这里会退回第一页（「历史」）：下面正文档那一支用
 * `activeHostTab` 先短路，`current` 只在真正渲染内置页时才被读，
 * 所以它退到哪里都不会画错东西。
 */
const current = computed(
  () => builtinTabs.find((tab) => tab.key === litKey.value) ?? builtinTabs[0]!,
)

/**
 * 宿主页那一格的插槽名。
 *
 * 拼法与转发用的前缀同在 `utils/panelSlots.ts`，只有那一处——拼错一个连字符
 * **不报错**，宿主的面板会一个字都不显示（一个没被提供的插槽是合法的空插槽）。
 */
const activeHostSlot = computed(() => `${INSPECTOR_TAB_PREFIX}${activeHostTab.value?.key ?? ''}`)

/**
 * 点内置那一格：先把宿主页那一支清掉。
 *
 * 不写第一行的表现是**从宿主页点回内置页时，正文仍然是宿主的**——而导轨已经
 * 亮了内置那一格，两边都不报错。
 */
function openBuiltinTab(key: InspectorTab): void {
  hostTabKey.value = null
  activeTab.value = key
}

/** 点宿主那一格：`activeTab` 不动，理由见 `hostTabKey` */
function openHostTab(key: string): void {
  hostTabKey.value = key
}

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
  <aside class="tdm-col tdm-col--right">
    <nav ref="inspector" class="tdm-inspector">
      <!--
        图标导轨。
        7 个中文标签横排要 420px 以上，右栏总共才 306px，
        所以导轨只占 40px、固定用图标表示；名称由悬停提示和 aria-label 补上。
        图标路径本身在 useInspectorSchema 的 NAV_ICONS 里声明。
      -->
      <div class="tdm-rail" @mouseleave="hideTip">
        <button
          v-for="tab in builtinTabs"
          :key="tab.key"
          type="button"
          class="tdm-rail-item"
          :class="{ 'tdm-rail-item--active': tab.key === litKey }"
          :aria-label="tab.label"
          :aria-current="tab.key === litKey"
          @click="openBuiltinTab(tab.key)"
          @mouseenter="showTip(tab.label, $event)"
          @focus="showTip(tab.label, $event)"
          @blur="hideTip"
        >
          <!-- 描边粗细/端点交给 CSS，fill 由属性决定：两者控制不同的属性，不会互相覆盖 -->
          <svg class="tdm-rail-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path
              v-for="(part, i) in tab.icon"
              :key="i"
              :d="part.d"
              :fill="part.fill ? 'currentColor' : 'none'"
            />
          </svg>
        </button>

        <!--
          宿主追加的页接在内置七页之后。
          名字与图标都来自那份声明，没有可分开画的东西，所以这里不做 `#rail` 那种
          「宿主不想让我们代画」的口子——左栏那个口子是为**追加分类**开的
          （分类的条目在宿主手里），页没有这个问题。
        -->
        <button
          v-for="tab in tabs"
          :key="tab.key"
          type="button"
          class="tdm-rail-item tdm-rail-item--group-start"
          :class="{ 'tdm-rail-item--active': tab.key === litKey }"
          :aria-label="tab.label"
          :aria-current="tab.key === litKey"
          @click="openHostTab(tab.key)"
          @mouseenter="showTip(tab.label, $event)"
          @focus="showTip(tab.label, $event)"
          @blur="hideTip"
        >
          <svg class="tdm-rail-icon" viewBox="0 0 24 24" aria-hidden="true">
            <!-- 缺图标时退回占位字形：导轨上没有常显文字，留白等于少一格还点不到 -->
            <path
              v-for="(part, i) in tab.icon ?? ICON_HOST_FALLBACK"
              :key="i"
              :d="part.d"
              :fill="part.fill ? 'currentColor' : 'none'"
            />
          </svg>
        </button>
      </div>

      <!--
        提示挂在 .tdm-inspector 下、导轨之外：导轨是滚动容器，
        提示放在里面就可能被它的裁剪范围吃掉。
      -->
      <span v-if="tip" class="tdm-rail-tip" :style="{ top: `${tip.top}px` }">{{ tip.label }}</span>

      <!--
        key 绑当前那一页：切 tab 时整块重建，让 tabpanel 的淡入动画每次都能重放。
        绑的是 `activeHostTab ?? current` 而不是 `current`——停在宿主页上时
        `current` 恒是第一页（宿主页的 key 落不进 `builtinTabs`），
        两个宿主页之间切换就会因为 key 没变而**不重放动画**。
      -->
      <div
        :key="activeHostTab?.key ?? current.key"
        class="tdm-inspector-body tdm-scroll tdm-tabpanel"
        :class="{ 'tdm-inspector-body--split': isModelTab && hasModels }"
      >
        <!--
          宿主页：正文整个换成宿主的内容，名字见 `activeHostSlot`。

          放在这支链的**最前**：宿主页的 key 落不进 `builtinTabs`，
          排在后面的话 `current.key === 'history'` 会先把这一支吃掉，
          宿主的面板永远轮不到——而那是**不报错**的（画面照常，只是没有内容）。
        -->
        <slot v-if="activeHostTab" :name="activeHostSlot" />
        <HistoryPanel v-else-if="current.key === 'history'" />
        <template v-else-if="isModelTab">
          <!--
            「模型属性」这一页是主从结构：上面是场景里的模型列表，下面是选中那个的属性。
            列表自己带表头与空态提示，所以它不吃 hasModels 的 v-if。
          -->
          <ModelList />
          <!--
            两块各自滚动：模型多到装不下时列表自己在框内滚，不动下面的字段；
            字段长到装不下时也不把列表顶走。比例写在 .tdm-inspector-body--split 里。
          -->
          <div v-if="hasModels" class="tdm-models-detail tdm-scroll">
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
