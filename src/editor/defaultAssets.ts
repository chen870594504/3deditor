import type { EditorAssets } from './assets'

/**
 * 库内置的那些默认：**两个地址，没有清单**。
 *
 * ## 本文件现在有两个地址，别混
 *
 *     …/static/3d-assets/     ← DEFAULT_ASSET_BASE_URL：模型与那份清单
 *     …/static/svg/3dmaker/   ← DEFAULT_ICON_BASE_URL：左栏导轨那五个分类图标
 *
 * 两者是服务器上**同级**的两个目录，所以**由其中一个拼不出另一个**——这也是它们
 * 只能各是一个常量的原因。**两个都能被宿主换掉，但走的是两个不同的口子**：
 * 素材根给 `SceneViewer` 的 `assetBaseUrl`、图标根给它的 `iconBaseUrl`
 * （也可以整份换：插件选项 `assets` 上各有一项）。
 *
 * **两个地址都拼出「要跨域拿的东西」，所以两个都需要同源**（或者那台服务器发
 * `Access-Control-Allow-Origin`）。这一点在图标那一侧曾经被我判错过：图标当
 * `mask-image` 用，而**遮罩是要走 CORS 的**（遮罩的 alpha 参与合成，浏览器按
 * 「读像素」对待它），与 `<img>` / `background-image` 的 no-cors 不是同一条规矩。
 * 实测报错是 `has been blocked by CORS policy`，见设计决定 54。
 *
 * ## 清单不在这里了
 *
 * 列表原先写死在本文件里（五类、每一类几行）。它现在住在素材服务器上，
 * **整个素材根只有一份**：
 *
 *     https://<那台服务器>/…/3d-assets/index.json
 *
 * 顶层是对象，键就是那五个分类、值是该类的条目数组。字段与库公开导出的
 * `EditorAssetEntry` 逐字同形，所以**往服务器上放一个新模型只是改那一个 json
 * 文件**——不用回来改库、不用重打包、不用等宿主升级。
 * 拼地址与认格式那两个纯函数在 `src/utils/assetManifest.ts`，发请求那一层在
 * `editor/composables/useAssetManifest.ts`，完整理由见 DESIGN.md 设计决定 52 与 53
 * （**53 把 52 的「每类一份」改成了「根目录一份」**，读 52 时要连着读）。
 *
 * ## 「不抓目录」那条决定**没有被推翻**，别读错
 *
 * 早先否掉的是「让前端去抓服务器的目录索引页（nginx 开 autoindex 那种）」，
 * 三条理由今天依然成立：抓目录页等于把整棵目录结构暴露给任何打开编辑器的人；
 * 目录页的响应也不带 `Access-Control-Allow-Origin`（实测）。
 * 这次加的是**读一份服务器自己放的清单文件**——谁能看到什么由那份文件决定，
 * 而不是由目录结构决定。两件事的区别要留住，否则下一个人会以为那条决定松了。
 *
 * 只有第三条理由（「写死的列表在离线、代理没配好时也还能用」）**确实没了**：
 * 现在读不到就是空栏。这是换来的那件事的价钱，如实记在决定 52 上。
 *
 * ## 为什么地址（而不是清单）留在这里
 *
 * 删掉这个地址，宿主不写一行配置时就彻底没有模型了——而「装完库写一句
 * `<SceneViewer editable />` 左栏就有货」正是设计决定 50 立起来的那件事，
 * 清单换了住处，它仍然要成立（现在多一个前提：那台服务器上真放着 index.json，
 * 且宿主把请求代理成同源，见下）。
 *
 * 三级优先级一个字没变：
 *
 * | 谁 | 换什么 |
 * |---|---|
 * | `SceneViewer` 的 `assetBaseUrl` prop | **只换根地址**（换镜像 / 开发期同源代理前缀） |
 * | `createThreeDMaker({ assets })` | **整份**（地址 + 清单，给了清单就不再读服务器） |
 * | 本文件 `DEFAULT_EDITOR_ASSETS` | 什么都不写时的默认（就是这个地址） |
 *
 * ## 代价（写在这里，因为它是这条规矩唯一真正付出的东西）
 *
 * `DEFAULT_ASSET_BASE_URL` 是个**私有域名**，而 `vite build` 会把它原样打进
 * `dist/index.js`，`sourcemap` 也跟着 `dist` 一起发出去（`files` 只收 `dist`，
 * `.map` 在里面）。所以从这一版起，任何一家宿主的产物里都能搜到这个域名——
 * **这是知情的取舍，不是漏了**。别当成 bug 删掉那个常量：删了它，
 * 「一行不写就有模型」这个承诺跟着一起没。
 *
 * 文件里的地址**写字面量、不读 `import.meta.env`**：库构建会把
 * `import.meta.env.VITE_*` 内联进产物，读它等于把本仓库的 `.env` 发给每一家宿主。
 * 开发期的同源代理前缀是**宿主那一侧**的事（playground 自己拼），不进这里。
 *
 * **这条不是风格问题，它有第二个代价，而且那个会当场炸**：本文件同时被
 * `vite.config.ts` import（拿这两个常量当代理目标的兜底）。Vite 加载配置文件时是
 * 把它当普通 Node 代码打包执行的，**那里没有 `import.meta.env` 这东西**——
 * 于是常量读到 `undefined`，`new URL(undefined)` 抛 `Invalid URL`，
 * **`pnpm build` / `pnpm dev` 直接起不来**。而这与「宿主产物里混进了 .env」
 * 是同一个根因的两张脸：只要地址读环境变量，它就在「谁是构建方」上站错了位置。
 *
 * ## 读清单要同源（与加载 .glb 是同一条命）
 *
 * 那台服务器**不发 `Access-Control-Allow-Origin`**，而清单是 `fetch` 拉的、
 * `.glb` 也要 `fetch`——两者都会被浏览器拦在交给 JS 之前。缩略图是 `<img>`、
 * 不受这条约束，所以配错了的表现仍然是那个老坑：
 * **缩略图全都好好的，模型一个都加载不出来，清单那一格是空的**。
 * 解法是同源代理（dev 期看 `vite.config.ts` 的 `ASSET_PROXY_PREFIX`）。
 *
 * **图标那一处一样要同源，但要的是另一条代理规则**：图标当 `mask-image` 用，
 * 而**遮罩走 CORS**（实测结论，见设计决定 54）——`<img>` 那条 no-cors 的豁免
 * 在这里不适用。两条前缀各指一个目录、互不替代，dev 期在 `vite.config.ts` 里
 * 并列放着（`ASSET_PROXY_PREFIX` 与 `ICON_PROXY_PREFIX`）。
 *
 * ## 只写条目、不写分类
 *
 * 有哪五类、它们的顺序、中文名、以及「这一类点一下是干什么的」仍然由编辑器
 * 自己定（`useModelLibrary.ts` 的 `LIBRARY_SHAPE`）：那是承重的，四个绘制工具
 * 钉在上面。所以这里连分类都不写——`categories` 是空数组，等 `index.json` 的
 * 数据来填。**空不是「没配」，是「清单在服务器上」**。
 */

