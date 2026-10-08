<script setup lang="ts">
import { computed, ref, useTemplateRef } from 'vue'
import { librarySection, openLibrarySection } from '../../composables/useEditorState'
import { resolveLibrarySection, useLibrarySections } from '../../composables/useModelLibrary'
import type {
  ExtraLibrarySection,
  LibrarySection,
  LibrarySectionKey,
  MergedLibrarySection,
} from '../../composables/useModelLibrary'
import { useRailTip } from '../../composables/useRailTip'
import type { IconPath } from '../../composables/useInspectorSchema'
import { ICON_HOST_FALLBACK } from '../../utils/panelIcons'
import { SIDE_TAB_PREFIX } from '../../utils/panelSlots'
import type { EditorPanelTab } from '../../../types'
import ModelLibrary from './ModelLibrary.vue'

defineOptions({ name: 'SidePanel' })

const props = withDefaults(
  defineProps<{
    /**
     * 宿主**追加**的模型库分类：内置那五类之外还要有几类、每类里有什么东西。
     *
     * 只能追加、不能覆盖——`sections` 那行拼接把内置五类恒放在前面，理由写在
     * `useModelLibrary.ts` 顶上那一节（四个承重的 key）。不传就是什么都不加，
     * 左栏与改造前一模一样。
     *
     * 每一项的 `icon` 不写时，导轨上退回立方体占位图（见 `railIcon`）——
     * 看得见，不会是一格空白。
     */
    extraSections?: ExtraLibrarySection[]

    /**
     * 宿主**追加**的页：点了整个左栏正文换成宿主的内容（`#side-tab-<key>` 插槽）。
     *
     * 与 `extraSections` 是两件事，别串了：那一个是**往模型库的宫格里加一类东西**，
     * 正文仍是宫格；这一个换的是**正文本身**。所以两者在导轨上排成两组
     * （见 `railButtons`）。
     *
     * 不传则左栏只有「模型库」一页——宿主页为 0 时，正文那个 `v-if` 恒走
     * `ModelLibrary` 那一支，整块与没有这个 prop 之前逐字一致。
     */
    tabs?: EditorPanelTab[]
  }>(),
  { extraSections: () => [], tabs: () => [] },
)

/**
 * 合并表：内置五类在前、宿主追加的在后。**导轨与宫格读的是同一个数组**，
 * 所以两边不可能对不上（`resolveLibrarySection` 那边的注释讲了代价）。
 *
 * 内置那五类由 `useLibrarySections()` 现算：它们的**条目**来自宿主注入的素材
 * （`useEditorAssets`），不再是模块常量——见 `useModelLibrary.ts` 顶上那一节。
 *
 * 追加的那几类排在最末（天空盒之后）。天空盒之所以排在内置的末尾，是因为
 * 它不是「往场景里摆的实体」；追加分类接在它后面，读起来是「另一组」，
 * 分割线由每一项自己的 `groupStart` 给出（见 `railButtons`）。
 */
const builtinSections = useLibrarySections()

const sections = computed<MergedLibrarySection[]>(() => [
  ...builtinSections.value,
  ...props.extraSections,
])

/**
 * 导轨图标的共用约定（与右栏 `NAV_ICONS` 同一套，完整版在 `useInspectorSchema.ts`）：
 * 画在 24 格里、只用描边、只吃 `currentColor`（描边粗细与端点在 CSS 里，
 * 见 `.tdm-rail-icon`）、留白压在 3 格以上——18px 渲染下再多占一格就会贴边。
 *
 * 这一栏另有一条：**同屏的每个字形只能指一件事**。已经占掉的形状有右栏 7 个
 * （立方体 / 相机 / 带门洞缺口的方框+隔墙 / 等轴测菱形网格 / 太阳 / 球与影 /
 * 时钟+箭头）、中栏 `ModelActions` 6 个（其中「贴地」占掉了一条**裸地面线**、
 * 「移除」占掉了**带通栏盖线与内部竖线的方框**），下面几个字形逐个绕开了它们。
 */

/**
 * 地板：两块**错缝**的地板条（侧视，下板右端伸出去一截）。
 *
 * 凭什么不撞：不是 `NAV_ICONS.ground` 的等轴测菱形（任何扁长平行四边形在 18px
 * 下都会被认成它）、不是 `floorplan` 的方框+隔墙、不含 `ModelActions`「贴地」
 * 那条裸地面线；本图标是中空闭合的，且带竖边。全仓库没有第二处「两个中空横条、
 * 右端错开」。
 *
 * 「错缝」是这两个条唯一的辨识点，所以**两条的右端差得足够远**（4.7 格），
 * 两板之间的缝也留了 4.5 格——再窄就糊成一坨，读起来是一条粗横杠。
 */
