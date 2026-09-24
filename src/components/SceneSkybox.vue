<script setup lang="ts">
import { onUnmounted, watch } from 'vue'
import { useTresContext } from '@tresjs/core'
import { CubeTexture, ImageLoader, SRGBColorSpace } from 'three'
import type { Scene } from 'three'
import type { SkyboxFaces } from '../types'
import { skyboxPatchFaces } from '../utils/skyboxFill'

defineOptions({ name: 'TdmSceneSkybox' })

/**
 * 天空盒。**这个组件不渲染任何东西**，它的产物是 `scene` 上的两个字段。
 *
 * 六个面由 `ImageLoader` 一张一张拉回来，拼成一张 `CubeTexture`，然后同时写进
 * `scene.background`（**能看见的那层天**）与 `scene.environment`（金属与玻璃
 * 反射到的东西）。两个一起写是有意的：只写背景的话，一块镜面地板会把天空照成
 * 黑色，看起来像坏了；`sun.environment`（预设）那条路只写 environment，
 * 正是因为它管的是「反射用什么」，而天空盒管的是「外面长什么样」。
 *
 * ## 为什么不用 cientos 的 `<Environment :files="...">`
 *
 * 它确实收立方体贴图的六个地址（`files` 传数组走的就是 `CubeTextureLoader`），
 * 少写一大截。读一遍它的实现（`@tresjs/cientos` 的 `useEnvironment`）之后
 * 有两条过不去：
 *
 * 1. **它不还东西**。`scene.background` / `scene.environment` 是它写上去的，
 *    但组件卸载、或者 `files` 换成另一组时，它只把新值写上去，
 *    旧值既不还原也不清空。后果是两个都看得见的坏毛病：关掉天空盒、
 *    或者改选一个环境预设之后，**背景还是上一个天空盒**（预设那条路不碰
 *    background，所以谁也盖不掉它）。而「关掉」这个能力是必须有的——
 *    没有它，离开天空盒之后只剩「换成预设」这一条路。
 * 2. **它不释放贴图**。卸载时它只 dispose 自己的 FBO 与那棵场景，
 *    加载出来的 `CubeTexture` 一次都没有 `dispose()`。换一次天空盒就漏一份
 *    显存（六个面 512² 的贴图约 6 MB，连 mipmap 一起约 8 MB），
 *    而「挨个点一遍看看哪个好看」正是这个功能的用法。
 *
 * 自己写这几十行的代价换来的是：换、关、卸载三种情况下 `scene` 都被收拾干净，
 * 而且**不会留着上一份贴图不放**。下面是这份「收拾干净」的完整约定。
 *
 * ## 生命周期
 *
 * `swap` / `detach` 这一对负责所有的写入与还原，规则只有一条：
 * **只还原「还是我们写进去的那个值」**。中途被别的代码改过（宿主自己设了背景、
 * 或者预设那条路写了 environment），说明那一格已经不归我们管了，就不该被我们
 * 在收摊时覆盖掉。这条判据让「天空盒开着的时候宿主自己改背景」变成
 * 「天空盒让位，收摊时保留宿主的值」，而不是两边互相盖。
 *
 * ## 缺一个面不废掉整组
 *
 * `CubeTextureLoader` 的完成条件是**六张一张不少**（`if (loaded === 6)`），
 * 少一张就永远不触发回调、一个字段都不写——表现是「点了没反应」，而左栏那一格
 * 看着完全正常（缩略图用的是另一张图）。服务器上现在有二十组就是这样，只缺
 * `down.jpg`。所以这里**不用 `CubeTextureLoader`**：六个面各加载各的，
 * 谁没拿到谁就让 `skyboxPatchFaces` 补一块贴边纯色（补色的依据与实测差异
 * 都在 `utils/skyboxFill.ts` 的文件头上），**六张全缺才维持原样**。
 *
 * 这是**公开行为的一处变化**：以前「六张里有一张拿不到」等于整组不生效，
 * 现在是照样换上、那一面是块纯色。宿主看到的是「坏了也看得出来」而不是
 * 「点了没反应」，所以不做开关——多一个开关就多一组要测的组合。
 */
