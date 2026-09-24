import { nextTick } from 'vue'
import { DEFAULT_SCENE_CONFIG, useSceneStore, viewModeOf } from '../../src'
import type { CameraConfig, ViewMode } from '../../src'
import { pushEvent } from './useEditorState'

/**
 * 视口右上角那枚 2D / 3D 视角切换的**动作**，外加把**判据**转出去。
 *
 * 这一档不是「正交投影 vs 透视投影」——它是同一只透视相机的两个机位：2D 是正上方俯视、
 * 3D 是随手转的自由视角。真正的正交相机要新增一只相机、切 TresJS 的 activeCamera，
 * 而 cientos 5.9 换相机会重挂 OrbitControls 并因为 `whenever(..., { once: true })`
 * 丢掉 `end` 监听器，连带打断「松手回写机位」与「拖手柄时禁用轨道控制」两条链路。
 * 代价与取舍写在 DESIGN.md 的设计决定里。
 *
 * **档位是从机位推导的，没有独立的 ref。** 这与 `activePresetKey(config)` 同一条思路
 * （预设高亮也是从配置推导、手动改了参数就自己消失），也与 store 里那句
 * 「靠数据本身自洽，比靠一个需要在 nextTick 里复位的布尔量更难写错」一致：
 * 撤销、套预设、点「重置机位」、在面板里改机位之后，档位自己就是对的，
 * 不可能出现「档位写着 2D、画面其实已经转走」。
 *
 * **推导规则 `viewModeOf` 住在库里**（`src/utils/viewMode.ts`），这里只是把它
 * 原样再转出去，好让既有的两个调用点（`useFloorplanTool.ts` / `SceneStage.vue`）
 * 一个字不用改。搬家的理由在那边写着：墙的 2D 平面图外观要用**同一条**规则，
 * 两份实现不一致的表现是「按钮亮着 2D、墙却铺着贴面」。
 */

export { viewModeOf }
export type { ViewMode }

/**
 * 2D 档进来时站多高。
 *
 * **它刻意不是算出来的。** 早先这版按选中模型的包围盒求一个刚好装得下的距离，
 * 结果是同一个按钮在不同模型上给出完全不同的观感：椅子近、大楼远，
 * 而「俯视」这个动作本身想要的是一把稳定的尺子——转到 2D 就该退到同一个高度，
 * 于是任何两次俯视之间都能直接比大小、比位置。
 *
 * 说是「起始高度」更准：**进来之后滚轮可以缩放**（这一档只关旋转，见 `LOCKED`），
 * 想凑近看某一块就凑近。尺子保证的是**每次切进来都从同一个高度、对着同一个原点
 * 开始**——两次俯视要互相比较时，先各自按一次 2D 再比，起点就是同一个。
 *
 * 110 是**按默认那块地定的**：地面边长默认 120，45° 视场角下竖直装下 120 需要约 145，
 * 110 装下约四分之三、横向（宽视口下）整块都在——够看平面关系，又没有为了四个角
 * 再多退三分之一。地面边长改了，这个数就该跟着重算，两者是配套的。
 *
 * 它比默认的 `maxDistance`（150）低 40，所以这个高度站得住，而且**往外还有得滚**：
 * 滚到上限的 150 正好能把整块 120 见方的地装进画面（那需要 145）。两点都是有用的余量，
 * 别把这两个数改到相等——持平的话俯视里就只能往里缩、往外一滚顶在上限上不动。
 *
 * 宿主或用户在面板里把「最远距离」调到 110 以下时，这个高度会被夹回去
 * （写入前自己夹一次，理由见下面那段注释），那时以那个限制为准——「最远距离」
 * 是相机权限，俯视档的高度只是它的一个使用者。
 *
 * 代价要认：进来时的取景是固定的，比这更大的场景一下看不全（得往里缩），
 * 内容整体远离原点时画面中央是空的。真要框住任意大小的模型，用右下的「聚焦」——
 * 那个动作是**按模型算**距离的，两者各司其职，不要把这一个也改成算出来的。
 */
const TOP_DISTANCE = 110

/**
 * 没有可还原的 3D 机位时的兜底视线方向。
 *
 * 直接取默认配置里那一对机位与注视点的差再归一化，而不是手写三个小数：
 * 默认值改了这里就跟着改，也不会有人写错第 15 位。
 * （默认配置的 `target` 是 `[0, 0, 0]`，所以 position 本身就是那个方向。）
 */
const FALLBACK_DIRECTION: [number, number, number] = (() => {
  const { position, target } = DEFAULT_SCENE_CONFIG.camera
  const offset = [position[0] - target[0], position[1] - target[1], position[2] - target[2]]
  const length = Math.hypot(offset[0], offset[1], offset[2]) || 1
  return [offset[0] / length, offset[1] / length, offset[2] / length]
})()

