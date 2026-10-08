import type { Pinia } from 'pinia'
import type { Object3D } from 'three'
import type { EditorAssets } from './editor/assets'
import type { EditorHooks } from './editor/hooks'
import type { IconPath } from './editor/composables/useInspectorSchema'

/**
 * 天空盒的六个面。
 *
 * **顺序是 three 的 `CubeTextureLoader` 要求的顺序**，不是「前 后 左 右 上 下」
 * 这种按名字顺手的顺序：`[+X, -X, +Y, -Y, +Z, -Z]`，也就是
 * `[右, 左, 上, 下, 前, 后]`。摆错一格不会报任何错，只会让天空整体
 * 转一个方向或者左右镜像——所以调用方拼这个数组时**必须照着这一行来**，
 * 拼名字的那张表（`SKYBOX_FACE_FILES`）是唯一允许出现另一套顺序的地方。
 *
 * ⚠️ 上面那个「右 左 上 下 前 后」是**社区惯例对这三对轴的说法**（`front` = +Z），
 * 不是「图片文件该叫哪个名字」的定论：按相机朝向读的话 `front` 是 −Z。两套说法
 * 差一个绕竖直轴的 180° 旋转，对同一个立方体都自洽，**量接缝分不出来**。
 * 本项目用的那套资产按后者命名，`SKYBOX_FACE_FILES` 那边有完整交代与依据——
 * 照着这一段的字面去摆，天空会整个转到反方向去。
 *
 * 用定长元组而不是 `string[]`：六个面是这件事的定义，少一个或者多一个
 * 都构不成一个天空盒，`CubeTextureLoader` 拿到 5 个地址也不会当场报错
 * （它会拿 `undefined` 去请求，控制台里是一堆看不出所以然的 404）。
 */
export type SkyboxFaces = [string, string, string, string, string, string]

/**
 * 环境贴图预设。
 * 取值与 @tresjs/cientos 的 environmentPresets 保持一致，
 * 这里显式声明是为了让插件在未设置 environment 时不产生任何网络请求。
 */
export type EnvironmentPreset =
  | 'sunset'
  | 'studio'
  | 'city'
  | 'umbrellas'
  | 'night'
  | 'forest'
  | 'snow'
  | 'dawn'
  | 'hangar'
  | 'urban'
  | 'modern'
  | 'shangai'

/**
 * 任意层级都可省略的补丁类型。
 *
 * 用于分组配置 prop 与 applyConfig：调用方只需要写出要改的那几个字段，
 * 其余保持当前值。数组按整体替换处理（`position: [1,2,3]` 表示整组覆盖），
 * 不做逐元素合并——后者对坐标这类语义没有意义。
 */
export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends readonly unknown[]
    ? T[K]
    : T[K] extends object
      ? DeepPartial<T[K]>
      : T[K]
}

/** 模型支持的 5 类指针事件 */
export type ModelEventType =
  | 'click'
  | 'dblclick'
  | 'pointerenter'
  | 'pointerleave'
  | 'contextmenu'

/**
 * 单个事件的绑定。
 *
 * 分成「启用位」与「代码文本」两半，是因为它们的解释权不在同一层：
 * 库只读 `enabled`（决定挂不挂指针监听器、发不发事件），
 * `code` 库**完全不解释**——它只是配置里的一个字符串，由宿主自己决定跑不跑。
 *
 * 之所以敢把代码放在配置里：`cloneConfig` 是 JSON 往返，字符串正好是最精确的
 * 那一类；反过来，若这里放函数，`JSON.stringify` 会把它静默丢掉，
 * 历史快照与 `exportConfig` 都会失真。
 */
export interface ModelEventHandler {
  /**
   * 是否绑定。这是**唯一**的门控。
   *
   * 代码为空也算绑定（等于一个空操作）：门控只有一个判据，
   * 三处消费者（挂载监听器、HUD 读数、执行者）才不会各说各话。
   */
  enabled: boolean
  /** 要执行的 JS 语句体。库本身不解释它 */
  code: string
}

/**
 * 单个模型的配置，即 {@link SceneConfig.models} 里的一条。
 *
 * 这里同时承载「资源」与「这个物体在场景里的状态」两类字段：
 * url / draco / wireframe 描述模型本身，position / rotation / scale /
 * visible / castShadow / receiveShadow 描述它怎么被摆放在场景里，
 * events 描述它响应哪些指针交互。
 *
 * `id` 由库生成、随模型更换重新生成，宿主正常不必管它；
 * `name` 才是给人看、给人改的那一个。
 */
