<script setup lang="ts">
import { computed, ref } from 'vue'
import { useSceneStore } from '../../../src'
import type { SkyboxFaces } from '../../../src'
import { parseModelParts } from '../../../src'
import {
  LIBRARY_SECTIONS,
  resolveLibrarySection,
  scenePartsJsons,
  sceneUrls,
} from '../../composables/useModelLibrary'
import type { LibraryEntry, MergedLibrarySection } from '../../composables/useModelLibrary'
import { librarySection, pushEvent } from '../../composables/useEditorState'
import {
  TOOL_ASSET_RULES,
  applyMeasuredSizeFor,
  floorplanTool,
  isOpeningTool,
  pickedAssetFor,
  replaceTarget,
  toggleAssetPickFor,
} from '../../composables/useFloorplanTool'
import type { FloorplanTool, ReplaceTarget } from '../../composables/useFloorplanTool'
import type { IconPath } from '../../composables/useInspectorSchema'
import ModelMeasureProbe from '../ModelMeasureProbe.vue'

defineOptions({ name: 'ModelLibrary' })
const scene = useSceneStore()

const props = withDefaults(
  defineProps<{
    /**
     * 左栏那张**合并表**：内置五类 + 宿主追加的那些（`SidePanel.vue` 建的表）。
     *
     * 不传就是内置五类本身，于是这个组件单独用时与改造前完全一样——
     * 它自己**不造表**，只是把拿到的表当「有哪些分类」用。
     *
     * 表的来路只有 `SidePanel` 一个，所以导轨高亮与这里的宫格读的是同一个
     * `resolveLibrarySection`、同一张表（那条老约束：两边各写各的时，一个对不上的
     * key 会让导轨亮着这一类而面板里是另一类，两边都不报错）。
     */
    sections?: MergedLibrarySection[]
  }>(),
  { sections: () => LIBRARY_SECTIONS },
)

/**
 * 当前分类。
 *
 * 状态**不在这个组件里**，住在 `useEditorState` 的 `librarySection`：有配料的工具
 * （地基、画墙、门、窗）激活时会由 `openLibrarySection` 从外面把它切到那一类
 * （点地基 → 地板、点画墙 → 墙壁、点门窗 → 门 / 窗，见 `setFloorplanTool` 与 `TOOL_ASSET_RULES`）。
 *
 * 它**不能并进面板体那个 key**（左栏曾经是 `:key="leftTab"`）：那个 key 的取值集合是
 * 「页面」的集合，并进去就意味着每切一次分类都重建整个组件，`broken` 连同已经加载好的
 * 缩略图全部作废，表现是来回切分类时图闪白、失败的图重发请求。左栏只剩这一页之后
 * 那个 key 没有了（见 `useEditorState.ts` 里 `librarySection` 的注释），
 * 但分类与面板仍然是两层，宫格那个 `:key="librarySection"` 管的是滚动位置（见模板里那段）。
 *
 * 默认落在**第一个有模型的分类**上——规则跟着数据走，所以它现在指到的是「地板」
 * （两条），而不是按语义排在最前的那一条，也不是写死的第一条。定义在
 * `useModelLibrary.ts` 的 `DEFAULT_LIBRARY_SECTION_KEY` 里。
 *
 * 兜底也不省：取不到就退回第一条，宫格整块消失比退回第一条糟得多。
 * 与导轨的高亮共用 `resolveLibrarySection` 同一个函数、同一张表，两边不会不一致。
 * 宿主把一个追加分类从表里撤掉、而左栏正停在它上面时，退回的正是内置第一条。
 */
const section = computed(() => resolveLibrarySection(librarySection.value, props.sections))

/**
 * 当前这一类是不是**宿主追加**的（不在内置五类里）。
 *
 * 判据是「在不在 `LIBRARY_SECTIONS` 里」，不新造常量、也不看这个 prop 是谁给的：
 * 合并表恒是「内置五类 + 追加的那些」的拼接，所以对任意一张传进来的表这句话都成立。
 *
 * 它的用处只有一个——决定 `#list` 插槽管不管得着这一类（见模板）。**内置分类
 * 永远走内置宫格**，插槽管不到：那是「插槽只用于追加、不作为覆盖」这条约定的落点。
 */
const isExtraSection = computed(
  () => !LIBRARY_SECTIONS.some((builtin) => builtin.key === section.value.key),
)