const ICON_FLOOR: IconPath[] = [
  { d: 'M3.5 5.6 H15.8 V10.6 H3.5 Z' },
  { d: 'M3.5 15.1 H20.5 V20.1 H3.5 Z' },
]

/**
 * 门：一个**竖长方形**的门框，里面贴着一块实心门扇，铰链那一侧留一条缝。
 *
 * 凭什么不撞：全仓库唯一**在闭合轮廓里嵌一块实心矩形**的字形。逐个比最近的三个
 * ——`ICON_WALL` 是**正方**外框（`4.5→19.5` 两轴等长）且内部全是砖缝细线，
 * 一块实心都没有；`NAV_ICONS.floorplan` 同样是正方外框，内部是三道打断的隔墙；
 * `ICON_FLOOR` 是两块分离的中空横条，连闭合外框都不成立。
 * **长宽比是第二个辨识点**：这一格 10.4 × 15.6（0.67），那两个方框是 1.0。
 *
 * 不画「开着的门」（框 + 一道斜的门扇）：全仓库唯一稳定的斜线族是
 * `NAV_ICONS.ground` 那个等轴测菱形，再添一道短斜线会把两边的辨识度一起拉低；
 * 而在 18px 上「框 + 实心块」比「框 + 斜线 + 弧」干净得多，后者这个量级下会糊。
 *
 * 实心块**刻意不贴满**：左边留 3.4 格（合 2.5px）是铰链那一侧的缝，右边只留
 * 1.6 格是门扇与框的正常间隙。两边都留够就成了一个空心方框（与「墙壁」撞形），
 * 一边都不留就是一个实心黑块——那条不对称的缝正是「这是一扇门」的全部信息。
 * 把手刻意不画：半径得大到 3 格才看得见，而那个大小的实心圆点了实心块上
 * 就与块同色、点缝里就成了一个漂浮的圆（读不出是把手），两个方向都不划算。
 */
const ICON_DOOR: IconPath[] = [
  { d: 'M4.8 4.4 H15.2 V20 H4.8 Z' },
  { d: 'M8.2 6.8 H13.6 V20 H8.2 Z', fill: true },
]

/**
 * 窗：一个**横长**的窗框，框内一道通栏竖梃与一道通栏横梃交出正中的十字，
 * 框底压着一条**比框更宽**的窗台线。
 *
 * 凭什么不撞：全仓库唯一**横长**的闭合外框（15 × 10.4，1.44）——隔壁「门」是
 * 竖长的 10.4 × 15.6（0.67），`ICON_WALL` 与 `NAV_ICONS.floorplan` 都是正方
 * （两轴 15，1.0）。第二个辨识点是**框内的十字**：`ICON_WALL` 的横缝虽然也通栏，
 * 但竖的那几条是**错缝短竖线**（上中下三排各错半个砖长），凑不出十字；
 * `NAV_ICONS.floorplan` 内部是三道**打断的隔墙**，没有一根贯通；`ICON_FLOOR`
 * 是两块分离的中空横条，连闭合外框都不成立。
 *
 * 那条窗台是**最终辨识点**：全仓库唯一「比自己的外框更宽」的一条线（左右各伸出去
 * 1.3 格）。去掉它就只剩「框 + 十字」——18px 下与「墙壁」的砖缝网格要盯着数才分得开，
 * 而窗台一下就把「横向坐落在什么上面」说清楚了，也正好对应模型那一侧的窗台
 * （`WINDOW_SILL`：窗洞不落地）。它的两端停在 3.2 格，与 `ICON_SKYBOX` 那道拱的
 * 最外沿**同为全仓库最紧的一档**（文件头那条「留白压在 3 格以上」），不再往外伸。
 *
 * 刻意**不画多分格**（两列三行那种窗棂格）：再加两根竖线就密到与砖缝同量级，
 * 两边的辨识度一起垮；十字是最少的分格数，也是唯一能同时读出「竖梃」和「横梃」的。
 * 也刻意不画窗外的景物（云、太阳）：`ICON_SKYBOX` 已经占了拱 + 地平线 + 太阳，
 * 再添一个天体就把那一格也说糊了。
 */
