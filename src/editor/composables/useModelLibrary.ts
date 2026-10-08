import { computed, type ComputedRef } from 'vue'
import { useEditorAssets } from '../assets'
import { useSceneStore } from '../../stores/scene'
import type { EditorAssetEntry } from '../assets'
import type { SkyboxFaces } from '../../types'

/**
 * 模型库。
 *
 * ## 清单从哪来
 *
 * **内置的只有「有哪五类」这件事与兜底那份条目表。** 这个文件里写死的是五个
 * 分类的 `key` / `label` / `kind` 与它们的先后（下面的 `LIBRARY_SHAPE`），
 * 以及「一个目录一个模型，目录里放同名的 .glb 与 .png」这套拼地址的约定；
 * 条目本身来自 `useEditorAssets()`——正常就是 `defaultAssets.ts` 那份库内置的
 * 标准素材表，宿主也可以整份换掉（`createThreeDMaker({ assets })`）
 * 或只换根地址（`SceneViewer` 的 `assetBaseUrl`）。
 *
 * 这么切是因为**「哪一类」是承重的、得由编辑器定，而「这一类里有什么」
 * 是素材包长什么样、该有份能用的默认**：真实宿主装完库写一句
 * `<SceneViewer editable />` 就该看到五个分类有货，而不是先配一份表。
 * 早先的规矩反过来（库一个字面量地址都不含、缺省是空表），代价是每一家宿主
 * 都得先做那道功课，而漏做的表现是「左栏空的、不报错」。见设计决定 50。
 *
 * 刻意**不去抓服务器的目录索引页**，即使那台 nginx 已经开了 autoindex、
 * 抓下来解析出列表是可行的：
 *   - 抓目录页 = 把整棵目录结构暴露在页面上，谁打开编辑器都能看到
 *     服务器上放了什么、叫什么名字。列表写死在数据里就没有这个口子。
 *   - 目录页的响应也不带 Access-Control-Allow-Origin（实测），
 *     生产环境要靠再开一条 CORS 规则才能读，等于为了这个功能放宽服务器配置。
 *   - 写死的列表在离线、代理没配好、服务器换路径时都还能用。
 *
 * 代价是**往服务器上放了新模型要去 `defaultAssets.ts` 里加一行**。
 * 这是有意的取舍。
 *
 * ## 内置的这五类：工具钉住的那四类 + 天空盒
 *
 * `floor` / `wall` / `door` / `window` 是四个工具（地基 / 画墙 / 门 / 窗）各自要用的料，
 * 编辑器自己就必须有；`skybox` 是「换掉外面那圈背景」这件编辑器自带的功能。
 * **其余的都归宿主**：家具、设备那类「往场景里摆的独立物体」不在这五类里，
 * 由宿主通过 `SidePanel.vue` 的 `extraSections` 传进来。
 *
 * ## 分类的 key 是承重的，所以与「条目」分开、留在编辑器这一侧
 *
 * `LIBRARY_SHAPE` 那五个 key**宿主改不动**：`useFloorplanTool.ts` 的
 * `TOOL_ASSET_RULES` 把地基 / 画墙 / 门 / 窗四个工具钉在 `floor` / `wall` /
 * `door` / `window` 上，`SidePanel.vue` 的 `SECTION_ICONS satisfies
 * Record<LibrarySectionKey, IconPath[]>` 又要它们是一个编译期字面量联合
 * （新加一类忘了画图标要红）。宿主换掉一个 key，工具那条链就静默指向一个
 * 不存在的分类——点「画墙」跳到「我的模型」去，不报错。
 *
 * 所以**宿主给的那份表只按 key 取条目，key 不在那五个里的分类会被忽略**
 * （要加分类走 `extraSections`，那条路才带图标与插槽）。少给一类不是错误：
 * 那一类照常出现在导轨上，宫格里是空态文案。
 *
 * ## 宿主还能**追加**分类，但只能追加
 *
 * `SidePanel.vue` 的 `extraSections` 只能往后接，合并出来的表恒是「内置五类 +
 * 宿主那几类」。追加的套用同一套条目形状（`LibraryEntry`），于是「已在场景里」
 * 的底色高亮、选用态、空态文案、缩略图 404 兜底、「点一下追加到场景」全部自动生效。
 *
 * 追加分类**点不到任何绘制工具**，也就进不了选料与量尺寸那两条链
 * （`ModelLibrary.vue` 的 `cellIntent` / `measureUrl` 都认 key）。
 *
 * **纪律：本文件永远不 import `useEditorState`。**
 * 它会给 `useEditorState` 提供左栏的默认分类，于是「谁依赖谁」只有一个方向才对。
 * 反向再引一次就是真正的环——两个模块顶层**都有副作用**（这边建 computed、
 * 那边建 ref），环下必有一方拿到 `undefined`，而且是在生产构建里才发作。
 * 要在这里 `pushEvent` 之前，先把状态搬出去。
 */

