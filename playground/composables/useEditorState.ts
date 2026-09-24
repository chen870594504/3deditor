import { ref } from 'vue'
import type { ModelBounds, SceneStats, TransformMode } from '../../src'
import { DEFAULT_LIBRARY_SECTION_KEY } from './useModelLibrary'

/**
 * 编辑器自身的 UI 状态。
 *
 * 这里刻意用模块级 ref 而不是 Pinia：它是 playground 的界面状态，
 * 不参与场景配置的导入导出，也不该混进插件发布物。
 * 单页应用里模块级单例等价于一个 store，但少一层概念。
 */

/** 右侧属性面板的 tab。顺序即导轨从上到下的顺序 */
export type InspectorTab =
  | 'model'
  | 'floorplan'
  | 'camera'
  | 'ground'
  | 'sun'
  | 'shadow'
  | 'history'

/** 当前场景名，导出文件名与顶栏都读它 */
export const sceneName = ref('未命名场景')

/** 当前选中的属性 tab */
export const activeTab = ref<InspectorTab>('model')

/**
 * 模型库当前选中的分类。
 *
 * **左栏只有这一页了。**「场景预设」曾经是左栏第二个页面（`LeftTab = 'preset'
 * | 'library'`），点了整个面板换掉；它搬到右栏「日照环境」的 03 节之后
 * （`playground/components/inspector/PresetList.vue`），左栏的页面状态没有了对象，
 * 那个 ref 与它的类型一起删掉。
 *
 * 删掉之后顺带少了一件事：面板体上那个 `:key="leftTab"` 是为「切页面时整块重建、
 * 让淡入动画重放」而设的，而它的**取值集合等于「面板」的集合**这句话才是分类
 * 不能并进它的原因（并进去就是每切一次分类重建一次 `ModelLibrary`：缩略图
 * 加载失败的记录与已经加载好的图全部作废，表现是来回切分类时图闪白、
 * 挂掉的图重发请求）。现在没有页面可切，`leftTab` 是多余的一层，
 * `librarySection` 就是左栏唯一的视图状态。
 *
 * 值与上面的几个一样：UI 偏好，不进 config、不进历史、导入导出与重置都不影响它。
 *
 * 类型是 `string` 而不是 `LibrarySectionKey`（内置那五个 key 的字面量联合）：
 * 左栏还能有**宿主追加**的分类（`SidePanel.vue` 的 `extraSections`），它们的 key
 * 是运行时的。代价是这里写错一个内置 key 不再是编译错误——那道守卫留在了它真正
 * 管得住的地方：`SECTION_ICONS satisfies SafeIcons`（漏图标）与 `TOOL_ASSET_RULES`
 * （工具绑到不存在的分类），两处都仍然只认那个字面量联合。
 */
export const librarySection = ref<string>(DEFAULT_LIBRARY_SECTION_KEY)

/**
 * 切到模型库的某个分类。
 *
 * 原先它还要顺手把左栏切到模型库页（`leftTab.value = 'library'`），
 * 现在左栏只有这一页，于是它只做一件事。
 *
 * 唯一的落点是 `useFloorplanTool.ts` 的 `setFloorplanTool()`：那里按
 * `TOOL_ASSET_RULES` 查出「这个工具从哪一类里挑料」再调过来
 * （点地基 → 地板、点画墙 → 墙壁、点门 → 门），与它顺手切 2D 档（`void setViewMode('2d')`）
 * 是同一类动作——把「能画的地方」与「要用的料」两样都备好。
 *
 * 另一个落点是左栏导轨自己（`SidePanel.vue` 的 `activate`），它也会接到宿主
 * 追加分类的 key 上——所以这里的参数是 `string`。
 */
export function openLibrarySection(key: string) {
  librarySection.value = key
}

