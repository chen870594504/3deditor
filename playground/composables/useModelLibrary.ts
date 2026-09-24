import { computed } from 'vue'
import { useSceneStore } from '../../src'
import type { SkyboxFaces } from '../../src'
import { FLOOR, WALL, SKY_BOX, DOOR, WINDOW } from '../utils/modelList'

/**
 * 模型库。
 *
 * 列表数据**写死在下面的 LIBRARY 里**，只把「分类目录 / 模型文件名」这两段拼到
 * 服务器目录地址后面——服务器上「一个分类一个目录、一个模型一个子目录」，
 * 所以分类的 `key` 同时是地址里的第一段。那份字面量**按分类嵌套**，
 * 分类的顺序即界面上的显示顺序。
 *
 * 某个分类的清单大了，可以**整个搬到 `playground/utils/` 下的文件里再由这里引用**
 * （`floor` / `wall` / `door` / `window` / `skybox` 那几项现在就是
 * `utils/modelList.ts` 的 `FLOOR` / `WALL` / `DOOR` / `WINDOW` / `SKY_BOX`）。搬的只是代码放哪，**清单本身仍然是
 * 一个字一个字写死的**，下面这段不是「以后可以改成抓目录」的铺垫。天空盒那一批是个
 * 例外中的例外：它们是**在 `modelList.ts` 里循环拼出来的**（编号连号、没有逐个
 * 手抄的意义），但「一份写死的清单」这条性质没变——去问服务器有哪些目录这件事
 * 依然没做。
 *
 * 刻意**不去抓服务器的目录索引页**，即使那台 nginx 已经开了 autoindex、
 * 抓下来解析出列表是可行的：
 *   - 抓目录页 = 把整棵目录结构暴露在页面上，谁打开编辑器都能看到
 *     服务器上放了什么、叫什么名字。列表写死在代码里就没有这个口子。
 *   - 目录页的响应也不带 Access-Control-Allow-Origin（实测），
 *     生产环境要靠再开一条 CORS 规则才能读，等于为了这个功能放宽服务器配置。
 *   - 写死的列表在离线、代理没配好、服务器换路径时都还能用。
 *
 * 代价是**往服务器上放了新模型要来这里加一行**。这是有意的取舍。
 *
 * ## 内置的只剩五类：工具钉住的那四类 + 天空盒
 *
 * `floor` / `wall` / `door` / `window` 是四个工具（地基 / 画墙 / 门 / 窗）各自要用的料，
 * 编辑器自己就必须有；`skybox` 是「换掉外面那圈背景」这件编辑器自带的功能。
 * **其余的都归宿主**：家具、设备那类「往场景里摆的独立物体」原先内置在这儿，
 * 现在由宿主通过下面的 `extraSections` 传进来（见下面那一节）。
 *
 * ## 宿主还能**追加**分类，但只能追加
 *
 * 上面这五个分类是编辑器的内置集合，**宿主改不动它**：`SidePanel.vue` 的
 * `extraSections` 只能往后接，合并出来的表恒是「内置五类 + 宿主那几类」
 * （`SidePanel` 的 `sections` computed 就是这一行拼接）。
 *
 * 为什么不让宿主覆盖：这四个 key 是**承重的**——`useFloorplanTool.ts` 的
 * `TOOL_ASSET_RULES` 把地基 / 画墙 / 门 / 窗四个工具钉在 `floor` / `wall` /
 * `door` / `window` 上。宿主换掉一个内置分类的 key 或内容，工具那条链就会
 * 静默指向一个不存在（或文不对题）的分类——点「画墙」跳到「我的模型」去。
 * 所以**选料这件事不开放**：追加分类点不到任何工具，也就进不了选料与
 * 量尺寸那两条链（`ModelLibrary.vue` 的 `cellIntent` / `measureUrl` 都认 key）。
 *
 * 追加分类**复用这里的条目形状**（`LibraryEntry`），于是「已在场景里」的底色
 * 高亮、选用态、空态文案、缩略图 404 兜底、「点一下追加到场景」全部自动生效。
 *
 * **纪律：本文件永远不 import `useEditorState`。**
 * 它会给 `useEditorState` 提供默认分类（见下面的 `DEFAULT_LIBRARY_SECTION_KEY`），
 * 于是「谁依赖谁」只有一个方向才对。反向再引一次就是真正的环——两个模块顶层
 * **都有副作用**（这边算资产地址、那边建 ref），环下必有一方拿到 `undefined`，
 * 而且是在生产构建里才发作。要在这里 `pushEvent` 之前，先把状态搬出去。
 */

