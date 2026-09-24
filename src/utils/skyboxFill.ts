/**
 * 六张面图里有几张没拿到时，把缺的那几张补成一块纯色。
 *
 * ## 为什么要有这个
 *
 * `CubeTextureLoader` 的完成条件是**六张一张不少**（`three.core.js` 里那句
 * `if (loaded === 6)`），少一张就永远不触发回调，于是 `scene.background` /
 * `scene.environment` 一个字都不写——用户看到的是「点了没反应」。而服务器上
 * 恰好有二十组天空盒只缺 `down.jpg`（另外五张都在，连缩略图都是好的），
 * 表现就是左栏那一格看着完全正常、点下去却什么都不发生。
 *
 * 缺一张图不构成「这一组不能用」：底面朝下，本来大半被地面挡着，补一块与四周
 * 接得上的纯色就够用了。所以这里做的是**逐面兜底**，不是整组放弃。
 *
 * ## 补什么颜色（量出来的，不是拍的）
 *
 * 拿十二个六面齐全的组当样本，比较「按下面的规则算出来的颜色」与「真实
 * `down.jpg` 的平均色」（0~255 的三通道平均绝对差）：
 *
 * | 规则 | 差 |
 * | --- | --- |
 * | 取四个侧面**贴着下缘那两行**（下面 `DOWN` 那一支） | **8.1** |
 * | 取现有五张图的整体平均（最省事的做法） | 41.8 |
 *
 * 十二组里有六组的差 ≤ 1.4。底面被补成天空色还是地面色，是看得出来的，
 * 所以贴着共享棱取色不是讲究。
 *
 * **「哪一行属于哪一个极」也验过一遍**，不是在纸上推的：把两个配对倒过来再量一次，
 *
 * | 配对 | 与真实那一面的差 |
 * | --- | --- |
 * | 最后一行 ↔ 底面、第一行 ↔ 顶面（本文件） | 8.1 |
 * | 最后一行 ↔ 顶面、第一行 ↔ 底面（倒着来） | 63 ~ 66 |
 *
 * 也就是说接底面的那条边确实是图像的**最后**一行。弄反了的代价是补出来的底面
 * 变成天空色，而那正是一眼能看出来又不会报错的那类错。
 *
 * ## 为什么「贴边」这条规则这么短
 *
 * 立方体贴图那套面表里，四个侧面的 `tc` 全都是 `-y`（`+X: sc=-z, tc=-y`、
 * `-X: sc=z, tc=-y`……），而 `t = 0` 是图像第一行（`flipY` 对立方体贴图是关的）。
 * 于是「四个侧面接底面的那一条边」对四张**一律是最后一行**，接顶面的一律是第一行，
 * 不需要逐面写一张对照表——那种表抄错一格不会报错，只会让补出来的颜色不对。
 *
 * 缺**侧面**时这条规则失效（邻居里混着上下两面，没有统一的行列规则），
 * 那一支退化成「整图平均」，也就是上表里 41.8 那一行。**那一支是粗的**，
 * 当前这批资产里没有这种组；真有的时候更好的做法是按立方体的十二条棱
 * 逐条求共享边，而不是照抄这里。
 */
export type SkyboxFaceImages = (HTMLImageElement | null)[]

/**
 * 缩略图边长。取色只要颜色不要细节，而 `drawImage` 缩放本身就是一次重采样，
 * 把 512² / 1024² 的图统一到这一张上，取色逻辑就不用关心原图多大。
 */
const THUMB = 32

/** 贴边取色取几行。取两行而不是一行：单行容易被一条 JPEG 噪点带偏 */
const STRIP = 2

/** 四个侧面的槽位（`+X` / `-X` / `+Z` / `-Z`），顺序见 `SkyboxFaces` */
const SIDES = [0, 1, 4, 5]

/** `+Y` 那一面在 `SkyboxFaces` 里的槽位 */
const UP = 2

/** `-Y` 那一面在 `SkyboxFaces` 里的槽位 */
const DOWN = 3

/**
 * 取不到像素时用的中性灰。
 *
 * **这条理论上走不到**：`ImageLoader` 的 `crossOrigin` 默认是 `'anonymous'`，
 * 图能加载进来就说明服务器发了 `Access-Control-Allow-Origin`，画布不会被污染；
 * 而没发的话图压根加载不出来，那一面会被当成「缺这张」而不是「读不出来」。
 * 留着它是为了那个万一——拿不到颜色时补一块灰的，总比不补好。
 */
const NEUTRAL: readonly [number, number, number] = [107, 112, 117]

/** 原图尺寸也读不出来时的兜底边长（这批资产的两档尺寸之一） */
const DEFAULT_SIZE = 512

interface Rect {
  /** 从哪一张图取（`SkyboxFaces` 的下标） */
  face: number
  x: number
  y: number
  w: number
  h: number
}

