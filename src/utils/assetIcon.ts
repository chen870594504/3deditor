import { normalizeBase } from './assetManifest'

/**
 * 分类图标的地址拼法。
 *
 * ## 约定：图标**不在素材根目录下**
 *
 * 左栏导轨那五个分类图标住在服务器上的另一个目录里，与素材根是**同级**的
 * 两个目录：
 *
 *     …/static/3d-assets/     ← 素材根（DEFAULT_ASSET_BASE_URL）：模型、清单
 *     …/static/svg/3dmaker/   ← 图标根（DEFAULT_ICON_BASE_URL）：floor.svg 等
 *
 * 所以**由素材根拼不出图标地址**，图标那边只能另起一个常量
 * （`DEFAULT_ICON_BASE_URL`）**与一个口子**（`SceneViewer` 的 `iconBaseUrl` /
 * 插件选项 `assets.iconBaseUrl`）。这两条不对称都是刻意的：换镜像服务器
 * （只给 `assetBaseUrl`）时模型跟着换、**图标仍指原来那台**——要一起换就
 * 把 `iconBaseUrl` 也指过去。只给前一个而图标跨域被拦下时，表现是导轨
 * **退回内置图标、不报错**。见 DESIGN.md 设计决定 54。
 *
 * 文件名就是**分类的 key**：`floor.svg` / `wall.svg` / `door.svg` /
 * `window.svg` / `skybox.svg`。于是「多一个分类要加一个图标」这件事不需要
 * 再定一套命名规则——key 本来就是服务器上的目录名（见 `resolve()` 那条约定），
 * 这里只是把「目录名」换成「同名的 .svg」。
 *
 * ## 这份 SVG 被当成**遮罩**用，不是当图片贴上去
 *
 * 调用方（`useCategoryIcons.ts` 探到之后由 `SidePanel.vue` 渲染）把它写进
 * `mask-image`，颜色由 `background-color: currentColor` 给。这不是随手挑的写法：
 * 导轨的激活/悬停态**只改 `color`**（`_editor.scss` 里 `.tdm-rail-item` 那两条），
 * 图标要跟着变色就得让颜色从 CSS 来——而 `<img>` 里的 SVG 是个独立文档，
 * `currentColor` 传不进去，那张图会永远停在文件里写死的颜色上。
 *
 * 代价是**画图的规矩**：遮罩只取「有没有像素」，颜色完全被忽略，所以图标得是
 * **单色实心形状**，不能是描边图形（一条 1.5px 的描边缩到 18px 就看不见了）。
 *
 * 还有一条**比 `<img>` 贵**的代价，它是实测出来的、也是这个口子存在的原因：
 * **遮罩走 CORS**（alpha 要参与合成，浏览器得读像素），而那条「CSS 里的图片
 * 不受 CORS 约束」的豁免只对 `background-image` / `<img>` 成立。所以拼出来的
 * 地址**必须同源**，否则渲染时被拦下、导轨上多出一格空白且没有 error 事件。
 *
 * 与 `normalizeBase` 一样：**调用方要先判过 `iconBaseUrl` 非空**。今天它可能
 * 来自库内那个常量（非空）、也可能来自宿主给的 prop——而**空串是合法的**
 * （「不探服务器图标、全用内置那五个」），`useCategoryIcons.ts` 就是在那里
 * 提前返回的：`normalizeBase('')` 给的是 `'/'`，拼出来是打向本站根的
 * `/floor.svg`，那个错没有任何提示。
 */
export function assetIconUrl(iconBaseUrl: string, categoryKey: string): string {
  return `${normalizeBase(iconBaseUrl)}${categoryKey}.svg`
}
