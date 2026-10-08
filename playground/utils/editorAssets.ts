import type { EditorAssets } from '../../src'
import { DOOR, FLOOR, SKY_BOX, WALL, WINDOW } from './modelList'

/**
 * playground 作为**宿主**交给插件的那份素材表。
 *
 * 这个文件是「库不许内置地址」那条线的另一头：素材根地址、私有域名兜底、
 * 开发期的同源代理前缀——原先都写在编辑器的 `useModelLibrary.ts` 里，现在
 * 全归这儿。库只认 `createThreeDMaker({ assets })` 传进去的那一份，
 * 自己一个字面量地址都不含。
 *
 * ## 这台服务器为什么不发 CORS 头，要靠同源代理绕
 *
 * `GLTFLoader` 走的是 `fetch`，而那台服务器不发 `Access-Control-Allow-Origin`
 * ——响应完整到手了，是浏览器在交给 JS 之前丢掉的。同目录下的缩略图却正常
 * （`<img>` 不受 CORS 约束），所以这个错很容易被当成「地址写错了」，实际文件是好的。
 * 开发期把跨域变成同源，问题就不存在了，见下面的 `DEV_ASSET_PREFIX`。
 */

/**
 * 资产根地址。
 *
 * 优先读 .env。注意那边的键名是 `VITE_ASSE_IMAGE_URL`（ASSE 少一个 R），
 * 这里照它原样读：要改键名得两边一起改，否则会静默退回下面的兜底值。
 * 兜底值目前与 .env 一致，让「忘了配 .env」不至于表现成一列拼不出地址的条目。
 */
const FALLBACK_BASE = 'https://box.hczyun.cn/usr/tool/rhmh/data/rhmh/static/3d-assets/'

const REMOTE_BASE = (import.meta.env.VITE_ASSE_IMAGE_URL || FALLBACK_BASE).replace(/\/?$/, '/')

/**
 * 开发期换上的同源前缀，由 `vite.config.ts` 里同名的 `ASSET_PROXY_PREFIX` 代理出去。
 * **两边必须一起改**：只改一边，地址就代理不到，表现是清一色的加载失败。
 *
 * 代价：DEV 期写进配置的 `model.url` 是这个相对前缀，导出的配置拿到别处就
 * 解析不出来。这跟拖进来的本地文件存成 `blob:` 是同一类事——配置里本来就
 * 允许存在只在当前环境有效的地址。
 */
const DEV_ASSET_PREFIX = '/3d-assets'

const ASSET_BASE = import.meta.env.DEV ? `${DEV_ASSET_PREFIX}/` : REMOTE_BASE

/**
 * 交给 `createThreeDMaker({ assets })` 的那一份。
 *
 * 分类**只写 key 与条目**：有哪几类、顺序、中文名、以及「这一类点一下是干什么的」，
 * 全由编辑器自己定（`useModelLibrary.ts` 的 `LIBRARY_SHAPE`）。这里写 label 也认，
 * 但没必要——两个地方各写一份「地板」，迟早有一处改了一处没改。
 */
export const EDITOR_ASSETS: EditorAssets = {
  baseUrl: ASSET_BASE,
  categories: [
    { key: 'floor', entries: FLOOR },
    { key: 'wall', entries: WALL },
    { key: 'door', entries: DOOR },
    { key: 'window', entries: WINDOW },
    { key: 'skybox', entries: SKY_BOX },
  ],
}
