import { CanvasTexture, LinearFilter, SRGBColorSpace } from 'three'

/**
 * 把一行字画成贴图，给房间名标签用（挂 `Sprite`）。
 *
 * 参考项目用的是它自己 `threeUtils.createTextSprite`，这边另写一份而不是搬
 * ——那份是给它的渲染器用的内部工具，形状（返回一个已经配好尺寸的 sprite 对象）
 * 也不适合声明式的这一侧：这边只要一张贴图，怎么摆是模板的事。
 *
 * **没有引入任何依赖**：canvas 2D + `CanvasTexture` 就够，而这正是「一个房间名」
 * 这种量级该有的代价。
 */

export interface LabelTextureOptions {
  /** 文字颜色 */
  color?: string
  /** 描边色。房间底色是用户可改的，靠描边保证任何底色上都读得清 */
  haloColor?: string
  /** 字号（canvas 像素） */
  fontSize?: number
  /** 四周留白（canvas 像素） */
  padding?: number
}

const DEFAULTS: Required<LabelTextureOptions> = {
  color: '#f8fafc',
  haloColor: '#0f172a',
  fontSize: 64,
  padding: 18,
}

/**
 * 贴图缓存。
 *
 * **必须有**：这个函数是在组件的 `computed` 里调的，而房间名一改就会重算一次。
 * 不缓存的话每次改名都新建一张 `CanvasTexture` 与一块 canvas，
 * 旧的既不会被回收（three 的贴图要显式 `dispose()`）也没有引用能再拿到它。
 *
 * 容量取 32 是「够用且封顶」：一栋房子里房间是个位数量级，超出说明在反复改名，
 * 那时按**插入顺序**淘汰最旧的一张并显式 `dispose()`。
 * 用 `Map`（保持插入顺序）而不是普通对象，就是为了白拿这个顺序。
 */
const CACHE_LIMIT = 32
const cache = new Map<string, CanvasTexture>()

/**
 * 造一张（或取一张缓存的）文字贴图。
 *
 * **没有 DOM 时返回 `null`**，不是抛错：这个模块会被 `renderToString` 跑一遍
 * （冒烟测试就是这么渲染的），那时候没有 `document`。调用方拿到 null 就跳过
 * 那个标签——少一个房间名，而不是整棵场景渲染不出来。
 */
export function createLabelTexture(
  text: string,
  options: LabelTextureOptions = {},
): CanvasTexture | null {
  if (typeof document === 'undefined') return null

  const { color, haloColor, fontSize, padding } = { ...DEFAULTS, ...options }
  const key = `${text}|${color}|${haloColor}|${fontSize}|${padding}`

  const cached = cache.get(key)
  if (cached) return cached

  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) return null

  /** 字体串要**先设好**才能量宽度；两处必须逐字一致，否则量出来的与画出来的不是一个字宽 */
  const font = `600 ${fontSize}px system-ui, -apple-system, "Segoe UI", sans-serif`
  context.font = font

  const width = Math.ceil(context.measureText(text).width) + padding * 2
  /*
   * 行高取字号的 1.6 倍：既要放得下描边（`lineWidth` 是以文字轮廓为中心向两侧
   * 各画一半），也要给汉字的上下留一点余地。
   */
  const height = Math.ceil(fontSize * 1.6) + padding
  canvas.width = width
  canvas.height = height

  /*
   * **改 canvas 尺寸会把 2D 上下文的状态全部重置**（含 font 与对齐方式），
   * 所以字体要在这里再设一遍——上面那次是为了量宽，这次是为了画。
   */
  context.font = font
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.lineJoin = 'round'

  // 先描边再填字：反过来的话描边会盖掉半个笔画
  context.lineWidth = Math.max(4, fontSize * 0.16)
  context.strokeStyle = haloColor
  context.strokeText(text, width / 2, height / 2)
  context.fillStyle = color
  context.fillText(text, width / 2, height / 2)

  const texture = new CanvasTexture(canvas)
  /*
   * 这张贴图存的是**颜色**而不是数据（法线、粗糙度那一类），
   * 所以标成 sRGB，否则会被当成线性值再转一次，字会发灰。
   */
  texture.colorSpace = SRGBColorSpace
  // 标签在屏幕上通常比贴图小，线性过滤比默认的 mipmap 更省也更清楚
  texture.minFilter = LinearFilter

  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) {
      cache.get(oldest)?.dispose()
      cache.delete(oldest)
    }
  }
  cache.set(key, texture)

  return texture
}

/**
 * 贴图的宽高比（宽 / 高）。
 *
 * 缩放 sprite 时要用它：只给一个高度、宽度按比例算，字才不会被拉扁。
 * 拿不到贴图时回退成 1，调用方那边本来就会跳过整个标签。
 */
export function labelTextureAspect(texture: CanvasTexture | null): number {
  if (!texture) return 1
  const image = texture.image as { width?: number; height?: number } | undefined
  if (!image?.width || !image?.height) return 1
  return image.width / image.height
}