/**
 * 这一栏里点的格子，现在是「选来当料用」还是「替换一个已选中的东西」。
 *
 * 做成一个判别式、而不是并列两个 computed：宫格那三处读它（格子高亮、无障碍名字、
 * 点击分流）必须**对同一件事给出同一个答案**，两份真相迟早不一致——症状是
 * 「高亮说这一格是当前料，点下去却把它换到别的东西上了」。
 *
 * ## 两种模式**按构造互斥**
 *
 * `pick` 要求有一个配料工具开着（地基 / 画墙 / 门 / 窗，判据是 `TOOL_ASSET_RULES`
 * 里有没有它），`replace` 要求有个东西被选中——而选中只可能发生在空档里
 * （`setFloorplanTool` / `cancelFloorplanTool` 都走 `resetDraft`，那里清掉选中）。
 * 所以下面那个 `if` 的顺序无关紧要，宫格上那一圈琥珀一次也只说一件事。
 *
 * 判据里**不写** `floorplanTool === 'select'`：上面那句「选中 ⇒ 空档」是结构性的，
 * 写进去是一句永远为真的条件，看起来像在防守，其实只是把耦合抄了一遍。
 *
 * ## 替换的靶子有几种，这一层**一种都不认识**
 *
 * 靶子是个描述符（`ReplaceTarget`）：停在哪一类、现在装的是哪一件、说给用户听的
 * 两句话、点下去做什么，四件事都由靶子自己说。所以这一层只比 `target.section`。
 *
 * 早先这里写的是 `sectionKeyForOpening(target.opening.kind) === section.value.key`
 * ——那句话要求它知道「靶子是个洞口」。墙来了之后它得再加一个分支，而下一种能换
 * 外观的东西还会再加一个；靶子自己知道自己停在哪一类之后，这个分支永远长不出来。
 *
 * ## 分类与工具的对应关系只从 `TOOL_ASSET_RULES` 来
 *
 * 不在组件里写死 `floorplanTool === 'foundation' && key === 'floor'`：那种写法
 * 在再加一个配料工具时不会报错，只会静默地少一个能选料的工具。
 * 替换那一支同理，比的是 `target.section`——那个字段也是查这张表算出来的。
 *
 * 判据里**不含**「现在画不画得出来」（2D 档、允许旋转那些）：那说的是「落笔能不能
 * 落成」，与「选中了哪一件料」是两件事。画不出来时选一件放着，等切回 2D 再画，
 * 是合理的用法；真画不了的时候，视口底部那行提示已经在解释原因（`floorplanHint`）。
 *
 * 替换那一支用的是 `replaceTarget` 而不是 `selectedOpening` / `selectedWall`：
 * **它带 `planView` 闸**，理由写在那边的注释里（3D 里选中状态其实还活着，高亮却不画）。
 */
type CellIntent =
  | { mode: 'pick'; tool: FloorplanTool; purpose: string }
  | { mode: 'replace'; target: ReplaceTarget }

const cellIntent = computed<CellIntent | null>(() => {
  const rule = TOOL_ASSET_RULES[floorplanTool.value]
  if (rule && rule.section === section.value.key) {
    return { mode: 'pick', tool: floorplanTool.value, purpose: rule.purpose }
  }

  const target = replaceTarget.value
  if (target && target.section === section.value.key) {
    return { mode: 'replace', target }
  }

  return null
})

/**
 * 当前正在用的天空盒。
 *
 * 直接读配置，而不是在组件里记「上次点了哪一格」：与模型那一列的高亮
 * （`sceneUrls`）同一条——手动改了配置、导入了别的配置，高亮都会自己跟上，
 * 不需要谁记得「上次点了谁」。
 */
const appliedSkybox = computed(() => scene.config.sun.skybox)

/**
 * 这一格天空盒**是不是正在生效的那一个**。
 *
 * 逐项比六个地址，不比 label、也不比引用：配置里的那六个地址是**导出的 JSON
 * 能带走的**那一份，而条目里的是模块求值时拼的，两者相等才说明是同一张图。
 * 比 label 会在「两个目录起了同一个显示名」时同时亮两格。
 *
 * **「空盒子」那一格问的是另一个问题**：它没有地址可比，它对应的配置值就是
 * `null`——所以「现在一个天空盒都没在用」时它是亮的。这样这一列的高亮始终是
 * 同一句话「现在生效的是这一格」，关掉天空盒之后用户不用猜背景为什么变了。
 *
 * 换个说法：这里比的是「这一格现在是不是在生效」，不是「上次是不是点了它」——
 * 所以关掉天空盒、或者从右栏选了预设之后，**那一格**的高亮会自己灭掉
 * （同时「空盒子」那一格亮起来，因为现在生效的正是它）。
 *
 * 判据是 `'skybox' in entry` 而不是 `entry.skybox`：`null` 是真值上的假，
 * 却是这一格里**最有意义**的那个取值，理由见 `LibraryEntry.skybox`。
 */
function isAppliedSkybox(entry: LibraryEntry): boolean {
  if (!('skybox' in entry)) return false

  const applied = appliedSkybox.value
  if (!entry.skybox) return !applied
  if (!applied) return false

  return entry.skybox.every((url, index) => url === applied[index])
}

/**
 * 这一格的东西**现在是不是在场景里**（底色高亮）。
 *
 * **三类条目问的是三个问题**，各走各的集合：
 *
 * - 模型（联网的）：「场景里有没有这个地址」。同一个模型可以摆好几份，所以是个集合；
 * - 天空盒：「现在用的是不是它」。永远只有一个在用，由配置回答；
 * - 程序生成的模型（`partsJson`）：「场景里有没有**这一段** JSON」。
 *
 * **必须分流，不能共用 `sceneUrls`**：那两个失败是同一类，都会**一起亮一大片**。
 * 天空盒条目的 `url` 是空串，而空串在 `sceneUrls` 里是**内置示例几何体**的地址
 * ——场景里只要摆过一个内置几何体，天空盒那三十多格就会一起亮起来，
 * 看起来像全都选上了。`partsJson` 是**新来的同一个坑**：它的 `url` 也是空串，
 * 所以场景里只要有一个程序生成的模型，所有空地址的条目会一起亮。
 * 第二处为此另起了 `scenePartsJsons`（那边有完整机制）。
 *
 * 分流顺序：先天空盒（判据是 `in`，不能按真假——「空盒子」那一格的 `skybox`
 * 是 `null`），再 `partsJson`（判据是它真不真，因为这个字段只有「有」与「没有」
 * 两种状态），剩下的才是联网模型。
 */