/** 某个工具待用的那份料：地址 + 显示名 + 铺装参数 */
export interface PickedAsset {
  url: string
  label: string
  /**
   * 「这张贴图一个 uv 重复铺几米见方」，来自模型清单（`LibraryFile.span`）。
   *
   * **可选，因为不是每一种料都需要**：眼下只有地板用它（`layFloorModel` 拿它算
   * 出 `ModelConfig.repeat`，图案的实物尺寸才不会随区域大小变），墙那条链铺的是
   * 一整块面、没有可平铺的格子，自然不带。
   *
   * 它是**资产的属性**，一路从清单原样搬到这里，中间谁都不解释它——解释在
   * `useModelLibrary.ts` 的 `LibraryFile.span` 上。
   */
  span?: number
  /**
   * 这件资产要在墙上**占一个多大的洞口**（米），与 `span` 同一性质、同一来路
   * （`LibraryFile.width` / `height` 上有完整解释），可选、只对门有意义。
   *
   * 不写就退回 `DOOR_WIDTH` / `DOOR_HEIGHT`，也就是「照 0.9 × 2.1 开洞」那条
   * 改造前的老路径。**用 `??` 读，不按真假判**——理由与 `span` 一字不差。
   */
  width?: number
  height?: number
}

/**
 * 每个工具各自待用的那份料，**按工具名索引**。
 *
 * 一个表而不是「当前选中的那一个」：画墙时选过的砖不该因为中途去点了一下地基
 * 就丢掉，两个工具各记各的。取值集合是「有配料的工具」——眼下是地基与画墙
 * （那张规则表在 `useFloorplanTool.ts` 的 `TOOL_ASSET_RULES` 里）。
 *
 * 键**故意标成 `string` 而不是 `FloorplanTool`**：那个联合住在下游的
 * `useFloorplanTool.ts` 里，本文件在依赖链的上游。`import type` 今天擦得掉，
 * 但明天有人把它改成值导入就是一个真环——而与 `useModelLibrary.ts` 顶上那段
 * 纪律同理，环下的表现是某一方在生产构建里拿到 `undefined`。
 * 类型安全的包装是 `useFloorplanTool.ts` 的 `pickedAssetFor` / `toggleAssetPickFor`，
 * 调用方只走那两个，这里的 `string` 键不外泄。
 *
 * 它**不进配置**：`SceneConfig` 只放用户已经确认存在的东西，而这是一次「待用」的选择——
 * 料用掉之后就与它无关了（地基那边生成出来的是一块普通模型，墙那边外观写进了墙对象）。
 * 与 `librarySection` / `gizmoMode` 同一条约定：不进历史、不进导出、重置也不影响。
 * 于是「选料」这个动作**不产生任何历史记录**。
 *
 * **粘住，不随工具退出而清空**：Esc 一下再点回来就要重新选一次，是没必要的摩擦。
 * 于是「左栏那块高亮」在工具关掉之后仍然亮着，靠格子的提示文案说清它是什么。
 */
export const pickedAssets = ref<Record<string, PickedAsset | null>>({})

/** 这个工具当前待用的料，没选过就是 `null` */
export function pickedAssetOf(tool: string): PickedAsset | null {
  return pickedAssets.value[tool] ?? null
}

/**
 * 选用 / 取消选用一块料。**点已选用的那一块就是取消**。
 *
 * 用切换而不是「只能选中」，是为了让「不选料」那条老路径一直够得到：
 * 地基上它是「不选地板就落灰板」，墙上是「不选模型就落灰盒子」，门上是
 * 「不选模型就落程序生成的门套加门扇」——不然第一次选完之后就再也回不去了，
 * 等于把改造前唯一的行为做没了。
 * 「再点一次取消」也是这一族工具一直在用的手法（再点一次工具关掉、
 * 再点同一个位置删掉门窗），这里照办。
 *
 * 整份对象换新引用而不是原地改键：读它的地方是 computed，
 * 换引用让「哪几个工具选了料」这件事在调试器里一眼看得全。
 *
 * 投影成 `PickedAsset` 的这一小段抽在 `writePick` 里，两个入口共用：
 * 将来给 `PickedAsset` 加第六个字段时只需要改一处。
 */