const ICON_WINDOW: IconPath[] = [
  { d: 'M4.5 5.6 H19.5 V16 H4.5 Z M12 5.6 V16 M4.5 10.8 H19.5' },
  { d: 'M3.2 18.4 H20.8' },
]

/**
 * 墙壁：一堵**正立面**的砖墙（闭合外框 + 两行通缝 + 上下两排错缝短竖线）。
 *
 * 凭什么不撞：全仓库唯一的**「闭合外框 + 内部规则错缝短竖线」**。与最近的两个
 * 逐个比——`NAV_ICONS.floorplan` 是**正方**外框（`4.5→19.5` 两轴等长）且内部
 * 只有三道打断的隔墙（那道缺口就是它的门洞、是它的辨识点），既没有通栏横缝、
 * 也没有一排对齐的竖缝；`ICON_FLOOR` 是**两块分离的中空横条**，外框不闭合、
 * 内部一条线都没有。
 *
 * **刻意不画成剖面**（两条竖线夹一块填充）：那与隔壁「地板」会读成同一种东西
 * （都是「一块板」），而墙上最可辨认的特征是砖缝。**错缝是关键**，正缝会读成百叶窗
 * ——第二排的竖线（`x=7.5/12.5`）相对第一、三排（`x=10/15`）整整错开半个砖长。
 *
 * 密度：`stroke-width` 是 1.5、渲染在 18px 的 24 格里，相邻两道竖线中心距 5 格
 * （合 3.75px），线间净空约 2.6px——分得开。若将来把图标改小或加粗描边先在这里
 * 退回稀疏版：只留一条通栏横缝（`M4.5 12 H19.5`）+ 上排一道（`M12 7 V12`）
 * + 下排两道错开的（`M8 12 V17 M16 12 V17`）。
 */
const ICON_WALL: IconPath[] = [
  { d: 'M4.5 4.5 H19.5 V19.5 H4.5 Z' },
  { d: 'M4.5 9.5 H19.5 M4.5 14.5 H19.5' },
  { d: 'M10 4.5 V9.5 M15 4.5 V9.5 M7.5 9.5 V14.5 M12.5 9.5 V14.5 M10 14.5 V19.5 M15 14.5 V19.5' },
]

/**
 * 天空盒：一道**天穹**（大半圆拱）+ 一条地平线 + 拱内一个小小的太阳。
 *
 * 凭什么不撞：全仓库唯一的**大半径开口圆弧**——两笔已经搬去
 * `utils/libraryIcons.ts` 的「设备」字形与 `NAV_ICONS.camera` 里的弧都是小圆角/小圆面
 * （半径 2.6 / 3.3），
 * `NAV_ICONS.history` 那道 8.4 的弧是**闭合的整圆**（时钟表盘），
 * 而这一道是**开口朝下、两端落在地平线上**的拱，且**骑在一条通栏横线上**。
 *
 * 「拱 + 地平线 + 里面一个实心点」三样凑齐才读得出是天空，少掉那个点就只剩
 * 「一道拱压在一条线上」——那更像山丘或彩虹。点刻意画得小（半径 2.2），
 * 与 `NAV_ICONS.sun` 的「圆面 + 八道光芒」不是一个东西：这里没有光芒，
 * 它只是个被拱框住的实心点。
 *
 * 不用「展开的立方体贴图」（三格横排 + 上下各一格）：五个小方块在 18px 下
 * 每个只有 3.75px，糊成一排点。也不用立方体本身——`NAV_ICONS.model` 与
 * 中栏「没有预览图」的占位字形都是立方体，同屏已经有两个了。
 */
const ICON_SKYBOX: IconPath[] = [
  { d: 'M3.2 16.4 A8.8 8.8 0 0 1 20.8 16.4' },
  { d: 'M2.4 16.4 H21.6' },
  { d: 'M16.8 12 A2.2 2.2 0 1 1 12.4 12 A2.2 2.2 0 1 1 16.8 12', fill: true },
]

/**
 * 每个分类一个图标，一个都不能漏。
 *
 * 这里原先还挂着第二条：**分类的 key 不许和页面级的 key 撞名**
 * （`Extract<LibrarySectionKey, LeftTab> extends never ? unknown : never`）。
 * 左栏那个页面级的「场景预设」页搬去右栏之后，导轨上只剩分类这一种项，
 * 页面 key 不复存在，这条守卫没有了对象——分类之间撞名本来就被对象字面量
 * 自己拦着（同一个 key 写两遍是编译错误）。
 *
 * 宿主页（`tabs`）把**页面级**这一支带了回来，但这条守卫**长不回来**：
 * 它的 key 是宿主给的运行时字符串，类型层面看不出撞没撞。那件事改由运行时的
 * 重复 key 警告兜着（`RailItem` 那段注释里写了），代价是它只在开发模式下响。
 */