/**
 * 内置五类：key、显示名、以及这一类里的东西点一下是干什么的。
 *
 * 顺序即界面上的显示顺序。**条目不在这一份里**（它从 `useEditorAssets` 进来，
 * 缺省是 `defaultAssets.ts` 那份标准素材表）。
 *
 * `as const` **不能省**：它是下面 `LibrarySectionKey` 能推成字面量联合的唯一原因，
 * 而 `SidePanel.vue` 的 `satisfies Record<LibrarySectionKey, IconPath[]>` 正是靠
 * 那个联合把「新加一个分类但忘了画图标」变成编译错误的。去掉 `as const`，
 * `key` 被拓宽成 `string`，那条约束会静默退化成 `Record<string, …>`——不报错，
 * 只是导轨上少一格，得靠眼睛发现。
 */
const LIBRARY_SHAPE = [
  { key: 'floor', label: '地板', kind: 'model' },
  // 「墙壁」挨着「地板」：两者是同一件事的两种铺面（一个铺地、一个铺墙），
  // 而所有可平铺的纹理类资产都在这两类里。
  { key: 'wall', label: '墙壁', kind: 'model' },
  /*
    「门」与「窗」紧挨着「墙壁」：两者都是**墙面上的构件**，与地板 / 墙壁一样是
    「按工具铺上去的料」。它们也是两个**没有独立摆放路**的分类——点它选料之后，
    要落到视口里靠的是「门」/「窗」那两个工具在墙上点一下
    （`TOOL_ASSET_RULES.door` / `.window`）。

    内置这五类**全是「按工具铺上去的料」或背景**，没有一类是「往场景里摆的独立
    物体」——家具、设备那种由宿主传。这条分界不是巧合：工具能钉住的只有「铺料」
    这一类，而工具钉不住的东西编辑器自己就不必内置。

    「窗」排在「门」之后而不是之前：门是这一族里先做出来的那一个（整条链、
    清单格式、日志口径都是照它定的），窗跟着它走同一条路，读顺序上也跟着它。
    两者在渲染层是**同一个组件**（`SceneFloorplanOpeningModel`），
    条目里也共用同一对可选字段（`width` / `height`）。
  */
  { key: 'door', label: '门', kind: 'model' },
  { key: 'window', label: '窗', kind: 'model' },
  /*
    「天空盒」排在最后：它是这份表里唯一一类**不是往场景里摆的实体**——
    它描述的是「外面那圈背景」，与地板墙壁门窗不是同一个范畴的东西，
    摆在一起只会让人以为它也是个可以摆的物件。`kind: 'skybox'` 说的就是这件事，
    它在点击行为与资产摆放约定上都是另一套（见下面的 `resolveSkyboxFace`）。
  */
  { key: 'skybox', label: '天空盒', kind: 'skybox' },
] as const satisfies readonly { key: string; label: string; kind: 'model' | 'skybox' }[]

/**
 * 分类的 key。**由上面的 `LIBRARY_SHAPE` 推导**，不是手写的联合：
 * 加一个内置分类只需要改那一个字面量，这里自动跟上，永远不会脱钩。
 */
export type LibrarySectionKey = (typeof LIBRARY_SHAPE)[number]['key']