/**
 * 2D 档对「怎么操作」的两条限制。
 *
 * 俯视是拿来看**平面关系**的（谁跟谁对齐、间距多少），不是拿来换个角度参观的：
 * 左键一转就不再是俯视。所以这一档只关旋转。
 *
 * **缩放与平移都留着**：它们改变的是取景——多大、在哪——不改变「从正上方看下去」
 * 这件事本身，俯视还是俯视。收窄到只剩平移是一开始的做法，后来放开了缩放：
 * 「再凑近看一眼这一块」是这个档位里最常做的事，把它禁掉之后只能先退到 3D、
 * 凑近了、再切回来，比留着更容易打断「看一眼平面关系」。
 *
 * 两条都写进 `config.camera` 而不是只做界面状态：它们是**轨道控制的权限**，
 * 与 `enablePan` / `enableZoom` 是同一组东西，库本来就通过配置读它们。
 * 代价是在 2D 下导出的配置里这两项是收窄的（同 `minPolarAngle`），
 * 切回 3D 或在面板里手动打开即可复原。
 *
 * `enableZoom` 不在这里：这一档不改宿主的缩放权限，它本来就是什么就是什么。
 * 与「宿主关掉的『允许平移』不该被这枚按钮顺手打开」同一条：权限是宿主的，
 * 这个档位只关掉那个**与俯视本身矛盾**的旋转。
 */
const LOCK_KEYS = ['minPolarAngle', 'enableRotate'] as const

type Lock = Pick<CameraConfig, (typeof LOCK_KEYS)[number]>

/** 进入 2D 时要收窄的权限 */
const LOCKED: Lock = { minPolarAngle: 0, enableRotate: false }

/** 机位到注视点的距离 */
function distanceOf(camera: CameraConfig): number {
  return Math.hypot(
    camera.position[0] - camera.target[0],
    camera.position[1] - camera.target[1],
    camera.position[2] - camera.target[2],
  )
}

/**
 * 切到 2D 时要记下来的东西。
 *
 * 它是**界面状态**：不进 config、不进历史、不进导出物——与 `gizmoMode` 同一条约定。
 * 存的是整个机位而不只是方向，为的是「切回来时原地还原」而不是「回到某个默认斜角」。
 *
 * 两条权限也在里面：离开 2D 要把它们放回**进来之前**的样子，
 * 而不是一律按默认值打开——宿主本来就关掉的「允许旋转」不该被这枚按钮顺手改掉。
 *
 * `infiniteGrid` 同样在里面，理由一样：无限网格是 2D 这一档的取景需要（见下面
 * 写入那一段），不是用户对地面的改动，离开时必须还回去。
 */
/** 进入 2D 之前的完整状态：机位 + 那两条权限 + 地面是否无限 */
interface SavedPose extends Lock {
  position: [number, number, number]
  target: [number, number, number]
  infiniteGrid: boolean
}

let savedPose: SavedPose | null = null

/**
 * 切视角档位。
 *
 * 已经是这一档就什么都不做：它是分段控件（radio），不是「复位视角」按钮——
 * 在 3D 里点 3D 不该把已经转好的视角推回上一个记录点。
 *
 * 是 `async` 的，只为了切到 2D 那一步要等一个渲染帧，理由见下面那段注释。
 */
