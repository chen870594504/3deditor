import { onMounted, onUnmounted, ref, watch } from 'vue'
import type { EditorAssetCategory, EditorAssets } from '../assets'
import { assetManifestUrl, parseAssetManifest } from '../../utils/assetManifest'
import { BUILTIN_KEYS } from './useModelLibrary'

/**
 * 把宿主给的那份素材补成**编辑器实际要用的那一份**：清单从服务器上读。
 *
 * ## 什么时候会去读服务器
 *
 * 判据只有一条，`wantsRemote()` 说的就是它：**宿主的 `categories` 是空的、
 * 而且地址不是空串**。
 *
 * | 情形 | 发不发请求 | 左栏条目来自 |
 * |---|---|---|
 * | 宿主整份给了 `categories`（非空） | 不发 | 宿主那份（那条路与从前完全一样） |
 * | `baseUrl` 是空串（`EMPTY_EDITOR_ASSETS`＝「关掉模型库」） | 不发 | 空 → 空态 |
 * | 其余（含库内置那个默认：有地址、无清单） | **一条** | `<baseUrl>index.json` |
 *
 * **「空地址不请求」是一条承重承诺**，不是顺手加的判断：`normalizeBase('')`
 * 得到的是 `'/'`，拼出来就是 `/index.json` 这种以**本站根**为起点的地址
 * ——宿主的站上多半没有这个东西，于是发出去的是一条打向自己的 404。
 * `assets.ts` 里「传空字符串是合法的『关掉模型库』」这句话靠这一条守住。
 *
 * ## 只有一条请求，所以只有一个失败域
 *
 * 清单是**根目录那一份** `index.json`（顶层是对象，键就是那五个分类），
 * 所以一条请求取回全部——这是它相对「每一类一个文件」多出来的好处
 * （手工维护从一个文件改起、请求数从五条降到一条）。
 *
 * **代价是降级粒度变粗了**：那个文件读不到（404 / CORS / 坏 JSON / 顶层不是
 * 对象），五类**一起**变空；上一版是某一类请求失败只空那一类。逐类降级剩下
 * 的这一半仍然在——文件读到了、但某一类的**键**写坏了（值不是数组），
 * 只有那一类空，其余照常（判据在 `parseAssetManifest` 里）。
 *
 * 这条取舍是知情的：手工维护一份清单的收益（加一个模型只改一个文件）对得起
 * 「一个文件坏了五类一起空」这个价钱，而且服务器上还有 `ETag` 兜着缓存这一层
 * （见下）。完整理由见 DESIGN.md 设计决定 53。
 *
 * ## 为什么调用方是 `SceneEditor`，而不是 `SceneViewer`
 *
 * 清单是**编辑器**的事（左栏那一列要它），而 `SceneEditor` 正是编辑态三栏的壳、
 * 是左栏唯一的祖先。放在那里有两个好处：
 *
 *   - 画布态（`editable` 不为真）根本不渲染 `SceneEditor`，预览态的宿主
 *     **一条请求都不白付**；
 *   - 下游（`useLibrarySections` 与 `ModelLibrary.vue` 的兜底）**一行都不用改**
 *     ——它照旧走 `inject`，只是那个键在编辑器内部被重新 provide 了一次。
 *
 * 因此本文件**不碰 provide**：谁去 provide 是调用方的事，这一层只负责取数据。
 * 也**不用模块级单例**存结果：同一页面上两个 `SceneViewer` 各带各的
 * `assetBaseUrl` 时会串数据，理由与 `assets.ts` 那段「用 provide 不用模块级常量」
 * 完全一样。
 *
 * ## 状态与失败：只留一行日志
 *
 * - 失败一律 `warn` 一行（地址 + 原因 + 后果），**没有错误界面**：左栏那五格
 *   显示的就是空态。这是知情的取舍——「还没到」与「真没有」共用同一格文案，
 *   分开要多开一个 provide 键，而那个键只为了这一句话。
 * - **没有「加载中」这一态**，同上：加载中显示的就是空态。
 * - 换地址（宿主换镜像 / 换代理前缀）**重新读**，靠 `token` 丢弃过期结果；
 *   卸载时 `token` 自增，在飞的那一次落地即作废。抄的也是 `SceneSkybox.vue`。
 *
 * ## 缓存：`no-cache`
 *
 * 那台服务器发 `ETag` / `Last-Modified`，所以 `no-cache`（**每次都回来问一句**，
 * 没变就是 304）既不会拿到旧清单，也不用整份重下。
 * **这一条不能省**：改完 json 刷新浏览器就该看到变化，而那是这一整套机制
 * 存在的目的本身——被浏览器缓存吃掉的话，人只会以为「改了没用」。
 * （并成一份之后，改任何一类都会让**整份**重新下载——那也就是几 KB。）
 */