export interface ModelConfig {
  /**
   * 模型标识，随机 uuid。
   *
   * 由 store 生成并维护：建立 store 时生成一个，模型地址变化时换一个
   * （所以撤销到换模型之前也会跟着还原）。宿主一般不用传——
   * 只有在需要「换模型也保持同一个 id」时才自己给一个固定值。
   *
   * 默认值里是空串而不是写死的 uuid：常量是模块级共享的，
   * 把 uuid 写进去会让所有宿主实例拿到同一个 id。
   */
  id: string
  /** glTF / GLB 地址，空字符串表示渲染内置示例几何体 */
  url: string
  /**
   * **一段 JSON 文本**，里面是一张零件表，用来**程序生成**这个模型的几何体。
   * 可选；`url` 非空时它被忽略（见下面那条「两个来源互斥」）。
   *
   * 存的是**字符串本身**，不是解析好的对象：宿主与它的后端手里就是这一段文本
   * （见 DESIGN.md「宿主可以往左栏里追加分类」里那个示例），编辑器不替它解析、
   * 也不改写它，一路原样存进配置、导出时原样带走，**只在渲染那一刻 parse 一次**
   * （`src/components/SceneModelParts.vue`）。
   *
   * 这么定有两个后果，都是想要的：
   *
   * - 它**不需要**在 `cloneModelPatch` 里单独拷一份断别名（那边 `position` /
   *   `rotation` / `scale` / `repeat` 都要拷）。字符串是值，装进配置的就是值本身。
   *   在那里加一段注释说这件事，是因为下一个往 `ModelConfig` 里加**数组型**字段的人
   *   会照着这一条抄，而数组是会别名出去的。
   * - 配置的 JSON 往返**不做任何校验**：一段坏 JSON 照样能被存下、被导出。
   *   校验发生在两处——进场景之前（左栏点一下时先读一遍，读不出来就不追加），
   *   与渲染时（读不出来就画不出东西，并在控制台说一句）。
   *
   * ## 两个几何体来源互斥，`url` 优先
   *
   * `url` 与 `partsJson` 都能给出一件几何体，同时存在时**用 `url`**。
   * 渲染端的分支顺序（`SceneModelNode.vue` 里 `v-if="model.url"` →
   * `v-else-if="model.partsJson"`）与左栏追加时的一致，两边同序是这条约定唯一的保障：
   * 只在一处交换顺序，画面与「配置里写的」就会各说各话，且哪里都不报错。
   *
   * ## 空串 `url` 有**三种**意思了
   *
   * 这个字段引入之前，`url === ''` 只有两种意思：「内置示例几何体」与「不是模型
   * （天空盒条目）」。现在多了第三种：**这一件由 `partsJson` 生成**。
   * 于是 `src/editor/composables/useModelLibrary.ts` 的 `sceneUrls`（一个
   * `Set<url>`）**不能**再回答「这一格在不在场景里」——场景里只要有一个程序生成的
   * 模型，所有空 `url` 的条目会一起亮起来。那边为此另起了一个 `scenePartsJsons`，
   * 与天空盒那次事故是同一个坑。
   */
  partsJson?: string
  /** 模型是否为 Draco 压缩格式 */
  draco: boolean
  /** 是否以线框模式渲染 */
  wireframe: boolean

  /**
   * 显示名。
   *
   * 留空时回退成从 url 派生的可读短名（见 `deriveModelId`），
   * 因此事件载荷里的 `name` 与面板上看到的一样，永远非空。
   */
  name: string
  /** 相对父级的位置 */
  position: [number, number, number]
  /**
   * 相对父级的旋转，**单位是弧度**。
   *
   * 与 camera.minPolarAngle 一致，配置里只存一套角度单位；
   * 面板上的度数换算只发生在编辑器那一层。
   */
  rotation: [number, number, number]
  /** 相对父级的缩放 */
  scale: [number, number, number]
  /**
   * 贴图在**这个模型自己身上**重复几次（u, v），可选，缺省即「不重复」。
   *
   * 解决的是「把一个模型拉伸到一块区域大小」这类用法：`scale` 放大几倍，
   * 几何被拉伸的同时**贴图也跟着拉伸**，于是图案的实物尺寸随区域大小变
   * （地基 20 米宽，一块砖就变成 5 米）。给一个非 1 的 `repeat` 把
   * 「几何被放大了几倍」补偿回去，图案的实物尺寸就恒定了。
   *
   * **它只作用于贴图，不改几何**：`repeat = [2, 2]` 与「并排摆 4 份、
   * 每份 scale 不变」在画面上是同一张图，但只有 1 个模型条目、1 次加载、
   * 1 个 draw call。想铺满一块 100 × 100 的区域时，这个差别是 100 个条目
   * 各自解析一遍 glb。
   *
   * **为什么不做成自动的**（`repeat` 跟着 `scale` 走）：缩放一个人物模型时，
   * 贴图跟着拉伸是**对的**（那就是「把它变大」的意思，也是 three 的默认行为）。
   * 只有「拿一个模型去铺一块地」才需要反过来补偿，所以它是逐模型的显式选择。
   *
   * 注意它只认贴图槽上的 `repeat`，**要求资产的 UV 恰好铺满 0..1**
   * （一个 uv 重复 = 整个模型）；UV 跨度不是 1 的资产要自己把账算进去。
   * 两个分量都必须是正数：0 或负数会让采样塌成一条线。
   */
  repeat?: [number, number]
  /** 是否渲染 */
  visible: boolean
  /**
   * 是否投射阴影。
   *
   * 与全局 `shadow.castShadow` 是 AND 关系——全局是总闸。
   * 另外：`shadow.type === 'contact'` 时接触阴影走 `scene.overrideMaterial`
   * 烘焙，绕开 WebGLShadowMap，这个字段不产生任何效果。
   */
  castShadow: boolean
  /** 是否接收阴影，同样与全局 `shadow.receiveShadow` AND */
  receiveShadow: boolean
  /**
   * 5 类指针事件的绑定情况。
   *
   * 默认全部关闭：只要挂上**任意**一个指针监听器，指针在画布上移动时就会
   * 每帧对模型做一次 raycast，宿主没有明确要求就不该付这个代价。
   * 注意这是「任意一个」——`1/5` 与 `5/5` 的拾取开销完全一样，
   * 只有 `0/5` 才是真正零开销。
   *
   * 五个键分别是：单击 / 双击 / 鼠标经过 / 鼠标移出 / 右击。
   */
  events: Record<ModelEventType, ModelEventHandler>
}

/**
 * 世界空间下的轴对齐包围盒。
 *
 * 用两个三元数组而不是 three 的 `Box3`：它是要出现在公开 API 面上的类型，
 * 不该把 three 的类摆进去（与 {@link CameraChangePayload} 的形状保持一致），
 * 顺带也保证它可以 JSON 往返。
 *
 * 「世界空间」是要紧的：它已经把模型自己的 position / rotation / scale
 * 以及所有祖先的变换都算进去了，所以它可以直接用来做「最低点离地面多远」
 * 这种判断，调用方不需要再去关心物体变换。
 */
export interface ModelBounds {
  /** 最小角 */
  min: [number, number, number]
  /** 最大角 */
  max: [number, number, number]
}