/** 渲染用的条目。地址在这一层拼一次 */
export interface LibraryEntry {
  /**
   * v-for 的 key。用地址本身，天然唯一。
   *
   * 没有地址的两条各自有一个写死的 key（模型那边是 `'builtin'`、
   * 「空盒子」这一格是 `'skybox-off'`）。
   */
  key: string
  label: string
  /**
   * 模型地址。
   *
   * 空串表示**这不是一个模型**：要么是内置示例几何体（不联网），
   * 要么是一条天空盒（它的地址在 `skybox` 里）。两种都读作「没有 .glb 可加载」，
   * 所以判空之后还得分一次流——调用方看的是 `skybox` 在不在，不是这个字段。
   */
  url: string
  /** 缩略图地址，空串表示没有，界面上回退到立方体图标 */
  thumb: string
  /**
   * **文本图标**（一个 emoji 字符串，比如 `'📦'`）。可选，只在宫格格子里用。
   *
   * 它补的是「这一类资产没有 `.png` 可显示」那种情况：宿主从后端拼出来的模型
   * 清单常常只有一段数据、没有配套的图，那时给一个 emoji 比让每一格都显示
   * 同一个立方体占位图有价值得多——一格一个图标，一眼能分出是什么东西。
   *
   * 排在缩略图**之前**判（见 `ModelLibrary.vue` 的宫格）：内置清单里的 `thumb`
   * 是**无条件猜出来的**（同名 `.png`），而 `icon` 是明写的，明写的盖过猜出来的。
   *
   * **与 `ExtraLibrarySection.icon` 同名不同型**，别串了：那一个是**导轨**上的
   * 图标，类型是 `LibraryIconPath[]`（SVG 路径数组，要描边要填色），住在分类上；
   * 这一个是**格子**里的图，类型是 `string`（一个字符），住在条目上。
   * 两者层级不同、类型不同，写错在编译期就红。
   *
   * 内置五类**一个都没写它**：那五类的资产都在服务器上、都有 `.png`
   * （`EditorAssetEntry.thumb` 那个字段是另一回事，它一次都没被读过）。
   */
  icon?: string
  /**
   * **一段 JSON 文本**，里面是一张零件表——这一格的东西不是从服务器下载的
   * `.glb`，而是**程序生成**的几何体。可选，原样搬给 `ModelConfig.partsJson`
   * （那边解释了这段文本的格式、校验时机与 `url` 的优先关系）。
   *
   * 有它的条目**地址是空串**，与「内置示例几何体」那一条撞在同一个值上——
   * 所以判「在不在场景里」不能只看 `url`，要另起一个集合（`scenePartsJsons`，
   * 下面那段解释了为什么）。这与天空盒那次事故是同一个坑，那次是
   * 「三十多格一起亮」。
   *
   * 条目**只管搬运**，一个字都不解析：读它的是 `ModelLibrary.vue` 的 `add`
   * （追加之前先校验一遍，读不出来就不追加），以及渲染端。
   */
  partsJson?: string
  /**
   * 原样带过来的 `EditorAssetEntry.span`（那边解释了它是什么）。
   * 条目**只管搬运**，怎么用是 `useFloorplanTool` 与 `layFloorModel` 的事。
   */
  span?: number
  /**
   * 原样带过来的 `EditorAssetEntry.width` / `height`：这件资产要占用多大的洞口。
   * 条目同样**只管搬运**（理由与 `span` 一字不差），读它的是
   * `useFloorplanTool.ts` 的 `placeOpeningAt`（门与窗共用，那边按工具名取）。
   */
  width?: number
  height?: number
  /**
   * 有它就说明这一格是天空盒那一类，值就是点下去要写进 `sun.skybox` 的东西：
   * 六张面地址（顺序见 `SkyboxFaces`）是「换成这个天空盒」，**`null` 是
   * 「空盒子」那一格——点它是关掉**。
   *
   * **判据是这个键在不在（`'skybox' in entry`），不是它真不真。** 三种状态都要
   * 分开：没这个键 = 模型条目；`null` = 空盒子；六元组 = 一个真天空盒。
   * 真值判别只能分出「六元组」与「其余两种」，而这两种要走的路完全不同——
   * 空盒子的 `url` 与内置示例几何体的 `url` 都是空串，落错分支不会报错，
   * 只会让点「空盒子」往场景里追加一个示例几何体。
   * 用到它的四处（`ModelLibrary.vue` 的 `isAppliedSkybox` / `isInScene` /
   * `describeEntry` / `add`）**一律写 `in`**。
   */
  skybox?: SkyboxFaces | null
}