export function useAssetManifest(
  source: EditorAssets,
  options: { remote?: boolean } = {},
): EditorAssets {
  const fetched = ref<EditorAssetCategory[]>([])

  /** 过期守卫：只有最后一次发出的那一次能落地 */
  let token = 0

  function wantsRemote(): boolean {
    /*
      `options.remote === false` 是**模型编辑页**那一档：那一页左栏只放宿主给的
      `extraSections`，服务器清单用不上，一条请求都不该发。

      写成「显式 false 才关」而不是「显式 true 才开」：调用方一共两处，
      而 `SceneEditor` 是唯一传 options 的那个；漏传 = 维持原来的行为。
    */
    if (options.remote === false) return false
    return source.categories.length === 0 && source.baseUrl !== ''
  }

  async function load() {
    const mine = ++token
    const baseUrl = source.baseUrl

    const categories = await loadManifest(baseUrl)

    if (mine !== token) return
    // 没写的那几类根本不进这份表：`useLibrarySections` 那边「找不到这一类」
    // 与「这一类是空的」走的是同一条空态，不必区分。
    fetched.value = categories
  }

  onMounted(() => {
    if (wantsRemote()) void load()
  })

  /*
    只 watch 地址：`categories` 在 setup 之后不会变（插件选项是 `install` 那一刻
    给的一次，`SceneViewer` provide 的那份是常量表），所以地址是唯一能变的输入。
    判据放在回调里而不是外面，是因为它同时也要为「地址从空变成有值」兜住。
  */
  watch(
    () => source.baseUrl,
    () => {
      if (wantsRemote()) void load()
    },
  )

  // 卸载时可能还有一条在飞，落地后不该再往这份表上写
  onUnmounted(() => {
    token++
  })

  /*
    返回**带 getter 的普通对象**，不是 `computed`、也不是 `reactive`——
    与 `SceneViewer.vue` 里那一段是同一个理由：`inject` **不解包 ref**，
    调用方（`useLibrarySections`）直接读 `assets.baseUrl`，拿一个 ref 下去
    那边读到的是 `undefined`，地址静默拼不出来。
  */
  return {
    get baseUrl() {
      return source.baseUrl
    },
    /*
      图标根**原样透传、不参与取数**：它不走这份清单这一条路（图标是 `new Image()`
      探的，见 `useCategoryIcons.ts`）。但这一层必须把它带上——`SceneEditor`
      provide 出去的是**本函数的返回值**，漏了这一项，下游拿到的对象就没有图标根，
      `useCategoryIcons` 里读到的会是 `undefined`，拼出来的地址是 `undefinedfloor.svg`
      ——一列 404，而界面上只是「退回内置图标」，不报错。
    */
    get iconBaseUrl() {
      return source.iconBaseUrl
    },
    get categories() {
      return wantsRemote() ? fetched.value : source.categories
    },
  }
}

/**
 * 打过日志的正文。**挂在模块上**，与 `SceneSkybox.vue` 那条同一条约定：
 * 编辑器每次进编辑态都会重挂一次（切一次 `editable` 就是一次），
 * 实例内的标志位挡不住「同一个坏地址被反复打」，而用户需要看到的是**一遍**。
 */
const WARNED = new Set<string>()

function warn(text: string) {
  if (WARNED.has(text)) return
  WARNED.add(text)
  console.warn(`3deditor: ${text}`)
}

/** 取一份清单并组装成分类表。失败返回空表，**由调用方理解成「五类都是空的」** */
async function loadManifest(baseUrl: string): Promise<EditorAssetCategory[]> {
  const url = assetManifestUrl(baseUrl)

  let response: Response
  try {
    response = await fetch(url, { cache: 'no-cache' })
  } catch (error) {
    /*
      走到这里的典型原因是**跨域**：那台服务器不发 `Access-Control-Allow-Origin`，
      浏览器在把响应交给 JS 之前就丢掉了，`fetch` 抛的是一个不带任何诊断信息的
      `TypeError: Failed to fetch`。所以这句日志要把「多半是代理」说出来——
      用户看到的现象是「左栏空的」，而真正的原因在服务器配置上。
    */
    warn(
      `素材清单读不到（${url}）：${reasonOf(error)}。` +
        '多半是没走同源代理——那台服务器不发 CORS 头，清单与 .glb 一样会被浏览器拦下。',
    )
    return []
  }

  if (!response.ok) {
    warn(`素材清单读不到（${url}）：HTTP ${response.status}。五个分类都会是空的。`)
    return []
  }

  let value: unknown
  try {
    value = await response.json()
  } catch {
    warn(`素材清单不是合法的 JSON（${url}）。五个分类都会是空的。`)
    return []
  }

  const parsed = parseAssetManifest(value, BUILTIN_KEYS)

  if (!parsed.ok) {
    warn(
      `素材清单的顶层不是一个对象（${url}）：` +
        '整份 index.json 里直接是「分类 key → 条目数组」，' +
        '形如 `{ "floor": [ { "file": "carpet" } ] }`。五个分类都会是空的。',
    )
    return []
  }

  /*
    没被采纳的键**要说出来**，两种情况都在这里：
      - 不认识的（`floors` 这种笔误、或者想凭空加一类）；
      - 认识的但写坏了（值不是数组），那一类会整片空掉。
    后一种尤其要紧——它既不抛错也没有别的痕迹，不说就是「某一天有人发现
    少了一整栏」。而**有意留空的那一类不会吵**：它压根不在顶层，
    也就进不了这个列表。
  */
  if (parsed.ignored.length) {
    warn(
      `素材清单里有 ${parsed.ignored.length} 个键没被采纳（${parsed.ignored.join('、')}，${url}）：` +
        `只看这五个 key（${BUILTIN_KEYS.join('、')}），且每一个的值都必须是一个数组。`,
    )
  }

  // 丢掉的条数同理**要说出来**：静默丢弃正是「某一天有人发现少了一格」的那种 bug
  if (parsed.dropped) {
    warn(
      `素材清单里有 ${parsed.dropped} 条读不懂，已跳过（${url}）：` +
        '每一条至少要有一个字符串 `file`。',
    )
  }

  /*
    按**界面顺序**组装，而不是照文件里的键顺序——分类的先后由编辑器定
    （`LIBRARY_SHAPE`），文件里谁写在前面不承重。
    分类的中文名也不从这里来，清单只管条目（`label` 是条目自己的显示名）。
  */
  return BUILTIN_KEYS.filter((key) => key in parsed.lists).map((key) => ({
    key,
    entries: parsed.lists[key],
  }))
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
