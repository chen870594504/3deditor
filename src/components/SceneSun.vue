<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue'
import { Environment, Sky } from '@tresjs/cientos'
import { MathUtils, Vector3 } from 'three'
import type { DirectionalLight, Object3D } from 'three'
import type { EnvironmentPreset } from '../types'

defineOptions({ name: 'TdmSceneSun' })

/**
 * 这一层位于 TresCanvas 内部，只收 props、不访问 Pinia
 * （见 DESIGN.md「TD 层不使用 Pinia」）。
 */
const props = withDefaults(
  defineProps<{
    /** 是否渲染程序化天空 */
    showSky?: boolean
    /** 太阳高度角（度） */
    elevation?: number
    /** 太阳方位角（度） */
    azimuth?: number
    /** 大气浑浊度 */
    turbidity?: number
    /** 瑞利散射强度 */
    rayleigh?: number
    /** 米氏散射系数 */
    mieCoefficient?: number
    /** 米氏散射方向性 */
    mieDirectionalG?: number
    /** 环境光强度 */
    ambientIntensity?: number
    /** 主光强度 */
    keyIntensity?: number
    /** 补光强度 */
    fillIntensity?: number
    /** 环境贴图预设，空字符串表示不使用 */
    environment?: EnvironmentPreset | ''
    /**
     * 是否有天空盒在接管环境贴图。
     *
     * 只用来决定要不要渲染下面那个 `<Environment>`，与天空盒本身怎么加载无关
     * （那是 `SceneSkybox` 的事）。它存在的理由是**两个组件写的是同一个
     * `scene.environment`**：配置里同时有预设和天空盒时（手写的、或者从别处
     * 导入的 JSON 都可能是这样）两边都会去加载、都会去写，谁最后落地看网速。
     * 这里让天空盒无条件胜出，结果就是确定的。
     *
     * 编辑器那侧几乎走不到这个分支——左栏点天空盒时会把 `environment` 清成空串。
     * **只清这一个方向**：反方向（选环境贴图时清掉天空盒）原先在右栏那个下拉框里，
     * 那个下拉框已经删掉（见 DESIGN.md 设计决定 41），所以「宿主同时给了 environment
     * 与 skybox」现在是这份配置里唯一能造出冲突的写法。这一句就是给它兜底的，
     * 不是常态。
     */
    hasSkybox?: boolean
    /** 主光是否投射阴影 */
    castShadow?: boolean
    /** 阴影贴图分辨率 */
    shadowMapSize?: number
    /** 阴影偏移 */
    shadowBias?: number
    /** 法线方向偏移 */
    shadowNormalBias?: number
    /** 阴影正交相机的覆盖半径 */
    shadowCameraHalf?: number
    /**
     * 阴影正交相机的圆心（地面上的 `[x, z]`，世界坐标）。
     *
     * 主光是一只平行光，方向只由太阳角度决定；圆心决定的是**这只平行光
     * 朝哪儿照着投**——阴影贴图的盒子以它为中心。场景整体偏离原点时必须
     * 跟着挪（见 `utils/shadowBounds.ts`），否则盒子里一个模型都没有。
     */
    shadowTarget?: [number, number]
  }>(),
  {
    showSky: false,
    elevation: 48,
    /**
     * 与 `DEFAULT_SCENE_CONFIG.sun.azimuth` 保持一致（90°）。
     * 这里只是「配置里没写时」的兜底，两处不同会让同一个场景在
     * 「走配置」与「走组件默认值」时亮出不同的影子方向。
     */
    azimuth: 90,
    turbidity: 3.4,
    rayleigh: 3,
    mieCoefficient: 0.005,
    mieDirectionalG: 0.7,
    /** 与 `DEFAULT_SCENE_CONFIG.sun.ambientIntensity` 保持一致（0.9，理由在那边的注释里） */
    ambientIntensity: 0.9,
    keyIntensity: 2.2,
    fillIntensity: 0.7,
    environment: '',
    hasSkybox: false,
    castShadow: true,
    shadowMapSize: 1024,
    shadowBias: -0.0005,
    shadowNormalBias: 0.02,
    shadowCameraHalf: 12,
    shadowTarget: () => [0, 0],
  },
)

/**
 * 主光到圆心的距离，只影响灯的位置，不影响方向。
 *
 * 大场景里阴影相机半径可能到几十米，灯还贴在 12 米外的话，阴影相机的
 * 近裁剪面（0.5）离最远的模型太近、远裁剪面又得拉到很远；把灯放到
 * 「半径的 1.2 倍」之外，整只盒子就都落在灯前方，near/far 只用跟着半径走。
 */
const KEY_LIGHT_DISTANCE = 12

/** 补光固定放在主光的对立侧，避免和太阳方向联动后失去补光作用 */
const FILL_LIGHT_POSITION = new Vector3(-6, -3, -5)

/**
 * 主光到圆心有多远。
 *
 * 平行光的方向只由「位置 → target」决定，所以把这个距离放大**不会改变
 * 光线方向**，只让阴影相机站得更高、把整只盒子放进裁剪范围里。
 */
const keyLightDistance = computed(() =>
  Math.max(KEY_LIGHT_DISTANCE, props.shadowCameraHalf * 1.2),
)

/**
 * 阴影正交相机的远裁剪面。
 *
 * 覆盖半径变大之后固定 100 会切掉盒子的远端（模型仍在盒子里，
 * 但因为超出相机远平面而不产生深度，影子整片消失）。按「灯到圆心的距离 +
 * 圆的直径 + 余量」给，任何半径下都够。
 */
const shadowCameraFar = computed(() => keyLightDistance.value + props.shadowCameraHalf * 2 + 10)