/** 渲染用的分类：分类名 + 已经拼好地址的条目 */
export interface LibrarySection {
  /** 分类的 key，同时当 v-for 的 key 用 */
  key: LibrarySectionKey
  label: string
  /**
   * 这一类里的东西点一下是干什么的，原样搬自 `LIBRARY_SHAPE`。
   *
   * 渲染层目前只有一个地方用它：导轨上的数量单位（`SidePanel.vue`）——
   * 「地板 · 2 个模型」与「天空盒 · 38 个天空盒」。
   *
   * 为什么值得为量词多带一个字段：那一句**同时也是 `aria-label`**，
   * 而「38 个模型」描述的是一个根本没有 `.glb`、也不往场景里摆东西的分类。
   * 量词是这一类唯一说得出「它不是模型」的地方。
   */
  kind: 'model' | 'skybox'
  entries: LibraryEntry[]
}

/**
 * 导轨图标里的一段路径。
 *
 * 与 `useInspectorSchema.ts` 的 `IconPath` **结构上一模一样**，这里刻意再写一遍、
 * 不去 import 它：那条 import 会连出一条真环——`useInspectorSchema` →
 * `useEditorState` → 本文件，而本文件对 `useEditorState` 是上游。`import type`
 * 今天擦得掉，但**依赖「擦得掉」正是本文件顶上那条纪律点名不许做的事**。
 * 两处形状一致由 `SidePanel.vue` 的取图标那一行兜着：`SECTION_ICONS` 那个表
 * 与它同处一个 `??` 表达式，任一边改了字段都会在那里红。
 */
export interface LibraryIconPath {
  /** 画在 24 格里的描边路径，只吃 currentColor（描边粗细与端点在 CSS 里） */
  d: string
  /** 为真时用 currentColor 填实，否则只描边 */
  fill?: boolean
}

/**
 * **宿主追加的一个分类**（`SidePanel.vue` 的 `extraSections`）。
 *
 * 与 `LibrarySection` 只差两处，都是从「内置」与「追加」的分工推出来的：
 *
 * - **`key` 是自由的 `string`**，不是那个字面量联合——追加分类的 key 是运行时
 *   才知道的。内置那五个必须留在联合里：`SECTION_ICONS satisfies SafeIcons`
 *   与 `TOOL_ASSET_RULES` 两处编译期守卫都靠它，拓宽成 `string` 两处会一起静默失效。
 * - **`icon` 可选**（内置那五个不写这个字段，它们的图标在 `SECTION_ICONS` 表里）。
 *   追加分类不写它，导轨上退回立方体占位图——看得见，不会静默空白。
 *
 * 条目复用 `LibraryEntry`，于是「已在场景里」的底色高亮、选用态、空态文案、
 * 缩略图 404 兜底、「点一下追加到场景」全部自动生效（`ModelLibrary.vue` 一个字不改）。
 * 唯一拿不到的是**选料**：追加分类点不到任何工具，理由见本文件顶上那一节。
 */
export interface ExtraLibrarySection extends Omit<LibrarySection, 'key'> {
  key: string
  icon?: LibraryIconPath[]
}

/**
 * 左栏合并表里的一项：内置五类 + 宿主追加的那些。
 *
 * 两个组件（`SidePanel` 建表、`ModelLibrary` 消费）都要用它，所以住在这里而不是
 * 某一个组件里——它们之间传的是**同一个数组**，类型也必须是同一个。
 */
export type MergedLibrarySection = LibrarySection | ExtraLibrarySection