export async function setViewMode(mode: ViewMode): Promise<void> {
  const scene = useSceneStore()
  if (viewModeOf(scene.config.camera) === mode) return

  const { camera, ground } = scene.config

  if (mode === '2d') {
    savedPose = {
      position: [...camera.position],
      target: [...camera.target],
      minPolarAngle: camera.minPolarAngle,
      enableRotate: camera.enableRotate,
      infiniteGrid: ground.infiniteGrid,
    }

    /*
     * 注视点是**世界原点**（网格中心），不是选中模型，也不是内容的中心。
     *
     * 这是「尺子」那个比喻的另一半：进来时的高度写死（见 `TOP_DISTANCE`），注视点也写死，
     * 于是同一处风景任何一次切到 2D 都从画面的同一格开始——两次俯视之间能直接比大小、
     * 比位置，换选中哪个模型、之前把视角平移到哪里都不影响。要是跟着选中模型走，
     * 「谁跟谁对齐、差多少」这些判断在换一个模型看的时候就得重新对一遍。
     *
     * 进来之后滚轮可以缩放、右键可以平移（这一档只关旋转），所以「同一个起点」
     * 不等于「同一个画面」——比之前各自按一下 2D 回到起点就是了。
     *
     * 代价是内容整体远离原点时画面中央是空的——起始取景就是 `TOP_DISTANCE` 那一段讲的
     * 那个固定高度，不会因为这里有东西而自己凑过去。要按内容自动取景，用右下的「聚焦」，
     * 那个动作才是算出来的，两者各司其职。
     */
    const target: [number, number, number] = [0, 0, 0]

    /*
     * 距离必须自己夹进 min / maxDistance。不夹的话配置里留下的是夹取前的值，
     * 而 OrbitControls 会在 update() 里把真实距离夹回去——于是写出的机位键
     * 与上一次可能完全相同，`syncCamera` 的 watch 不触发，相机一动不动，
     * 字面意义上的点了没反应（同 `focusModel`）。
     */
    const distance = Math.min(Math.max(TOP_DISTANCE, camera.minDistance), camera.maxDistance)

    /*
     * **这一步分两次写，但历史里只有一条。**
     *
     * 「最低仰角」是 OrbitControls 上的一个限制量，它由组件重新渲染时才会落到
     * 控件上——而且是排在整趟 diff 的**最后**（渲染里的 prop 补丁都在 patchElement
     * 那一遍里）；而把机位写进相机的 `syncCamera` 是一个 pre-flush watcher，
     * 同一个渲染帧里它跑在渲染**之前**。三者写在一起的话，`syncCamera` 摸到的
     * 控件还带着旧的仰角下限，`update()` 会把正上方的姿态夹成一个斜角：
     * 配置里是正俯视（按钮亮着 2D），画面上却是歪的——而 damping 关掉时
     * `update()` 压根不逐帧跑，这一夹没人会替它纠正回来。
     *
     * 所以先单独把这一项放下、等这帧渲染完，再写机位。第二次写入带 label，
     * store 是按**快照 diff** 提交的（见 `stores/scene.ts` 的 `commit`），
     * 于是前一步的 `minPolarAngle` 会和机位一起并进同一条记录——标签也正是
     * 想要的那个，不会多出一条「相机」。
     *
     * 只有 `minPolarAngle` 需要这样等：`enableRotate` 是给指针用的、地面那项是给
     * 网格用的，与这一帧的机位写回都不相干，跟着第二次写入一起落就行。
     */
    scene.applyConfig({ camera: { minPolarAngle: 0 } })
    await nextTick()

    scene.applyConfig(
      {
        camera: {
          position: [target[0], target[1] + distance, target[2]],
          target,
          ...LOCKED,
        },
        /*
         * 俯视下让地面**无限延伸**。
         *
         * 不这么做的话画面里会看见这块地的边：边长 120 是「半个 ±60」，
         * 而淡出要到 150 才彻底透明，于是边界那圈线还留着六成的亮度——
         * 从正上方看下去正好横在取景里，缩得越远越明显，像一块浮着的板子。
         *
         * `infiniteGrid` 的做法是把平面几何按 `1 + fadeDistance` 放大
         * （顶点着色器里那行 `localPosition *= 1.0 + fadeDistance`），
         * 平面于是有 ±9000 出头，边界远在淡出之外、再也看不见；而网格图案是按
         * **同一个变量**算的，世界空间里仍然是 0.6 一格——放大的只有那块板子，
         * 不是格子。所以它看起来就是同一张网格铺到看不见为止。
         *
         * 它是这一次的取景手段，不是用户对地面的改动：离开 2D 时按进来之前的值还原
         * （见 `SavedPose`）。代价与那两条权限一样——2D 下面板里的「无限延伸」是开的，
         * 那时导出的配置里也写着 true。
         */
        ground: { infiniteGrid: true },
      },
      '切换到 2D 俯视视角',
    )

    pushEvent(`已切换到 2D 俯视视角（原点正上方 ${distance.toFixed(1)}）`)
    return
  }

  const saved = savedPose
  savedPose = null

  /*
   * 没有可还原的机位，说明这份配置**本来就是从俯视来的**（导入了一份在 2D 下导出的
   * 文件就会这样），那 2D 那一步就没记过东西。此时除了换方向，还要把两条权限
   * 放回默认值——按钮说的是「3D 透视视角」，出去之后却转不动，那是这一档在说谎。
   * 宿主自己调的权限在这条路上无从得知，只能回到默认。
   *
   * 无限网格同理：那种配置是 2D 下导出物，里面写着 `infiniteGrid: true`，
   * 既然要离开俯视，就回到默认的有限网格。
   */
  const lock: Lock = saved ?? {
    minPolarAngle: DEFAULT_SCENE_CONFIG.camera.minPolarAngle,
    enableRotate: DEFAULT_SCENE_CONFIG.camera.enableRotate,
  }
  const infiniteGrid = saved?.infiniteGrid ?? DEFAULT_SCENE_CONFIG.ground.infiniteGrid

  /*
   * 有得还原就**原地还原**（含注视点，所以是整条机位）；没有就只换方向、
   * 不改距离与注视点——「退出俯视」不该顺带把用户看的位置也挪走。
   */
  let position: [number, number, number]

  if (saved) {
    position = [...saved.position]
  } else {
    const orbit = Math.min(Math.max(distanceOf(camera), camera.minDistance), camera.maxDistance)
    const [dx, dy, dz] = FALLBACK_DIRECTION
    position = [
      camera.target[0] + dx * orbit,
      camera.target[1] + dy * orbit,
      camera.target[2] + dz * orbit,
    ]
  }

  scene.applyConfig(
    { camera: { position, ...lock }, ground: { infiniteGrid } },
    '切回 3D 透视视角',
  )
  pushEvent('已切回 3D 透视视角')
}
