/**
 * 「把一件模型画成一张方形封面」——离屏渲染，不进主画布。
 *
 * 这是 `exportModel()` 的 `thumbnail` 那一半。它回答的问题与 `captureCamera()`
 * 完全不同：后者抓的是**此刻的画面**（机位、其他模型、背景都在里面），
 * 这里要的是**这一件东西本身**——机位自动取、背景透明、别的模型一概不参与。
 *
 * ## 为什么不截主画布
 *
 * 主画布上有什么取决于用户此刻在干什么：可能被转到了背面、可能被别的模型挡住、
 * 可能还停在 2D 俯视。拿它当封面，同一个模型每次保存出来的图都不一样。
 * 离屏渲染把「取景」这件事收回来，封面才是稳定的。
 *
 * ## 为什么不 clone 一棵树
 *
 * three 官方的克隆入口是 `three/examples/jsm/utils/SkeletonUtils.js`，
 * 但它**只有 ESM**。本库同时产出 `es` 与 `cjs`，静态 import 进 CJS 产物会变成
 * `require()` 一个 ESM 文件，Node 20 的宿主在**加载模块那一刻**就崩，而这条
 * 路径与缩略图毫无关系——整包都装不进来。
 *
 * 于是这里改成「借用活对象」：用 `tempScene.attach(object)` 把它从原父级取下、
 * 挂进临时场景（`attach` 会**保留世界变换**，蒙皮绑定也不受影响），画完在
 * `finally` 里原样挂回去。这是同步调用，渲染循环插不进来；也顺带避开了
 * 「克隆出来的几何体与贴图是共享的、不能 dispose」那一整类问题——
 * 这里本来就什么都不 dispose，只 dispose 自己建的渲染目标。
 *
 * ## 颜色为什么全是手算的
 *
 * three 对**非 XR 的渲染目标**强制用工作色彩空间、并关掉色调映射
 * （`WebGLPrograms` 里那两个参数按 `currentRenderTarget` 分支）。也就是说
 * 读回来的像素是**线性 sRGB、已预乘 alpha、左下原点**，与主画布输出的那张
 * sRGB 图不是一回事。三步缺一不可：
 *
 * 1. 反预乘（透明边缘的 RGB 被 alpha 乘过）；
 * 2. 按 `renderer.toneMapping` 做色调映射（本库的画布从不配置它，默认是
 *    `NoToneMapping`，但宿主将来若在同一个 renderer 上改过，这里要跟得上）；
 * 3. 线性 → sRGB 的传递函数。
 *
 * 颜色算错了**不会报错**，只会得到一张偏亮、偏灰或者边缘发黑的封面。
 * 同一类「只有眼睛看得出来」的东西，见 DESIGN.md 目视清单 164。
 */

import {
  ACESFilmicToneMapping,
  Box3,
  CineonToneMapping,
  Color,
  DirectionalLight,
  HemisphereLight,
  LinearToneMapping,
  NoToneMapping,
  PerspectiveCamera,
  ReinhardToneMapping,
  RGBAFormat,
  Scene,
  Sphere,
  UnsignedByteType,
  Vector3,
  WebGLRenderTarget,
} from 'three'
import type { Object3D, WebGLRenderer } from 'three'

/** 默认边长。512 在列表里放大到两倍还够清楚，PNG 也只有几十 KB */
const DEFAULT_SIZE = 512

/** 下限：再小就连「这是什么东西」都看不出来了 */
const MIN_SIZE = 64

/**
 * 上限：1024。
 *
 * 回读走的是同步 `readPixels`，会卡住主线程；2048² 的 RGBA 缓冲是 16 MB，
 * 在低端机上已经能感到一次明显的停顿。宿主真要大图应该自己拿 `geometry`
 * 重画，而不是把封面放大。
 */
const MAX_SIZE = 1024

/** 取景用的竖直视角。35° 接近人像镜头的观感，比 50° 更少透视变形 */
const THUMBNAIL_FOV = 35

