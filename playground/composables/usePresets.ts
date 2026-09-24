import type { SceneConfig, ShadowConfig, SunConfig } from '../../src'

/**
 * 场景预设：**几个时间点的光照与光影**。
 *
 * 每个预设只写 `sun` 与 `shadow` 两组，且这两组都写全（形状见下面 `ScenePreset`
 * 的类型）；其余字段沿用 store 里的当前值。
 *
 * 它现在住在右栏「日照环境」的 03 节（`components/inspector/PresetList.vue`），
 * 与它改的那几个字段（太阳高度 / 三盏灯 / 阴影）同屏。原先它是左栏一个独立的页面，
 * 那一格今天换成了环境贴图撤走之后腾出来的位置，见 README 设计决定 41。
 *
 * ## 一个预设只管两件事：光照（`sun` 里那几盏灯）与光影（`shadow`）
 *
 * 它**不动**相机、地面、画布底色、环境贴图、天空盒。理由是预设这个词在这份
 * 编辑器里的意思是「换个光看看」，不是「把这个场景重置成这样」：
 *
 * - **相机**是用户的取景。点一下预设就把镜头挪走，是拿一个装饰性的动作打断
 *   一件正在做的事（正在看的那个角落没了）。要回到某个机位有「重置机位」，
 *   要滑过去有 2D / 3D 与「聚焦」。
 * - **地面与画布底色**是场景的外观，右栏「地面」与左栏「地板」那两处各有主人。
 * - **环境贴图（`sun.environment`）与天空盒**是一次**网络请求**：cientos 的
 *   环境预设从远处拉一张 1k 的 HDR（实测 1.6MB / 约 2s），拿到之后还要生成
 *   环境贴图、重算一遍所有材质的 shader。点一下预设要等它落地才出画面，
 *   那不是预设该有的手感；而且这两样说的是「反射从哪来」，与「这一束光从哪来」
 *   是两件事。
 *
 *   它们今天各有各的入口，但**都不在这一页**：天空盒在左栏那一类里，
 *   环境贴图只剩一个配置字段——它的下拉框原先就长在这 03 节的位置上，
 *   随这次搬家一起删掉了（`sun.environment` 仍然有效，由宿主经 props 或
 *   导入 JSON 设定；左栏点天空盒时照旧把它清空）。
 *
 * ## 光影这一组里哪些字段不能写（原来的「卡死」就是它们）
 *
 * 收窄到标量还不够——**同样是标量，改一个值要付的代价可以差三个数量级**。
 * 这一页今天留下的字段都是照「点下去几毫秒内出画面」挑的，下面三条是排除掉的，
 * 前两条正是原先「一次切换卡住好几秒」的主因（另一条来源在上一节：环境贴图
 * 那一次网络请求，与它落地之后的全材质重编译）：
 *
 * 1. **不换 `shadow.type`。** 换它 = `SceneShadows` 里那两个组件整个换一个
 *    （`:key` 带 `revision`，type 一变就重挂载），而累积阴影是「挂载即开烘」
 *    的——40 帧里每帧遍历整棵场景、把每个材质换成 `discardMat`、8 盏 1024²
 *    随机灯各渲染一张阴影贴图。**这一条是原先「一次切换卡住好几秒」的主因**。
 * 2. **不写 `accFrames` / `accBlend` / `accScale`。** 这三个在 cientos 的
 *    `AccumulativeShadows` 里挂在同一张表上：
 *    `watch(() => [props.frames, props.once, props.accumulate, props.scale, props.limit], reset)`
 *    ——`reset()` 清掉两张 1024² 的累积贴图并把 `frameCount` 归零，于是整轮
 *    烘焙从头再来一遍。**改了 `accScale` 与改了 `accFrames` 的代价一模一样。**
 * 3. **`accOpacity` 也不写，但理由与上面两条相反：它太便宜了，便宜到没用。**
 *    它不在那张 watch 表里，只在烘焙那一趟被读一次
 *    （`material.opacity = Math.min(props.opacity, …)`）。烘完之后再改它，
 *    没有任何东西会重新读一遍，**画面上一点反应都没有**。写进来就是
 *    「点一下预设，明明改了参数却什么都没发生」——那是比缺失更坏的一种存在。
 *
 * 于是累积阴影那一组**一个都不写**。代价说清楚：用累积阴影的人点预设，
 * 能看到光变了（灯的角度与强度照常生效），但那块影子的大小与浓淡归他自己管，
 * 预设不插手——这也正是「不换 type」的必然结果。
 *
 * 留着的那几个 `contact*` 是**当场生效**的：`ContactShadows` 把
 * `opacity` / `blur` / `scale` 都挂在 watch 上，改一个只重画一帧 512²
 * （它本来就 `:frames="1"`）。同样几个数在两边的待遇不同，是 cientos 自己的
 * 取舍，不是这里能选的。
 *
 * ## 每个预设必须把它管的字段**写全**（这条是深合并逼出来的）
 *
 * `applyConfig` 是深合并而不是整体替换——没出现在补丁里的字段保持当前值。
 * 好处是「只改光照」这种小补丁写得出来，代价是**漏写一个字段就等于让它继承
 * 上一个预设的值**：从「夜晚」（`receiveShadow: false`）切到「正午」时，
 * 正午若不写 `receiveShadow`，地上就一直没有影子，而面板里那个开关明明开着。
 * 所以 `sun` 那五项与 `shadow` 那几项**每个预设都从头写一遍**，不看上一个是谁。
 *
 * 同一条规则还有第二个受害者：**天空（`sun.showSky`）与那四个大气参数**
 * （`turbidity` / `rayleigh` / `mieCoefficient` / `mieDirectionalG`）也不写。
 * 天空是一个巨大的背面盒体，它管的是「头顶上那层天长什么样」，与灯照亮什么
 * 无关；而 `elevation` / `azimuth` 开着天空时**同时**驱动太阳的位置，
 * 所以用户开着天空时，预设挪主光也就顺便挪了太阳——那是对的，不必替它关开关。
 */

