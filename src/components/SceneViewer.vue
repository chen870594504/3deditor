<script setup lang="ts">
import { provide, useTemplateRef, watch } from 'vue'
import SceneCanvas from './SceneCanvas.vue'
import SceneEditor from '../editor/components/SceneEditor.vue'
import { EDITOR_ASSETS_KEY, useEditorAssets } from '../editor/assets'
import { useSceneStore } from '../stores/scene'
import {
  INSPECTOR_TAB_PREFIX,
  SIDE_TAB_PREFIX,
  panelSlotNames,
} from '../editor/utils/panelSlots'
import type {
  CameraChangePayload,
  DeepPartial,
  ModelPickPayload,
  ModelTransformPayload,
  ObjectClickPayload,
  SceneConfig,
  SceneViewerApi,
  SceneViewerProps,
} from '../types'

/*
  公开面。宿主只看得到这一个组件，`TdmSceneViewer` 这个全局名也归它。

  它按 `editable` 选一种形态渲染：

  - `true` → `SceneEditor`（三栏工作台，含左右栏与事件弹窗）
  - 其余 → `SceneCanvas`（纯画布；`false` 是四个开关全关的只读态，
    **不传**则走旧默认——内置工具栏还开着，那是 `editable` 出现之前的形状）

  两种形态共用同一块画布（`SceneCanvas`），所以 `defineExpose` 那 5 个方法
  与 12 个事件在哪种形态下都成立。区别只在「谁来喂画布那几个内部值」：
  画布态下面没有别人，走 `SceneCanvas` 自己的默认；编辑态由 `EditorStage` 喂
  （内置工具栏让位、手柄模式、相机过渡时长）。见 DESIGN.md 设计决定 47。
*/
defineOptions({ name: 'TdmSceneViewer' })

const props = withDefaults(defineProps<SceneViewerProps>(), {
  height: '480px',
  /*
    这两个必须是 `undefined`，不是可有可无的写法。

    `editable` 的类型是 `boolean`，而 Vue 对布尔 prop 有一条特例：**缺失且没有
    default 时转成 `false`**。于是「不传」会被当成「宿主说了 false」，旧默认那一支
    （内置工具栏还开着）就永远走不到——所有已发布宿主的内置工具栏会一起消失，
    而且不报错，只有肉眼看得出来。`default: undefined` 让 `hasDefault` 为真，
    跳过那次转换。

    详细后果与冒烟测试的落点写在 `SceneCanvas` 里那段注释上，两处守的是同一件事。
  */
  editable: undefined,
  autoRotate: false,
  draco: false,
  /*
    `initialScene` 也显式写 `undefined`：它没有合理的默认值，而「宿主到底传没传」
    本身就是要紧的——下面那个一次性 watcher 只在**第一次拿到非空值**时落笔。
  */
  initialScene: undefined,
})

/*
  事件与 `SceneCanvas` 完全一致，**一个不删**。它们是宿主已经在用的公开面，
  与方法那 5 条不同——方法可以按形态转发，事件是两条路都要接上的。
*/
const emit = defineEmits<{
  (e: 'loaded'): void
  (e: 'progress', percentage: number): void
  (e: 'error', message: string): void
  (e: 'cameraChange', payload: CameraChangePayload): void
  (e: 'objectClick', payload: ObjectClickPayload): void
  (e: 'objectDblclick', payload: ObjectClickPayload): void
  (e: 'objectPointerEnter', payload: ObjectClickPayload): void
  (e: 'objectPointerLeave', payload: ObjectClickPayload): void
  (e: 'objectContextMenu', payload: ObjectClickPayload): void
  (e: 'modelPick', payload: ModelPickPayload): void
  (e: 'modelTransform', payload: ModelTransformPayload): void
  (e: 'modelTransformEnd', payload: ModelTransformPayload): void
}>()

const scene = useSceneStore()

/*
  `autoRotate` 与 `draco` 是两条 prop → store 桥。它们与删掉的那些
  （`background` / `wireframe` / 分组配置…）的分别在于：

  - 它们不是「场景长什么样」的一部分，而是两个**开关**，宿主写一行就想要结果；
  - 更实际的一条：`draco` 只在「加模型」那一下有意义，宿主在 `addModel` 之前
    没有别的地方能表达它。

  `draco` 落在**当前选中项**上（库一贯的语义，与旧版逐字一致）：场景空着、
  没有选中项时它会什么都不做。要精确控制请用 `addModel(url, { draco: true })`。
*/
watch(() => props.autoRotate, (value) => { scene.autoRotate = value }, { immediate: true })
watch(() => props.draco, (value) => { scene.patchModel({ draco: value }) }, { immediate: true })