/**
 * 资产根地址。
 *
 * 优先读 .env。注意那边的键名是 `VITE_ASSE_IMAGE_URL`（ASSE 少一个 R），
 * 这里照它原样读：要改键名得两边一起改，否则会静默退回下面的兜底值。
 * 兜底值目前与 .env 一致，让「忘了配 .env」不至于表现成一列拼不出地址的条目。
 */
const FALLBACK_BASE = 'https://box.hczyun.cn/usr/tool/rhmh/data/rhmh/static/3d-assets/'
const REMOTE_BASE = (import.meta.env.VITE_ASSE_IMAGE_URL || FALLBACK_BASE).replace(/\/?$/, '/')

/**
 * 开发期换上的同源前缀，由 vite.config.ts 里同名的 ASSET_PROXY_PREFIX 代理出去。
 * **两边必须一起改**：只改一边，地址就代理不到，表现是清一色的加载失败。
 *
 * 绕这一圈是因为那台服务器不发 Access-Control-Allow-Origin，而 three 的
 * GLTFLoader 走的是 fetch——响应完整到手了，是浏览器在交给 JS 之前丢掉的。
 * 同目录下的缩略图却正常（<img> 不受 CORS 约束），所以这个错很容易被当成
 * 「地址写错了」，实际文件是好的。代理把跨域变成同源，问题就不存在了。
 *
 * 代价：DEV 期写进配置的 `model.url` 是这个相对前缀，导出的配置拿到别处就
 * 解析不出来。这跟拖进来的本地文件存成 `blob:` 是同一类事——配置里本来就
 * 允许存在只在当前环境有效的地址。
 */
const DEV_ASSET_PREFIX = '/3d-assets'

const ASSET_BASE = import.meta.env.DEV ? `${DEV_ASSET_PREFIX}/` : REMOTE_BASE