function isInScene(entry: LibraryEntry): boolean {
  if ('skybox' in entry) return isAppliedSkybox(entry)
  if (entry.partsJson) return scenePartsJsons.value.has(entry.partsJson)
  return sceneUrls.value.has(entry.url)
}

/**
 * 这一格是不是当前选中的那件料。
 *
 * 内置几何体（`entry.url === ''`）一律不算：它没有地址，选它去铺地基只会得到
 * 一块永远加载不出来的地板（`layFloorModel` 会等 12 秒再报错删除），
 * 选它去铺墙则连地址都没有、画出来的还是灰盒子；洞口那边更直接——渲染端判「这个
 * 洞口是不是由模型负责」的判据就是 `openingFilledByModel`（`url` 真不真），
 * 所以空地址根本进不了那条路。地板那一类眼下没有内置条目，
 * 但这条规则不该只在「眼下」成立。（天空盒与「空盒子」也是空 `url`，
 * 同样在这里被挡掉，而它们的分支在上面的 `isInScene` 里走。）
 */
function isPicked(entry: LibraryEntry): boolean {
  const intent = cellIntent.value
  if (!intent || entry.url === '') return false

  /*
    替换模式下问的是**另一件事**：不是「待用的是哪一件」（那是 `pickedAssets`），
    而是「选中的这个洞口或这面墙现在装的是哪一件」。读**配置**而不是读那次点击的记忆，
    与上面的 `appliedSkybox`、以及模型那一列的 `sceneUrls` 同一条口径——撤销一步、
    导入别的配置、手改配置，高亮都会自己跟上。

    靶子没有外观时 `url` 是 `undefined`（这个键整个不存在），与任何非空串都不等，
    于是没有格子会亮——那正是对的：洞口这会儿是程序构件那套框加扇、墙这会儿是
    灰盒子，都不来自左栏任何一格。
  */
  if (intent.mode === 'replace') return entry.url === intent.target.url

  return entry.url === pickedAssetFor(intent.tool)?.url
}

/**
 * 一格的无障碍名字。
 *
 * 这是这一格**唯一**的可读名：缩略图的 `alt` 留空、名字条只是视觉（它常显，
 * 但那句话说的比名字多——「用它铺地基」这种事名字里没有）。
 * 所以它得跟着「这一下会做什么」变，而不能只顾描述这个模型是什么——
 * 有配料工具开着时点它是「用它铺地基 / 铺墙面 / 装门 / 装窗」，读成「追加到场景」就是把用户指去了别处。
 *
 * 天空盒排在最前：它的 `url` 也是空串，落到下面那条会被念成
 * 「追加内置示例几何体到场景」，而它根本不是一个几何体。
 * **「空盒子」那一格同理**，而它还要再多一层：它的 `skybox` 是 `null`，
 * 用真假分流会掉进模型那一支（判据见 `LibraryEntry.skybox`）。
 *
 * **程序生成的模型（`partsJson`）紧跟着**，同样排在 `!entry.url` 之前：它的
 * `url` 也是空串，落到那一条会被念成「追加内置示例几何体到场景」——同一句话
 * 说的却是另一件事。这里说清了它「由 JSON 生成」，因为这一格的东西**不在服务器上**，
 * 听不懂的用户会去服务器上找一个不存在的文件。
 * 这一支不会再往下走「选料」：`partsJson` 模型没有 `.glb` 可量、不能铺地面、
 * 也装不进洞口，它进不了 `TOOL_ASSET_RULES` 那四个 key，所以这里没有「选它去铺什么」
 * 那种说法可以给。
 *
 * 「空盒子」在用着的时候念的是**状态**（「当前没有天空盒」）而不是动作：
 * 那一格点下去本来就不会再发生什么（见 `toggleSkybox`），
 * 给它一个动作名等于承诺一件不会发生的事。
 */
function describeEntry(entry: LibraryEntry): string {
  if ('skybox' in entry) {
    if (!entry.skybox) {
      return isAppliedSkybox(entry) ? '当前没有天空盒' : '关闭天空盒，背景回到背景色'
    }

    return isAppliedSkybox(entry)
      ? `正在使用「${entry.label}」，再点一次关闭天空盒`
      : `把场景背景换成「${entry.label}」`
  }

  if (entry.partsJson) return `追加「${entry.label}」（由 JSON 生成）到场景`

  if (!entry.url) return '追加内置示例几何体到场景'

  const intent = cellIntent.value
  if (!intent) return `追加「${entry.label}」到场景`

  /*
    替换模式的两句也不能省，而且**名词与动词都得跟着靶子走**：「这个门洞**装**的
    就是…」/「这面墙**贴**的就是…」，不能笼统说「换成」——读屏的人听到的是这一句，
    而这一栏现在停在门类、窗类还是墙类是刚刚才切过来的，靶子不自报家门，
    他不知道自己改的是哪一个。两句话整份交给靶子说（`ReplaceTarget.item` / `verb`），
    这里不拼：拼的话这一层就又认识「有哪几种靶子」了（见 `cellIntent` 那段）。
  */
  if (intent.mode === 'replace') {
    return isPicked(entry)
      ? `${intent.target.item}${intent.target.verb}的就是「${entry.label}」`
      : `把${intent.target.item}换成「${entry.label}」`
  }

  return isPicked(entry)
    ? `已选「${entry.label}」用于${intent.purpose}，再点一次取消`
    : `用「${entry.label}」${intent.purpose}`
}