/**
 * 取景留白系数。
 *
 * 包围球是「最坏情况下能装下」的球，按它算出来的距离边缘几乎贴着画布。
 * 1.15 留出大约一圈 7% 的空白——封面要能看清轮廓，不能顶着边。
 */
const FRAME_MARGIN = 1.15

/** 固定的 3/4 视角方向：右前上方。归一化在构造相机时做 */
const VIEW_DIRECTION = new Vector3(0.75, 0.55, 1)

/**
 * 把宿主给的尺寸收进合法区间。
 *
 * `NaN` / `Infinity` 回落成默认值而不是夹成边界：那两种输入只可能是
 * 「宿主算错了」，给 512 比给 64 或 1024 更像一个正常结果。
 */
export function normalizeThumbnailSize(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_SIZE
  return Math.min(MAX_SIZE, Math.max(MIN_SIZE, Math.round(value)))
}

/**
 * 画一张缩略图，失败返回 `null`。
 *
 * `object` 必须已经挂在一个父级下（`attach` 要借它的世界变换）；`sourceScene`
 * 只用来抄环境贴图与它的强度 / 旋转——**灯光不抄**，见下面那盏补光的注释。
 *
 * 这个函数**不抛异常**：缩略图是附加价值，画不出来不该让宿主连配置都拿不到。
 * 所有失败路径都收敛成 `null`，由调用方原样放进 `ModelExportResult.thumbnail`。
 */
export function renderModelThumbnail(
  object: Object3D,
  sourceScene: Scene,
  renderer: WebGLRenderer,
  size: number,
): string | null {
  // SSR 与「画布还没挂上」都在这里被挡住：两者都拿不到 2D canvas
  if (typeof document === 'undefined') return null

  const parent = object.parent
  if (!parent) return null

  const tempScene = new Scene()

  /*
    环境贴图是 PBR 材质的主光。不抄它，金属与光滑表面会黑成一片——
    而那正是 AI 生成的零件表里最常见的两种材质参数。
  */
  tempScene.environment = sourceScene.environment
  tempScene.environmentIntensity = sourceScene.environmentIntensity
  tempScene.environmentRotation.copy(sourceScene.environmentRotation)

  /*
    两盏**固定**的补光，刻意不抄场景里的太阳。

    缩略图的职责是「同一件模型每次导出来都长一样」；跟着场景里的灯光走，
    同一个模型在阴天预设与正午预设下会得到两张明显不同的封面。中性棚拍光
    也让缺环境贴图的宿主（纯色背景）不至于得到一个全黑的东西。
  */
  const skyLight = new HemisphereLight(0xffffff, 0x555566, 2.2)
  tempScene.add(skyLight)

  const keyLight = new DirectionalLight(0xffffff, 2.4)
  tempScene.add(keyLight)
  // 方向光的方向由「灯 → target」决定，target 默认在原点，必须跟着模型中心走
  tempScene.add(keyLight.target)

  const previousVisible = object.visible
  const previousRenderTarget = renderer.getRenderTarget()
  const previousClearColor = renderer.getClearColor(new Color())
  const previousClearAlpha = renderer.getClearAlpha()
  const previousAutoClear = renderer.autoClear

  let target: WebGLRenderTarget | null = null

  try {
    /*
      隐藏的模型也要能出封面——「保存」这个动作不该因为物体此刻不可见就拿不到图。
      恢复放在 finally，主画布下一帧照旧按 config 的 visible 渲染。
    */
    object.visible = true
    tempScene.attach(object)
    tempScene.updateMatrixWorld(true)

    const box = new Box3().setFromObject(object)
    if (box.isEmpty()) return null

    const sphere = box.getBoundingSphere(new Sphere())
    if (!Number.isFinite(sphere.radius) || sphere.radius <= 0) return null

    const center = sphere.center
    const direction = VIEW_DIRECTION.clone().normalize()
    const distance = (sphere.radius / Math.sin((THUMBNAIL_FOV * Math.PI) / 360)) * FRAME_MARGIN

    /*
      近远平面只影响深度裁剪，不参与取景。近平面压在距离的 1/100，
      远平面放到距离的 10 倍——都留够了余量，又不会把精度浪费掉。
    */
    const camera = new PerspectiveCamera(
      THUMBNAIL_FOV,
      1,
      Math.max(distance / 100, 0.001),
      distance * 10,
    )
    camera.position.copy(center).addScaledVector(direction, distance)
    camera.lookAt(center)

    // 主光从相机的左上方打过来，跟着取景方向走，转到哪一面都有形体
    keyLight.position.copy(center).addScaledVector(
      new Vector3(0.6, 1, 0.4).normalize(),
      Math.max(sphere.radius * 3, 1),
    )
    keyLight.target.position.copy(center)

    target = new WebGLRenderTarget(size, size, {
      format: RGBAFormat,
      type: UnsignedByteType,
      /*
        4× MSAA。缩略图里斜边与圆柱侧面占的比例很高，2× 的锯齿在这个尺寸上
        仍然一眼可见。解析发生在 `render()` 返回之前，紧接着回读就是已解析的图。
      */
      samples: 4,
      depthBuffer: true,
      stencilBuffer: false,
      generateMipmaps: false,
    })

    renderer.setRenderTarget(target)
    renderer.autoClear = true
    // 透明底：PNG 的 alpha 直接来自这里，不是把背景画成白色
    renderer.setClearColor(0x000000, 0)
    renderer.render(tempScene, camera)

    const pixels = new Uint8Array(size * size * 4)
    renderer.readRenderTargetPixels(target, 0, 0, size, size, pixels)

    return encodeThumbnail(pixels, size, renderer)
  } catch (error) {
    /*
      这条路径上的失败大多是显卡能力或内存问题（例如 WebGL2 不可用）。
      宿主拿到的仍然是完整的配置与零件表，只是没有封面。
    */
    console.warn('3deditor: 模型缩略图渲染失败', error)
    return null
  } finally {
    // 先恢复渲染器状态，再处理场景图——顺序不重要，但两件都必须做
    renderer.setRenderTarget(previousRenderTarget)
    renderer.setClearColor(previousClearColor, previousClearAlpha)
    renderer.autoClear = previousAutoClear
    target?.dispose()

    /*
      「还回原父级」用 `attach` 而不是 `add`：后者会把当前（临时场景里的）
      局部变换原样带回去，模型在画布上会跳到别的位置。`attach` 保留世界变换，
      于是局部变换也回到原值——这是这段代码唯一一个错了**不起眼**的地方。
    */
    parent.attach(object)
    object.visible = previousVisible
  }
}