/**
 * 标准素材包的根地址，末尾斜杠可有可无（拼之前会补齐）。
 *
 * 单独摘出来是为了让 `vite.config.ts` 能拿它当开发期代理目标的兜底值——
 * 那边 `loadEnv(...).VITE_ASSE_IMAGE_URL` 读不到时才用它，于是
 * 「换台服务器」只需要改一处，`.env` 从「源」降级成「覆盖」。
 */
export const DEFAULT_ASSET_BASE_URL =
  'https://box.hczyun.cn/usr/tool/rhmh/data/rhmh/static/3d-assets/'

/**
 * 左栏导轨那五个分类图标的根地址：`<这个地址><分类 key>.svg`。
 *
 * **它为什么不跟着上面那个地址走**：图标与素材在服务器上是同级的两个目录
 * （见文件头那张对照表），一个是 `…/static/3d-assets/`、一个是
 * `…/static/svg/3dmaker/`，从其中一个推不出另一个。这是有意的摆放——
 * 换素材（换镜像服务器、换一批模型）**不该连带把那五个图标也换掉**，
 * 它们是界面的一部分，不是素材的一部分。
 *
 * 但**「不跟着变」不等于「换不了」**：宿主给它的是 `SceneViewer` 的
 * `iconBaseUrl`（或插件选项 `assets.iconBaseUrl`），两级都压不过时才落在这里。
 * 换素材服务器时**记得一起看这一项**——只换 `assetBaseUrl` 的表现是
 * 「模型换新了、图标还指原来那台」，而那个错**不报错**：探不到就静静退回
 * 内置那五个描边图标。
 *
 * 与素材根同样**写字面量、不读 `import.meta.env`**（理由同上）。
 * 它同样会进 `dist/index.js` 与 sourcemap，这是知情的取舍。
 *
 * 用户往这个目录里放 `.svg` 时的画图规矩（24×24、单色实心、四周留白、
 * 别用描边）写在 `utils/assetIcon.ts` 上；目录**今天可能还是空的**，
 * 那正是 `useCategoryIcons.ts` 要先探一次、探不到就退回内置那五个描边图标的
 * 原因——服务器上放不放图标，导轨都不会是空白。
 */
export const DEFAULT_ICON_BASE_URL = 'https://box.hczyun.cn/usr/tool/rhmh/data/rhmh/static/svg/3dmaker/'

/**
 * 库内置的那一份：只有地址。
 *
 * **冻结**，与 `DEFAULT_SCENE_SWITCHES` 同一个理由：它是模块级单例，
 * 而 `useEditorAssets()` 会把它原样交给每一家宿主。谁要是就地往
 * `categories` 里 push 一件资产，改的就不只是他自己那一次渲染——
 * 同一个页面里所有 `SceneViewer`、以及同一进程里所有 SSR 请求，全都跟着变。
 * 冻结让这件事变成一条明确的报错，而不是一个查不出来的串请求。
 *
 * 宿主想在内置那几类里再加一件资产，**不要改它**——`{ ...DEFAULT_EDITOR_ASSETS }`
 * 摊平出来的是一份新对象，往新对象的 `categories` 里加一项即可；更省事的做法是
 * 直接改服务器上那一份 `index.json`（在那一类的数组里加一行，那正是本轮改的目的）。
 *
 * 注意**给了 `categories` 就整份算宿主的**：那一份不再是「内置的补充」，
 * 编辑器也不会再去读服务器（判据写在 `useAssetManifest.ts` 上）。
 */
export const DEFAULT_EDITOR_ASSETS: EditorAssets = Object.freeze({
  baseUrl: DEFAULT_ASSET_BASE_URL,
  iconBaseUrl: DEFAULT_ICON_BASE_URL,
  categories: Object.freeze([]),
})
