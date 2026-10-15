import { onMounted, onUnmounted, ref, watch } from 'vue'
import { useEditorAssets } from '../assets'
import { assetIconUrl } from '../../utils/assetIcon'
import { BUILTIN_KEYS } from './useModelLibrary'

/**
 * 导轨那五个分类图标：**服务器上有就用服务器上的，没有就用内置的**。
 *
 * 地址读的是 `useEditorAssets().iconBaseUrl`（缺省落回库内那个默认），
 * 所以宿主能把它换到自己那条同源代理前缀上——**这一步是必须的，不是可选的**，
 * 理由见下一节。
 *
 * ## 为什么必须同源：遮罩走 CORS（实测）
 *
 * 图标是当 **CSS 遮罩**用的（`mask-image` + `background-color: currentColor`，
 * 理由见 `utils/assetIcon.ts`），而**遮罩的请求走 CORS**：遮罩的 alpha 通道参与
 * 合成，浏览器把它按「读像素」那一类对待。这与 `<img>` / `background-image` 的
 * no-cors 不是同一条规矩——**同一个目录下的缩略图 `<img>` 一切正常、图标却被拦下**，
 * 控制台里那句是
 * `has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header`。
 *
 * 这条是实测出来的，最早就栽在这里：原以为「CSS 里的图片不吃 CORS」，
 * 于是把图标根写成了库内常量、不给宿主换的口子；接上真服务器那天才发现，
 * **那条豁免只对 `background-image` 成立**。现在它是可配的（`iconBaseUrl`），
 * 宿主与 playground 各自把它指到同源前缀上。见设计决定 54。
 *
 * ## 为什么不能「直接渲染，加载失败再说」
 *
 * 遮罩**失败是无声的**：`mask-image` 指向一个 404、或者被 CORS 拦下，那一格
 * 只是空白——没有 `error` 事件、我们这边也没有任何回调（CORS 那句是浏览器打的）。
 * 而今天那台服务器上 `svg/3dmaker/` 目录**还是空的**，所以「无声空白」
 * 就是默认情形，不是边缘情形。
 *
 * 于是这里先用 `new Image()` 探一次，探到了才渲染遮罩那条路，探不到就
 * **退回内置那五个描边图标**（`SidePanel.vue` 的 `SECTION_ICONS`）——
 * 导轨永远不会是空白。
 *
 * **探测必须能预言遮罩的成败**，所以那张图是**带 `crossOrigin` 拉的**
 * （理由写在下面 `probe` 上）：不带它的话，探测会对跨域图照常成功、
 * 遮罩却在渲染时被拦，导轨上多出一格空白——**探测等于白做**。
 *
 * `new Image()` 不用挂进 DOM，这也正是它比「先渲染一个 `<img>`、onerror 再换」
 * 干净的地方：探测阶段一个节点都不产生。
 *
 * ## 探不到时**不打 warn**，这是刻意的
 *
 * 「服务器上没有图标」在今天是**默认状态**，不是错误状态：图标是装饰，退回内置
 * 的那套与它视觉上本来就是一回事。为它打一条 warn 等于**每次进编辑器都报一条
 * 假警**——而那会把真正的告警（清单读不到那几条）淹掉。
 *
 * 代价是**「代理没配好」也走这一路**：界面上是内置图标（看不出区别），
 * 只有控制台里那条 CORS 消息说得清。这一档归目视清单 160。
 *
 * ## 与清单那一层的关系：**互不牵连**
 *
 * 两边各读各的地址（素材根 vs 图标根，是服务器上**同级**的两个目录，
 * 由素材根拼不出图标地址），也各失败各的：清单读不到 → 左栏那五格是空的，
 * 但导轨上那五个图标照旧（内置的）。地址都是空串这种情形会是**两条都不发**。
 *
 * ## 只探内置那五个 key
 *
 * 宿主通过 `extraSections` 追加的分类**不探**——它们的图标是宿主自己用
 * `IconPath[]` 给的（那条路是 `IconPath`，不是 SVG 文件），也不在那台服务器的
 * 命名约定里。返回的那个函数对任何不在 `BUILTIN_KEYS` 里的 key 直接返回 `null`。
 */