export function toggleAssetPick(tool: string, entry: PickedAsset): void {
  writePick(tool, pickedAssets.value[tool]?.url === entry.url ? null : entry)
}

/**
 * **设置**（而不是切换）某个工具待用的料：点同一件**不会**取消。
 *
 * 替换那条路要的是这个语义——用户在说「这一樘换上去」，不是「不要料了」。
 * 用 toggle 的话，替换之后再点同一格会把它取消掉，于是下一笔画门悄悄回到
 * 程序构件那套（而用户以为自己只是又点了一下，屏幕上什么提示都没有）。
 */
export function setAssetPick(tool: string, entry: PickedAsset): void {
  writePick(tool, entry)
}

/** 把一件料写进某个工具的格子。整份换新引用，理由见 `pickedAssets` 那段 */
function writePick(tool: string, entry: PickedAsset | null): void {
  pickedAssets.value = {
    ...pickedAssets.value,
    [tool]: entry
      ? {
          url: entry.url,
          label: entry.label,
          span: entry.span,
          width: entry.width,
          height: entry.height,
        }
      : null,
  }
}

/**
 * 「量出来的宽度」与「清单里写的宽度」差到几倍就该说话。
 *
 * 与 `wallFace.ts` 里那个 `OPENING_OVERSIZE_RATIO`（同是 3）**是两个判断**，
 * 不共用一个常量：那个比的是「资产 vs 洞口」、判的是摆放看着对不对；
 * 这个比的是「两次量出来的数」，判的是**该信哪一个**。数值相同是巧合，
 * 理由是同一个（差三倍以上不像是同一件东西）。
 */
const SIZE_DISAGREE_RATIO = 3

/**
 * 已经报过的尺寸不符。去重粒度是**这条日志本身**（消息里含地址与两个数），
 * 与 `SceneFloorplanOpeningModel.vue` 的 `WARNED` 是同一套：
 * 同一个资产反复选中不该反复刷屏。
 */
const SIZE_WARNED = new Set<string>()

/**
 * 把**量出来的**洞口尺寸补到待用的那份料上（`ModelMeasureProbe.vue` 量完调这里）。
 *
 * ## 为什么要有这一步
 *
 * `PickedAsset.width` / `height` 是「这件料要占一个多大的洞口」。清单里手写的
 * 那两个数**可以是错的**——用户报的「窗户大小不对，没有根据模型大小显示」
 * 就是清单写 1.2、资产实际 2.7，装进去时系数被算成 0.444，3.6 米宽的幕墙
 * 被画成 1.6 米、两侧嵌进墙里被吞掉（`modelList.ts` 的 `WINDOW` 有完整机制）。
 * 让编辑器在选中那一刻自己去量一遍，**新加的、没人量过的资产**就不再需要谁手抄。
 *
 * ## 清单写了数就听清单的——这一条是拿一道真门换来的
 *
 * 一开始这里是无条件覆盖。那会把 `DOOR` 里那樘双开玻璃门弄坏：
 * 服务器上那份 `doubleGlassDoor.glb` **导出的范围里混着地面（14 × 0.02 × 17）
 * 与三面墙**（节点名就叫「地面」「墙-左」「远端墙」），它们每一件都有 4~12 厘米厚、
 * 一片都筛不掉，于是量出来 14 × 3.42 米；而清单里的 1.8 × 2.1 是**对的**。
 * 覆盖之后洞口会被开成 14 米，落笔时得到「这面墙太短，放不下一个门」
 * ——用一个 bug 换掉另一个 bug。
 *
 * 根子上，这两个数**本来就不是一回事**：清单里那个是「**洞口**要开多大」，
 * 是一件设计决定（`LibraryFile.width` 那段写着「带门套的资产量出来会比门扇宽一圈，
 * 写哪个取决于想让墙上的洞开多大」）；量出来的是**资产的外廓**，是一件事实。
 * 拿事实覆盖决定，只在那个决定本来就不存在（清单没写）时才成立。
 *
 * ## 差得远就说一句
 *
 * 清单赢了不等于什么都不该发生：上面那道门正是「资产里有道具」的活标本，
 * 而这在屏幕上与控制台里原本都是静默的。所以差到 `SIZE_DISAGREE_RATIO` 倍以上时
 * 报一句，把两个数与地址都写进去——它同时也在解释「为什么量出来的没生效」。
 * 说清「落笔仍按清单」是要紧的：不然看到这句话的人会以为落笔也换成了量出来的数。
 *
 * ## 它是一条**补丁**，不是一次选用
 *
 * 只在「这个工具当前待用的还是那件料」时才写。这一条不能省：测量是异步的
 * （要拉一次 glb），用户在量完之前换了一格、或者干脆取消了选用，
 * 回来的时候这里如果无条件写，就会把**另一件料**的尺寸改成这一件的
 * ——表现是「选了门却按窗的尺寸开洞」，而且完全不报错。
 *
 * 比的是 `url` 而不是 `label`：同一个模型可以有两个显示名，
 * 而地址是这一份资产的身份（`isPicked` 也是按 url 判的）。
 *
 * 量不出来时不调（`ModelMeasureProbe` 那边判）：**没有结果就什么都不做**，
 * 让清单里那个数继续当兜底，而不是把 `width` 写成 `undefined` 把兜底也毁掉。
 */
