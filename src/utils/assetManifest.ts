import type { EditorAssetEntry } from '../editor/assets'

/**
 * 素材清单（manifest）的地址拼法与格式校验。
 *
 * ## 约定：服务器的**根目录**下有一份 index.json
 *
 * 清单**不再内置在库里**，它住在素材服务器上，**整个素材根目录只有一份**：
 *
 *     <素材根>/index.json
 *
 * 顶层是一个**对象**，键就是分类的 key（同时是服务器上的目录名），值是该类的
 * 条目数组——与「每一类一个文件」那种形态相比，条目那一段逐字同形，只是外面
 * 多了一层键。服务器上一份真实的 index.json 长这样（节选）：
 *
 *     {
 *       "floor":  [ { "label": "普通地板", "file": "carpet", "span": 2.4 } ],
 *       "wall":   [ { "label": "墙壁1", "file": "wall1" } ],
 *       "door":   [ { "label": "双开玻璃门", "file": "doubleGlassDoor",
 *                     "width": 1.8, "height": 2.1 } ],
 *       "skybox": [ { "label": "空盒子", "file": "" } ]
 *     }
 *
 * 条目字段与库这边公开导出的 `EditorAssetEntry` 逐字同形
 * （`label` / `file` / 可选 `span` / `width` / `height` / `thumb`）。
 *
 * 于是**往服务器上放一个新模型不再需要重新打包库**——这是这整套机制存在的
 * 唯一理由，见 DESIGN.md 设计决定 52 与 53。
 *
 * ## 有哪几类**不由这份文件定**
 *
 * 文件只管「这一类里有什么」，**不管有哪几类**：分类的 key、中文名、顺序、
 * 以及「这一类点一下是干什么的」由编辑器定（`useModelLibrary.ts` 的
 * `LIBRARY_SHAPE`），那是承重的，四个绘制工具与导轨图标钉在上面。所以：
 *
 *   - 顶层**多出来的键**（`floors` 这种笔误、或者想凭空加一类）只是被忽略，
 *     接着由调用方打一行 warn 说出来——静默忽略会让「我明明写了」变成一个
 *     查不出来的问题；
 *   - 顶层**少一个键**是**合法的**（这一类我不要），静默走空态。
 *
 * 这条划分的落点就是 `parseAssetManifest` 的第二个参数：**「哪几类算数」由
 * 调用方传进来**，这个文件自己不 import `useModelLibrary.ts`（那会把 Vue 拖进
 * 一个本该与框架无关的模块，也会让「哪五类」有两个来源）。
 *
 * ## 为什么是一份 index.json，而不是去抓目录
 *
 * 「让前端列举服务器目录」这件事在库里是被明确否掉的（nginx 开 autoindex
 * 也能抓，但那会把整棵目录结构暴露给任何打开编辑器的人）。这次**没有**推翻
 * 它：读一份服务器自己放的、只有模型条目的清单文件，与列举目录是两件事——
 * 谁能看到什么，由那份文件决定，而不是由目录结构决定。
 *
 * ## 只认这一种形态
 *
 * **不接受**「每一类一个 index.json」那种裸数组，也不接受 `{ entries: [...] }`
 * 之类的包装。两种形态并存会让「这份文件到底该怎么写」有两个答案，而写错的
 * 代价是一整类甚至整份空白——那正是本文件要防的那类沉默故障。
 *
 * 于是这个模块只做两件不需要 three、不需要 DOM 的事（所以它进了 `src/utils/`，
 * 冒烟才够得着）：拼地址、认格式。**发请求那一层在
 * `editor/composables/useAssetManifest.ts`**——它要挂生命周期、要与实例绑定。
 */