/** 相机与轨道控制配置 */
export interface CameraConfig {
  /** 相机位置 */
  position: [number, number, number]
  /** 轨道控制的注视点，同时也是相机的朝向目标 */
  target: [number, number, number]
  /** 透视相机垂直视场角（度） */
  fov: number
  /** 近裁剪面 */
  near: number
  /** 远裁剪面 */
  far: number
  /** 是否自动旋转视角 */
  autoRotate: boolean
  /** 自动旋转速度 */
  autoRotateSpeed: number
  /** 是否启用阻尼惯性 */
  damping: boolean
  /** 阻尼系数，越小越"重" */
  dampingFactor: number
  /** 相机到注视点的最小距离 */
  minDistance: number
  /** 相机到注视点的最大距离 */
  maxDistance: number
  /** 最小极角（弧度），0 表示正上方 */
  minPolarAngle: number
  /** 最大极角（弧度），Math.PI / 2 表示不允许转到地面以下 */
  maxPolarAngle: number
  /** 是否允许平移 */
  enablePan: boolean
  /** 是否允许缩放 */
  enableZoom: boolean
  /**
   * 是否允许旋转。
   *
   * 与 `enablePan` / `enableZoom` 同一组：它们是**轨道控制的权限**，
   * 决定指针与滚轮能不能改变这个机位。写进配置而不是只做界面状态，
   * 是因为「这个场景只许平视、不许转」本身可能就是一个场景的既定要求。
   */
  enableRotate: boolean
}

/** 地面网格配置，字段与 cientos 的 Grid 对齐 */
export interface GroundConfig {
  /** 是否显示地面网格 */
  visible: boolean
  /** 网格平面边长 */
  size: number
  /** 单格尺寸 */
  cellSize: number
  /** 单格线宽 */
  cellThickness: number
  /** 单格线颜色 */
  cellColor: string
  /** 每多少格出现一条主分隔线 */
  sectionSize: number
  /** 主分隔线宽 */
  sectionThickness: number
  /** 主分隔线颜色 */
  sectionColor: string
  /** 是否使用无限网格（忽略 size） */
  infiniteGrid: boolean
  /** 开始淡出的距离 */
  fadeDistance: number
  /** 淡出强度 */
  fadeStrength: number
  /** 网格是否跟随相机移动 */
  followCamera: boolean
}

/** 天空、太阳与灯光配置 */
export interface SunConfig {
  /**
   * 是否渲染程序化天空。
   *
   * 默认关闭：天空会覆盖背景色，开启前请确认这是想要的效果。
   * 另外 Sky 的材质是 three-stdlib 的模块级单例，全场景只能存在一个。
   */
  showSky: boolean
  /** 太阳高度角（度），0 为地平线，90 为正上方 */
  elevation: number
  /** 太阳方位角（度） */
  azimuth: number
  /** 大气浑浊度，越大越朦胧 */
  turbidity: number
  /** 瑞利散射强度，影响天空的蓝色层次 */
  rayleigh: number
  /** 米氏散射系数 */
  mieCoefficient: number
  /** 米氏散射方向性，越大太阳周围的光晕越集中 */
  mieDirectionalG: number
  /** 环境光强度 */
  ambientIntensity: number
  /** 主光强度 */
  keyIntensity: number
  /** 补光强度 */
  fillIntensity: number
  /** 环境贴图预设，空字符串表示不使用 */
  environment: EnvironmentPreset | ''
  /**
   * 天空盒的六个面地址（顺序见 `SkyboxFaces`），`null` 表示不使用。
   *
   * 与 `environment` 是**同一个位置的两种填法**，不是可以叠加的两层：
   * 两者都写的是 `scene.environment`，而天空盒还要占掉 `scene.background`。
   * 所以正常情况下**最多只有一个不是空的**——编辑器里只有一个地方写这两个字段：
   * 左栏点天空盒时会把 `environment` 清成空串。反方向（选环境贴图时清掉天空盒）
   * 原先在右栏「环境贴图」那个下拉框里，那个下拉框已经删掉（它的位置换成了
   * 场景预设，见 DESIGN.md 设计决定 41），于是 `environment` 现在只由宿主经 props
   * 或导入 JSON 设定，编辑器不再替它清天空盒。`SceneSun` 里那条 `v-if` 是给
   * 两边都有值的手写 / 导入配置兜底的，见那边的注释。
   *
   * 清空用 `null` 而不是空数组：`SkyboxFaces` 是个定长元组，没有「六个都是空串」
   * 这种合法值，而 `applyPatch` 只跳过 `undefined`、不跳过 `null`，所以「关掉天空盒」
   * 在这份配置里是写得出来、也存得下去的。
   *
   * 为什么六个地址整个存进配置，而不是存一个「天空盒编号」：与 `models[].url`
   * 同一条理由——配置要能自己站住，导出成 JSON 拿到别处（或者存进 localStorage
   * 过几天再导入）时不该依赖「那个编号在那台服务器上还是第几号」。
   */
  skybox: SkyboxFaces | null
}

/** 阴影实现方式 */
export type ShadowType = 'map' | 'contact' | 'accumulative'

/** 阴影配置。三个分支的参数按 type 生效，未选中的分支不会渲染 */
export interface ShadowConfig {
  /** 是否启用阴影 */
  enabled: boolean
  /** 实现方式：原生 shadow map / 接触阴影 / 累积阴影 */
  type: ShadowType
  /** 模型是否投射阴影 */
  castShadow: boolean
  /** 模型是否接收阴影 */
  receiveShadow: boolean

  // ---------- type === 'map' ----------

  /** 阴影贴图分辨率 */
  mapSize: number
  /** 阴影偏移，用于消除自阴影产生的摩尔纹 */
  bias: number
  /** 法线方向偏移，对曲面比 bias 更稳 */
  normalBias: number

  // ---------- type === 'contact' ----------

  /** 接触阴影不透明度 */
  contactOpacity: number
  /** 接触阴影模糊半径 */
  contactBlur: number
  /** 接触阴影采样范围 */
  contactScale: number
  /** 接触阴影渲染分辨率 */
  contactResolution: number

  // ---------- type === 'accumulative' ----------

  /** 累积帧数，越大越干净但越慢 */
  accFrames: number
  /** 累积阴影不透明度 */
  accOpacity: number
  /** 累积阴影采样范围 */
  accScale: number
  /** 累积混合强度 */
  accBlend: number
}