/**
 * 读回的像素 → `data:image/png`。
 *
 * 三步顺序不能换：反预乘 → 色调映射 → sRGB 编码。先编码再反预乘的话，
 * 透明边缘会先被传递函数压成非线性值，之后除 alpha 得到的颜色就不对了。
 */
function encodeThumbnail(
  pixels: Uint8Array,
  size: number,
  renderer: WebGLRenderer,
): string | null {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size

  const context = canvas.getContext('2d')
  if (!context) return null

  const image = context.createImageData(size, size)
  const output = image.data
  const exposure = renderer.toneMappingExposure

  for (let y = 0; y < size; y += 1) {
    /*
      渲染目标的原点在左下，`ImageData` 的原点在左上——不移这一行，
      封面会上下颠倒。模型大多接近对称，颠倒了有时甚至不显眼，
      但带底座或扶手的椅子会立刻看出来。
    */
    const sourceRow = (size - 1 - y) * size * 4
    const outputRow = y * size * 4

    for (let x = 0; x < size; x += 1) {
      const from = sourceRow + x * 4
      const to = outputRow + x * 4

      const alpha = pixels[from + 3] / 255
      // 全透明像素留在 ImageData 的初始值 (0,0,0,0)，省掉一整轮算术
      if (alpha <= 0) continue

      /*
        反预乘。不透明像素这里除以 1，等于没动；只有 MSAA 边缘与半透明材质
        会被影响——而它们恰好是最容易被忽略、又最容易被看出来的地方。
      */
      const linear = [
        pixels[from] / 255 / alpha,
        pixels[from + 1] / 255 / alpha,
        pixels[from + 2] / 255 / alpha,
      ] as [number, number, number]

      const mapped = toneMap(renderer.toneMapping, linear, exposure)

      output[to] = toSrgbByte(mapped[0])
      output[to + 1] = toSrgbByte(mapped[1])
      output[to + 2] = toSrgbByte(mapped[2])
      output[to + 3] = pixels[from + 3]
    }
  }

  context.putImageData(image, 0, 0)
  return canvas.toDataURL('image/png')
}