/**
 * 现在该量哪一件资产，空串表示没什么可量的。
 *
 * 量的是**当前待用的那件洞口资产**（门或窗），不是「当前分类里的每一格」：
 * 只在用户点中之后才拉模型，翻分类、把鼠标扫过宫格都不花钱。
 *
 * 判据是 `isOpeningTool` 而不是「这一格有没有写 `width`」——后者正是要被取代的
 * 东西（用户提的「洞口要跟着模型自己的宽度自适应」），拿它当开关等于
 * 「清单里没写数的资产就永远量不出数、永远退回默认档」。
 * 地板用的是 `span`、墙两者都不用，那两类不该为这个白拉一次 glb。
 *
 * 用 `?? ''` 而不是可选链加真假判：`url` 是空串的内置示例几何体条目
 * （见 `isPicked`）会走到这里，空串正好就是「没什么可量的」。
 *
 * **宿主追加的分类永远走不到这里**，而这是结构性的、不是漏了这一条：
 * 判据是 `cellIntent`，它只从 `TOOL_ASSET_RULES` 来，而那张表把四个工具钉在
 * `floor` / `wall` / `door` / `window` 上。追加分类的 key 查不到规则，
 * `cellIntent` 恒为 `null`——它点不到任何工具，也就没有「待用的那件料」可量。
 *
 * **替换模式也不量**（判据里那个 `mode !== 'pick'`）：量出来的数要补到「待用的那件料」
 * 上（`applyMeasuredAssetSize` 读的是 `pickedAssets`），而替换这条路上量出来也没地方放
 * ——替换已经写完了配置，测量是异步的，回来时该做的是**再替换一次**（多一条历史、
 * 而且用户没说要改第二次），不是悄悄改数。所以清单没写宽高的资产在替换时按
 * 「保持洞口原尺寸」兜底（见 `replaceSelectedOpening`）；墙那条更是压根没有尺寸可改，
 * `height` / `thickness` 是一次改全部墙的全局量，见 `replaceSelectedWall`。
 */
const measureUrl = computed(() => {
  const intent = cellIntent.value
  if (!intent || intent.mode !== 'pick' || !isOpeningTool(intent.tool)) return ''
  return pickedAssetFor(intent.tool)?.url ?? ''
})

/**
 * 量好了，把这件资产自己的尺寸交给上面那条链去决定用不用。
 *
 * **这里不做「用不用」的判断**——清单写了数就听清单的、差得远时报一句、
 * 以及「待用的还是不是这一件」，三条都在 `applyMeasuredAssetSize` 里，
 * 因为它要读的是 `pickedAssets` 本身，而那本账在那边。这里只负责
 * 把**量的那个地址**原样递下去，以及「现在还有没有一个占洞口的工具开着」这一条
 * （工具关了、翻走了，就没有「待用的料」这个概念了，写进去只会留下一份没人用的数）。
 *
 * 地址必须是**递下去的那个**，不能回头读 `measureUrl`：回头读拿到的是**新**地址，
 * 配上**旧**测量值，写下去正是一门一窗的错配。
 *
 * 写进去的是尺寸，**不进历史**：它只改「下一笔用什么尺寸」，配置与场景一个字都没动，
 * 撤销栈里因此也没有东西可退。用户连点两格来比较尺寸时不会堆一串没意义的记录。
 */
function applyMeasured(size: { url: string; width: number; height: number }) {
  const intent = cellIntent.value
  if (!intent || intent.mode !== 'pick' || !isOpeningTool(intent.tool)) return

  applyMeasuredSizeFor(intent.tool, size.url, { width: size.width, height: size.height })
}

/**
 * 缩略图加载失败的条目。
 *
 * 只存在组件里，**不写回 LIBRARY_SECTIONS**：后者是「服务器上有什么」这份数据，
 * 这里是「这一次渲染有没有拿到图」，两者混在一起之后，刷新列表也没法让它复原。
 *
 * 记在组件级而不是随分类重建：同一张图挂在两个分类里时两边都该回退占位图，
 * 而且失败过的地址再进 `<img>` 还会再失败一次——这里挡住，连请求都不会发。
 * 切分类**不会**重建这个组件（见上面那段），所以这份记录跨分类是真的活着的。
 */
const broken = ref(new Set<string>())

function markBroken(key: string) {
  broken.value.add(key)
}

/**
 * 没有预览图时的占位图形。
 *
 * 与右栏「场景模型」里代表内置几何体的那个立方体是同一个形状——
 * 两处表达的是同一件事「这是一个模型，只是没有图给你看」。
 */
const ICON_NO_PREVIEW: IconPath[] = [
  { d: 'M12 3 20.5 7.8v8.4L12 21 3.5 16.2V7.8z' },
  { d: 'M3.5 7.8 12 12.6l8.5-4.8' },
  { d: 'M12 12.6V21' },
]