/**
 * 平面图上的一个点，`[x, z]`，单位米。
 *
 * 与 three 的 (x, z) 同序，y 恒为 0（所有平面图对象都长在地面上）。
 * 之所以不写成一个 `{ x, z }` 对象：它要按数组喂给 three 的 `Shape` 与位置属性，
 * 而配置里这类坐标点会有成百上千个，数组是更紧凑也更好做相等比较的形态。
 */
export type FloorplanPoint = [number, number]

/**
 * 地基：一块矩形板。
 *
 * `x` / `z` 是**中心点**。参考项目在这一点上前后矛盾（它的 `createEmptyScene`
 * 给的 24×15 看着像尺寸、`renderFoundation` 又写 `x + width / 2` 当最小角），
 * 这里统一取中心：面板上填的数就是板子的中心，不需要心算半个尺寸。
 */
export interface FloorplanFoundation {
  /** 中心点 x，米 */
  x: number
  /** 中心点 z，米 */
  z: number
  /** 宽（沿 x），米 */
  width: number
  /** 深（沿 z），米 */
  depth: number
}

/**
 * 一面墙，存**中心线**（两个端点）。
 *
 * 厚度与高度在渲染时才长出体。长度、朝向这类派生量一律不进配置——
 * 挪一个端点就不会有第二处需要同步的数字。
 */
export interface FloorplanWall {
  id: string
  /** 中心线起点，米，`[x, z]` */
  start: FloorplanPoint
  /** 中心线终点，米，`[x, z]` */
  end: FloorplanPoint
  /** 墙高，米 */
  height: number
  /** 墙厚，米。以中心线为轴两侧各占一半 */
  thickness: number
  /**
   * 这面墙的外观地址，可选。**不写就是灰盒子**（`SceneFloorplanWall.vue` 那条路），
   * 老配置因此照旧能画，一个字段都不用补。
   *
   * **「没有外观」时这个键整个不存在**，而不是写 `undefined` 或空串：`undefined`
   * 在 JSON 往返里键会消失，于是「有键无值」与「没有键」会同时在内存里存在，
   * 任何按 `Object.keys` 比较的地方都看得出来——与 `FloorplanOpening.sillHeight`
   * 那条注释是同一个坑。写入方因此要用条件展开
   * （见 `useFloorplanTool.ts` 的 `addWall`），不能写成 `url: asset?.url`。
   *
   * **它是画笔留下的痕迹，不是几何**：`wallPieces()` 完全不认识它，切段、开洞、
   * 算世界坐标一个字都不受影响。铺面是叠在几何之上的一层
   * （`utils/wallFace.ts` 才认识它），所以纯几何那侧连同 smoke 里的断言都不用动。
   *
   * **为什么地基没有同一个字段、而墙必须有**：地基那次的生成物是一个能独立
   * 存在于 `config.models` 的物体（换了外观就是换一个模型），而一面墙不可能脱离
   * `walls[]` 独立存在——它要参与房间识别的整数格泛洪、要在上面挂门窗，
   * 外观只能长在墙身上。
   */
  url?: string
}

/** 洞口类型：门或窗。两者的差别只在竖直方向的切法（见 `floorplan.ts`） */
export type FloorplanOpeningKind = 'door' | 'window'

/**
 * 门窗：**没有自己的坐标**，只有「挂在哪面墙上 + 沿墙多少米」。
 *
 * 这是整个模型里最要紧的一条约束。墙一挪，门窗跟着挪；墙一删，
 * 挂在它上面的门窗必须一起删（见 `removeWall`）。存独立 x/z 就一定会漂移。
 * 参考项目用**数组下标** `wallIdx` 当引用，于是删墙时要逐个重映射下标——
 * 这里用 id，那个问题不存在。
 */
export interface FloorplanOpening {
  id: string
  kind: FloorplanOpeningKind
  /** 宿主墙的 id */
  hostWallId: string
  /** 洞口**中心**沿墙中心线的米数，从墙的 start 量起 */
  offset: number
  /** 洞口宽，米 */
  width: number
  /** 洞口高，米 */
  height: number
  /**
   * 窗台高，米。**门恒为 0，且这一项是必填的 `number` 而不是可选的。**
   *
   * 参考项目里门这一项是 `undefined`，而 `undefined` 在 JSON 往返里整个键会消失，
   * 门的形状就成了「有时有键、有时没键」。恒为数字之后，「门的 0」
   * 与「门下没有墙段」是同一件事，渲染端一个分支就够。
   */
  sillHeight: number
  /**
   * 这个洞口的外观地址（一樘门或窗的模型），可选。**不写就是程序生成的那套构件**
   * （四根框条 + 门扇 / 玻璃，`SceneFloorplanWallBox.vue` 那两种 role），老配置因此
   * 照旧能画，一个字段都不用补。
   *
   * **「没有外观」时这个键整个不存在**，与 `FloorplanWall.url` 是同一条约定
   * （那边写了完整理由）。写入方同样用条件展开。
   *
   * **它同样是画笔留下的痕迹，不是几何**：`wallPieces()` 完全不认识它，
   * 洞口照旧把墙切开、照旧产出框条与门扇。「哪些构件不画」是渲染层的事，
   * 判据是**这个字段真不真**（`floorplan.ts` 的 `openingFilledByModel` 是唯一实现），
   * 与洞口种类无关——门与窗都能装模型。填进去的那一方各取各的碎片：
   * 门那条渲染路取 `leaf`、窗取 `glass`（`fillRole`），所以一个被写了地址的洞口
   * 那一套框条与填充件就整批交给模型那一侧，这边再画一遍就是同一个包围盒上
   * 两组共面几何，逐像素 z-fighting。
   */
  url?: string
}

/**
 * 房间：由墙体自动围出来的多边形。
 *
 * `polygon` 是简单多边形、首尾不重复、**已折掉共线点**（见 `findEnclosedArea`），
 * 渲染时直接喂 `THREE.Shape`。它是「点封闭区域」那一刻算出来的快照，
 * 之后不随墙变动——改墙不会自动重算房间，这是刻意的：
 * 自动重算会让用户手改过的房间名与颜色莫名消失。
 */