type SafeIcons = Record<LibrarySectionKey, IconPath[]>

/**
 * 每个分类一个图标。`satisfies` 是关键：**漏画一个分类的图标就是编译错误**，
 * 不会变成导轨上一格空白。这条落得成立，是因为 `LibrarySectionKey` 是从
 * `LIBRARY` 那个 `as const` 字面量推出来的字面量联合——若它退化成 `string`，
 * `satisfies` 会跟着退化成 `Record<string, …>`，这里就静默不报错了。
 */
const SECTION_ICONS = {
  floor: ICON_FLOOR,
  wall: ICON_WALL,
  door: ICON_DOOR,
  window: ICON_WINDOW,
  skybox: ICON_SKYBOX,
} satisfies SafeIcons

/**
 * 每个分类的**量词**，用在导轨的悬停提示与 `aria-label` 里（`地板 · 2 个模型`）。
 *
 * 按 `kind` 取，不按分类名：量词要说的正是「这一类里的东西点一下是干什么的」，
 * 而那就是 `kind` 的定义。天空盒那一类里一个 `.glb` 都没有、点下去也不往场景里
 * 摆东西，读成「38 个模型」是错的——而提示里除了量词没有别的地方说得出这件事。
 *
 * `satisfies` 照上面那条：`kind` 多一个取值就会在这里红，
 * 而不是导轨上多一句量词不对的话。
 */
const SECTION_UNITS = {
  model: '个模型',
  skybox: '个天空盒',
} satisfies Record<LibrarySection['kind'], string>

/**
 * 每个分类的图标，**按字符串索引**的那一份。
 *
 * `SECTION_ICONS` 本身是按字面量联合索引的对象，`SECTION_ICONS[someString]`
 * 在类型上过不去——而追加分类的 key 正是运行时的字符串。这里摊平成一张表，
 * 一次摊平、处处按 key 取。
 *
 * 它与 `SECTION_ICONS` **是同一份数据**（构造时读的就是它），所以 `satisfies
 * SafeIcons` 那条「内置分类漏一个图标就编译不过」的守卫一个字都没松。
 */
const SECTION_ICON_BY_KEY = new Map<string, IconPath[]>(Object.entries(SECTION_ICONS))

/**
 * 导轨上的一项 = 模型库的一个分类，**或者**宿主追加的一页。
 *
 * **它原先是一个可辨识联合**（`kind: 'page' | 'section'`），因为导轨上混着两种东西：
 * 页面级的「场景预设」页（点了整个面板换掉）与分类（只换宫格内容）。预设页搬到
 * 右栏「日照环境」之后只剩分类一种，`kind` 那支判别式每个使用点都退化成一堆
 * 收窄判断，于是整个联合收成接口——**一个只有一支的联合比一个接口更贵**。
 *
 * 现在它长回来了，而且回来的还是原来那一支：宿主追加的页正是**页面级**的
 * （`tabs` prop，正文换成插槽）。所以判别字段与当初同名同义，`activate` 那处
 * 分流的形状也一样。区别只在来源——当初那一支是内置的预设页，今天全是宿主的。
 *
 * `groupStart` 保留：导轨上现在最多有三组（内置分类 ｜ 追加分类 ｜ 宿主页），
 * 每条分隔线落在各组的第一项上（见 `extraRailItems` / `pageRailItems`）。
 *
 * `key` 是 `string` 而不是 `LibrarySectionKey`：导轨上还可能有
 * **宿主追加**的分类与页，它们的 key 是运行时的。收窄成 `string` 只影响这一处，
 * `SECTION_ICONS satisfies SafeIcons` 与 `TOOL_ASSET_RULES` 两处守卫
 * 仍然只认那个字面量联合——**内置那几类才是承重的**，追加分类不是。
 */
interface RailItem {
  kind: 'page' | 'section'
  key: string
  tip: string
  icon: IconPath[]
  groupStart: boolean
}

/**
 * 一个分类项的那句提示。
 *
 * 数量与量词都照内置项同款拼（`地板 · 2 个模型`），因为**同一句话也当 `aria-label`
 * 用**：读屏没法悬停，数量只放在悬停提示里就等于对读屏用户不存在。
 * 宿主自己写 `#rail` 时拿的就是这个函数（插槽作用域里的 `tipOf`）——
 * 那句话的格式是这一栏的契约，不该由每个宿主各发明一遍。
 */
