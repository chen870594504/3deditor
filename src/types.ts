import type { Pinia } from 'pinia'
import type { Object3D } from 'three'

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
   * 于是 `playground/composables/useModelLibrary.ts` 的 `sceneUrls`（一个
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
}

/** SceneViewer 组件属性 */
export interface SceneViewerProps {
  /**
   * glTF / GLB 模型地址；不传时场景里没有任何模型（默认就是空场景）。
   *
   * 也可以直接传一整个模型分组，用来一次配置模型本身与它的摆放状态：
   *
   * ```vue
   * <SceneViewer :model="{ url: '/chair.glb', position: [0, 1, 0], scale: [2, 2, 2] }" />
   * ```
   *
   * 传内联对象字面量时每次父组件渲染都会重新同步一次，从而覆盖用户在编辑器里的改动；
   * 建议传 setup 里的常量或 computed。
   *
   * 这个 prop 是**单模型**时代的入口，语义是「当前那一个模型」：它写入的是
   * store 里被选中的那个条目，选中项不存在（空场景）时追加一个新的。
   * 场景里要同时摆多个模型请直接用 store 的 `addModel` / `patchModel`——
   * 用一个 prop 描述一张列表，就得再定义「谁被选中」，那是界面的事，不该进 props。
   */
  model?: string | DeepPartial<ModelConfig>

  /** 画布背景色，传 'transparent' 可透出宿主页面背景 */
  background?: string

  /** 环境贴图预设；不设置时仅使用内置灯光 */
  environment?: EnvironmentPreset

  /** 画布高度，数字按 px 处理，默认 '480px' */
  height?: string | number

  /** 是否显示内置工具栏，默认 true */
  toolbar?: boolean

  /** 是否自动旋转视角，默认 false */
  autoRotate?: boolean

  /** 是否以线框模式渲染，默认 false */
  wireframe?: boolean

  /** 是否显示地面网格，默认 true */
  showGrid?: boolean

  /** 模型是否为 Draco 压缩格式，默认 false */
  draco?: boolean

  /**
   * 是否允许在画布上点选模型，默认 **false**。
   *
   * 打开后，在画布上单击会命中指针底下那个模型并派发 `modelPick`，
   * 宿主据此把选中项切过去。判定「单击」的规则与物体事件完全一样
   * （按下与抬起之间位移不超过几个像素、且间隔很短），所以拖动旋转视角不会误选中。
   *
   * 与 `events` 是**两条互不相干**的通道，代价也不叠加：
   *
   * - `events` 是**物体级**的：挂上监听器之后，那个模型的整棵子树在指针移动时
   *   每帧都要被 raycast（这也正是它默认全关的原因）；
   * - `pickable` 是**画布级**的：只多两个 DOM 监听器（pointerdown / pointerup），
   *   射线只在真的抬起指针那一刻走一次，静止时一切开销为零。
   *
   * 所以它不会让任何模型每帧被 raycast，也不需要模型自己开任何事件。
   * 点空白处（地面、背景）不会有任何事件——`modelPick` 只在真的点中模型时发出。
   */
  pickable?: boolean

  /**
   * 选中的模型是否在画布上画一圈包围框，默认 **false**。
   *
   * 与 `pickable` 是**输入与输出**两条独立通道：`pickable` 管「点谁能选中」，
   * 这一个管「选中了看得见吗」。两者互不依赖，各自都能单独打开。
   *
   * 选中的是 store 里的 `selectedIndex`（那是界面状态，不进配置、不进历史）。
   * 模型被隐藏（`visible` 为 false）时不画——否则会出现「拖着一个看不见的东西」
   * 这种既没反馈又难解释的状态。
   *
   * 代价：只对**选中的那一个**模型每帧做一次世界包围盒计算
   * （遍历它的网格，不做逐顶点迭代），与 `events` 那种「整棵子树每帧被 raycast」
   * 不是一回事。
   */
  selection?: boolean

  /**
   * 是否显示 X/Y/Z 变换手柄，默认 **false**。拖手柄直接改选中模型的变换。
   *
   * 拖拽过程中每帧写回 store（面板数字实时跟着跳，整段拖拽由 store 的防抖
   * 合并成**一条**历史记录），并派发 `modelTransform`；松手且确实变了再派发
   * `modelTransformEnd`。**宿主一行代码都不写也能用**。
   *
   * 不需要模型开任何 `events`，也不会让模型每帧被 raycast：手柄自己的射线检测
   * 只打在它那几个轴网格上。
   *
   * 拖动期间会临时把轨道控制禁用（相机的 `enable` 由 cientos 的 TransformControls
   * 处理），所以转视角与拖手柄不会互相打架。
   */
  gizmo?: boolean

  /** 手柄模式：平移 / 旋转 / 缩放，默认 `'translate'`。模式是界面状态，不进配置 */
  gizmoMode?: TransformMode

  /**
   * 机位过渡时长（毫秒），默认 **0 = 瞬移**（要滑过去就写 450 之类）。
   *
   * 打开之后，`camera.position` / `camera.target` 的任何改动都是**滑**过去的：
   * 球坐标插值（半径 / 极角 / 方位角），两端缓入缓出，中途被用户操作打断时
   * 直接落到终点。宿主写配置、撤销、套预设、面板里改数值走的是同一条路。
   *
   * 整条路径都夹在 `min` / `maxDistance` 与 `min` / `maxPolarAngle` 之内（两端先夹进
   * 区间，插值出来就都在区间里），所以飞行途中约束不会把路径拧变形。
   *
   * **它只是动画，不改变「谁说了算」**：配置在写入的那一刻就是终点，相机在后面追。
   * 于是面板读数、按钮高亮、历史记录立刻是终点的样子，不必等画面追上。
   *
   * 两条不做动画的情况：起点与终点在 1mm 以内（所以用户拖动视角松手后的自动回写
   * 不会莫名其妙滑一下），以及用户自己开了「减少动效」。
   */
  cameraTransition?: number

  /** 相机配置，只需写出要覆盖的字段 */
  camera?: DeepPartial<CameraConfig>

  /**
   * 户型图配置：地基 / 墙 / 门窗 / 房间。
   *
   * 与其余分组配置同一条约定——只写要覆盖的字段，走深合并。
   * 但比它们多一条**必须注意**的事：`walls` / `openings` / `rooms` 是数组，
   * 而深合并对数组是**整体替换**（见 {@link DeepPartial}），
   * 补丁里的数组会被**按引用**装进配置。传内联数组字面量没问题，
   * 传你自己那个 reactive / 复用的数组则会留下一条隐式通道：
   * 之后就地改它一下就是静默改场景，历史栈里查无此事。
   *
   * 库**在这一条通道上自己会克隆**（`SceneViewer` 里那个分组桥过了一遍
   * `cloneFloorplanPatch`），所以经这个 prop 进来是安全的；需要自己克隆的是
   * **直接调 store 的 `applyConfig`** 那条路，那里没有这层保护。
   */
  floorplan?: DeepPartial<FloorplanConfig>

  /** 地面配置，只需写出要覆盖的字段 */
  ground?: DeepPartial<GroundConfig>

  /** 日照环境配置，只需写出要覆盖的字段 */
  sun?: DeepPartial<SunConfig>

  /** 阴影配置，只需写出要覆盖的字段 */
  shadow?: DeepPartial<ShadowConfig>
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