export interface FloorplanRoom {
  id: string
  name: string
  polygon: FloorplanPoint[]
  color: string
}

/**
 * 户型图：2D 里画的东西、3D 里长出来的立体。
 *
 * 它是 `SceneConfig` 的一个顶层分组，而不是另立一个 store ——
 * 主要理由是**撤销、历史、导出全部白拿**：历史是「快照 + 分组 diff」
 * （见 `stores/scene.ts` 的 `commit`），每次落一面墙都是一次带标签的 `applyConfig`，
 * `⌘Z` 自然可用。代价是库的公开面变大，这一点写在 DESIGN.md 的设计决定里。
 *
 * **编辑态绝不进这里**：画到一半的墙链、悬停点、拖框中的矩形全是编辑器状态，
 * 配置里只出现「用户已经确认存在的东西」——`SceneConfig` 必须可 JSON 往返。
 */
export interface FloorplanConfig {
  /** 单块地基；null 表示还没放 */
  foundation: FloorplanFoundation | null
  walls: FloorplanWall[]
  openings: FloorplanOpening[]
  rooms: FloorplanRoom[]
}

/**
 * 场景配置：插件的完整可序列化状态。
 *
 * 这个对象是「导出配置 / 导入配置 / 操作历史」的载体，
 * 因此只放可 JSON 往返的数据，不放 loading 这类运行时状态。
 */
export interface SceneConfig {
  /** 画布背景色，'transparent' 表示透出宿主页面 */
  background: string

  /**
   * 场景里的模型，可以同时有多个。
   *
   * 用**数组**而不是「主模型 + 附属列表」，是因为这里没有主次之分：
   * 每个条目的字段完全一样，摆位、阴影、事件绑定各自独立，
   * 渲染时平铺成一层同级的包裹组。谁在编辑器里被选中是**界面状态**
   * （见 store 的 `selectedIndex`），不进配置、不进历史、不进导出物——
   * 换一份配置过来时不该顺带决定宿主该选中哪一个。
   *
   * 默认就是**空数组**（空场景）。视图层对「一个都没有」有完整处理：
   * 视口只渲染地面与光照，`selectedModel` 是 `undefined`，加载态与错误各自归位。
   * 想要一个 `url` 为空的条目（渲染成内置示例几何体），调 `addModel()`——
   * 那是一个明确的动作，不该由默认值白送。
   *
   * 注意它与配置里其他字段的一个不对称：`applyPatch` 对数组是**整体替换**
   * （见 {@link DeepPartial}），所以补丁里写 `models` 等于换掉整张列表，
   * 不是逐项合并。要改其中一个模型请用 store 的 `patchModel`。
   */
  models: ModelConfig[]

  /**
   * 户型图：在 2D 平面档里画出来的地基 / 墙 / 门窗 / 房间。
   *
   * 与 `models` 平级、默认**空的一份**（没有地基、没有墙）。理由同 `models: []`：
   * 默认值里出现东西，它会跟着每一份默认配置进导出物、进宿主页面，
   * 而「造一栋房子」是一个明确的动作，不该是默认值。
   *
   * 与 `models` 的另一个共同点：`applyPatch` 对数组是**整体替换**，
   * 补丁里写 `walls` 等于换掉整张列表而不是逐项合并。
   * 宿主调 `applyConfig` 传数组时请先过一遍 `cloneFloorplanPatch`。
   */
  floorplan: FloorplanConfig

  camera: CameraConfig
  ground: GroundConfig
  sun: SunConfig
  shadow: ShadowConfig
}

/** 一条操作历史记录 */
export interface HistoryEntry {
  /** 自增 id，用作列表 key */
  id: number
  /** 变更摘要，例如「相机 · 地面」 */
  label: string
  /** 记录时刻的时间戳 */
  at: number
  /** 该次变更后的完整配置快照 */
  config: SceneConfig
}

/** createThreeDMaker 的安装选项 */
export interface ThreeDMakerOptions {
  /**
   * 宿主应用已创建的 Pinia 实例。
   *
   * 传入时插件复用宿主实例（推荐，状态可在 Vue Devtools 中统一观察）；
   * 不传时插件会创建一个私有实例，保证在完全没有 Pinia 的项目里也能直接使用。
   */
  pinia?: Pinia

  /** 是否把组件注册为全局组件，默认 true */
  registerComponents?: boolean

  /** 全局组件名前缀，默认 'Tdm' */
  prefix?: string

  /**
   * 编辑器要用的一整套素材（根地址 + 分类清单），走 `provide` 发给整棵树。
   *
   * 写在这一层而不是 `SceneViewer` 的 prop 上，是为了让宿主**只写一次**：
   * 一个页面里挂几个 `SceneViewer` 都共用同一份，不必逐个传。
   *
   * **不传就是空**：编辑器渲染一句空态，不发任何请求。库不含任何默认地址——
   * 素材从哪来是宿主的事，见 `EditorAssets`。
   */
  assets?: EditorAssets

  /**
   * 编辑器需要回调宿主的那几件事，走 `provide` 发给整棵树。
   *
   * 今天只有一项：`runEventCode`——执行模型事件绑定里的那段代码。库**自己不执行**
   * 任何配置里的 `code`（那需要 `new Function`，而 `dist/index.js` 里不许出现它，
   * 冒烟测试钉着这一条），所以「跑不跑」由宿主决定。不传就是不跑。
   *
   * 与 `assets` 写在同一条理由上：宿主只写一次，页面上挂几个 `SceneViewer` 共用。
   * 完整说明见 `EditorHooks`。
   */
  hooks?: EditorHooks
}