/**
 * 点一格。
 *
 * **三种意思，靠这一格是什么分开**（见上）：
 *
 * - **天空盒**（`'skybox' in entry`）：换掉外面那圈背景，**「空盒子」那一格是关掉**，
 *   两者都在 `toggleSkybox` 里；
 * - **有配料工具开着、且正停在它那一类**（`cellIntent` 的 `pick`）：选来当铺装，
 *   **不动场景**，只记住「待用哪一件」，等用户在视口里划出区域 / 画出墙 / 点下洞口
 *   才用上（地基走 `layFloorModel`，墙与门窗是把地址写进墙对象 / 洞口对象）；
 * - **空档里选中了某个东西（洞口或墙）、且正停在它那一类**（`cellIntent` 的
 *   `replace`）：**把它的外观换成这一件**——洞口那边尺寸跟着新料重开洞
 *   （`replaceSelectedOpening`），墙那边只换地址、不动几何（`replaceSelectedWall`）；
 * - **其余**：追加一个模型到场景。
 *
 * 为什么第二次点同一件料是**取消选用**而不是「再选一次」：得让「不选料、直接用灰色默认」
 * 那条老路径一直够得到，不然第一次选完之后它就再也回不去了，等于把地基与画墙
 * 改造前唯一的行为做没了。手势上也是这一族的惯例（再点一次工具关掉、
 * 再点同一个位置删掉门窗）。天空盒那个「再点一次关掉」是同一个惯例的另一种用法——
 * 那边点第二次时，用户要的是「回到没有天空盒的样子」，而不是把同一张图再设一遍。
 * 「空盒子」是这条惯例的**终点**：它本身就是「没有天空盒」，所以点它只会关，
 * 不会开（见 `toggleSkybox` 里那段）。
 *
 * **替换那一支不走这个惯例**：再点同一格不会把外观撤掉，只会说一句「装的就是它」
 * （墙那边是「贴的就是它」，判据见 `ReplaceTarget`）——用户是在说「把这一件换上去」，
 * 不是「不要了」（所以两条替换的路写的都是 `setAssetPick` 而不是 `toggleAssetPick`）。
 *
 * 反馈**刻意不对称**：追加会在右栏「场景模型」多出一行、视口里多一个物体；
 * 而选用只有左栏这一圈琥珀和视口底部的一句话——因为它确实什么都没改。
 * 天空盒更直接：背景当场就变了（那六张图加载完之后），左栏那一格也会有底色。
 *
 * 追加本身是**追加**而不是替换，点同一条两次会得到两个独立模型——
 * 这对于「同一个模型摆两种姿态对比」是常用用法。
 *
 * **宿主追加的分类只有「追加」这一种意思**：它的 key 不在 `TOOL_ASSET_RULES` 里，
 * 于是 `cellIntent` 恒为 `null`，点一下就是追加到场景。这是设计如此——
 * 选料这件事不开放给宿主（理由在 `useModelLibrary.ts` 顶上那一节）：
 * 工具只从内置那四类里挑料，宿主加的分类既点不到工具、也不进量尺寸那条链。
 * 条目形状是同一个（`LibraryEntry`），所以「已在场景里」的底色高亮、空态文案、
 * 缩略图 404 兜底在这里一样生效。
 *
 * **由 JSON 生成的模型（`partsJson`）要先读一遍再决定追加不追加**，见 `addGenerated`。
 */
function add(entry: LibraryEntry) {
  if ('skybox' in entry) {
    toggleSkybox(entry)
    return
  }

  if (entry.partsJson) {
    addGenerated(entry)
    return
  }

  const intent = cellIntent.value

  /*
    替换：空档里选中了某个东西（洞口或墙），而且这一栏正停在这一类上——点一格就是
    「换掉它」。两个模式按构造互斥（见 `cellIntent` 那段），所以这条与下面那条
    谁在前都行。

    **靶子有几种，这里都走同一条**：`apply` 是靶子自己带的回调——洞口那条写的是
    `replaceSelectedOpening`（尺寸跟着新料重开洞），墙那条是 `replaceSelectedWall`
    （只换地址，不动几何）。

    `entry.url` 为空时**落回追加**（下面那条 `entry.url` 的判据各自都带）：空地址
    没有 `.glb` 可指。洞口那边写进去会让它翻回程序构件那一侧，于是洞里既少了框扇、
    又没有模型，只剩一个空洞；墙那边写进去被 `SceneFloorplan.vue` 判回灰盒子，
    于是白白留下一个 `url: ''` 的脏键（那一条链上完整的账在 `replaceSelectedWall`）。
  */
  if (intent?.mode === 'replace' && entry.url) {
    intent.target.apply({
      url: entry.url,
      label: entry.label,
      span: entry.span,
      width: entry.width,
      height: entry.height,
    })
    return
  }

  if (intent?.mode === 'pick' && entry.url) {
    /*
      `span` / `width` / `height` 原样搬过去：它们是这件资产的属性，
      不是这个组件能解释的东西（解释在 `useModelLibrary.ts` 的 `LibraryFile` 上）。
      **三个都整份带上，不按分类挑**——今天只有门与窗写了后两个、只有地板写第一个，
      而「哪一类有哪个数」是清单的事，这里多写一句判断就等于在界面上再抄一遍那张表。
    */
    toggleAssetPickFor(intent.tool, {
      url: entry.url,
      label: entry.label,
      span: entry.span,
      width: entry.width,
      height: entry.height,
    })
    return
  }

  const index = scene.addModel(entry.url)

  /*
    显式写名字。
    留空的话显示名会回退到 deriveModelId，而它的 toKebab 只保留 [a-z0-9]
    （src/utils/modelId.ts），中文名会被整段剥掉、回退成 'model'——
    一排中文模型在右栏列表、事件载荷和 HUD 里会全部变成同一个词。

    这一步不会多出一条历史记录：带 label 的 patchModel 会先清掉防抖计时器
    再同步 commit，快照里同时包含刚追加的模型和这个名字。
  */
  if (entry.url) scene.patchModel({ name: entry.label }, `添加模型 · ${entry.label}`, index)

  pushEvent(
    // 第三支（由 JSON 生成）不在这里：它在 `addGenerated` 里就返回了，
    // 所以这个三元只有两种可能，不必为「已经处理过的情况」再写一句
    entry.url
      ? `已追加模型「${entry.label}」（场景中第 ${index + 1} 个）`
      : `已追加内置示例几何体（场景中第 ${index + 1} 个）`,
  )
}