const props = withDefaults(
  defineProps<{
    /** 天空盒的六个面地址（顺序见 `SkyboxFaces`），`null` 表示不用天空盒 */
    skybox?: SkyboxFaces | null
  }>(),
  { skybox: null },
)

/**
 * 与 `ScenePicker` / `SceneContent` 一样的第三个 `useTresContext` 消费者
 * （DESIGN.md「TD 层不使用 Pinia」那一节点了名）。这里要的就是 `scene` 本身：
 * 天空盒不是场景图里的一个物件，它是场景上的一对字段，没有别的写法够得着。
 * 它同样不碰 Pinia，只收一个 prop。
 */
const { scene } = useTresContext()

/** 当前这一份贴图。`null` 表示「现在没有天空盒」 */
let active: CubeTexture | null = null

/**
 * 我们接管之前 `scene` 上那两个字段的值，交还时原样放回去。
 *
 * 只在**第一次接管**时记一次（`swap` 里那句 `if (!saved)`）：换天空盒是
 * 「从一份换成另一份」，原始值不变，每次都重记就会把上一份天空盒当成原始值记住，
 * 于是关掉之后背景停在上一份天空盒上——正是上面点名要避开的那个毛病。
 */
let saved: { background: Scene['background']; environment: Scene['environment'] } | null = null

/**
 * 异步加载的序号。
 *
 * 加载是异步的、点格子是同步的：连点三格时六个图片的**到达顺序不保证**
 * 与发起顺序一致（第三次点的可能先到完）。没有这个序号，最后落地的是哪一份
 * 全看网络，而左栏高亮的是第三格——两边都不报错，只是对不上。
 * 每次发起 `+1`，回调里对不上号的整份丢掉（连同那张半成品贴图）。
 */
let token = 0

/**
 * 逐面加载用的加载器。
 *
 * 不复用 `CubeTextureLoader`，理由见上面「缺一个面不废掉整组」：它只在六张全齐时
 * 才给回调，而这里要的是「谁到了先记谁、谁没到补谁」。`crossOrigin` 的默认值
 * （`'anonymous'`）与 `CubeTextureLoader` 内部用的那个是同一个——它本来就是拿
 * `ImageLoader` 去拉的。
 */
const loader = new ImageLoader()

/**
 * 已经打过的日志。
 *
 * 挂在模块上而不是组件上：这个组件是按配置挂载的，换一次天空盒就是一次新的
 * 加载，用实例内的标志位挡不住「同一个坏地址被反复重试」。粒度是这条日志本身
 * （正文里有组名与缺的那几张的名字），与 `SceneFloorplanWallSkin` 那条同一条约定。
 *
 * 打日志的判据是「这一次有面没拿到」（一张也好六张也好）——六张里缺几张，
 * 画面上的差别只是「底下一块纯色」与「背景维持原样」，都不报错，补过的那一面
 * 与真的那一面在画面上几乎同形。库这一侧没有别的事件通道（`SceneSkybox`
 * 只收一个 prop），**用户唯一的线索就是这里**。
 * 前缀沿用 `3dmaker:`（不是编辑器的 `[tdm]`，那是设计决定 21）。
 *
 * 反面是**不打印**：浏览器自己在 Network 面板里会把 404 与跨域都标红，
 * 这里再复述一遍只会让控制台更难读。
 */
const WARNED = new Set<string>()

function warn(text: string) {
  if (WARNED.has(text)) return
  WARNED.add(text)
  console.warn(`3dmaker: ${text}`)
}

/** 换上这一份，把上一份扔掉。只在加载成功后被调用 */
function swap(texture: CubeTexture) {
  const target = scene.value
  if (!target) {
    texture.dispose()
    return
  }

  if (!saved) saved = { background: target.background, environment: target.environment }

  const previous = active
  active = texture
  target.background = texture
  target.environment = texture

  // 上一份在这里才释放，而不是在换之前：换的这几百毫秒里画面还是它
  if (previous && previous !== texture) previous.dispose()
}

/**
 * 摘下当前这一份，把 `scene` 还回原样。
 *
 * 没有天空盒时是空操作，所以「本来就没有」与「刚被关掉」走同一个入口。
 * `saved` 一起清掉，下次接管重新记——见上面那段。
 */
