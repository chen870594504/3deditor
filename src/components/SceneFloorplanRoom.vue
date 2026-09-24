<script setup lang="ts">
import { computed } from 'vue'
import { DoubleSide, Euler, Shape, Vector3 } from 'three'
import { polygonCenter } from '../utils/floorplan'
import { createLabelTexture, labelTextureAspect } from '../utils/labelTexture'
import type { FloorplanRoom } from '../types'

defineOptions({ name: 'TdmSceneFloorplanRoom' })

/**
 * 一个房间：地面色块 + 悬浮的房间名。
 *
 * 这一层位于 TresCanvas 内部，只收 props、不访问 Pinia
 * （见 README「TD 层不使用 Pinia」）。
 *
 * 多边形是「点封闭区域」那一刻算出来的**快照**（见 `FloorplanRoom` 的注释），
 * 之后不随墙变动，所以这里也不需要在墙变化时重算什么。
 */
const props = defineProps<{
  room: FloorplanRoom
}>()

/**
 * 色块离地面的高度。
 *
 * 要同时躲开两样东西：网格线在 `y = 0`，地基板顶面在 `y = 0.005`。
 * 压在任一层上都分不出谁在前，从正上方（2D 档）看就是一片闪烁。
 * 3.5 厘米在俯视图里完全看不出「浮着」，但足够让深度缓冲分得清。
 *
 * 这个「足够」是有字面依据的，不是估的：2D 档相机在 110 米高，`near = 0.1` /
 * `far = 200` 下深度缓冲在那里约每 7 毫米一个单位（算法见
 * `SceneFloorplanFoundation.vue` 的 `TOP_GAP`），色块离板顶 30 毫米就是
 * 4 个出头的单位。**地基板自己还带 `-2` 个单位的 `polygonOffset`**（它要靠
 * 这个压住网格），扣掉之后这里仍有 2 个单位——这就是不能再往下调的原因。
 */
const FLOOR_Y = 0.035

/** 房间名悬浮的高度。取墙高的一半：3D 里从墙外斜看过去不会被墙顶盖住 */
const LABEL_Y = 1.4

/**
 * 房间名在屏幕上的大小（`sizeAttenuation: false`，见模板那段注释）。
 *
 * 是**屏幕比例**而不是世界尺寸，所以与相机远近无关。
 * 这是个只能靠眼睛定的数：太小在俯视里读不出，太大在近处糊满屏。
 */
const LABEL_HEIGHT = 0.06

/**
 * 放平多边形的旋转。
 *
 * 多边形存的是 `[x, z]`，喂给 `Shape` 时第二个分量当**局部 y** 用，
 * 于是需要一个把「局部的 (x, y)」映到「世界的 (x, z)」的旋转。
 *
 * three 的 `makeRotationX(θ)` 是 `y' = cosθ·y − sinθ·z`、`z' = sinθ·y + cosθ·z`，
 * 局部点是 `(x, y, 0)`，代入 `θ = +π/2`（cos 0、sin 1）得到世界 `(x, 0, y)`——
 * 存进去的 z 原样变成世界的 z。用 `−π/2` 的话 z 被取反，整个房间沿 z 镜像、
 * 与墙错开，而且不报任何错。
 *
 * 顺带一个后果：这个旋转把面法线从 `+z` 转到了 `(0, −1, 0)`，也就是**朝下**，
 * 所以材质必须 `DoubleSide`（不靠绕序决定正面）。
 *
 * 写成 `Euler` 而不是数组：TresJS 的全局组件类型把 `rotation` 标注成严格的
 * three 对象（`SceneContent.vue:97-99` 有完整说明）。放在模块作用域是为了
 * **引用恒定**——它一辈子只该是这一只对象，不像位置那样需要重算。
 */
const FLAT_ROTATION = new Euler(Math.PI / 2, 0, 0)

const hasArea = computed(() => props.room.polygon.length >= 3)

/**
 * `ShapeGeometry` 的构造参数。
 *
 * 只有一个元素（`curveSegments` 用默认值）：这里的轮廓全是直线段，
 * 那 12 段细分是给曲线用的，对我们完全不起作用。
 *
 * args 装在一个 computed 里，是为了**引用稳定**——TresJS 在 args 换引用时
 * 会重建几何体（`SceneGround.vue:54-60` 的注释是这条约定的出处）。
 *
 * 顶点用的是**世界坐标**（多边形就是这么存的），所以摆它的网格 x / z 必须是 0，
 * 否则整个房间会被平移两遍——见 `FLOOR_POSITION`。
 */
const geometryArgs = computed<[Shape]>(() => {
  const shape = new Shape()
  props.room.polygon.forEach(([x, z], index) => {
    if (index === 0) shape.moveTo(x, z)
    else shape.lineTo(x, z)
  })
  shape.closePath()
  return [shape]
})