/**
 * 宿主往左右栏里追加的一个面板页。
 *
 * **只有「有哪些页」这部分是数据**，页里画什么由具名插槽给，不在这个类型里：
 *
 *     const SIDE_TABS = [{ key: 'device', label: '设备' }]
 *
 *     <SceneViewer editable :side-tabs="SIDE_TABS">
 *       <template #side-tab-device>…我自己的面板…</template>
 *     </SceneViewer>
 *
 * ## 为什么声明与内容分成两处
 *
 * 页名 / 图标 / 顺序**库要拿去画导轨**，所以必须是能读的数据；而内容是宿主自己的
 * 模板。塞进同一个 prop 就得传组件对象或渲染函数——那在 `<script setup>` 里别扭，
 * 还会让「有哪些页」散在 setup 里、摆不到模板上。
 *
 * 这与仓库已有的扩展模式同源：左栏的追加分类（`SidePanel` 的 `extraSections`）
 * 也是「一份声明 + 按 key 的插槽」这么分的。
 *
 * ## 插槽名就是 `key` 拼出来的
 *
 * 左栏 `#side-tab-<key>`、右栏 `#inspector-tab-<key>`。没有任何一个 key 会被特殊对待，
 * 也不存在「库保留的 key」——宿主自己取的名字自己用。
 *
 * `key` 是**两个面板各自**的唯一标识，两边的命名空间不互通（左栏叫 `device` 与
 * 右栏叫 `device` 互不影响）。它与内置分类的 key（`floor` / `wall` / `door` /
 * `window` / `skybox`）撞名时**宿主这一支优先**，那个分类会点不到——
 * 撞名在开发模式下会由 Vue 报一条重复 key 的警告，不必等用户来发现。
 */
export interface EditorPanelTab {
  /**
   * 唯一键。插槽名按它拼：左栏 `#side-tab-<key>`、右栏 `#inspector-tab-<key>`。
   *
   * 它同时是「当前停在哪一页」的标识，所以**改了 key 就等于换了一页**：
   * 宿主中途把某个 key 撤掉，左栏/右栏会自己落回内置的第一页，不会停在空白上。
   */
  key: string

  /** 导轨上的名字。**同时是 `aria-label` 与悬停提示**，导轨上没有常显文字 */
  label: string

  /**
   * 导轨图标。
   *
   * 形状与内置那套同约定：画在 24 格里、只用描边、只吃 `currentColor` ——
   * 于是深色 / 浅色主题下都跟着文字色走，宿主不必关心配色。
   * 描边粗细与端点由 CSS 给（`.tdm-rail-icon`），这里只写路径。
   *
   * **不写退回一个立方体占位字形**（看得见、知道该点哪里），
   * 而不是留一格空白。
   */
  icon?: IconPath[]
}

/**
 * SceneViewer 组件属性。
 *
 * **只有七个，全部与「能力」有关**。画布长什么样（背景色、环境贴图、线框、
 * 地面网格、相机与户型图那几组配置）一概不在这里：那些值本来就住在
 * `useSceneStore().config` 里，让它们再从 prop 绕一遍等于同一个事实有两个来源，
 * 还得再定义「谁优先」——而 `watch` 桥那套写法连「谁最后落笔」都要靠注册顺序。
 * 想改场景外观就写 store（`applyConfig` / `patchModel`），那本来也是编辑器自己走的路。
 *
 * 同理，「编辑模式里默认就该开着的东西」不再逐个摆开关：`editable` 一处管一整组
 * （内置工具栏让位给编辑器自绘的界面、点选 / 包围框 / 手柄全开），规则与每条排法的
 * 理由在 `utils/sceneSwitches.ts`，那里是唯一实现。
 *
 * 也不再收 `model`：单模型入口是「一行 GLB」时代的形状，而多模型只是同一个
 * prop 的第一层裂缝。加模型请走 `useSceneStore().addModel(url, patch)`——
 * 它有 `draco` 之类的选项，也顺带回答了「加进去的那个算不算选中」。
 * 「拿一份存好的场景 JSON 把场景渲染出来」这件事由 {@link SceneViewerProps.initialScene} 承接，
 * 那是**整份配置**的入口，与「一个 GLB」是两件事。
 */
export interface SceneViewerProps {
  /** 画布高度，数字按 px 处理，默认 '480px' */
  height?: string | number

  /**
   * 编辑模式总闸：**`true` 时渲染整个三栏工作台**（左栏 ｜ 画布 ｜ 右栏），
   * 其余两种取值都只渲染画布。顶栏不在这里——场景名、保存、预览是策略，属于宿主。
   *
   * - `true` —— **编辑**：左栏挑料、中栏画布（点选 / 包围框 / 手柄全开）、右栏改属性，
   *   附带事件绑定弹窗与户型图绘制工具。内置工具栏让位给编辑器自绘的界面。
   * - `false` —— **预览**：只有画布，四个开关一律关掉。只想让人转着看时写它，
   *   就不必再记着关哪几个（漏关一个不报错，画面上只是多出一截本不该有的东西）。
   * - **不传** —— 只有画布，走旧默认（内置工具栏开、其余三个关）。这一支存在的
   *   唯一理由是**兼容**：`editable` 出现之前 `<SceneViewer />` 就是这个样子。
   *
   * 两个扩展 prop（`sideTabs` / `inspectorTabs`）只在编辑形态下有落点：
   * 画布形态没有面板，传了也不会渲染（不报错）。
   *
   * 其余 prop（`height` / `autoRotate` / `draco`）在哪种形态下都照常生效。
   *
   * 三栏工作台要求宿主给一个有高度的容器：组件根默认高 `480px`，铺满外层就写
   * `height="100%"`。
   */
  editable?: boolean

  /** 是否自动旋转视角，默认 false */
  autoRotate?: boolean

  /**
   * 模型是否为 Draco 压缩格式，默认 false。
   *
   * **只在「加模型」那一下有意义**：它写进的是**当前选中项**的 `draco` 标记，
   * 而读它的是加载那一步（`GLTFLoader` 挂不挂 DRACOLoader）。场景空着时
   * 没有选中项，这个 prop 会静静地什么都不做——要精确控制请用
   * `addModel(url, { draco: true })`。
   */
  draco?: boolean