/**
 * 与 three 的 `tonemapping_pars_fragment.glsl.js` 逐式对应。
 *
 * 这里只实现本库可能遇到的几种。画布本身从不设置 `renderer.toneMapping`，
 * 所以正常路径永远是 `NoToneMapping`；另外几种是防宿主在同一个 renderer 上
 * 改过它——那时封面应当尽量贴近主画布，而不是突然换一种观感。
 */
function toneMap(
  mapping: number,
  color: [number, number, number],
  exposure: number,
): [number, number, number] {
  const [r0, g0, b0] = color

  switch (mapping) {
    case NoToneMapping:
      return color

    case LinearToneMapping:
      return [
        Math.min(1, exposure * r0),
        Math.min(1, exposure * g0),
        Math.min(1, exposure * b0),
      ]

    case ReinhardToneMapping: {
      const r = exposure * r0
      const g = exposure * g0
      const b = exposure * b0
      return [
        Math.min(1, r / (1 + r)),
        Math.min(1, g / (1 + g)),
        Math.min(1, b / (1 + b)),
      ]
    }

    case CineonToneMapping: {
      const r = Math.max(0, exposure * r0 - 0.004)
      const g = Math.max(0, exposure * g0 - 0.004)
      const b = Math.max(0, exposure * b0 - 0.004)
      const cineon = (v: number) =>
        ((v * (6.2 * v + 0.5)) / (v * (6.2 * v + 1.7) + 0.06)) ** 2.2
      return [
        Math.min(1, cineon(r)),
        Math.min(1, cineon(g)),
        Math.min(1, cineon(b)),
      ]
    }

    case ACESFilmicToneMapping:
    default:
      /*
        ACES 与「未知档位」共用这一条。矩阵与 RRT/ODT 拟合式照 three 的 shader，
        连 `exposure / 0.6` 那个经验系数也照抄——少了它封面会比主画布暗一截。
      */
      return acesFilmic([r0 * (exposure / 0.6), g0 * (exposure / 0.6), b0 * (exposure / 0.6)])
  }
}

/** three 的 `ACESFilmicToneMapping`，逐项展开。矩阵是 shader 里的列向量 */
function acesFilmic(color: [number, number, number]): [number, number, number] {
  const [r, g, b] = color

  // ACESInputMat * color
  const x = 0.59719 * r + 0.35458 * g + 0.04823 * b
  const y = 0.076 * r + 0.90834 * g + 0.01566 * b
  const z = 0.0284 * r + 0.13383 * g + 0.83777 * b

  const fitted: [number, number, number] = [0, 0, 0]
  for (const [index, value] of [x, y, z].entries()) {
    const a = value * (value + 0.0245786) - 0.000090537
    const denominator = value * (0.983729 * value + 0.432951) + 0.238081
    fitted[index] = a / denominator
  }

  const [fx, fy, fz] = fitted

  // ACESOutputMat * color
  return [
    Math.min(1, Math.max(0, 1.60475 * fx - 0.53108 * fy - 0.07367 * fz)),
    Math.min(1, Math.max(0, -0.10208 * fx + 1.10813 * fy - 0.00605 * fz)),
    Math.min(1, Math.max(0, -0.00327 * fx - 0.07276 * fy + 1.07602 * fz)),
  ]
}

/** 线性 → sRGB 的传递函数，与 three 的 `sRGBTransferOETF` 同一分段 */
function toSrgbByte(value: number): number {
  const clamped = Math.min(1, Math.max(0, value))
  const encoded =
    clamped <= 0.0031308
      ? clamped * 12.92
      : 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055
  return Math.round(encoded * 255)
}