/**
 * 天空盒六个面在服务器上的文件名。
 *
 * **顺序就是 three 的 `CubeTextureLoader` 要的顺序**——`[+X, -X, +Y, -Y, +Z, -Z]`
 * （`src/types.ts` 的 `SkyboxFaces` 有完整解释）。所以这张表的含义是
 * 「three 的六个位置依次对应服务器上的哪张图」，而不是「前后左右上下」。
 *
 * **这套资产的 front/back 和社区惯例是反的，这一条是量出来的、不是推出来的。**
 * 惯例里 `[px,nx,py,ny,pz,nz]` 对应 `[right,left,top,bottom,front,back]`——
 * 名字按**世界轴**读，`front` 就是 +Z。这里不是：`front` 落在 −Z、`back` 落在 +Z，
 * 六个名字都按**相机朝向**读，而 three 的相机默认朝 −Z。这样一来六个名字
 * 恰好各自落在同名那根轴上，一张图都不用翻、也不用转。
 *
 * 怎么量的：把六张图按某个摆法合成一张等距柱状全景图，量四条竖棱两侧各一列像素的差，
 * 拿它跟图自己的相邻列差（约 3~4）比。**现在这一行是 1.9~4.6**（接缝与普通相邻列
 * 无异，也就是连续）；而社区惯例那一套（`front` 放 +Z，即本文件的初版）是
 * 12.7~24.7——四条竖棱全裂，用户看到的「各个方向没对齐」就是这个。
 *
 * **量得出来的只有「六个面的相对摆法」。** 把整个天空盒绕竖直轴转 90°/180°/270°，
 * 接缝一条都不会变（棱是立方体内部的，刚体转动不动它），所以方位角的**绝对值**
 * 只能由命名惯例定，量不出来。本轮取「相机默认朝 −Z」这一种：它是 three 自己的
 * 相机朝向，也让六个名字全部名副其实。旁证（弱）：这套图里烘焙的太阳在方位角
 * 60° 上下，与场景默认日照方位 45° 同象限；按另一种摆法会落到 −120° 去。
 *
 * 因此：若将来发现太阳在天空里的位置与场景日照对不上，要转 180° 应当用
 * `scene.backgroundRotation` + `scene.environmentRotation`（three 0.186 有这两个
 * 字段），**不要去重排这一行**——重排要连每张图的翻转一起动（转 180° = 左右互换 +
 * 前后互换 + 上下两张各转 180°），而下面这套拼地址的机制根本没有逐面翻转的位置，
 * 硬加一处就会多出一个只在错误路径上被走到的分支。
 *
 * 顺序错了**不会报任何错**，天空会整体镜像或者转到别的方向上去，只有眼睛看得出来；
 * 加之「按社区惯例写」在这里恰好是错的，所以**别照惯例「改回来」**。
 * 真要调，改的是**这一行**；别去动那个六元组类型的顺序，它是三件套定死的。
 */
const SKYBOX_FACE_FILES = ['right', 'left', 'top', 'down', 'back', 'front'] as const

type SkyboxFace = (typeof SKYBOX_FACE_FILES)[number]

/**
 * 素材根地址的归一化：末尾补一个斜杠，拼的时候不用每处都判。
 *
 * 宿主写不写末尾那个斜杠都可以（`https://x/y` 与 `https://x/y/` 等价），
 * 少判一次就少一处「有的地方写了、有的地方没写」的不一致。
 */
function normalizeBase(baseUrl: string): string {
  return baseUrl.replace(/\/?$/, '/')
}

/**
 * 拼一个天空盒面的地址。
 *
 * **刻意不复用下面那个 `resolve`**：那一个是「一个目录、一个同名文件」这条约定的
 * 编码（`<分类>/<模型>/<模型>.glb`），天空盒不是这么放的——一个目录里六张
 * **固定名字**的图，目录名与文件名毫无关系。硬塞进去要么给 `resolve` 加一个
 * 「后缀与文件名另说」的分支，要么在调用处把 `file` 拼成 `bak1/back` 这种半截
 * 东西，两者都会让那条约定名存实亡，而下一个人照着它去放资产就会放错。
 *
 * 空 `file` 返回空串，与 `resolve` 同一条：调用方拿它当「没有地址」。
 * 天空盒这一类的空 `file` 是「空盒子」那一格，调用方**在拼地址之前就分流了**
 * （那一支根本不经过这里），所以这一段实际上是条退路，留着是为了这个函数
 * 自己站得住——它不该假设调用方一定先判过空。
 */