function tipOf(section: MergedLibrarySection): string {
  return `${section.label} · ${section.entries.length} ${SECTION_UNITS[section.kind]}`
}

/**
 * 一个分类项的图标：先查内置那张表，再问分类自己带没带，都没有就用占位立方体。
 *
 * 顺序**不能反**：内置分类的图标在 `SECTION_ICONS` 里，它们的 `LibrarySection`
 * 根本没有 `icon` 这个字段（`'icon' in section` 就是那道分流）。
 *
 * 这一行也是 `LibraryIconPath` 与 `IconPath` 两份结构相同的类型的**交汇点**：
 * 任一边改了字段名，这里就会红（`useModelLibrary.ts` 那段注释说的是这件事）。
 */
function railIcon(section: MergedLibrarySection): IconPath[] {
  return (
    SECTION_ICON_BY_KEY.get(section.key) ??
    ('icon' in section ? section.icon : undefined) ??
    ICON_HOST_FALLBACK
  )
}

/** 拼一项导轨。内置与追加走同一个函数，于是两组的图标取法、提示文案不会各长一份 */
function sectionRailItem(section: MergedLibrarySection, groupStart: boolean): RailItem {
  return {
    kind: 'section',
    key: section.key,
    tip: tipOf(section),
    icon: railIcon(section),
    groupStart,
  }
}

/**
 * 拼一项**宿主追加的页**。
 *
 * 提示就是那个页名，不像分类那样接一个数量——页里有什么是宿主的模板，
 * 库数不出来，而数与不对的数都只会误导（`tipOf` 那边讲的「量词要说清点一下
 * 干什么」在这里没有对象）。页名本来就是宿主的 `label`，原样用。
 *
 * 图标缺了就退回 `ICON_HOST_FALLBACK`：这一格同样没有常显文字，
 * 留白等于让宿主少一格、还点不到。
 */
function pageRailItem(tab: EditorPanelTab, groupStart: boolean): RailItem {
  return {
    kind: 'page',
    key: tab.key,
    tip: tab.label,
    icon: tab.icon ?? ICON_HOST_FALLBACK,
    groupStart,
  }
}

/**
 * 数组顺序即导轨从上到下的顺序。
 *
 * 分类项**由 `useLibrarySections()` 派生**：那五个内置分类的顺序只写在
 * `useModelLibrary.ts` 的 `LIBRARY_SHAPE` 一处，导轨自动跟着，不出现
 * 「数据里有、界面上没有」。
 *
 * 每一项的 `groupStart` 都是 false：那条第几项上的分隔线原先分的是「页面级的
 * 预设页」与「模型库的分类」，现在整条导轨都是分类，没有可分的两组。
 *
 * 这里**只有内置那五类**。宿主追加的分类在下面的 `extraRailItems` 里、
 * 宿主追加的页在 `pageRailItems` 里，三者由 `railButtons` 决定怎么合并。
 *
 * 写成 computed 而不是常量：内置那五类现在是算出来的（条目来自宿主注入的素材），
 * 不再是模块常量。
 */
const RAIL_ITEMS = computed<RailItem[]>(() =>
  builtinSections.value.map((section) => sectionRailItem(section, false)),
)

/** 宿主追加的那几项，只在宿主没写 `#rail`（不想自己画）时由组件代画 */
const extraRailItems = computed<RailItem[]>(() =>
  props.extraSections.map((section, index) => sectionRailItem(section, index === 0)),
)

/**
 * 宿主追加的页。
 *
 * **恒由组件代画，与 `#rail` 无关**——那是它跟 `extraRailItems` 唯一的差别。
 * 理由在两类东西的来处：追加分类的图标要宿主自己带（`'icon' in section` 那道分流
 * 就是为它写的），于是「自己画」与「让组件代画」各有人选；而宿主页的名字与图标
 * 本来就在 `EditorPanelTab` 这份声明里给全了，库画出来不会比宿主差，
 * 再让宿主用 `#rail` 画一遍只是多一份可以写错的代码。
 *
 * 分隔线落在第一项上：它前面恒有东西（内置五类，或追加分类那一组的最后一项）。
 * 追加分类为空时不会有重复的分隔线——那两个 `computed` 各自独立，
 * 前一组没东西就没人去画它那一条。
 */