  /**
   * 挂载时装载的一份场景数据，**只装一次**。
   *
   *     <SceneViewer :initial-scene="savedConfig" />
   *
   * 入参与 `loadSceneData()` 同一口径（`DeepPartial`）：只写要覆盖的分组，其余
   * 保持当前值。内部走同一条实现——先 `migrateConfig`（旧版写单个 `model` 对象的
   * 配置也能直接喂进来），再深合并，最后**清空撤销栈**（装载是「初始化」，
   * 换了一个场景之后还能 ⌘Z 退回上一个通常不是想要的）。
   *
   * ## 「一次」到底是什么意思
   *
   * 只在**第一次拿到非空值**时应用。之后宿主再怎么改这个 prop 都不生效——场景归
   * store 管了：用户在画布上拖一个模型，改的是 store，**不会**影响宿主手里那份对象
   * （载入是深拷贝）。所以数据可以晚到（先渲染 `:initial-scene="null"`、拉到再赋值）。
   *
   * 这**不是**受控绑定，理由不是风格问题：编辑态下组件每帧把新值写回 store，
   * 而受控绑定要求父组件拿着真值回传——拖拽逐帧 emit 一整份 `SceneConfig` 不可行，
   * 不做回传则父组件随便一次重渲染就把场景打回原形。要「持续同步」请自己在数据
   * 到位后调 `applyConfig()`，那条路有明确的历史语义。
   *
   * ⚠️ **与 `autoRotate` / `draco` 同时传时，以本 prop 为准。** 它排在两条
   * prop → store 桥之后落笔，而那两个值（`camera.autoRotate`、逐模型的 `draco`）
   * **整份场景里本来就带着**——那两个 prop 是给「从空场景起步」的宿主准备的。
   */
  initialScene?: DeepPartial<SceneConfig>

  /**
   * 往**左栏**导轨末尾追加的页，内容走 `#side-tab-<key>` 插槽。
   *
   * 排在模型库那几个分类**之后**，与它们之间有一条分隔线（宿主追加的分类也一样，
   * 于是三组「内置分类 ｜ 追加分类 ｜ 宿主页」在导轨上读得出来）。
   * 顺序就是数组顺序。不传则左栏与没有这个 prop 时一模一样。
   *
   * 点开后**整个左栏正文换成宿主的内容**——这一页与「模型库」是并列的两页，
   * 不是插在宫格里的一个区块。要往宫格里加东西请走追加分类那条路
   * （`createThreeDMaker({ assets })` 的 `sections`），两条路管的是两件事。
   */
  sideTabs?: EditorPanelTab[]

  /**
   * 往**右栏**导轨末尾追加的页，内容走 `#inspector-tab-<key>` 插槽。
   *
   * 与 `sideTabs` 同一条路数，只是排在那七个内置页之后。右栏比左栏窄（306px），
   * 宿主页的正文要自己管好横向溢出。
   */
  inspectorTabs?: EditorPanelTab[]
}

/**
 * `SceneViewer` 用 `defineExpose` 交出去的那 5 个方法。
 *
 * 单独写成一个类型，是因为**同一条签名要走四层**：宿主持模板引用调它、`SceneViewer`
 * 转给 `SceneEditor`（编辑态）或 `SceneCanvas`（画布态），而 `SceneEditor` 下面还隔着
 * `EditorStage` 一层。四份逐字抄一遍的话，改一处返回值（比如「什么时候给 `null`」）
 * 另外三处不会报错，只会在某个形态下悄悄给出不同的结果。
 *
 * 「方法」与「props / emits」是两条不同的路：props / emits 是声明式的「场景长什么样」，
 * 这一个层是命令式的「此刻画布上是什么情况」。库只产出数据，不做策略——
 * 叫 `getSceneData` 而不是 `saveScene`，因为组件本身并不保存。
 *
 * 几条返回值语义要背下来（它们没有自动化防线，见 DESIGN.md 目视清单）：
 * 前四条要隔着挂载好的画布问，画布没就绪时一律退化成「现在拿不到」（`false` / `null`）；
 * `getSceneData` 是例外，它只读 store，**承诺不返回 `null`**。
 */
export interface SceneViewerApi {
  /** 抓取当前机位并写回配置，返回是否抓到了（自动旋转开着时相机一直在动，只能主动取） */
  captureCamera: () => boolean
  /** 量一个模型的世界包围盒，量不了时返回 `null` */
  measureModel: (id: string) => ModelBounds | null
  /** 屏幕坐标 → 地面 `[x, z]`，落不到地面上（相机没就绪、画布没尺寸、视线与地面平行）时返回 `null` */
  groundPointAt: (clientX: number, clientY: number) => [number, number] | null
  /** 取当前场景配置的深拷贝，可直接 JSON 序列化 */
  getSceneData: () => SceneConfig
  /** 用一份场景数据初始化场景（内部走 `migrateConfig` 并清空撤销栈），返回是否用上了 */
  loadSceneData: (data: DeepPartial<SceneConfig>) => boolean
}

/** 相机位置变更载荷，由用户拖动视图后回传 */
export interface CameraChangePayload {
  position: [number, number, number]
  target: [number, number, number]
}

/** 渲染统计，由画布内的探针组件定期上报 */
export interface SceneStats {
  /** 实测帧率 */
  fps: number
  /** 本帧绘制的三角面数 */
  triangles: number
  /** 本帧的绘制调用次数 */
  drawCalls: number
}

/**
 * 模型指针事件的载荷。5 类事件共用同一个形状。
 *
 * 只有在**该模型**的 `events[type].enabled` 为真时才会产生。
 * 判定「单击」的规则是按下与抬起之间位移不超过几个像素、且间隔很短，
 * 所以拖动旋转视角不会误触发；双击与右击在此基础上各自加自己的判据。
 *
 * 名字里的 Click 是历史包袱：它起初只服务单击，后来被 5 类事件共用。
 * 它是已发布的公开接口，改名是破坏性变更，因此保留原名并给出别名
 * {@link ModelEventPayload}。
 */
