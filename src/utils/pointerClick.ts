/**
 * 「这次指针交互算不算一次单击」的**唯一**判据。
 *
 * 两处共用：`SceneModelNode` 拿它把「点击」从「拖动旋转视角」里分出来，
 * `ScenePicker` 拿它挡住同样的误触。必须同源——两套阈值一旦漂移，
 * 用户拖着转视角时就会顺手选中一个模型，是那种不报错、但一眼就看出来的 bug。
 */

/**
 * 判据只用到这四个字段，所以参数取最小结构形状，而不是 DOM 的 `PointerEvent`。
 *
 * `TresPointerEvent`（pmndrs 的 PointerEvent）只是个长得像 PointerEvent 的类，
 * 并不是 DOM 的那个：它继承自 `HtmlEvent`、把 `clientX` 之类的属性用映射类型
 * 摊平上来，**不能**赋给 `globalThis.PointerEvent`。两边都要能用，就只声明
 * 真正读到的字段——与 SceneContent 里 `isMeasurer` 同一种结构化写法。
 */
export interface PointerSample {
  clientX: number
  clientY: number
  /**
   * 这一根手指 / 这个指针的 id。
   *
   * pmndrs 用自己的 pointerMap 按**原生** `event.pointerId` 复用内部指针对象，
   * 所以同一个 DOM 指针在按下与抬起之间拿到的是同一个值，两根手指则必然不同。
   */
  pointerId: number
  timeStamp: number
}

/**
 * 按下时刻的记录。
 *
 * 只记一份、不按 pointerId 分开存：一次单击只可能由一根手指构成，
 * 出现第二根手指就整次作废，没有「两根同时各自算一次」这种语义。
 */
export interface PressRecord {
  pointerId: number
  x: number
  y: number
  time: number
  /** 这次按压期间出现过第二根手指（双指缩放 / 平移）：一定不是单击 */
  multi: boolean
}

/** 超过这个位移（像素）就认为用户在转视角，而不是在点模型 */
export const CLICK_MAX_DRIFT = 4
/** 超过这个按压时长同理——长时间按住多半是在慢慢转 */
export const CLICK_MAX_DURATION_MS = 500

/**
 * 记下一次按压。返回新记录而不是改旧的，调用方各自持有一份自己的 `press`。
 *
 * 已经有一条记录、又来了另一个指针 id，说明第二根手指按下了：把整次交互标成
 * `multi` 而不是覆盖掉。覆盖的话，两指平移（每根手指位移都很小、间隔又短）
 * 会在先抬起的那一根上算成一次单击——在画布上就是「缩放时顺手选中了一个模型」。
 */
export function trackPress(press: PressRecord | null, event: PointerSample): PressRecord {
  if (press && press.pointerId !== event.pointerId) return { ...press, multi: true }

  return {
    pointerId: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    time: event.timeStamp,
    multi: false,
  }
}

/**
 * 这次抬起够不够得上一次单击。
 *
 * 没有记录就一律判否，这是正确的保守判断而不是妥协：一次真正的点击必然以
 * 「按在这个目标上」开始，所以缺记录只可能意味着手势是从别处划过来、
 * 在这里松手的——那本来就是拖拽。
 *
 * 不额外处理 `pointercancel`：上面的 `trackPress` 每次按下都无条件重写记录，
 * 一次单击又必须先有紧邻的按下，所以浏览器接管手势留下的陈旧记录既不可能
 * 被复用、也会被时长判据挡住。多挂一个监听器换不来任何东西。
 */
export function isClickGesture(press: PressRecord | null, event: PointerSample): boolean {
  if (!press || press.multi) return false
  if (press.pointerId !== event.pointerId) return false

  const drift = Math.hypot(event.clientX - press.x, event.clientY - press.y)
  if (drift > CLICK_MAX_DRIFT) return false
  return event.timeStamp - press.time <= CLICK_MAX_DURATION_MS
}