/** 列表里的一项。写死的原始数据，是唯一需要手改的地方 */
interface LibraryFile {
  /** 界面上显示的名字，也是追加进场景后写进 model.name 的值 */
  label: string
  /**
   * 服务器上的**子目录名**，也就是这一条在库里的文件名。
   *
   * 模型分类里它同时是几个文件的名字：目录里放同名的 `.glb` / `.png`，
   * 最终地址是 `<ASSET_BASE><分类目录>/<file>/<file>.<ext>`。空串表示
   * 内置示例几何体（不联网）；**天空盒分类里的空串是「空盒子」那一格**
   * （见 `LIBRARY_SECTIONS` 里那一支），两种都读作「没有地址可拼」。
   *
   * **天空盒分类是个例外**：目录里放的是六张固定名字的图（`back` / `front` / …），
   * 与目录名无关，所以那边走的是 `resolveSkyboxFace`——两套拼法分开的理由写在那。
   * 这里是「放这件事的那个名字」，两种分类都成立的那部分。
   */
  file: string
  /** 缩略图文件名。不写就按同名 .png 猜 */
  thumb?: string
  /**
   * 这张贴图**一个 uv 重复铺几米见方**，可选，只对「要拿它铺一块地」的资产有意义。
   *
   * 它补偿的是「把一个模型拉伸到区域大小」这件事：`layFloorModel` 会按区域尺寸
   * 缩放模型，几何被拉伸的同时**贴图跟着拉伸**，于是图案的实物尺寸随区域大小变
   * （地基画 20 米宽，一块砖就变成 5 米）。编辑器照这个数给模型写一个
   * `repeat`（`ModelConfig.repeat`，那边的注释解释了机制），图案尺寸就恒定了。
   *
   * **它是这件资产的属性，不是全局常量**：同一个 2.4 米铺在只有 8 行板的地板上
   * 会得到 0.3 米宽的板。数法是在贴图里数一个 uv 重复里有几格，再乘上想要的
   * 单格尺寸——`tile1` 是 4 块砖 × 0.6 米 = 2.4，`wood` 是 12 行板 × 0.2 米 = 2.4。
   *
   * 前提是资产的 **UV 恰好铺满 0..1**（一个 uv 重复 = 整个模型），否则实际密度
   * 会被再乘上 UV 的跨度。不写这一项就是「照旧随几何拉伸」，与改造前一样。
   */
  span?: number
  /**
   * 这个洞口**要开多大**（米），宽与高各一个，可选。
   *
   * 只对「装进洞口」的资产有意义（门与窗）：落笔时洞口按这两个数开、
   * 模型装进来一比一填满。不写就退回该种类的默认档——门是 `DOOR_WIDTH` /
   * `DOOR_HEIGHT`（0.9 × 2.1），窗是 `WINDOW_WIDTH` / `WINDOW_HEIGHT`
   * （1.2 × 1.2，窗台 0.9 米）。
   *
   * 与 `span` 是**同一性质的东西**：这件资产自己的一个数，清单里手写、
   * 一路原样搬到底（这边 → `LibraryEntry` → `PickedAsset` →
   * `useFloorplanTool.ts` 的 `placeOpeningAt`），中间谁都不解释它。
   * 两个都**不是**给渲染层用的——摆法（`wallFaceFit`）只看量出来的包围盒。
   *
   * **它是「洞口」的尺寸而不是「那一件」的尺寸**：带门套的资产量出来会比门扇宽一圈，
   * 写哪个取决于「想让墙上的洞开多大」，而墙上的洞要为整樘门窗让路，
   * 所以照资产的**整体外廓**写。完整理由见 `modelList.ts` 的 `DOOR`。
   *
   * 这两个数将来会**由编辑器量出来**（用户提出「洞口应该跟着模型自己的宽度自适应」），
   * 到那时这里就不必手写；今天它仍是唯一的来源。
   */
  width?: number
  /** 见 `width`。高同时决定缩放系数（洞高 ÷ 资产高），照资产自己的高度写 */
  height?: number
}

/**
 * 一个分类。
 *
 * `key` 是**给代码引用的**（画墙工具激活时左栏自己切到「墙壁」、地基工具切到「地板」，
 * 走的都是 `useFloorplanTool.ts` 里那张 `TOOL_ASSET_RULES` 表），`label` 只给界面。
 * 两者分开，是因为中文 label 会随着
 * 显示需要改名，而代码里一旦写死 `=== '地板'`，改一次显示名就静默失效。
 * 约定：`key` 全 ASCII、唯一、不随显示改动——它**同时就是服务器上这个分类的目录名**
 * （`floor` → `<ASSET_BASE>floor/`），所以「改 key」等于「把地址指向另一个目录」，
 * 服务器上的目录没跟着改就会整类加载失败。ASCII 这条也不是洁癖：地址里那一段直接用它。
 * 上传墙资产时若目录不叫 `wall`，要改的是**这里**，不是 `label`。
 */