/**
 * `initialScene`：挂载时装载一份场景数据，**只装一次**。
 *
 * 用 watcher 而不是在 setup 里直接调一次，是为了覆盖「数据后到」：
 * 先渲染 `<SceneViewer :initial-scene="null" />`、拉到数据再赋值的写法必须能用。
 * 第一次拿到非空值之后 `applied` 置位，之后再赋值一律不再生效——这就是名字里
 * 那个 `initial` 的全部含义，也是它**不是**受控绑定的原因：父组件手里那份对象
 * 与 store 之间没有回流，用户在画布上改的东西不会被覆盖（编辑态下组件每帧写回
 * store，受控绑定根本没法工作）。
 *
 * **顺序要紧，不能挪到上面那两条 watch 之前。** `draco` 那条带着默认值 `false`
 * 立即跑一次 `patchModel({ draco: false })`；若 `initialScene` 先落笔，此刻
 * `models[0]` 已经存在，那一下会把整份场景里那个模型的 `draco: true` **静静抹掉**。
 * 排在这儿则是反过来：整份场景最后落笔，它自带的 `autoRotate` 与逐模型的 `draco`
 * 说了算——这就是那条已经发布的规则：「两者同时传时以 `initialScene` 为准」。
 *
 * 它写的是 store，而 store 是全局的，所以**不必**把这个 prop 往
 * `SceneEditor` / `EditorStage` / `SceneCanvas` 三层透传。
 */
let initialSceneApplied = false
watch(
  () => props.initialScene,
  (value) => {
    if (initialSceneApplied || !value) return
    initialSceneApplied = true
    scene.loadSceneData(value)
  },
  { immediate: true },
)

/**
 * 素材：把上面 inject 到的那一份**再 provide 一次**，带上 `assetBaseUrl` 的覆盖。
 *
 * ## 为什么在这一个组件里
 *
 * 它是唯一公开入口，也是左栏（`SceneEditor → SidePanel → ModelLibrary`，
 * 两个 `useLibrarySections()` 的调用点都在里面）唯一的祖先；素材本来就是靠
 * `inject` 到达左栏的，所以覆盖发生在这一层，**中间三层一行都不用动**。
 *
 * **必须无条件执行，不能塞进 `editable === true` 那一支。** setup 只跑一次，
 * 而编辑态 / 画布态是模板里的 `v-if`——把 provide 放进分支里，挂载时是画布态
 * 就永远补不回来了（setup 不会重跑），之后切到编辑态左栏会是一片空。
 *
 * 因为它在 setup 里、每个实例各做一次，同一页面上两个 `SceneViewer`、
 * 同一个进程里两个 SSR 请求各拿各的那份，互不串——这正是 `assets.ts` 那段
 * 「用 provide 不用模块级常量」要守的纪律，本次继续守着。
 */
const inheritedAssets = useEditorAssets()

provide(EDITOR_ASSETS_KEY, {
  /*
    带 getter 的**普通对象**，不是 `computed`、也不是 `reactive`。

    - **不能是 `computed`**：`useEditorAssets()` 的调用方（`useLibrarySections`）
      直接读 `assets.baseUrl`，而 `inject` **不解包 ref**——传一个 computed 下去，
      那边拿到的是个 ref 对象，`assets.baseUrl` 就成了 `undefined`，
      地址静默拼不出来，左栏整片 404 而不报错。
    - **不能是 `reactive`**：要包的那份（`DEFAULT_EDITOR_ASSETS`）是**冻结**的，
      而 Vue 对冻结对象做 `reactive()` 是 no-op——响应式直接失效，也不报错。
      而且它是模块级单例，深层代理过去会让一个实例的写入污染所有宿主。
      包装对象自己必须是可写的，所以只能自己建一个。

    getter 读的是 `props.assetBaseUrl`，因此吃到了 prop 的响应式。**但这一条
    只在下游也响应式时才成立**：`useLibrarySections` 里那句根地址归一化
    （`normalizeBase(assets.baseUrl)`）已经在 computed 里面——原先它在外面，
    是个潜伏的坑，本轮一并搬进去了（见那里的注释）。
  */
  get baseUrl() {
    return props.assetBaseUrl ?? inheritedAssets.baseUrl
  },
  categories: inheritedAssets.categories,
})

/**
 * 12 个事件逐条转发。
 *
 * 写成一张表而不是模板里排 12 条 `@x="emit('x', $event)"`：键名与 `defineEmits`
 * 的声明一一对应，漏一个就是少一行、在模板上看得见；排成 12 条模板属性时
 * 漏掉的那条只会表现为「宿主收不到某个事件」，而事件是**没有编译期检查**的。
 *
 * `v-on` 的对象形态会把键名转成 `onXxx`（Vue 的 `toHandlers`），正好与
 * `SceneCanvas` 声明的事件名对上。
 */