export function applyMeasuredAssetSize(
  tool: string,
  url: string,
  size: { width: number; height: number },
): void {
  const current = pickedAssets.value[tool]
  if (!current || current.url !== url) return

  /*
    清单里写了完整的一对就不动它。判「两个都不是 `undefined`」而不是「任一非空」：
    只写了一个的清单是半截数据，那时候量出来的那一对整体更好。
  */
  if (current.width !== undefined && current.height !== undefined) {
    warnSizeDisagree(url, current.width, current.height, size)
    return
  }

  pickedAssets.value = {
    ...pickedAssets.value,
    [tool]: { ...current, width: size.width, height: size.height },
  }
}

/** 清单里那个数与量出来的差得远时点一句名，见 `applyMeasuredAssetSize` */
function warnSizeDisagree(
  url: string,
  width: number,
  height: number,
  measured: { width: number; height: number },
): void {
  // 量出来的那两个数一定是正的有限值（`ModelMeasureProbe` 挡住了其余），所以这里不会除出 NaN
  const worst = Math.max(
    width / measured.width,
    measured.width / width,
    height / measured.height,
    measured.height / height,
  )
  if (worst < SIZE_DISAGREE_RATIO) return

  const text =
    `洞口资产「${url}」量出来是 ${measured.width} × ${measured.height} 米，` +
    `与清单里写的 ${width} × ${height} 米差了 ${worst.toFixed(1)} 倍——` +
    `落笔仍按清单里的数开洞（清单写的是「洞口要开多大」，量出来的是资产的外廓，两件事）。` +
    `多半是资产的导出范围里混进了地面或墙面：片会被筛掉，实体不会。请检查资产。`

  if (SIZE_WARNED.has(text)) return
  SIZE_WARNED.add(text)
  console.warn(`3dmaker: ${text}`)
}

/** 预览模式：隐藏全部编辑器 chrome，只留视口 */
export const previewMode = ref(false)

/**
 * 等比缩放锁。默认开启，符合「缩放大小」的直觉。
 *
 * 和上面几个一样是 UI 偏好：不进 config、不进历史、导入导出与重置都不影响它。
 * 它决定的是「写入策略」而不是值本身，所以住在 schema 的 apply 里，控件不必知道。
 */