interface LibraryCategory {
  key: string
  label: string
  /**
   * 这一类里的东西点一下是**干什么**的。
   *
   * `model` 是「往场景里摆一个东西」（追加成一个模型），
   * `skybox` 是「换掉外面那圈背景」（写 `sun.skybox`，不动 `models`）。
   *
   * 为什么这个性质长在**分类**上而不是每一条上：一个分类里的东西是同一类资产、
   * 也是同一套操作，而分类的资产摆放约定本身就与模型不同——见 `resolveSkyboxFace`。
   * 写成必填而不是「不写就是模型」：加一个分类的人必须回答这个问题，
   * 忘了回答在 `satisfies` 那里就红了，而不是在点击时静默走错分支。
   */
  kind: 'model' | 'skybox'
  /** 只读：下面的 LIBRARY 是 `as const` 字面量，可变数组的目标类型会拒绝它 */
  files: readonly LibraryFile[]
}

/**
 * 模型库列表，**按分类嵌套**。
 *
 * 三条约定：
 *   - **源文件顺序即显示顺序**，要调分类的先后就调这几行的先后；
 *   - 分类只能从这份字面量里来，写不出「一个不存在的分类」；
 *   - `files: []` 是**合法状态**，不是待填的占位：分类在不在导轨上只看它在不在
 *     这份清单里，与有没有货无关，而没货的那一类要在界面上说得出话
 *     （见 `ModelLibrary.vue` 的空态）。宿主传进来的空分类走同一条路。
 *
 * **把 file 换成服务器上真实的目录名即可**，其余都不用动：服务器上把这个目录
 * 放进对应分类的目录里（分类的 `key` 就是那个目录名），地址就拼得对。
 * 只列 `.glb` / `.gltf`——加载链是 useGLTF（GLTFLoader），
 * 列 `.obj` / `.fbx` 只会得到一行点不动的条目。
 *
 * `as const` **不能省**：它是下面 `LibrarySectionKey` 能推成字面量联合的唯一原因，
 * 而 `SidePanel.vue` 的 `satisfies Record<LibrarySectionKey, IconPath[]>` 正是靠
 * 那个联合把「新加一个分类但忘了画图标」变成编译错误的。去掉 `as const`，
 * `key` 被拓宽成 `string`，那条约束会静默退化成 `Record<string, …>`——不报错，
 * 只是导轨上少一格，得靠眼睛发现。
 */
const LIBRARY = [
  { key: 'floor', label: '地板', kind: 'model', files: FLOOR },
  // 「墙壁」挨着「地板」：两者是同一件事的两种铺面（一个铺地、一个铺墙），
  // 而所有可平铺的纹理类资产都在这两类里。
  { key: 'wall', label: '墙壁', kind: 'model', files: WALL },
  /*
    「门」与「窗」紧挨着「墙壁」：两者都是**墙面上的构件**，与地板 / 墙壁一样是
    「按工具铺上去的料」。它们也是两个**没有独立摆放路**的分类——点它选料之后，
    要落到视口里靠的是「门」/「窗」那两个工具在墙上点一下
    （`TOOL_ASSET_RULES.door` / `.window`）。

    内置这五类**全是「按工具铺上去的料」或背景**，没有一类是「往场景里摆的独立
    物体」——家具、设备那种原先在这份清单里，现在由宿主传（见顶上那一节）。
    这条分界不是巧合：工具能钉住的只有「铺料」这一类，而工具钉不住的东西编辑器
    自己就不必内置。

    「窗」排在「门」之后而不是之前：门是这一族里先做出来的那一个（整条链、
    清单格式、日志口径都是照它定的），窗跟着它走同一条路，读顺序上也跟着它。
    两者在渲染层是**同一个组件**（`SceneFloorplanOpeningModel`），
    在清单里共用同一对可选字段（`width` / `height`）。
  */
  { key: 'door', label: '门', kind: 'model', files: DOOR },
  { key: 'window', label: '窗', kind: 'model', files: WINDOW },
  /*
    「天空盒」排在最后：它是这份清单里唯一一类**不是往场景里摆的实体**——
    它描述的是「外面那圈背景」，与地板墙壁门窗不是同一个范畴的东西，
    摆在一起只会让人以为它也是个可以摆的物件。`kind: 'skybox'` 说的就是这件事，
    它在点击行为与资产摆放约定上都是另一套（见 `LibraryCategory.kind`）。

    `SKY_BOX` 那几十条是在 `utils/modelList.ts` 里**循环拼出来的**（编号连号，
    再加最前面那格不用连号的「空盒子」），这里看不出它有多长——
    数量在那边一个常量上。
  */
  { key: 'skybox', label: '天空盒', kind: 'skybox', files: SKY_BOX },
] as const satisfies readonly LibraryCategory[]