/**
 * 主光方向由太阳角度推导，而不是写死一个坐标。
 *
 * 用和 cientos 的 Sky 完全相同的球坐标公式，天空里的太阳和投影方向才对得上；
 * 否则调了高度角会看到"太阳在这里、影子朝那边"。
 *
 * 位置 = 圆心 + 方向 × 距离。**方向那一项与圆心无关**：把圆心挪到场景中心
 * 只是让阴影相机照着那里，太阳的高度角与方位角读出来还是配置里那两个数。
 */
const keyLightPosition = computed(() =>
  new Vector3()
    .setFromSphericalCoords(
      1,
      MathUtils.degToRad(90 - props.elevation),
      MathUtils.degToRad(props.azimuth),
    )
    .multiplyScalar(keyLightDistance.value)
    .add(new Vector3(props.shadowTarget[0], 0, props.shadowTarget[1])),
)

/**
 * 主光注视的那只空 Object3D。
 *
 * `DirectionalLight` 的方向永远是「位置 → target」，而 target 默认是
 * `new Object3D()`、**不在场景图里**：不给它一个能更新世界矩阵的落点，
 * 改了位置也不生效。这里是模板里那只 `<TresObject3D>` 的引用，
 * 下面那个 watcher 把它交给灯的 `target`。
 */
const keyTarget = shallowRef<Object3D | null>(null)

/**
 * 用 `shallowRef` + 同名的模板 ref 属性，不用 `useTemplateRef`。
 *
 * `useTemplateRef` 返回 `readonly(shallowRef(null))`，而 readonly 是深层的：
 * 读 `.value` 得到的是光源的只读代理，`light.shadow.map = null` 会被静默丢弃、
 * `light.shadow.camera.updateProjectionMatrix()` 一个数都写不进去
 * （dev 下逐元素报 `Set operation on key ... failed: target is readonly`）。
 * 这两条命令式写入正是本组件必须拿到裸对象的原因，所以这里必须是裸对象。
 * 名字要与模板上的 `ref="keyLight"` 逐字相同。
 */
const keyLight = shallowRef<DirectionalLight | null>(null)

/** 主光注视点的位置（只在地面上，`y = 0`） */
const keyTargetPosition = computed(
  () => new Vector3(props.shadowTarget[0], 0, props.shadowTarget[1]),
)

/**
 * 把注视点交给主光。
 *
 * 两边都是模板 ref，谁先挂上说不准，所以放在一个 watcher 里等两边都就位。
 * 没有这一步时 `<TresObject3D>` 只是一个躺在场景里不动的空节点，
 * 主光仍盯着默认的原点——大场景里阴影相机整个偏到一边去。
 */
watch(
  [keyLight, keyTarget],
  () => {
    const light = keyLight.value
    const target = keyTarget.value
    if (!light || !target) return
    light.target = target
  },
  { immediate: true },
)

/**
 * 两处 three 不会自动帮我们做的事，必须手动补：
 *
 * 1. 运行期改 shadow.mapSize 只是改了期望值，WebGL 的 render target
 *    仅在 shadow.map 为 null 时才会重建，所以要显式释放一次。
 * 2. shadow.camera.* 写进去之后不会自动重算投影矩阵——TresJS 只在
 *    node 本身是相机时才调 updateProjectionMatrix，而这里是 Light。
 */
watch(
  () => props.shadowMapSize,
  () => {
    const light = keyLight.value
    if (!light) return
    light.shadow.map?.dispose()
    light.shadow.map = null
  },
)

watch(
  [keyLight, () => props.shadowCameraHalf],
  () => {
    const light = keyLight.value
    if (!light) return
    light.shadow.camera.updateProjectionMatrix()
  },
  { immediate: true },
)
</script>

<template>
  <!-- 程序化天空。注意 Sky 的材质是 three-stdlib 的模块级单例，全场景只能有一个 -->
  <Sky
    v-if="showSky"
    :elevation="elevation"
    :azimuth="azimuth"
    :turbidity="turbidity"
    :rayleigh="rayleigh"
    :mie-coefficient="mieCoefficient"
    :mie-directional-g="mieDirectionalG"
  />

  <!--
    环境贴图只影响 scene.environment（反射），不会覆盖背景色。

    天空盒开着时这一条整个不渲染（理由见 `hasSkybox` 的注释）：两个都渲染的话
    它们会抢同一个 scene.environment，而且各自都会真的去拉一张贴图。
  -->
  <Environment v-if="environment && !hasSkybox" :preset="environment" />

  <TresAmbientLight :intensity="ambientIntensity" />

  <!--
    主光注视的空节点。它必须在场景图里：`DirectionalLight.target` 的默认值
    **不在场景里**，位置改了也不会有人更新它的世界矩阵。
  -->
  <TresObject3D ref="keyTarget" :position="keyTargetPosition" />

  <TresDirectionalLight
    ref="keyLight"
    :position="keyLightPosition"
    :intensity="keyIntensity"
    :cast-shadow="castShadow"
    :shadow-mapSize-width="shadowMapSize"
    :shadow-mapSize-height="shadowMapSize"
    :shadow-bias="shadowBias"
    :shadow-normalBias="shadowNormalBias"
    :shadow-camera-left="-shadowCameraHalf"
    :shadow-camera-right="shadowCameraHalf"
    :shadow-camera-top="shadowCameraHalf"
    :shadow-camera-bottom="-shadowCameraHalf"
    :shadow-camera-near="0.5"
    :shadow-camera-far="shadowCameraFar"
  />

  <TresDirectionalLight :position="FILL_LIGHT_POSITION" :intensity="fillIntensity" />
</template>
