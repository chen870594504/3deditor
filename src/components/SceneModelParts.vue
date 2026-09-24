<script setup lang="ts">
import { computed } from 'vue'
import { Euler, Vector3 } from 'three'
import { placeModelParts, parseModelParts } from '../utils/modelParts'

defineOptions({ name: 'TdmSceneModelParts' })

/**
 * 由一段 JSON 零件表**程序生成**的几何体（`ModelConfig.partsJson`）。
 *
 * 它只做一件事：把 `partsJson` 读成一件件几何体摆出来。位置 / 朝向 / 参数表的
 * 算术**一条都不在这里**（全在 `utils/modelParts.ts`），这个文件因此薄到只有
 * 一层 `v-for`——这条分界是要紧的：算术在那边能被冒烟测试跑，写在这里就只能靠眼睛。
 *
 * ## 为什么它是一个独立组件、而不是在 SceneModelNode 里铺一层 v-for
 *
 * 与 `SceneModel` 分成一个组件的理由不同（那边是为了 glTF 的加载状态），这里是
 * 为了让 `SceneModelNode` 的模板继续只回答「这个模型用哪条路渲染」——
 * 三条分支各自是一行标签，插进来的这一条不该把 30 行 v-for 塞进那个判断里。
 *
 * ## 挂在包裹组内层，所以选中 / 手柄 / 历史 / 导出全都是白拿的
 *
 * `SceneModelNode` 里那只 `TresGroup` **永远渲染**，`v-if` 只在它内部挑一条分支。
 * 于是这里画出来的每一件都在那只组底下，也就自动进了：
 *
 * - `registerModelNode` 的登记（选中靠 `model.id`，与渲染的是 glTF 还是几何体无关）
 * - `ScenePicker` 的 raycast、包围框、变换手柄与写回
 * - `measure`（包围盒量的是那只组，程序生成的几何体照样量得出来）
 * - 历史与导出（它们看的是 `config.models`，而这一条就在里面）
 *
 * 反过来说，**不能**用 `SceneViewer` 的 `#scene` 插槽实现这件事：插槽内容在
 * `SceneContent` 之外，上面四样一样都拿不到——画得出来，但点不中、没有手柄、
 * 不进配置。那是「看起来对了」里最费时间的一种。
 *
 * ## `wireframe` 与阴影逐件传，没有继承这回事
 *
 * three 的 `castShadow` / `receiveShadow` 落在**每个 Mesh 自己身上**，
 * 材质只继承颜色那一路。所以这两个开关与 `wireframe` 都必须逐件传下去，
 * 与 `SceneModelNode` 里那只内置几何体是一致的写法。
 */
const props = defineProps<{
  /** 一段 JSON 文本，原样来自 `ModelConfig.partsJson` */
  json: string
  wireframe: boolean
  /** 与 `SceneModelNode` 的 castShadow 同一个值：场景总闸 AND 物体级开关 */
  castShadow: boolean
  receiveShadow: boolean
}>()

/**
 * 已报过的问题，去重粒度是**这条消息本身**（含地址与原因）。
 * 与 `SceneFloorplanOpeningModel` 的 `WARNED` 是同一套。
 *
 * 模块级而不是组件级：同一份坏零件表挂在两个模型上时，
 * 两处各报一句会让人以为是两个问题。
 */
const WARNED = new Set<string>()

/**
 * 展开之后的几何体，**读不出来时是空数组**（于是什么都不画）。
 *
 * 为什么在渲染端还要再读一遍（左栏追加之前已经读过一次、读不出来就不追加）：
 * 配置可以从别处来——导入一份 JSON、宿主自己拼一份、手改一下。那时候左栏那道
 * 校验根本没经过，而这里读不出来只会得到一片空白，没有任何地方会说话。
 * 所以这一遍不只是解析，它还负责**把问题说出来**（见下面）。
 *
 * 解析结果**不缓存**在组件状态里：`computed` 自己就缓存，且它的依赖只有
 * `props.json` 一个字符串，换一段 JSON 才重算一次。这与 `SceneModel` 那边
 * 要为异步加载专门维护一份状态完全不同——这边是纯算术，同步的。
 */