const pageRailItems = computed<RailItem[]>(() =>
  props.tabs.map((tab, index) => pageRailItem(tab, index === 0)),
)

/**
 * 待画进导轨的那一串。
 *
 * `hostDrawsExtras` 为真（宿主写了 `#rail`）时只剩内置那五项 + 宿主页：
 * 追加分类改由插槽给出，这里再画一遍就是每项两个按钮（同一格重复、同时亮）。
 *
 * ## 为什么这是个函数、判据还得从模板里传进来
 *
 * **读 `$slots` 必须发生在渲染期。** `slots` 对象是父组件重渲染时才被换掉的普通
 * 对象，在一个 computed 里读它**不建立依赖**：父组件先不写插槽、后来写上了，
 * 那个 computed 不会重算，导轨上就会照着旧结果画。写成函数、在模板里读
 * `$slots.rail` 传进来，两次读都发生在渲染期，没有这个时间差。
 *
 * 合并的次序是**内置在前、追加分类其次、宿主页最末**——与 `sections` 那张表、
 * 与「翻到底才见到宿主加的东西」是同一件事。
 */
function railButtons(hostDrawsExtras: boolean): RailItem[] {
  const categories = hostDrawsExtras
    ? RAIL_ITEMS.value
    : [...RAIL_ITEMS.value, ...extraRailItems.value]
  return [...categories, ...pageRailItems.value]
}

const navRef = useTemplateRef<HTMLElement>('nav')

/** 悬停提示的坐标推导在 useRailTip 里，与右栏导轨共用同一份 */
const { tip, showTip, hideTip } = useRailTip(() => navRef.value)

/**
 * 当前停在**哪一个宿主页**。`null` = 没停在宿主页上，正文是模型库。
 *
 * 它是本组件**本地**状态，不进 `useEditorState`：整个仓库只有这一处读它
 * （正文与导轨都在本文件里），提升成模块级单例只会让它看起来像「别处也会读」。
 * 当初那个 `leftTab` 是因为「场景预设」页另有出口才住在 store 里，
 * 而宿主页的出口就是这根导轨。
 */
const activePageKey = ref<string | null>(null)

/**
 * 当前这一页。（`undefined` = 停在模型库上，或者宿主把这一页撤掉了。）
 *
 * 判据取「数组里还在不在」而不是直接比 key：宿主中途把一个 tab 从数组里拿掉时，
 * `activePageKey` 会留在那个已经不存在的 key 上，只看它就会停在一页空白上。
 * 过一遍 `find` 之后，撤页的表现是**落回模型库**——与内置那条兜底同一个走向。
 * 重新加回来时它会自己再亮起来，那正是用户上一刻停的地方。
 */
const activePage = computed(() => props.tabs.find((tab) => tab.key === activePageKey.value))

/**
 * 宿主页那一格的插槽名。
 *
 * 名字由 `SIDE_TAB_PREFIX` 拼出来、不在模板里现拼：拼错一个连字符**不报错**，
 * 宿主的整块面板会一个字都不显示（一个没有被提供的插槽是合法的空插槽）。
 * 命名规则与转发用的前缀同在 `utils/panelSlots.ts`，只有那一处拼法。
 *
 * `?? ''` 只在 `activePage` 为空时取到，而那个值只可能出现在
 * 模板里那一支不渲染的时候——留着是为了让这个表达式自己站得住，
 * 不靠「调用点恰好在 v-else 里」。
 */
const activePageSlot = computed(() => `${SIDE_TAB_PREFIX}${activePage.value?.key ?? ''}`)

/**
 * 当前该亮哪一项。
 *
 * 两级：停在宿主页上就是它；否则是**当前分类**（「亮了这一类但面板里是另一类」
 * 正是 `resolveLibrarySection` 兜的底）。
 *
 * 分类那一支传的是合并表 `sections`（内置 + 追加分类），**与宫格内容是同一个函数、
 * 同一个数组**：各写各的时，一个对不上的 key 会让导轨亮着一格而宫格是另一格，
 * 两边都不报错。
 *
 * 宿主页**不进** `resolveLibrarySection`——它只认分类（它返回的是带 `entries`
 * 的那张表，宿主页根本没有 `entries`）。所以这里是 `??` 而不是把它并进那张表：
 * 并进去会让「宿主撤掉一页」变成「兜底到那一页上」，正好是反的。
 */