function detach() {
  if (!active) return

  const target = scene.value
  if (target) {
    if (target.background === active) target.background = saved?.background ?? null
    if (target.environment === active) target.environment = saved?.environment ?? null
  }

  active.dispose()
  active = null
  saved = null
}

/**
 * 地址末两段分别是「哪一个天空盒」与「哪一张面图」。
 *
 * 报给用户看的那几个字用它，而不是整条地址（太长）或者文件名一个（`down.jpg`
 * 这一条二十组都一样，日志正文就分不出是哪一组了——而 `WARNED` 是按正文去重的，
 * 分不出来就等于后面十九组都不打）。
 */
function groupOf(url: string) {
  const parts = url.split('/')
  return parts.length >= 2 ? parts[parts.length - 2] : url
}

function faceOf(url: string) {
  return url.split('/').pop() || url
}

/**
 * 换成指定的天空盒，`null` 就是关掉。
 *
 * **刻意先不动画面**：六张图没落地之前一直留着上一份（第一次则是光秃秃的背景），
 * 拼好才一次性换过去。中途先清空会看到一下背景色闪过去，
 * 而逛天空盒时这个动作是连着做的。
 *
 * 用 `loadAsync()` 而不是 `load()` + 回调：这里要的正是「**等六张都落地**」，
 * 而逐面加载之后被顶掉的那一次手里**只有图、还没有 GPU 资源**（纹理是下面
 * 才造的），所以旧版那种「先同步拿到句柄、好在被顶掉时 `dispose()`」的写法
 * 不再需要了——`await` 之后比一次 `token` 就够，被顶掉的那条路一个字节都不落地。
 * 造纹理之后再被顶掉是不可能的：从句柄比完到 `swap()` 之间没有 `await`。
 *
 * 不调用 `invalidate()`：`renderMode` 默认是 `always`，循环每帧都在画，
 * 改完 `scene` 下一帧就是新画面。
 */
async function show(faces: SkyboxFaces | null) {
  const mine = ++token

  if (!faces) {
    detach()
    return
  }

  const loaded = await Promise.all(
    // 空地址不发请求：它已经是一张确定拿不到的面，直接走兜底
    faces.map((url) => (url ? loader.loadAsync(url).catch(() => null) : null)),
  )

  if (mine !== token) return

  const images = skyboxPatchFaces(loaded)
  const group = groupOf(faces[0])

  if (!images) {
    warn(`天空盒「${group}」的六张面图一张都没拿到，背景与反射维持原样。`)
    return
  }

  const missing = faces.filter((_, index) => !loaded[index]).map(faceOf)
  if (missing.length) {
    warn(
      `天空盒「${group}」缺 ${missing.length} 张面图（${missing.join('、')}），` +
        '这几面补成了贴边纯色，整组照常生效。多半是服务器上没有这个文件，' +
        'Network 面板里能看到那几条 404。',
    )
  }

  const texture = new CubeTexture(images)
  // 自己造 `CubeTexture` 就得自己设色域，这一步原来是 `CubeTextureLoader` 代劳的
  texture.colorSpace = SRGBColorSpace
  // `Texture` 的构造函数自己已经把 `needsUpdate` 打上了（`three.core.js` 里
  // 构造函数最后一句），明写一遍是为了万一下次升级 three 改了那一句——
  // 那时这里的表现会是「天空盒不显示」而不是报错
  texture.needsUpdate = true
  swap(texture)
}

watch(() => props.skybox, show, { immediate: true })

// `token` 一起自增：卸载时可能还有六张图在飞，落地后不该再往 `scene` 上写
onUnmounted(() => {
  token++
  detach()
})
</script>

<!--
  没有模板内容：这个组件的产物全在 `scene` 上。

  空模板在 TresJS 的自定义渲染器里是安全的——`nodeOps.createComment` 造的那个
  记号节点会被 `insert` 收进父级的 `__tres.objects`，不像裸 `<template>` 那样
  把子节点挂到场景根上（DESIGN.md 设计决定 7 讲的正是那个坑）。
-->
<template />