const placed = computed(() => {
  const result = parseModelParts(props.json)
  report(result.problem, result.dropped)
  return placeModelParts(result.parts)
})

/**
 * 把「数字元组」换成 three 的对象，逐件一份。
 *
 * 必须换：`<TresMesh :position>` 的类型是 `Vector3`（`WithMathProps` 把 three 的
 * 数学类属性换成了数学类本身），一个三元组在那边是编译错误。这与
 * `SceneModelNode.vue` 里 `new Vector3().fromArray(props.model.position)` 是同一件事，
 * 那边换的是配置里那三个数，这边换的是算出来的三个数。
 *
 * **逐件新建而不是共用一个再 `set`**：TresJS 会把这些对象接过去当物体自己的
 * `position` / `rotation`（不是拷贝），共用一份就是所有零件钉在同一个位置上——
 * 画面上是「叠在一起的一堆零件」，而且拖动其中任何一个都会带着其余的一起动。
 *
 * 换出来的对象**不进 `placeModelParts`**：那边是纯函数、要留给冒烟测试与宿主，
 * 吐的必须是能 JSON 往返的数字。这一层转换是纯粹的渲染层职责。
 */
const spots = computed(() =>
  placed.value.map((part) => ({
    ...part,
    position: new Vector3().fromArray(part.position),
    rotation: new Euler().fromArray(part.rotation),
  })),
)

/**
 * 读零件表时遇到问题就往控制台说一句。
 *
 * 两种都不吵：整份读不出来（`problem`）、以及逐件剔掉了一些（`dropped`）。
 * 后者也要说话——「11 件画出来 8 件」在画面上是一个**看起来正常**的东西，
 * 少的那三件没有任何视觉线索，不说就永远查不到。
 *
 * 前缀用 `3deditor:` 而不是 `[tdm]`：那个前缀是给**编辑器界面**的日志用的
 * （`useEditorState` 的 `pushEvent`），而这句话是**库**在报告一件渲染不了的东西，
 * 宿主自己的控制台里也该一眼认出来是谁说的。
 */
function report(problem: string | null, dropped: number): void {
  const text = problem
    ? `模型没有画出来：${problem}`
    : dropped > 0
      ? `零件表里有 ${dropped} 件读不出来（形状认不出、尺寸不是正数、或 count 超上限），已经跳过——其余的照画。`
      : ''

  if (!text) return
  if (WARNED.has(text)) return
  WARNED.add(text)
  console.warn(`3deditor: ${text}`)
}
</script>

<template>
  <!--
    一层组都没有：外面那只包裹组已经把 position / rotation / scale / visible
    都管住了（`SceneModelNode`），这里再加一层只会多一个恒等变换的节点，
    而调试器里看见的是「模型 → 组 → 组 → 网格」四层里的空组。

    逐件一个 mesh，**不做几何合并**：同一件零件的每一份材质可能都不同
    （`color` / `metalness` / `roughness` 逐件给），合并要按材质分桶再各自 merge，
    一把椅子 19 个 draw call 对一个室内场景是零头，不值得为它引一套合并的算术。
  -->
  <TresMesh v-for="part in spots" :key="part.key" :position="part.position" :rotation="part.rotation"
    :cast-shadow="castShadow" :receive-shadow="receiveShadow">
    <!-- 两条几何体分支由 shape 收窄；参数表的元组形状跟着一起收窄，见 PlacedPart -->
    <TresBoxGeometry v-if="part.shape === 'box'" :args="part.geometryArgs" />
    <TresCylinderGeometry v-else :args="part.geometryArgs" />

    <TresMeshStandardMaterial :color="part.color" :metalness="part.metalness" :roughness="part.roughness"
      :wireframe="wireframe" />
  </TresMesh>
</template>