export const uniformScale = ref(true)

/**
 * 画布变换手柄的当前模式。
 *
 * 与上面几个一样是 UI 偏好：不进 config、不进历史、导入导出与重置都不影响它。
 * 它决定的是「手柄长什么样、拖出来的是哪种量」，而不是任何一个模型的属性值——
 * 模式本身没有对错，因此也不该被撤销。
 *
 * 放在这里而不是 SceneStage 的局部 ref：App 的全局快捷键（W/E/R）要改它，
 * 两者没有父子关系。
 */
export const gizmoMode = ref<TransformMode>('translate')

/**
 * 事件绑定弹窗是否打开。
 *
 * 和上面几个一样是纯 UI 状态：不进 config、不进历史。
 * 放到模块级而不是留在场景面板里，是因为 App 的全局快捷键要读它——
 * Esc 得先关弹窗、再谈退出预览，否则在弹窗里按 Esc 会连预览一起退出。
 */
export const eventDialogOpen = ref(false)

/**
 * 画布侧能力注册表。
 *
 * 「抓取当前视角」「量一个模型的包围盒」这类动作必须由画布内部执行，
 * 但调用方（属性面板在右栏、模型操作胶囊在中栏视口里）与 SceneViewer
 * 没有父子关系，中间还隔着 SceneStage 与 TresCanvas 两层。
 * 这里让 SceneStage 在挂载时把能力登记进来、调用方按名字取用，
 * 比为了一两个按钮把状态提升到 App 再逐层透传 props 要轻得多。
 */
export const canvasApi: {
  captureCamera: (() => void) | null
  /** 量指定模型的世界包围盒；量不了（未挂载 / 还没加载完）时返回 null */
  measureModel: ((id: string) => ModelBounds | null) | null
  /**
   * 中栏视口的宽高比。
   *
   * 唯一一项来自 DOM 而不是画布的能力：聚焦要把模型装进画面，
   * 而 `camera.fov` 是**垂直**视场角，视口比相机宽时
   * 「垂直装得下、水平装不下」是可能的，只按垂直算就会把模型左右切掉。
   */
  viewportAspect: (() => number) | null
  /**
   * 屏幕坐标 → 地面平面上的 `[x, z]`，米。
   *
   * 绘制工具唯一的入口：库只回答「这一点对应地面的哪个位置」，
   * 至于它意味着「画一面墙」还是「什么都不做」，是编辑器自己判断的
   * （状态机全在 `useFloorplanTool.ts` 里）。落不到地面时返回 null。
   */
  groundPointAt: ((clientX: number, clientY: number) => [number, number] | null) | null
} = {
  captureCamera: null,
  measureModel: null,
  viewportAspect: null,
  groundPointAt: null,
}

/** 由画布内的 PerfProbe 定期刷新，视口 HUD 与属性面板的只读读数都读它 */
export const stats = ref<SceneStats>({ fps: 0, triangles: 0, drawCalls: 0 })

/**
 * 往浏览器控制台打一条编辑器自己的日志。
 *
 * 早先它写进底部那条可展开的事件控制台，那个面板连同状态栏一起被去掉了
 * （两条加起来占掉近 50px 视口，而状态栏里的读数在视口 HUD 与右栏都有）。
 * 但它承载的是**别处看不到**的反馈，不能跟着一起删：
 *
 * - 事件代码的语法 / 运行时错误（写错一个括号就没有任何提示）
 * - 导入配置时「这份文件含 N 段可执行代码」的警告
 * - 撤销 / 重做落在哪一步、模型加载进度、抓取视角这类操作回执
 *
 * 加 `[tdm]` 前缀是为了和用户在事件代码里自己写的 `console.log` 分开：
 * 后者没有前缀，是宿主代码的输出，两者混在一起会分不清哪条是编辑器说的。
 */
export function pushEvent(text: string) {
  console.log(`[tdm] ${text}`)
}