/**
 * 色块的位置。
 *
 * **x / z 恒为 0 是刻意的，不是漏填。** 多边形存的就是世界坐标
 * （`findEnclosedArea` 返回的是 `格号 × CELL_SIZE`，见 `floorplan.ts:801-804`），
 * 而 `Shape` 拿它当**几何体的局部坐标**用——两套坐标同源，于是这块面片在网格
 * 坐标系里本来就在正确的位置上，网格一动不动。
 *
 * 这里踩过一脚，写下来免得再犯：最初网格摆的是 `polygonCenter`，
 * 「多边形已是世界坐标」与「网格又平移一次」叠在一起，等于把整个房间
 * **又挪了一个形心矢量**——房间离原点越远偏得越多。而房间名走的是另一条路
 * （世界坐标直接摆 `Sprite`），所以表现出来的正是「色块偏了、字是准的」。
 * 参考项目 `sceneRenderer.js:109-118` 只写 `position.y`，也是同一个道理。
 *
 * 写成模块常量而不是 `computed`：它一辈子只有一个值，不需要跟着配置重算。
 * `Vector3` 而不是数组，照 `SceneModelNode.vue:74-76` 的先例
 * （`SceneContent.vue:97-99` 解释了为什么数组在类型上不接受）。
 */
const FLOOR_POSITION = new Vector3(0, FLOOR_Y, 0)

/**
 * 形心。**只给房间名用**——色块用的是自己的局部坐标（见 `FLOOR_POSITION`）。
 *
 * `Vector3` 而不是数组（同上），而且每次重算返回**新实例**是必要的：
 * TresJS 按引用比较，原地改同一只会被当成「没变」。
 */
const labelPosition = computed(() => {
  const center = polygonCenter(props.room.polygon)
  return new Vector3(center[0], LABEL_Y, center[1])
})

/**
 * 房间名贴图。
 *
 * 没有 DOM 时 `createLabelTexture` 返回 `null`（库会被 `renderToString`
 * 跑一遍，那时没有 document），模板里的 `v-if` 于是整个跳过标签——
 * 少一个房间名，而不是让整棵场景渲染不出来。
 */
const labelMap = computed(() => (hasArea.value ? createLabelTexture(props.room.name) : null))

/**
 * 标签的缩放。
 *
 * **宽度按贴图的实际宽高比算**，否则中英文混排的长短名会被拉成同一个宽度，
 * 字就扁了。
 */
const labelScale = computed(
  () => new Vector3(LABEL_HEIGHT * labelTextureAspect(labelMap.value), LABEL_HEIGHT, 1),
)
</script>

<template>
  <!--
    地面色块。

    位置只动 y（见 `FLOOR_POSITION`）：多边形的坐标就是世界坐标，x / z 必须留在 0。

    半透明（0.55）而不是实心：房间是「被标记出来的区域」，透出底下的地基与网格
    才读得出这一层是标注。实心色块在俯视图里会像一块贴纸，反而看不出与墙的关系。
    深度写入保持默认的开启——这是一个平铺在地面上的孤立面片，
    关掉只会让它与其它半透明物体排错顺序。

    单独一个 v-if：少于三个点的多边形三角化不出任何东西，
    ShapeGeometry 会给出空几何体或直接报错。
  -->
  <TresMesh v-if="hasArea" :position="FLOOR_POSITION" :rotation="FLAT_ROTATION">
    <TresShapeGeometry :args="geometryArgs" />
    <TresMeshStandardMaterial
      :color="room.color"
      :side="DoubleSide"
      :roughness="0.9"
      :metalness="0"
      :opacity="0.55"
      transparent
    />
  </TresMesh>

  <!--
    房间名。

    用 Sprite 而不是贴在房间地面上的平面：Sprite 永远正对相机，俯视（2D 档，
    也就是这套东西的主场）与斜视（3D 档）下都正着读，不需要为每个机位
    各调一次朝向。

    `size-attenuation` 关掉是**刻意的**：开着的话标签的世界尺寸固定，
    而 2D 档的相机在 110 米高（见 useViewMode 的 TOP_DISTANCE），
    一个看得清的世界尺寸到近处会糊满整屏；关掉之后标签是**屏幕比例**，
    远近一样大——这正是地图标注要的行为。
    代价是房间里多的时候标签不会随距离缩小，可能挤在一起。

    贴图周围是透明的，所以必须 `transparent`，否则透明区会渲染成黑色。
  -->
  <TresSprite v-if="labelMap" :position="labelPosition" :scale="labelScale">
    <TresSpriteMaterial
      :map="labelMap"
      :size-attenuation="false"
      :depth-test="true"
      transparent
    />
  </TresSprite>
</template>
