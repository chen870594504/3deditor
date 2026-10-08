import { ref } from 'vue'

/**
 * 图标导轨的悬停提示。
 *
 * 不用原生 title：它的延迟约一秒、样式不受控，在一条只有几项的导轨上反复扫过
 * 会显得很迟钝。这里自己画一个，指针进入即出现。
 *
 * 坐标取「图标相对宿主的偏移」，而不是 clientY：前者由两次 getBoundingClientRect
 * 相减得到，祖先上的任何 transform（比如 tab 切换时的入场动画）都会同时作用在
 * 两者上而被抵消，写进 style 的 top 因此永远正确。
 *
 * 左右两栏共用这一份——坐标推导本来就与导轨在哪一侧无关，
 * 两份实现迟早会对不上。
 *
 * 宿主用 getter 而不是 Ref 传入：调用方用的是 useTemplateRef，
 * 它的返回类型带 readonly，直接当 Ref 参数传会被类型挡下。
 */
export function useRailTip(getHost: () => HTMLElement | null) {
  const tip = ref<{ label: string; top: number } | null>(null)

  function showTip(label: string, event: Event) {
    const host = getHost()
    if (!host) return

    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
    tip.value = {
      label,
      top: rect.top - host.getBoundingClientRect().top + rect.height / 2,
    }
  }

  function hideTip() {
    tip.value = null
  }

  return { tip, showTip, hideTip }
}