function resolveSkyboxFace(base: string, category: string, file: string, face: SkyboxFace): string {
  return file ? `${base}${category}/${file}/${face}.jpg` : ''
}

/**
 * 拼一个模型的资源地址：`<base><分类目录>/<模型子目录>/<同名文件>.<后缀>`，
 * 例如 `.../3d-assets/floor/tile1/tile1.glb`。
 *
 * 分类那一段**取自分类的 `key`**，不是 label——所以 key 必须是服务器上
 * 真实的目录名。模型子目录与文件名都是 `file`（服务器上「一个模型一个目录」，
 * 目录里放同名的 .glb 与 .png），于是同一个 file 键同时决定 glb 与 png 两条地址。
 *
 * `file` 为空串表示内置示例几何体，返回空串——调用方拿它当「不联网」的标志，
 * 所以这里不能拼出半个地址。
 */
function resolve(base: string, category: string, file: string, extr: string): string {
  return file ? `${base}${category}/${file}/${file}.${extr}` : ''
}

/** 把一个宿主给的条目拼成渲染用的条目。地址在这里拼一次 */
function toEntry(
  base: string,
  category: LibrarySectionKey,
  kind: 'model' | 'skybox',
  item: EditorAssetEntry,
): LibraryEntry {
  if (kind === 'skybox') {
    /*
      「空盒子」那一格（`file` 为空串，排在宿主那一类的最前面）。

      `skybox: null` 在这里**是有意义的取值，不是「这个字段没写」**：
      它说的就是「点这一下 = 把 `sun.skybox` 写成 `null`」，而 `null` 正是
      配置里「关掉」那个状态（`SkyboxFaces` 那边有完整解释）。
      读它的地方因此一律按 `'skybox' in entry` 判，不按真假——
      真假在这里恰好会把空盒子与内置示例几何体混在一起，理由见 `LibraryEntry.skybox`。

      `thumb` 留空：宫格会退回那个立方体占位图形，正是一个空盒子的样子，
      不必为它单独画一个图标（`ModelLibrary.vue` 里那份 `ICON_NO_PREVIEW`）。
      这也是这一类里**唯一一条不发任何请求**的条目。
    */
    if (!item.file) {
      return {
        key: 'skybox-off',
        label: item.label,
        url: '',
        thumb: '',
        skybox: null,
      }
    }

    return {
      // 这个分类没有 .glb，`resolve(..., 'glb')` 会拼出一个不存在的地址，
      // 所以 key 自己拼一个：目录地址，一个天空盒一份，天然唯一
      key: `${base}${category}/${item.file}`,
      label: item.label,
      url: '',
      /*
        拿「前」那一面当缩略图。

        六张图里没有哪一张能代表整个天空盒，但正面最接近「一张照片」——
        它是站在场景里朝外看时最常看到的那一面，地平面与地平线都在。
        这条依赖服务器上真有 `front.jpg`：缺了就是一次 404，
        `ModelLibrary` 那边会把这一格退回立方体占位图（它本来就有这条兜底）。
      */
      thumb: resolveSkyboxFace(base, category, item.file, 'front'),
      skybox: SKYBOX_FACE_FILES.map((face) =>
        resolveSkyboxFace(base, category, item.file, face),
      ) as SkyboxFaces,
    }
  }

  return {
    key: resolve(base, category, item.file, 'glb') || 'builtin',
    label: item.label,
    url: resolve(base, category, item.file, 'glb'),
    thumb: item.file ? resolve(base, category, item.file, 'png') : '',
    span: item.span,
    /*
      `width` / `height` 也原样搬（只有门与窗这两类写了它们）。

      同一次改动里 `span` 与它俩是同一件事的两面：**资产的属性**，清单里手写、
      条目照抄、用它的地方自己解释。三个都**不参与地址拼法**，所以不写就是
      「没有这个键」——下游一律用 `??` 退回默认值，而不是按真假判
      （0 是一个合法的宽度，虽然今天没人会那样填）。
    */
    width: item.width,
    height: item.height,
  }
}