/**
 * 分类的 key。**由上面的 LIBRARY 推导**，不是手写的联合：
 * 加一个分类只需要改那一个字面量，这里自动跟上，永远不会脱钩。
 */
export type LibrarySectionKey = (typeof LIBRARY)[number]['key']

/** 渲染用的条目。地址在模块求值时拼一次 */
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
   * （`LibraryFile.thumb` 那个字段是另一回事，它一次都没被读过）。
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
   * 原样带过来的 `LibraryFile.span`（那边解释了它是什么）。
   * 条目**只管搬运**，怎么用是 `useFloorplanTool` 与 `layFloorModel` 的事。
   */
  span?: number
  /**
   * 原样带过来的 `LibraryFile.width` / `height`：这件资产要占用多大的洞口。
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
   * 这一类里的东西点一下是干什么的，原样搬自 `LibraryCategory.kind`。
   *
   * 渲染层目前只有一个地方用它：导轨上的数量单位（`SidePanel.vue`）——
   * 「地板 · 2 个模型」与「天空盒 · 38 个天空盒」。
   *
   * 为什么值得为量词多带一个字段：那一句**同时也是 `aria-label`**，
   * 而「38 个模型」描述的是一个根本没有 `.glb`、也不往场景里摆东西的分类。
   * 量词是这一类唯一说得出「它不是模型」的地方。
   */
  kind: LibraryCategory['kind']
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
 * 拼一个模型的资源地址：`<ASSET_BASE><分类目录>/<模型子目录>/<同名文件>.<后缀>`，
 * 例如 `.../3d-assets/floor/tile1/tile1.glb`。
 *
 * 分类那一段**取自 `LibraryCategory.key`**，不是 label——所以 key 必须是服务器上
 * 真实的目录名。模型子目录与文件名都是 `file`（服务器上「一个模型一个目录」，
 * 目录里放同名的 .glb 与 .png），于是同一个 file 键同时决定 glb 与 png 两条地址。
 *
 * `file` 为空串表示内置示例几何体，返回空串——调用方拿它当「不联网」的标志，
 * 所以这里不能拼出半个地址。
 */
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
function resolveSkyboxFace(category: string, file: string, face: SkyboxFace): string {
  return file ? `${ASSET_BASE}${category}/${file}/${face}.jpg` : ''
}

function resolve(category: string, file: string, extr: string): string {
  return file ? `${ASSET_BASE}${category}/${file}/${file}.${extr}` : ''
}

/**
 * 分好类的模型库，左栏直接 `v-for` 它。
 *
 * 写成**模块常量**而不是 computed、也不是函数：源数据是写死的、没有任何响应式来源，
 * computed 只会白多一层包装；函数形式则每渲染一次就要重拼一遍地址，
 * 与上面「地址在模块求值时拼一次」的口径相冲。
 */
