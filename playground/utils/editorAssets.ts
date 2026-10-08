/**
 * playground 作为**宿主**给编辑器指的那个素材根地址。
 *
 * 清单**不在这里**——它现在是库内置的（`src/editor/defaultAssets.ts`），
 * playground 只是那个默认的一份消费者，不再自己维护一份模型列表。
 * 这一点与改造前正好相反：原先清单和地址都归 playground，库一个字面量都不含，
 * 结果是真实宿主装完库不写一行配置就得到一个空左栏。
 *
 * ## 它为什么只剩下「开发期换个前缀」这一件事
 *
 * 库内置的地址就是生产该用的那个，**不必再指一遍**（指了就是把同一个值抄成两份，
 * 迟早只改一处）。唯一需要覆盖的是开发期：素材服务器不发 CORS 头，而
 * `GLTFLoader` 走 `fetch`——响应其实完整到手了，是浏览器在交给 JS 之前丢掉的。
 * 同目录下的缩略图反而正常（`<img>` 不受 CORS 约束），所以这个错很容易被当成
 * 「地址写错了」，实际文件是好的。开发期把跨域变成同源，问题就不存在了。
 *
 * 生产构建下这里返回 `undefined`，意思是**不覆盖**：`<SceneViewer>` 那个 prop
 * 是「给了才生效」，`undefined` 就一路落到库内置那份。
 */
const DEV_ASSET_PREFIX = '/3d-assets'

/**
 * 开发期换上的同源前缀，由 `vite.config.ts` 里同名的 `ASSET_PROXY_PREFIX` 代理出去。
 * 代理的目标地址在那边读 `.env`（`VITE_ASSE_IMAGE_URL`），本文件不碰它。
 * **两边必须一起改**：只改一边，地址就代理不到，表现是清一色的加载失败。
 *
 * 代价：DEV 期写进配置的 `model.url` 是这个相对前缀，导出的配置拿到别处就
 * 解析不出来。这跟拖进来的本地文件存成 `blob:` 是同一类事——配置里本来就
 * 允许存在只在当前环境有效的地址。
 */
export const ASSET_BASE: string | undefined = import.meta.env.DEV
  ? `${DEV_ASSET_PREFIX}/`
  : undefined