export interface ObjectClickPayload {
  /**
   * 触发本次载荷的事件类型。
   *
   * 5 类事件共用一份载荷形状，因此执行代码时必须靠它分辨是谁触发的。
   */
  type: ModelEventType
  /** 模型 id，随机 uuid；换模型会换一个，因此可以拿它判断「是不是同一个物体」 */
  id: string
  /** 显示名，配置里留空时回退成派生的短名，因此**保证非空** */
  name: string
  /** 产生这次事件的模型地址，blob 场景靠它自解释 */
  url: string
  /** 命中点的世界坐标 */
  point: [number, number, number]
  /** 命中点到相机的距离 */
  distance: number
  /**
   * 命中的最深层 mesh。多部件的模型上可以据此分辨点到了哪个部件。
   *
   * **5 类事件在这里语义一致**，都是最深层 mesh 而不是包裹组——
   * 之所以要专门说明，是因为 pmndrs 在 pointerenter / pointerleave 上
   * 把事件对象本身设成了包裹组，两者必须靠 `intersection.object` 拉齐。
   *
   * 它是活的 three 对象、带 parent 环，**不能 JSON.stringify**。
   */
  object: Object3D
}

/** `ObjectClickPayload` 的本名。新代码用这个，旧的继续可用 */
export type ModelEventPayload = ObjectClickPayload

/**
 * 在画布上点中了一个模型，由 `pickable` 打开后的画布级拾取产生。
 *
 * 与 {@link ObjectClickPayload} 的差别只有两点，都是为了划清两层的边界：
 *
 * - **没有 `type`**：这条通道只有「选中」一种事件，不像 `events` 那样 5 类共用一份载荷；
 * - **没有 `name` / `url`**：拾取发生在 3D 层，而那一层不访问 Pinia、也不该知道
 *   配置里怎么称呼这个模型（见 SceneContent 顶部那段）。它唯一知道的就是模型 id，
 *   宿主拿到 id 之后自己回配置里取名字。
 *
 * 它与 `objectClick` 是**两条互不相干**的通道：同一个模型可以只开其中一个、
 * 也可以都开，而 `modelPick` 一定**先到**——它由我们自己的 DOM 监听器同步派发，
 * `objectClick` 要等 pmndrs 把事件批处理到下一帧才合成出来。
 */
export interface ModelPickPayload {
  /** 模型 id，与配置里 `models[n].id` 一一对应 */
  id: string
  /** 命中点的世界坐标 */
  point: [number, number, number]
  /** 命中点到相机的距离 */
  distance: number
  /** 命中的最深层 mesh。活的 three 对象、带 parent 环，不能 JSON.stringify */
  object: Object3D
}

/** 变换手柄的模式，与 three-stdlib TransformControls 的 `mode` 取值同名 */
export type TransformMode = 'translate' | 'rotate' | 'scale'

/**
 * 在画布上拖手柄改了一个模型的变换。
 *
 * 与 {@link ModelPickPayload} 同一条来路：3D 层不访问 Pinia，载荷里因此
 * 只有模型 id 与三个三元组，没有 `name` / `url`——宿主拿到 id 之后自己回配置里取名字。
 *
 * 三个值都是**配置口径**而不是「手柄口径」，可以直接写进 `models[n]`：
 * `rotation` 是弧度（面板上显示成度数是编辑器那一侧的事），`scale` 是倍率。
 */
export interface ModelTransformPayload {
  /** 模型 id，与配置里 `models[n].id` 一一对应 */
  id: string
  position: [number, number, number]
  /** 弧度 */
  rotation: [number, number, number]
  scale: [number, number, number]
}

/** SceneViewer 组件事件 */
export interface SceneViewerEmits {
  /** 模型加载完成 */
  (e: 'loaded'): void

  /** 加载进度变化，取值范围 0 ~ 100 */
  (e: 'progress', percentage: number): void

  /** 加载失败 */
  (e: 'error', message: string): void

  /** 用户拖动视图导致相机变化 */
  (e: 'cameraChange', payload: CameraChangePayload): void

  /** 单击模型（需要该模型的 events.click.enabled 为真） */
  (e: 'objectClick', payload: ObjectClickPayload): void

  /**
   * 双击模型（需要该模型的 events.dblclick.enabled 为真）。
   *
   * 与 DOM 语义一致：两次单击各自也会触发 `objectClick`，
   * 所以「开了双击」会看到 2 次单击 + 1 次双击。
   */
  (e: 'objectDblclick', payload: ObjectClickPayload): void

  /** 指针进入模型（需要该模型的 events.pointerenter.enabled 为真） */
  (e: 'objectPointerEnter', payload: ObjectClickPayload): void

  /** 指针离开模型（需要该模型的 events.pointerleave.enabled 为真） */
  (e: 'objectPointerLeave', payload: ObjectClickPayload): void

  /** 右键模型（需要该模型的 events.contextmenu.enabled 为真） */
  (e: 'objectContextMenu', payload: ObjectClickPayload): void

  /**
   * 在画布上点中了一个模型（需要 `pickable` 为真）。
   *
   * 与 `objectClick` 无关：不需要模型开任何 `events`，两者也不会互相顶掉。
   * 每次单击最多发一次；点空白处不发。
   */
  (e: 'modelPick', payload: ModelPickPayload): void

  /**
   * 拖手柄改变了模型的变换，**拖拽过程中每帧发一次**（需要 `gizmo` 为真）。
   *
   * 这不是「宿主拿到了才生效」的事件：库自己已经把值写回 store 了（与相机拖动
   * 那条路径对称），面板上的数字会实时跟着跳。它只是一个通知，给宿主做
   * 「拖动中就更新别的东西」用。
   */
  (e: 'modelTransform', payload: ModelTransformPayload): void

  /**
   * 手柄拖拽结束，且这一次拖拽**确实改变了变换**（需要 `gizmo` 为真）。
   *
   * 「确实变了」是刻意收窄的：在轴上按一下没拖动就松手不会发。宿主通常用它
   * 补一条可读的历史标签——那时值早已写进 store，所以这一次写入只是为了让
   * 历史里记成「移动模型」而不是自动拼出的「模型属性」，而且它会把 store 里
   * 那次防抖提交顶掉，整段拖拽仍然只留一条记录。
   */
  (e: 'modelTransformEnd', payload: ModelTransformPayload): void
}

/** 模型加载的资源地址变更 payload */
export interface ModelChangePayload {
  /** 当前模型地址，空字符串表示已卸载模型 */
  url: string
}