export function useCategoryIcons(): (categoryKey: string) => string | null {
  const assets = useEditorAssets()

  /** 探到的 key。用数组而不是 Set：最多五个，`includes` 比多包一层省事 */
  const found = ref<string[]>([])

  /** 过期守卫，抄的是 `useAssetManifest.ts` 与 `SceneSkybox.vue` 那一条 */
  let token = 0

  /**
   * 探一轮。
   *
   * **开头先把上一轮的结果清掉**：地址被换过时（宿主切了台服务器、或者切到
   * 同源代理前缀），旧地址探到的 key 若不扔掉，返回的那个函数就会拿**新地址**
   * 去拼那些 key——拼出来的是一张从没验证过的图，而它到底是 404 还是能用，
   * 没有人知道。清掉之后最多短暂地退回内置图标，不会指向没探过的地址。
   */
  function probeAll() {
    const base = assets.iconBaseUrl
    const mine = ++token

    found.value = []

    // 空串是「不探服务器图标」：与「那个目录是空的」表现一致，**一条请求都不发**
    // （拼出来会是打向本站根的 `/floor.svg`，那个坑写在 `utils/assetIcon.ts` 上）
    if (base === '') return

    for (const key of BUILTIN_KEYS) {
      probe(assetIconUrl(base, key)).then((ok) => {
        // 卸载过（或换过地址）就不再往这份表上写
        if (!ok || mine !== token) return
        found.value = [...found.value, key]
      })
    }
  }

  onMounted(probeAll)

  // 换地址就地重探，与 `useAssetManifest` 那条 watch 同一个理由：
  // 少了它，宿主在运行中换一档地址时图标还是旧那一套（而模型已经换了）。
  watch(() => assets.iconBaseUrl, probeAll)

  onUnmounted(() => {
    token++
  })

  /*
    返回的是**一个函数**，不是 ref：调用方（`SidePanel.vue`）在模板里按 key 取地址，
    而它是在渲染期调用的——函数体里读了 `found` 这个 ref 与 `assets` 那个 getter，
    于是那一次读取就把渲染副作用登记成了依赖，探测结果落地时会自动重渲染。
    多包一层 `computed` 或返回一个 ref 的 Map 都只是把同一件事写复杂。
  */
  return (categoryKey: string): string | null => {
    if (!BUILTIN_KEYS.includes(categoryKey as (typeof BUILTIN_KEYS)[number])) return null
    if (!found.value.includes(categoryKey)) return null
    return assetIconUrl(assets.iconBaseUrl, categoryKey)
  }
}

/**
 * 探一张图能不能加载出来。
 *
 * **永远 resolve，不 reject**：这张图加载不出来是本函数预期内的结果
 * （今天服务器上那个目录就是空的），走 reject 只会让调用方多一层 catch。
 *
 * **`crossOrigin` 那一句是必须的，它让探测成为遮罩的准确预言**：
 * 默认（no-cors）的 `<img>` 请求根本不会去要 CORS 头，跨域的 SVG 照样触发
 * `onload`——于是探测通过、渲染时遮罩却被拦下，导轨上多出一格空白，
 * 而那正是「探测」本要防的事。带上它之后两者的成败条件一致了：
 * 服务器不发 CORS 头就是 `onerror` → 退回内置图标、导轨保持完好，
 * 代价只剩控制台里那条 CORS 消息。
 *
 * 空目录（404）本来就会 `onerror`，用不着它——但**那两档的表现必须一样**
 * （都退回内置图标），否则「服务器上没放图标」与「代理没配好」在界面上
 * 会分不开，而它们该做的事完全不同（一个是等着，一个是去配代理）。
 */
function probe(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => resolve(true)
    image.onerror = () => resolve(false)
    image.src = url
  })
}