/**
 * 一个预设能写的光照字段，**类型级白名单**。
 *
 * `Pick` 把「只能写这五个」写成了编译错误：想往预设里加 `showSky` 或
 * `environment`，得先改这个类型，那时它会撞上下面的注释。`Required` 写的是
 * 「五个都得写」——深合并那条规矩（见文件头）于是不再靠人记着。
 */
type PresetSun = Required<
  Pick<SunConfig, 'elevation' | 'azimuth' | 'ambientIntensity' | 'keyIntensity' | 'fillIntensity'>
>

/**
 * 一个预设能写的光影字段，同样是白名单 + 写全。
 *
 * 名单里**没有** `type`（换它要换掉整个阴影组件）、没有 `acc*`（那一组改了要
 * 重烘一整轮，`accOpacity` 则是改了没反应）、也没有 `mapSize` / `bias` /
 * `normalBias`（重建阴影贴图）——理由逐条写在文件头，这里只留一句：
 * **能把这一页卡住的字段，一个都进不来**。
 */
type PresetShadow = Required<
  Pick<
    ShadowConfig,
    'enabled' | 'castShadow' | 'receiveShadow' | 'contactOpacity' | 'contactBlur' | 'contactScale'
  >
>

export interface ScenePreset {
  key: string
  label: string
  note: string
  /**
   * 补丁**只有这两组**。
   *
   * 这里不再是 `DeepPartial<SceneConfig>`：宽口类型允许预设顺手改相机、地面、
   * 环境贴图，而「预设不碰那些」是这一页最要紧的一条约定（见文件头）。收成
   * 一个只有两个键的字面量类型之后，多写一个分组就是**编译错误**，而
   * `pnpm build` 与 `pnpm typecheck` 都跑 `vue-tsc`，所以这条约定进得来、丢不掉。
   */
  patch: {
    sun: PresetSun
    shadow: PresetShadow
  }
}