/**
 * 追加一个**由 JSON 生成**的模型（`LibraryEntry.partsJson`）。
 *
 * ## 为什么在这里先读一遍
 *
 * 渲染端读不出来只会得到一片空白，而**一片空白与「这个模型本来就不该有东西」
 * 长得一模一样**——没人会去查。所以追加之前先读一次：读不出来就**不追加**，
 * 并在日志里说清是哪一格、为什么。把错误挡在「配置里根本没有这一条」这一步，
 * 比事后让人对着一片空白猜要好得多。
 *
 * 宿主那一侧也一样：它给的是一段文本，文本错了是它的问题，而这句话是它唯一
 * 能拿到的反馈（渲染端那句控制台警告要等到真摆进场景里才会出现）。
 *
 * ## 为什么要连「逐件剔掉」也报一句
 *
 * 11 件里读出来 8 件是**一个看起来正常的模型**，少掉的那三件没有任何视觉线索。
 * 不说的话，用户会以为这份零件表本来就是 8 件，然后去别处找原因。
 *
 * ## 名字与零件表**一次**写进去
 *
 * `patchModel` 带 `label` 时会先清掉防抖计时器再**同步**提交一条历史，
 * 所以这一次调用就是一条记录、一份快照，里面同时有几何与名字。
 * 拆成两次调用会得到两条历史，撤销一次只退掉一半——表现是「模型还在，
 * 名字变回 'model' 了」。这与 `add` 里那条 `patchModel({ name })` 的注释是同一件事。
 *
 * 不写 `url`：它的地址本来就是空串（`addModel('')` 已经写好了），而 `url` 非空
 * 会盖过 `partsJson`（两个来源互斥时 `url` 优先，见 `ModelConfig.partsJson`）。
 */
function addGenerated(entry: LibraryEntry): void {
  // 调用处判过它非空（`add` 里那条分支），这里再取一次是为了让这个函数自己站得住：
  // 它不该假设调用方一定先判过——`parseModelParts('')` 会自己给出一句人话
  const json = entry.partsJson ?? ''
  const result = parseModelParts(json)

  if (result.problem) {
    pushEvent(`「${entry.label}」的零件表读不出来，没有追加：${result.problem}`)
    return
  }

  /*
    一件都没读出来时也不追加。

    与「整份读不出来」分开说：这一种的 JSON 本身是对的、只是里面每一件都不合格，
    原因完全不同（要去看 `shape` / 尺寸 / `count` 那些字段），
    合成一句话会让人以为是格式坏了。
    不追加的理由与上面一样：一个画不出任何东西的模型条目摆进场景，
    在右栏列表里占一行、在视口里是空的，而它看起来与「模型没加载出来」没区别。
  */
  if (!result.parts.length) {
    pushEvent(`「${entry.label}」的零件表里一件都读不出来，没有追加`)
    return
  }

  if (result.dropped > 0) {
    pushEvent(
      `「${entry.label}」的零件表里有 ${result.dropped} 件读不出来，已经跳过，其余照画`,
    )
  }

  const index = scene.addModel('')
  scene.patchModel({ partsJson: json, name: entry.label }, `添加模型 · ${entry.label}`, index)

  pushEvent(`已追加模型「${entry.label}」（由 JSON 生成，场景中第 ${index + 1} 个）`)
}

/**
 * 点一格天空盒：换成它；**已经在用的那一个再点一次就是关掉**；
 * **「空盒子」那一格点下去就是关掉**——它自己就是「一个都不用」那个状态。
 *
 * ## 这一下该写什么，是算出来的
 *
 * 要写进 `sun.skybox` 的值只有三个来源：这一格是空盒子（写 `null`）、
 * 这一格正用着（写 `null`，也就是那个「再点一次」）、其余（写它的六张面图）。
 * 三个来源两种结果，所以先算出 `next` 再走同一条写入——分成两支写的话，
 * 「空盒子」那一支与「再点一次」那一支会各写一遍 `null`，
 * 而两处里改错一处的表现是「关不掉了」，正是这段代码最该守住的那条。
 *
 * ## 已经在关着的时候，点「空盒子」什么都不发生
 *
 * 它亮着（`isInScene`）说明现在就是一个天空盒都没有，这一下没有可改的东西。
 * 但**不能一声不吭**：这一格是亮的、看着是可以点的，点下去什么都不动，
 * 看起来像坏了。所以给 HUD 一句话，而不是往历史里塞一条什么都没改的记录。
 * 这与「追加一个已经在场景里的模型」不同——那边确实会多摆一份。
 *
 * ## 写进配置的是六个完整地址
 *
 * 不是一个「第几号」。与 `models[].url` 同一条理由：配置要能自己站住——
 * 导出成 JSON 拿到别处、或者存进本地草稿隔天再导入时，不该依赖
 * 「那个编号在那台服务器上还是第几号」。
 *
 * 地址要**拷一份**再写：`applyConfig` 走的 `applyPatch` 对数组是整体装入
 * （`isPatchObject` 显式排除数组），直接把条目里那个数组交出去，
 * 配置里那一格就成了库里的常量本身（`cloneModelPatch` 那段注释讲的是同一件事）。
 *
 * ## 与「环境贴图」预设互斥
 *
 * 两者写的是同一个 `scene.environment`，只可能有一个在生效，所以这里顺手把
 * `environment` 清成空串。不清的话，一个**手上已经有 `environment` 的场景**
 * （宿主经 props 给的、或者导入的 JSON 里带的）点一下天空盒会变成
 * 「看起来没生效」——天空盒那边无条件胜出（`SceneSun` 的模板解释了为什么），
 * 而配置里那个预设仍然写着。
 *
 * **这个不变量现在只剩这一处在写。** 反方向那一条（在右栏选环境贴图时把
 * `skybox` 清成 `null`）原先住在 `useInspectorSchema.ts` 那个下拉框的 `apply` 里，
 * 随这次搬家一起删掉了——那一格现在是场景预设，见 README 设计决定 41。
 * 所以今天「两个字段同时有值」是配置里合法存在的一种状态，由渲染层裁定
 * （天空盒赢），而不是被编辑器挡住。这是删掉那个下拉框的**必然代价**：
 * 一个没有入口的字段，配不上一条只有入口才写得出来的清空规则。
 *
 * 关掉用 `null` 而不是空数组：`SkyboxFaces` 是个定长元组，没有「六个都是空串」
 * 这种合法值，而 `applyPatch` 只跳过 `undefined`、不跳过 `null`，所以
 * 「关掉」在这份配置里是写得出来、也存得下去的（撤销、导出都跟着走）。
 * 「空盒子」那一格靠的就是这一条：它写的值与「关掉」完全一样，
 * 所以它不需要任何新的配置形状。
 *
 * 带 label 的 `applyConfig` 会**同步**提交一条历史，与追加模型那条一致：
 * 换天空盒是一次明确的动作，不该混进 400ms 的防抖里。
 */