const activeRailKey = computed(
  () => activePage.value?.key ?? resolveLibrarySection(librarySection.value, sections.value).key,
)

/**
 * 点导轨。
 *
 * 分流形状与那个判别字段同名同义：页面级换页、分类换宫格。两个 `kind` 的
 * `key` 落在同一根导轨上，所以**分类那一支必须把页清掉**——不写那一行的话，
 * 从宿主页点回某个分类，正文会继续是宿主页，而导轨已经亮了那个分类。
 */
function activate(item: RailItem) {
  if (item.kind === 'page') {
    activePageKey.value = item.key
    return
  }
  activePageKey.value = null
  openLibrarySection(item.key)
}
</script>

<template>
  <!--
    左栏，右栏的镜像。

    导轨贴在这一栏的**右缘**（紧邻视口）而不是外缘：这样左右两根导轨一起把视口
    夹在中间，激活指示条也都朝向视口那一侧。行的顺序因此是「内容在前、导轨在后」，
    列序直接用 DOM 顺序表达（.tdm-nav 的 grid 模板就是按这个顺序写的）。

    代价是 Tab 键会先走完内容再走到导轨，与右栏相反——可接受的小差异。

    根类仍是 tdm-col--left，所以预览模式那条 display:none 自动生效。

    **根元素是 `div` 而不是 `aside`**（右栏同，两处必须一起改）。这一条是真实宿主
    踩出来的：库的样式全都收在 `.tdm-root` 下，但作用域只赢「**两边都声明了的属性**」
    ——`.tdm-col` 只写了 display / flex-direction / min-width / min-height 四条，
    而宿主那份通用样式里常有一条按**标签**写的
    `aside { padding: 8px 24px; margin-bottom: 20px; line-height: 32px; background: … }`
    （后台模板的 `styles/index.scss` 里很典型），于是这两栏被它整片压住——
    **不报错，只是版面坏掉**。换成 `div` 之后宿主那边没有对应规则可命中，同理不用
    `header` / `section` / `article` / `footer`（属性面板的每一节、事件弹窗的表头与脚注
    原先都是这么写的，已经跟着改了）。`nav` 那两处导轨是例外、留着：它是真语义，
    而按 `nav` 写全局样式的模板极少。
    这条约定由 `scripts/smoke.mjs` 里那条「容器根不用语义元素」的源码扫描守着。
  -->
  <div class="tdm-col tdm-col--left">
    <nav ref="nav" class="tdm-nav">
      <!--
        这一层原先绑着 `:key="leftTab"`：切面板时整块重建，让 tabpanel 的淡入动画
        每次都能重放。左栏只剩模型库一页之后，那个 key 的取值集合只剩一个值，
        这把 key 什么都没在管了，连同左栏的页面状态（`useEditorState` 的
        `leftTab`）一起删掉。`tdm-tabpanel` 这个类留着：首屏挂载时仍然淡入一次，
        与右栏的观感一致。

        「场景预设」原先就挂在这一层的 `v-if` 上，现在它搬去了右栏「日照环境」的
        03 节（`PresetList.vue`）——预设改的就是那一页的字段，隔半个屏幕点它、
        再回头看数字变化，本来就不顺手。
      -->
      <div class="tdm-side-body tdm-tabpanel">
        <!--
          模型库：合并表（内置五类 + 宿主追加的）从这里进去，宫格与导轨读的是
          **同一个 `sections`**，所以两边不可能对不上。

          宫格那边只拿它当「有哪些分类、每一类里有什么」，`resolveLibrarySection`
          的兜底因此也落在内置第一条上——宿主把一个追加分类撤掉、而左栏正停在
          它上面时，落回的是内置分类，不是空白。
        -->
        <ModelLibrary v-if="!activePage" :sections="sections">
          <!--
            `#list` 的**透传**：导轨在 SidePanel、宫格在 ModelLibrary，
            宿主给 SidePanel 写的插槽要跨一层才到得了真正渲染它的地方。

            `v-if` 与 `v-slot` 写在同一个 `<template>` 上是合法的，而且条件为假时
            这个插槽**真的不存在**（编译成 `ok ? { name: 'list', fn } : undefined`，
            实测过），所以 `ModelLibrary` 里 `!!slots.list` 判得准——
            不会把「一个空的透传壳」误当成「宿主接管了宫格」。
          -->
          <template v-if="$slots.list" #list="scope">
            <slot name="list" v-bind="scope" />
          </template>
        </ModelLibrary>

        <!--
          宿主页：正文整个换掉，内容由 `#side-tab-<key>` 给出（名字见 `activePageSlot`）。

          作用域**刻意是空的**：这一页是宿主的模板，库没有「这一页里有什么」可言。
          要读编辑器状态（当前选中哪个模型、配置是什么）请用公开导出的
          `useSceneStore` / `useEditorState`，它们本来就是这个页面里画东西的依据。
        -->
        <slot v-else :name="activePageSlot" />
      </div>

      <!--
        提示挂在 .tdm-nav 下、导轨之外：导轨是滚动容器，
        提示放在里面就可能被它的裁剪范围吃掉。
      -->
      <span v-if="tip" class="tdm-rail-tip tdm-rail-tip--start" :style="{ top: `${tip.top}px` }">
        {{ tip.label }}
      </span>

      <!--
        导轨。写法与右栏同一套：`aria-label` 给名字，**`aria-current`** 表示「当前项」。

        **刻意不用 `role="tablist"` / `role="tab"` + `aria-selected`**：那是一整套契约
        （roving tabindex、左右方向键、`aria-controls` 与面板配对），只写角色不写键盘，
        读屏会念出「选项卡 1/4」然后方向键毫无反应——比不声明更糟。
        全仓库没有一处 tab 角色，两根导轨都靠原生 Tab 顺序，这里照办。
        将来要加方向键，应当所有同类切换器一起做，而不是只给这一处。

        `@scroll="hideTip"` 不是可有可无的：提示的坐标是 useRailTip 在事件那一刻用
        `getBoundingClientRect` 算出来的快照，而滚轮不会触发 mouseleave，
        项多了以后「悬停中滚导轨」会把提示留在旧位置上。
      -->
      <div class="tdm-rail" @mouseleave="hideTip" @scroll="hideTip">
        <!--
          待画的项由 `railButtons` 算：宿主写了 `#rail` 就只剩内置那五项
          （追加项改由插槽给出），没写就连追加的一起代画。
          `!!$slots.rail` 必须在**这里**读——理由写在 `railButtons` 上面那段。
        -->
        <button
          v-for="item in railButtons(!!$slots.rail)"
          :key="item.key"
          type="button"
          class="tdm-rail-item"
          :class="{
            'tdm-rail-item--active': item.key === activeRailKey,
            'tdm-rail-item--group-start': item.groupStart,
          }"
          :aria-label="item.tip"
          :aria-current="item.key === activeRailKey"
          @click="activate(item)"
          @mouseenter="showTip(item.tip, $event)"
          @focus="showTip(item.tip, $event)"
          @blur="hideTip"
        >
          <!-- 描边粗细/端点交给 CSS，fill 由属性决定：两者控制不同的属性，不会互相覆盖 -->
          <svg class="tdm-rail-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path
              v-for="(part, i) in item.icon"
              :key="i"
              :d="part.d"
              :fill="part.fill ? 'currentColor' : 'none'"
            />
          </svg>
        </button>

        <!--
          宿主自定义的导轨项接在内置项之后（**没有任何默认内容**：不写插槽的话，
          追加项上面那个 `v-for` 已经代画了，这里再来一份就是每项两个按钮）。

          作用域里给的是**做一格按钮需要的全部东西**，不是一堆零碎：
            - `sections` 那一串 `ExtraLibrarySection`，含每一项的 label / entries；
            - `activeKey` / `activate(key)` 负责「亮哪一项」与「点了去哪」；
            - `showTip(label, event)` / `hideTip` 负责悬停提示——坐标是
              `useRailTip` 用 `getBoundingClientRect` 现算的，宿主自己写不出这一对
              回调，不给出就只能悬停没提示；
            - `tipOf(section)` 拼出与内置项同款的那句「标签 · 数量 量词」。

          `tipOf` 不是可选的体面：那句话**同时是那一格的 `aria-label`**，
          导轨上没有常显文字，读屏只读得到它。宿主各写各的，格式错了就少一句。

          `activate` 只认**分类**（宿主页由库自己画、自己接，见 `pageRailItems`），
          而 `activeKey` 两种都可能给到——宿主页亮着时它是那个页的 key，
          此时宿主画的分类项应当全不亮，那就是它的用处。
        -->
        <slot
          name="rail"
          :sections="extraSections"
          :active-key="activeRailKey"
          :activate="openLibrarySection"
          :show-tip="showTip"
          :hide-tip="hideTip"
          :tip-of="tipOf"
        />
      </div>
    </nav>
  </div>
</template>