/** 内置五类的 key，按界面顺序。`isExtraSection` 那条判据与 `LIBRARY_SHAPE` 共用同一个来源 */
const BUILTIN_KEYS: readonly string[] = LIBRARY_SHAPE.map((shape) => shape.key)

/**
 * 内置五类，**已经拼好地址**，左栏直接 `v-for` 它。
 *
 * 写成 `computed` 而不是模块常量：条目的来源是 `useEditorAssets()`，也就是
 * `inject` 出来的一份输入——**模块求值那一刻它还不存在**。它后面可能是库内置
 * 那份默认表，也可能是宿主整份换掉的、或者只在根地址上被 `assetBaseUrl` 改过的
 * 那一份，三种情况都得现算。
 *
 * 与它配套的 `resolve` / `resolveSkyboxFace` 都**把根地址当参数**收：
 * 原先它们闭包在模块级那个 `ASSET_BASE` 上，那是「库自带地址」的写法，
 * 现在是**这份表自己带着地址进来**、由调用方传下去。
 *
 * 生效那份表里，key 不在这五个里的分类**会被忽略**——理由是那五个 key 承重，
 * 见本文件顶上那一节。某类没给不是错误：那一类照常出现，宫格里是空态文案。
 */
export function useLibrarySections(): ComputedRef<LibrarySection[]> {
  const assets = useEditorAssets()

  return computed(() => {
    /*
      根地址的归一化**必须在这个 computed 里面**，与下面那句 `assets.categories`
      同一个道理。

      它原先在外面（`const base = normalizeBase(assets.baseUrl)`，只算一次）。
      那时没人中途换过 `baseUrl`——素材是插件在 `install` 时 provide 一次的，
      装配完就不动了，所以写在哪儿都一样。`SceneViewer` 的 `assetBaseUrl` 之后
      这个前提没有了：那是个**能绑在模板上**的 prop，宿主换镜像时左栏得跟着换。
      摆在外面就是一份调用那一刻的快照，换不换都不动，而且**不报错**
      ——只有盯着缩略图才看得出。

      依赖是从 getter 上取的（`SceneViewer` provide 的那个带 getter 的对象读
      `props.assetBaseUrl`），所以这里读一次就够，不必再 watch 什么。
    */
    const base = normalizeBase(assets.baseUrl)

    return LIBRARY_SHAPE.map((shape) => {
      const category = assets.categories.find((item) => item.key === shape.key)
      return {
        key: shape.key,
        // 显示名以宿主那份为准：宿主把「地板」叫成「地面」是它的自由。
        // 没给这一类时退回编辑器自己的中文名，导轨上才不会是一格空白。
        label: category?.label ?? shape.label,
        kind: shape.kind,
        entries: (category?.entries ?? []).map((item) => toEntry(base, shape.key, shape.kind, item)),
      }
    })
  })
}