function toggleSkybox(entry: LibraryEntry) {
  if (!('skybox' in entry)) return

  const faces = entry.skybox
  const next = faces && !isAppliedSkybox(entry) ? ([...faces] as SkyboxFaces) : null

  if (!next && !appliedSkybox.value) {
    pushEvent('当前没有天空盒')
    return
  }

  scene.applyConfig(
    { sun: { skybox: next, environment: '' } },
    next ? `应用天空盒 · ${entry.label}` : '关闭天空盒',
  )

  pushEvent(next ? `已应用天空盒「${entry.label}」` : '已关闭天空盒，背景回到背景色')
}
</script>

<template>
  <!--
    模型库：只放**当前分类**的宫格。分类改成左栏导轨上的一项了
    （见 `SidePanel.vue`），所以这里不再有任何分类表头或 tab 栏。

    导轨上每一项都带这一类的数量，挂在悬停提示里。代价是**必须悬停才看得见**：
    「哪一类是空的」不再一眼可见——所以同一个数字也写进了 `aria-label`，
    读屏用户没法悬停，数量只放提示里就等于对他们不存在。

    切换的反馈是**刻意不对称**的：预设 ↔ 库是页面级切换，面板体
    （`.ed-side-body`，它自己就是 `.ed-tabpanel`）整块重建并淡入；
    库内切分类不重建组件，靠「内容瞬换 + 导轨上琥珀高亮移动 + 滚动归零」给反馈。
    给宫格补一个 `.ed-tabpanel` 去要淡入**恰恰不行**：`ed-rise` 是 translateY(6px)，
    两层同帧叠加会变成 12px 的错位（editor.scss 里那条注释点名批评过这个形态）。

    一格一个模型：一张方形缩略图，下面一行**常显**的名字。

    一行两个而不是四个——内容区 200px 里每格约 96px、缩略图约 86px；
    再分细缩略图就只剩图标大小，名字条也塞不下几个字。
    名字常显是拿版面换来的：格子比只放缩略图时高约一行、一屏少看一行，
    换来的是「哪一格叫什么」不必悬停就能读（原先名字是悬停才浮出来的浮层，
    见 editor.scss 里 `.ed-lib-name` 那段）。

    格子本身就是按钮，不做「先选中再确定」两步——而它**有三种意思**：
    追加到场景、给某个工具当铺装、或者换掉背景的天空盒（「空盒子」那一格是
    **关掉**天空盒，同一支里，见 `add`）。名字条与缩略图都只是视觉，
    读屏拿到的是 `aria-label` 那一整句。

    这一类还可能整个**由宿主接管**：宿主追加的分类（`SidePanel.vue` 的
    `extraSections`）配上一个 `#list` 插槽时，下面三分支里的第一支把宫格交出去，
    **内置五类不受影响**——见那一支上面的注释。
  -->
  <!--
    **宿主接管这一类的列表**：两个条件同时成立才走这支——当前是**追加**分类
    （`isExtraSection`），且宿主真的写了 `#list`。

    内置五类**永远走下面那支宫格**，插槽管不到：那是「插槽只用于追加、
    不作为覆盖」这条约定的落点。宿主也覆盖不了——`sections` 那张表恒是
    「内置在前」的拼接，把内置分类从表里拿掉就等于把工具那条链指空
    （`useModelLibrary.ts` 顶上那一节）。

    这一支抢在 `v-else-if` 之前，所以**空的追加分类也归宿主**：宿主既然接管了
    这一类怎么画，那一类的空态该怎么说话就是宿主的事，编辑器不替它显示
    「这一类暂时还没有模型。」。

    接管之后连**滚动容器**也是宿主的（宫格那套 `ed-list ed-list--grow ed-scroll`
    在下面那支里，这里不代劳）——README 里那段示例照抄了这几个类名。

    作用域给出的就是当前分类本身（`section`，含 `entries`），也就是
    「这个 tab 分类下的模型数据列表」。**不额外给 `isInScene` / `isPicked`
    这类判断**：宿主自己画的格子自己说了算，而宿主只用 `extraSections` 不写插槽时，
    宫格那套高亮本来就自动生效。

    三分支（宿主接管 / 内置宫格 / 空态）仍是紧挨着的 `v-if` / `v-else-if` / `v-else`，
    下面那个探针继续当最后一个根节点。
  -->
  <slot v-if="isExtraSection && !!$slots.list" name="list" :section="section" />

  <!--
    宫格**自己就是那个滚动口**（.ed-list--grow + .ed-scroll），是左栏唯一的滚动列表，
    5px 内边距来自 `.ed-list` 本身（右栏那几份清单也一样，见 editor.scss 里的分节）。

    `:key="librarySection"` 是**功能必需，不是为了动画**：不加它，这个 div 在分类
    之间是同一个元素，`scrollTop` 会被留下来——从一条长列表切到另一条仍溢出的
    列表时，一进新分类就落在半中间甚至掉到底部。换 key 让它重新挂载，位置自然归零。

    key 落在**这个元素**上，不能上提到 `<ModelLibrary :key>`：Vue 的 key 只改这
    一个 vnode 的身份，重挂的是元素、不是组件实例，于是 `broken` 与已经加载好的
    `<img>` 都活着（上提到组件上就会退化成脚本里那段注释点名的那条回归）。
    也不能挪到面板体 `.ed-side-body`——那里原先绑的是左栏的页面 key（已随那个页面
    一起删掉），两个 key 各管各的语义，混用就回到了上面那条回归。

    `v-if` 那一族分支当根是合法的（先例 InspectorField.vue），这里没有
    attrs 要透传；父级 `.ed-side-body` 是 flex 列，所以撑满 / 贴顶的行为与改造前一致。
  -->
  <div v-else-if="section.entries.length" :key="librarySection" class="ed-list ed-list--grow ed-scroll ed-lib-grid">
    <button v-for="entry in section.entries" :key="entry.key" type="button" class="ed-item ed-lib-cell"
      :class="{ 'ed-item--active': isInScene(entry), 'ed-lib-cell--picked': isPicked(entry) }"
      :aria-label="describeEntry(entry)" @click="add(entry)">
      <!--
        格子的图，**三支**，顺序是有讲究的：

        1. 文本图标（`entry.icon`）—— 排在 `<img>` **之前**。宿主写 `icon` 就是在说
           「这一格的图用它」，而内置清单里的 `thumb` 是**无条件猜出来的**
           （同名 `.png`，见 `useModelLibrary.ts` 的 `resolve`），
           明写的盖过猜出来的。程序生成的模型通常两者都没有，这一支就是它的图。
        2. 服务器上的缩略图。`thumb` 有值、且没挂过（`broken`）才走这里。
        3. 立方体占位图形。

        `icon` 那一支**不参与 `broken`**：它是文本、没有请求可失败，
        把它塞进那套记账里只会多一个永远不会被写入的 key。
        它也不判空串——空串是假值，会自己落到下一支去，不必另写一句。

        `alt` 留空、`aria-hidden` 都在同一件事上：按钮的名字由 `aria-label` 给，
        图与名字条都只是视觉。
      -->
      <span v-if="entry.icon" class="ed-lib-thumb ed-lib-thumb--glyph-text" aria-hidden="true">{{
        entry.icon }}</span>
      <img v-else-if="entry.thumb && !broken.has(entry.key)" class="ed-lib-thumb" :src="entry.thumb" alt=""
        loading="lazy" @error="markBroken(entry.key)" />
      <svg v-else class="ed-lib-thumb ed-lib-thumb--glyph" viewBox="0 0 24 24" aria-hidden="true">
        <path v-for="(part, i) in ICON_NO_PREVIEW" :key="i" :d="part.d"
          :fill="part.fill ? 'currentColor' : 'none'" />
      </svg>

      <span class="ed-lib-name">{{ entry.label }}</span>
    </button>
  </div>

  <!--
    空分类照常显示一句话，而不是整个面板变白：导轨上那个 `0` 已经说了「这一类是空的」，
    这里补一句人话。文案只说「这一类是空的」，**不写「点某个工具再回来」那种指路**——
    空着的分类未必有对应的工具（内置这五类眼下都有货，但宿主传进来的空分类就一定没有，
    追加分类本来就点不到任何工具），指了就是撒谎。
    （左栏另一页的空态没有这条约束：那里的每一处都对应一个真在的功能。）
  -->
  <p v-else class="ed-hint ed-hint--quiet ed-lib-empty">这一类暂时还没有模型。</p>

  <!--
    量尺寸的探针：选中一件洞口资产之后，把它的 glb 拉下来量一次包围盒，
    量出来的宽高补到待用的那份料上（见 `applyMeasured`）。

    **它不画任何东西**（组件内部渲染的是注释节点），所以它是最后一个根节点
    也不影响上面那三分支——`v-if` / `v-else-if` / `v-else` 仍然是紧挨着的。

    `:key="measureUrl"` 是功能必需：换一件料要重新挂一个实例、重新拉一次模型，
    而不是让同一个实例去 `watch` 地址变化（两条路的差别写在探针组件里）。
    反过来，`v-if` 也是必需的——没有它，探针会在「什么都没选中」时挂载，
    而 `useGLTF` 一挂载就会拿空地址去 load 一次，那会是一次打到当前页面的请求。
  -->
  <ModelMeasureProbe
    v-if="measureUrl"
    :key="measureUrl"
    :url="measureUrl"
    @measured="applyMeasured"
  />
</template>