/**
 * 四个时间点。
 *
 * 全部参数都写出来（理由见文件头），所以每条都是完整的两小块。
 * 顺序按一天的早晚排，与用户在脑子里找它的顺序一致。
 *
 * 「影长」那一半靠的是 `contactScale`（接触阴影的采样范围）：太阳压得越低，
 * 影子在地上摊得越开，所以清晨与黄昏给的是 18 / 20，正午只给 10。
 */
export const SCENE_PRESETS: ScenePreset[] = [
  {
    key: 'morning',
    label: '清晨',
    note: '低角度主光 · 影长而淡',
    patch: {
      sun: {
        elevation: 12,
        azimuth: -105,
        ambientIntensity: 1.5,
        keyIntensity: 2,
        fillIntensity: 0.5,
      },
      shadow: {
        enabled: true,
        castShadow: true,
        receiveShadow: true,
        // 太阳压得低，投在地上的影子拉得很长，浓淡得淡一点才不像一块脏
        contactOpacity: 0.4,
        contactBlur: 4.2,
        contactScale: 18,
      },
    },
  },
  {
    key: 'noon',
    label: '正午',
    note: '顶光 · 影短而实',
    patch: {
      sun: {
        elevation: 82,
        azimuth: 25,
        ambientIntensity: 1.4,
        keyIntensity: 3,
        fillIntensity: 0.45,
      },
      shadow: {
        enabled: true,
        castShadow: true,
        receiveShadow: true,
        // 顶光下的影子最短、边界最清楚，采样范围因此收小（贴着物体那一圈）
        contactOpacity: 0.72,
        contactBlur: 1.4,
        contactScale: 10,
      },
    },
  },
  {
    key: 'dusk',
    label: '黄昏',
    note: '斜射 · 影长而浓',
    patch: {
      sun: {
        // 高度角 7° 是「太阳快贴到地平线」，主光几乎平着扫过来
        elevation: 7,
        azimuth: 132,
        ambientIntensity: 0.95,
        keyIntensity: 3.4,
        fillIntensity: 0.35,
      },
      shadow: {
        enabled: true,
        castShadow: true,
        receiveShadow: true,
        contactOpacity: 0.78,
        contactBlur: 3.4,
        contactScale: 20,
      },
    },
  },
  {
    key: 'night',
    label: '夜晚',
    note: '弱光 · 影极淡',
    patch: {
      sun: {
        elevation: 16,
        azimuth: -62,
        ambientIntensity: 0.45,
        keyIntensity: 0.9,
        fillIntensity: 0.22,
      },
      shadow: {
        enabled: true,
        castShadow: true,
        /*
          夜景下**不接收阴影**：地上那层深色模型本来就压得低，
          再叠一道 90% 不透明的影会糊成一片死黑，反而看不出形体。
          与「夜晚影子淡」是同一件事的两面。
        */
        receiveShadow: false,
        contactOpacity: 0.3,
        contactBlur: 5.5,
        contactScale: 16,
      },
    },
  },
]

/**
 * 判断当前配置是否仍然满足某个补丁。
 *
 * 用它来推导「当前选中哪个预设」，而不是在点击时记一个 ref：
 * 预设是一份声明式的期望值，用户后面手动改了参数，高亮就该跟着消失。
 * 数组按 `Object.entries` 逐下标比较，坐标元组因此也能正确命中。
 *
 * 它也是「预设只管光照与光影」的**第二个好处**：判据只有那十几个数，
 * 用户挪一下相机、关一下地面、换一组天空盒，高亮都**不会**跟着灭掉——
 * 那些字段本来就不在补丁里，与「现在是不是这个预设」无关。
 */
function matches(target: unknown, patch: unknown): boolean {
  if (typeof patch !== 'object' || patch === null) return Object.is(target, patch)

  return Object.entries(patch).every(([key, value]) =>
    matches((target as Record<string, unknown> | null | undefined)?.[key], value),
  )
}

/** 当前配置命中的预设 key，没有命中时返回 null */
export function activePresetKey(config: SceneConfig): string | null {
  return SCENE_PRESETS.find((preset) => matches(config, preset.patch))?.key ?? null
}