/**
 * 按 key 从**给定那张表**里取分类，取不到退回「第一个有货的分类」。
 *
 * **左栏导轨的高亮与宫格的内容必须都走这一个函数。** 两边各写各的
 * （一边 `===` 比较、一边取第一条）时，一个对不上的 key
 * 就会让导轨亮着「地板」而面板里是别的分类——两边都不报错。
 *
 * 兜底取「第一个有货的」而不是「第一条」：`LIBRARY_SHAPE` 的顺序是照语义排的
 * （地板 → 墙壁 → 门 → 窗 → 天空盒），与「这一类眼下有没有货」无关，
 * 取第一条就可能一进来就给用户一句「这一类暂时还没有模型」。
 * 宿主哪一类先有货、哪一类被清空，都不用谁记得来改，规则跟着数据走。
 *
 * `sections` 由调用方显式传入（内置五类 + 宿主追加的那些），本函数不再自己
 * 拿一份兜底。左栏现在有**两张**表了（内置的、合并的），让读的人自己说清用的是
 * 哪一张，比函数偷偷挑一张可靠：导轨按合并表高亮、宫格按内置表取内容，
 * 那种不一致不会报错、只会看着别扭。
 *
 * 泛型是为了**保持元素类型**：传 `LibrarySection[]` 就还你 `LibrarySection`，
 * 传合并表（`MergedLibrarySection[]`）就还你合并表那一项。
 *
 * key 的类型是 `string` 而不是 `LibrarySectionKey`：追加分类的 key 是运行时的，
 * 而字面量联合拦不住它。兜底仍然落在内置那一侧——宿主把某个追加分类撤掉、
 * 而左栏正停在它上面时，落回的是内置分类而不是空白。
 */
export function resolveLibrarySection<T extends { key: string; entries: readonly unknown[] }>(
  key: string,
  sections: readonly T[],
): T {
  return (
    sections.find((section) => section.key === key) ??
    sections.find((section) => section.entries.length) ??
    sections[0]
  )
}

/**
 * Pinia 的 store 必须在 app.use(createPinia()) 之后才能取。
 * 这个模块会被 App.vue 间接引入，模块求值时机早于 main.ts 的函数体，
 * 所以这里做成惰性单例而不是在模块顶层直接取。
 */
let sceneRef: ReturnType<typeof useSceneStore> | null = null
function scene() {
  return (sceneRef ??= useSceneStore())
}

/**
 * 场景里已经在用的模型地址集合。
 *
 * 一个集合，而不是「当前是哪一个」：左栏这一列是**追加**而不是替换，
 * 同一个模型被摆两次是完全合法的用法（两个头盔摆不同姿态）。
 * 集合表达的是「场景里已经有它了」，比一个单选高亮更诚实。
 *
 * 从 `config.models` 反推，所以手动改了地址、或导入了别的配置，
 * 高亮都会自己跟上，不需要记「上次点了谁」。
 */
export const sceneUrls = computed<Set<string>>(
  () => new Set(scene().config.models.map((model) => model.url)),
)

/**
 * 场景里已经在用的**零件表**集合（`ModelConfig.partsJson`）。
 *
 * ## 为什么不能直接用 `sceneUrls`
 *
 * `partsJson` 模型的 `url` 是**空串**，而空串在这个集合里是**内置示例几何体**的
 * 地址。于是只要场景里摆过一个程序生成的模型，所有 `url` 为空的条目——包括那条
 * 「内置示例几何体」——会一起亮起「已在场景里」。这与天空盒那次是**同一个坑**
 * （`ModelLibrary.vue` 的 `isInScene` 上记着那一次：三十多格一起亮），
 * 而那一次的教训写在了判据上：**空串不再是一个能分辨东西的值了，得另起一个集合。**
 *
 * 判据取 `partsJson` 本身而不是「有没有这个字段」：内置五类与天空盒都是
 * `undefined`，一律进不来这个集合。
 *
 * 与 `sceneUrls` 同一条设计：从 `config.models` 反推，所以手动改了配置、
 * 导入了别的配置，高亮都会自己跟上。
 */
export const scenePartsJsons = computed<Set<string>>(
  () =>
    new Set(
      scene()
        .config.models.map((model) => model.partsJson)
        /*
          类型谓词不能省：`!!json` 这个判据足以让运行时的集合里没有 undefined，
          但类型层面 TS 的 `filter` 不认它，不写谓词就得把 Set 的元素类型放宽成
          `string | undefined` —— 那会把「这里保证非空」这条事实从类型里抹掉，
          下游每一个读它的人都要自己再判一次。
        */
        .filter((json): json is string => !!json),
    ),
)

/** 内置五类的 key 表（`ModelLibrary.vue` 判「这一类是不是宿主追加上来的」时用） */
export { BUILTIN_KEYS }