/**
 * 素材根地址的归一化：末尾补一个斜杠，拼的时候不用每处都判。
 *
 * 宿主写不写末尾那个斜杠都可以（`https://x/y` 与 `https://x/y/` 等价），
 * 少判一次就少一处「有的地方写了、有的地方没写」的不一致。
 *
 * **它是素材地址这边**唯一**的归一化实现**，清单与图标两条路共用
 * （`assetManifestUrl` 与 `assetIcon.ts` 的 `assetIconUrl`），别在别处再写一遍。
 *
 * **空串有个反直觉的出口，调用方必须自己拦**：这个函数会把 `''` 变成 `'/'`
 * （正则 `\/?$` 匹配到末尾的空、再补一个斜杠）。直接拿它去拼地址，得到的是
 * `/index.json` 这种**以本站根为起点的绝对路径**——本来「空地址 = 关掉
 * 素材」的意图会变成「拿宿主自己的站根当素材根去请求」，而且不报错。
 * 所以判空一律在调用方、判的是**原来的那个 `baseUrl`**，不是这个函数的返回值。
 * （`useModelLibrary.ts` 那边同样按这个口径用它：空 `file` 在拼之前就分流了。）
 */
export function normalizeBase(baseUrl: string): string {
  return baseUrl.replace(/\/?$/, '/')
}

/**
 * 拼清单的地址：`<素材根>index.json`。
 *
 * 与 `normalizeBase` 一样：**调用方要先判过 `baseUrl` 非空**。
 *
 * 它曾经带第二个参数（分类 key，拼 `<素材根><分类>/index.json`）——清单并成
 * 根目录一份之后那个参数没有意义了。**当时那个签名从未发布过**（这两个函数
 * 与被它们撑起来的那套机制是同一次改动里加的），所以删掉它不算破坏性变更，
 * 见 DESIGN.md 设计决定 53。
 */
export function assetManifestUrl(baseUrl: string): string {
  return `${normalizeBase(baseUrl)}index.json`
}

/** `parseAssetManifest` 的结果。四个字段都是给调用方拿去做判断与打日志用的 */
export interface AssetManifestParse {
  /** 顶层是不是一个对象。`false` 表示这份文件根本没法用（不是清单的形态） */
  ok: boolean
  /**
   * 认得出来的类：**只含「key 在题内、且值是一个数组」的那些**。
   *
   * 顺序照文件里的顺序，但**不承重**——调用方按自己那份分类表（界面顺序）
   * 组装，谁在前谁在后由编辑器定，不由文件定。
   *
   * 值可能是个**空数组**（这一类里一件都没有），与「这个名字根本不在这份
   * 文件里」是两件事：前者照常进表（导轨上是空态），后者压根不进，
   * 于是调用方也分不出「文件里没写」与「写了但我不认」——那正是 `ignored`
   * 存在的理由。
   */
  lists: Record<string, EditorAssetEntry[]>
  /** 认不出来、被丢掉的行数（**所有类加总**）。只在 `ok` 为真时有意义 */
  dropped: number
  /**
   * 顶层里**没被采纳**的键：不认识的（`floors` 这种笔误、或者想凭空加一类）
   * 与**值不是数组**的（写成 `42` / `{}`）。
   *
   * 后一种才是这个字段真正的价值：一个写坏的类型会让那一类的格子整片消失，
   * 而它既不抛错也没有任何别的痕迹。调用方据此打一行 warn。
   */
  ignored: string[]
}

/**
 * 数字字段的取值：只认**有限数**，不吃真假。
 *
 * `span` / `width` / `height` 三个都照这条来。按真假判会把 `0` 吃掉，
 * 而 `0` 是一个合法的取值（`EditorAssetEntry.width` 那边写着这句话）——
 * 「不写」与「写了 0」是两件事，前者落到下游的默认档，后者是「洞口宽 0 米」。
 *
 * `NaN` / `Infinity` / 字符串数字 / `null` 一律当**没写**：它们是 json 手工编辑
 * 的典型笔误（少个引号、多个逗号），当没写比当 0 安全——那一格会退回默认档，
 * 而不是把一扇门压成一条线。
 */