/**
 * 补 `slot` 这一面时该从哪些图的哪块地方取色。
 *
 * 缺上下两面走贴边那一条（见文件头），缺侧面走整图平均那一条。两个分支都
 * **可能指向一张同样缺失的图**，由调用方按「这张拿到了没有」过滤掉。
 */
function sampleRects(slot: number): Rect[] {
  if (slot === UP || slot === DOWN) {
    const y = slot === DOWN ? THUMB - STRIP : 0
    return SIDES.map((face) => ({ face, x: 0, y, w: THUMB, h: STRIP }))
  }

  return [0, 1, 2, 3, 4, 5].map((face) => ({ face, x: 0, y: 0, w: THUMB, h: THUMB }))
}

/** 把一张图画进缩略图。画不进去时返回 `null`（取色的那几个分支各有一层退路） */
function thumbnailOf(image: HTMLImageElement): CanvasRenderingContext2D | null {
  try {
    const canvas = document.createElement('canvas')
    canvas.width = THUMB
    canvas.height = THUMB

    const context = canvas.getContext('2d')
    if (!context) return null

    context.drawImage(image, 0, 0, THUMB, THUMB)
    return context
  } catch {
    // 图还没解码完（`drawImage` 会抛 `InvalidStateError`）或者尺寸是 0：
    // 这一张不参与取色，其余几张照常
    return null
  }
}

/** 一块区域的平均色 */
function meanOf(context: CanvasRenderingContext2D, rect: Rect): [number, number, number] {
  const { data } = context.getImageData(rect.x, rect.y, rect.w, rect.h)

  let r = 0
  let g = 0
  let b = 0
  for (let i = 0; i < data.length; i += 4) {
    r += data[i]
    g += data[i + 1]
    b += data[i + 2]
  }

  const count = data.length / 4
  return [r / count, g / count, b / count]
}

/** 补 `slot` 这一面用的颜色。一处取不到就跳过那一处，全取不到才回到中性灰 */
function fillColorOf(
  slot: number,
  thumbs: (CanvasRenderingContext2D | null)[],
): [number, number, number] {
  const parts: [number, number, number][] = []

  for (const rect of sampleRects(slot)) {
    const context = thumbs[rect.face]
    if (!context) continue

    try {
      parts.push(meanOf(context, rect))
    } catch {
      // 画布被跨域图污染时 `getImageData` 会抛 `SecurityError`，见 `NEUTRAL` 那段
    }
  }

  if (!parts.length) return [...NEUTRAL]

  let r = 0
  let g = 0
  let b = 0
  for (const part of parts) {
    r += part[0]
    g += part[1]
    b += part[2]
  }

  return [r / parts.length, g / parts.length, b / parts.length]
}

/** 一块纯色的面。尺寸必须与别的面一致，见 `skyboxPatchFaces` */
function patchFace(color: [number, number, number], size: number): HTMLCanvasElement | null {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size

  const context = canvas.getContext('2d')
  if (!context) return null

  context.fillStyle = `rgb(${color.map(Math.round).join(', ')})`
  context.fillRect(0, 0, size, size)
  return canvas
}

/**
 * 六个面的加载结果 → 六个可以喂给 `CubeTexture` 的面。
 *
 * 全都拿到了就**原样返回**（一个 canvas 都不建，六面齐全的组因此与以前逐像素
 * 一致）；缺哪一面补哪一面；**六面全缺时返回 `null`**，由调用方维持原样——
 * 那种情况下没有任何东西可以拿来取色，能补的只有一块凭空的中性灰，不如不换。
 *
 * 补出来的面取现有图里**最大的那个边长**：立方体贴图六个面不等大是未定义行为，
 * 而这批资产组内部都是等大的（512²，`bak6` / `bak32` 是 1024²），补出来的面
 * 没有理由跟它们不一样。
 */
export function skyboxPatchFaces(
  images: SkyboxFaceImages,
): (HTMLImageElement | HTMLCanvasElement)[] | null {
  if (!images.some((image) => image)) return null

  // 一张都没缺是最常见的一路，连 canvas 都不用建
  if (images.every((image) => image)) return images as HTMLImageElement[]

  const size = images.reduce(
    (max, image) => (image ? Math.max(max, image.naturalWidth || DEFAULT_SIZE) : max),
    0,
  )

  const thumbs = images.map((image) => (image ? thumbnailOf(image) : null))
  const faces: (HTMLImageElement | HTMLCanvasElement)[] = []

  for (let slot = 0; slot < images.length; slot++) {
    const image = images[slot]
    if (image) {
      faces.push(image)
      continue
    }

    // 连一块单色画布都造不出来（2D 上下文拿不到）：整组退回「维持原样」，
    // 比换上一张透明的面好——那在画面上是个洞，看起来更像坏了
    const canvas = patchFace(fillColorOf(slot, thumbs), size || DEFAULT_SIZE)
    if (!canvas) return null
    faces.push(canvas)
  }

  return faces
}