export const LIBRARY_SECTIONS: LibrarySection[] = LIBRARY.map((category) => ({
  key: category.key,
  label: category.label,
  kind: category.kind,
  /*
    两类资产的地址拼法不同，分流就放在这一处（`resolveSkyboxFace` 那边解释了
    为什么不能合成一个函数）。`category.kind` 是编译期就知道的，所以这条分支
    不会在运行期逐条判断——它对一个分类来说是常量。

    回调参数**显式标注**成 `LibraryFile`：`LIBRARY` 是 `as const` 字面量，
    `category.files` 于是是「各分类各自的元素类型」的联合，而只有地板那一支
    写了 `span`——直接读 `item.span` 会在联合上取不到键而报错。标一次类型，
    所有分类就走同一套字段（`span` 可缺省），以后再加字段也只改这里一处。
  */
  entries: category.files.map((item: LibraryFile): LibraryEntry => {
    if (category.kind === 'skybox') {
      /*
        「空盒子」那一格（`file` 为空串，排在清单第一位）。

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
        key: `${ASSET_BASE}${category.key}/${item.file}`,
        label: item.label,
        url: '',
        /*
          拿「前」那一面当缩略图。

          六张图里没有哪一张能代表整个天空盒，但正面最接近「一张照片」——
          它是站在场景里朝外看时最常看到的那一面，地平面与地平线都在。
          这条依赖服务器上真有 `front.jpg`：缺了就是一次 404，
          `ModelLibrary` 那边会把这一格退回立方体占位图（它本来就有这条兜底）。
        */
        thumb: resolveSkyboxFace(category.key, item.file, 'front'),
        skybox: SKYBOX_FACE_FILES.map((face) =>
          resolveSkyboxFace(category.key, item.file, face),
        ) as SkyboxFaces,
      }
    }

    return {
      key: resolve(category.key, item.file, 'glb') || 'builtin',
      label: item.label,
      url: resolve(category.key, item.file, 'glb'),
      thumb: item.file ? resolve(category.key, item.file, 'png') : '',
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
  }),
}))

/**
 * 打开模型库时默认落在哪一类。
 *
 * **第一个有模型的分类**，不是第一条：`LIBRARY` 的顺序是照语义排的
 * （地板 → 墙壁 → 门 → 窗 → 天空盒），与「这一类眼下有没有货」无关，
 * 取第一条就可能一进来就给用户一句「这一类暂时还没有模型」。
 * 规则跟着数据走，所以哪个分类先有货、哪个分类被清空，都不用谁记得来改这个默认值。
 */
export const DEFAULT_LIBRARY_SECTION_KEY: LibrarySectionKey = (LIBRARY_SECTIONS.find(
  (section) => section.entries.length,
) ?? LIBRARY_SECTIONS[0]).key

/**
 * 按 key 从**给定那张表**里取分类，取不到退回第一条。
 *
 * **左栏导轨的高亮与宫格的内容必须都走这一个函数。** 两边各写各的
 * （一边 `===` 比较、一边 `?? sections[0]`）时，一个对不上的 key
 * 就会让导轨亮着「地板」而面板里是别的分类——两边都不报错。
 *
 * `sections` 由调用方显式传入（内置五类 + 宿主追加的那些，见 `SidePanel.vue`
 * 的 `sections`），本函数不再自己拿 `LIBRARY_SECTIONS` 兜底。左栏现在有**两张**
 * 表了（内置的、合并的），让读的人自己说清用的是哪一张，比函数偷偷挑一张可靠：
 * 导轨按合并表高亮、宫格按内置表取内容，那种不一致不会报错、只会看着别扭。
 *
 * 泛型是为了**保持元素类型**：传 `LibrarySection[]` 就还你 `LibrarySection`，
 * 传合并表（`MergedLibrarySection[]`）就还你合并表那一项。
 *
 * key 的类型是 `string` 而不是 `LibrarySectionKey`：追加分类的 key 是运行时的，
 * 而字面量联合拦不住它。兜底仍然落在 `sections[0]`，也就是**内置第一条**——
 * 宿主把某个追加分类撤掉、而左栏正停在它上面时，落回的是内置分类而不是空白。
 */
export function resolveLibrarySection<T extends { key: string }>(
  key: string,
  sections: readonly T[],
): T {
  return sections.find((section) => section.key === key) ?? sections[0]
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