function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/**
 * 把一行 json 认成一条条目，认不出来返回 `null`。
 *
 * 判据只有一条硬的：**`file` 必须是字符串**。它是承重的那一格（地址全靠它拼），
 * 缺了或者不是字符串，这一行就没有意义了。其余各字段都是「有就用、没有就退」：
 *
 *   - `label` —— 缺了或空串就退回 `file`。显示名少一个不该让整条资产消失，
 *     而 `file` 恰好是唯一必然存在的字符串，退到它总比退到空白强。
 *   - `thumb` —— 只认非空字符串。它不是地址上的东西，写坏了只是宫格少一张图
 *     （`ModelLibrary.vue` 本来就有 404 兜底那条路）。
 *   - `span` / `width` / `height` —— 见 `finite`。
 *
 * **`file: ''` 是合法的一条，不能当坏行丢掉**：天空盒那一类的第一条就是它
 * （「空盒子」= 把背景关掉），含义写在 `EditorAssetEntry.file` 上。
 * 所以这一行不判 `file` 的真假，只判它是不是字符串。
 *
 * 返回的是**新对象**，不是原来那一行：json 里多写的键（将来可能加的、或者纯粹
 * 写错的）不会顺着这条链一路漏进场景配置里——配置是要落盘、要发给宿主的东西。
 */
function toEntry(row: unknown): EditorAssetEntry | null {
  if (typeof row !== 'object' || row === null) return null

  const raw = row as Record<string, unknown>
  if (typeof raw.file !== 'string') return null

  const entry: EditorAssetEntry = {
    label: typeof raw.label === 'string' && raw.label !== '' ? raw.label : raw.file,
    file: raw.file,
  }

  if (typeof raw.thumb === 'string' && raw.thumb !== '') entry.thumb = raw.thumb

  const span = finite(raw.span)
  if (span !== undefined) entry.span = span

  const width = finite(raw.width)
  if (width !== undefined) entry.width = width

  const height = finite(raw.height)
  if (height !== undefined) entry.height = height

  return entry
}

/**
 * 认一份 index.json。**纯函数**：喂 `JSON.parse` 的结果与「哪几类算数」，
 * 返回认得出来的那些条目。
 *
 * 上游是**别人手写的文件**，所以这里一个字段都不假设：
 *
 *   - 顶层不是对象（是数组、是字符串、是 `null`）就整体作废（`ok: false`）
 *     ——**数组那一条是刻意的**：上一版那种「每一类一个文件」的形态正是裸数组，
 *     收下它就会让两种形态同时活下来；
 *   - 某一类的值不是数组，那一类整个跳过、键进 `ignored`（其余照常），
 *     逐类降级在文件**内部**仍然成立；
 *   - 数组里某一行写坏（不是对象、或者 `file` 不是字符串），只丢那一行并计数
 *     ——**一行写坏不该让整类资产消失**，这是「手工编辑的文件」与「编译期常量」
 *     最大的区别，也正是这个函数存在的理由。
 *
 * 丢掉的条数与没被采纳的键都回给调用方去打日志：静默丢弃是这类改动里最容易
 * 埋下的那种「只有某一天有人发现少了一格」的 bug。
 */
export function parseAssetManifest(
  value: unknown,
  knownKeys: readonly string[],
): AssetManifestParse {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, lists: {}, dropped: 0, ignored: [] }
  }

  const raw = value as Record<string, unknown>
  const known = new Set(knownKeys)
  const lists: Record<string, EditorAssetEntry[]> = {}
  const ignored: string[] = []
  let dropped = 0

  for (const key of Object.keys(raw)) {
    // 不认识的键与写坏的键都算「没被采纳」，但**都不解析**——一个我们不认的
    // 名字底下的坏行不该记到 dropped 上，那会让人去找一个跟他无关的错误。
    if (!known.has(key)) {
      ignored.push(key)
      continue
    }

    const list = raw[key]
    if (!Array.isArray(list)) {
      ignored.push(key)
      continue
    }

    const entries: EditorAssetEntry[] = []

    for (const row of list) {
      const entry = toEntry(row)
      if (entry) entries.push(entry)
      else dropped += 1
    }

    lists[key] = entries
  }

  return { ok: true, lists, dropped, ignored }
}