const forwarded = {
  loaded: () => emit('loaded'),
  progress: (percentage: number) => emit('progress', percentage),
  error: (message: string) => emit('error', message),
  cameraChange: (payload: CameraChangePayload) => emit('cameraChange', payload),
  objectClick: (payload: ObjectClickPayload) => emit('objectClick', payload),
  objectDblclick: (payload: ObjectClickPayload) => emit('objectDblclick', payload),
  objectPointerEnter: (payload: ObjectClickPayload) => emit('objectPointerEnter', payload),
  objectPointerLeave: (payload: ObjectClickPayload) => emit('objectPointerLeave', payload),
  objectContextMenu: (payload: ObjectClickPayload) => emit('objectContextMenu', payload),
  modelPick: (payload: ModelPickPayload) => emit('modelPick', payload),
  modelTransform: (payload: ModelTransformPayload) => emit('modelTransform', payload),
  modelTransformEnd: (payload: ModelTransformPayload) => emit('modelTransformEnd', payload),
}

/*
  两种形态各有一个模板引用，另外两个转发入口就完全同形。

  `api` 那个 computed 而不是在 `defineExpose` 里写 `editable ? … : …`：
  `defineExpose` 的对象在组件实例上是**静态**的一份（它的成员被逐条读，不重新求值），
  把条件写在字段里会让「切换形态后方法还指向旧那个」这类问题无从察觉；
  收成一个 computed 之后，5 个方法只有一处分支。
*/
const canvasRef = useTemplateRef<SceneViewerApi>('canvasRef')
const editorRef = useTemplateRef<SceneViewerApi>('editorRef')

function activeApi(): SceneViewerApi | null {
  return (props.editable === true ? editorRef.value : canvasRef.value) ?? null
}

/*
  5 个方法转发。三条要隔着画布问（`?? ` 兜底成「现在拿不到」，与原实现同值），
  另外两条落到 store：`getSceneData` 只读 store、**承诺不返回 `null`**；
  `loadSceneData` 的实现本来就在 store 里（`SceneCanvas` 那一层也只转发），
  所以画布没挂上时本组件自己调一次同样成立——**挂载前调也能用**。
  两条都让本组件自己兜底，好过把 `!` 压上去——那会在挂载前抛异常，
  比原来的行为更差。
*/
defineExpose<SceneViewerApi>({
  captureCamera: () => activeApi()?.captureCamera() ?? false,
  measureModel: (id) => activeApi()?.measureModel(id) ?? null,
  groundPointAt: (clientX, clientY) => activeApi()?.groundPointAt(clientX, clientY) ?? null,
  getSceneData: () => activeApi()?.getSceneData() ?? scene.exportConfig(),
  loadSceneData: (data: DeepPartial<SceneConfig>) =>
    activeApi()?.loadSceneData(data) ?? scene.loadSceneData(data),
})
</script>

<template>
  <!--
    编辑态：三栏工作台。`height` 照传——两种形态的根都是同一个高度契约，
    宿主写一次 `height="100%"` 在两种形态下都铺满。
  -->
  <SceneEditor
    v-if="editable === true"
    ref="editorRef"
    :height="height"
    :side-tabs="sideTabs"
    :inspector-tabs="inspectorTabs"
    v-on="forwarded"
  >
    <!--
      宿主页的内容透传下去。中间隔着本组件与 `SceneEditor` 两层，而插槽不会自己
      往下走——两层都要按前缀挑一遍再转（写法与理由见 `utils/panelSlots.ts`）。

      **只挑那两个前缀**，不做「除了 `#scene` 全转发」：后者会把右栏的插槽也塞进
      左栏，而多出来一个没被读到的插槽**不报错**。
    -->
    <template v-for="name in panelSlotNames($slots, SIDE_TAB_PREFIX)" #[name]="scope">
      <slot :name="name" v-bind="scope" />
    </template>
    <template v-for="name in panelSlotNames($slots, INSPECTOR_TAB_PREFIX)" #[name]="scope">
      <slot :name="name" v-bind="scope" />
    </template>

    <template #scene>
      <slot name="scene" />
    </template>
  </SceneEditor>

  <!--
    画布态：`editable` 原样转下去，`false` 与 `undefined` 在这一层是**两件事**
    （前者四个开关全关，后者走旧默认），所以这里只能传 `props.editable`，
    不能写成 `:editable="false"`。`v-bind` 传 `undefined` 时键仍在 rawProps 里，
    Vue 那条布尔特例不会启动。
  -->
  <SceneCanvas
    v-else
    ref="canvasRef"
    :height="height"
    :editable="editable"
    v-on="forwarded"
  >
    <!--
      `#scene` 透传给宿主。这一层必须是**具名插槽的 template**，
      不能是裸 `<template>`——后者会被 TresJS 的编译器当成字面量标签，
      子节点静默挂到 Scene 根上（见 SceneCanvas 里同一处注释）。
    -->
    <template #scene>
      <slot name="scene" />
    </template>
  </SceneCanvas>
</template>
