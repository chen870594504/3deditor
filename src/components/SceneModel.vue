<script setup lang="ts">
import { watch } from 'vue'
import type { Ref } from 'vue'
import { useGLTF } from '@tresjs/cientos'
import { RepeatWrapping } from 'three'
import type { Material, Mesh, MeshStandardMaterial, Texture } from 'three'

defineOptions({ name: 'TdmSceneModel' })

const props = withDefaults(
  defineProps<{
    /** glTF / GLB 模型地址 */
    path: string
    /** 是否以线框模式渲染 */
    wireframe?: boolean
    /** 模型是否为 Draco 压缩格式 */
    draco?: boolean
    /** 模型是否投射阴影 */
    castShadow?: boolean
    /** 模型是否接收阴影 */
    receiveShadow?: boolean
    /**
     * 贴图在两个方向上重复几次 `(u, v)`。缺省即不重复——贴图照旧随几何被拉伸。
     *
     * 用途与「为什么不自动」写在 `ModelConfig.repeat` 上（那边是配置侧的解释），
     * 这里只说渲染侧的一条前提：**它要求资产的 UV 恰好铺满 0..1**，
     * 因为「重复几次」是直接写进贴图变换的，跟 UV 跨度无关——
     * UV 跨度不是 1 的资产，实际重复密度会被乘上那个跨度。
     */
    repeat?: [number, number]
  }>(),
  {
    wireframe: false,
    draco: false,
    castShadow: true,
    receiveShadow: true,
  },
)

const emit = defineEmits<{
  (e: 'loaded'): void
  (e: 'progress', percentage: number): void
  (e: 'error', message: string): void
}>()

/**
 * useGLTF 内部会自动发起加载，并在卸载或 path 变化时释放几何体与材质，
 * 所以这里既不需要自己做资源回收，也不用套 Suspense。
 */
const loader = useGLTF(props.path, { draco: props.draco })
const { state, isLoading } = loader

/**
 * cientos 给 useGLTF 标注的返回类型漏掉了 useAsyncState 的 error
 * 与 useLoader 的 progress，这两个字段在运行时确实存在
 * （见 @tresjs/core 中 useLoader 的实现）。
 * 这里显式收窄一次，只为拿到真实的错误信息和逐文件的加载进度。
 */
const extras = loader as unknown as {
  error?: Ref<Error | null>
  progress?: { loaded: number; total: number; percentage: number }
}

/**
 * 跟着几何一起被拉伸的那些贴图槽。
 *
 * 显式列名字、而不是遍历材质的所有属性去认 `isTexture`：材质上还挂着
 * `envMap`、`lightMap` 这类**不描述表面图案**的贴图，给它们设 `repeat`
 * 是错的（环境反射会跟着平铺，看起来像贴了一层墙纸）。
 *
 * 同一张贴图挂在两个槽上是常态——glTF 把金属度与粗糙度打包进同一张图，
 * GLTFLoader 按贴图下标缓存，两个槽拿到的是**同一个** `Texture` 实例，
 * 所以下面用一只 Set 去重，避免同一张贴图被设两遍。
 */
const REPEAT_SLOTS = [
  'map',
  'normalMap',
  'roughnessMap',
  'metalnessMap',
  'aoMap',
  'alphaMap',
  'emissiveMap',
  'bumpMap',
  'displacementMap',
  'specularMap',
] as const

/**
 * 把 `repeat` 写到模型自带的每张贴图上。
 *
 * 只改贴图、**不改几何**：几何该多大多大，图案自己重复，于是
 * 「一个模型拉伸铺满一块区域」时图案的实物尺寸不随区域大小变。
 *
 * 两处细节：
 *
 * - **重复次数变了不需要 `needsUpdate`**。贴图变换走的是 `texture.matrix`，
 *   而 three 在 `matrixAutoUpdate` 开着时每次绘制前会重算一遍，
 *   所以只改 `repeat` 是一次纯 CPU 的写入，不上传任何像素。
 * - **但换 wrap 需要**。`wrapS/wrapT` 是上传贴图时设置的采样参数，
 *   光改字段不会重新设进 GPU。所以只在真的要从别的模式换成 `RepeatWrapping`
 *   时才碰它、并顺手 bump 一次 `needsUpdate`——重复次数在拖动中会变，
 *   每次都 bump 就等于每帧重新上传一张 2K 贴图。
 *
 * 重复次数不是 1 就必须是 `RepeatWrapping`，否则采样会拖出最后一列像素
 * （一条拉长的条纹）。glTF 的默认值本来就是 `REPEAT`（这两件地板的
 * sampler 都没写），但那只是一种默认，不是保证。
 */
function applyTextureRepeat(material: Material) {
  const [u, v] = props.repeat ?? [1, 1]
  const seen = new Set<Texture>()

  for (const slot of REPEAT_SLOTS) {
    const texture = (material as unknown as Record<string, Texture | undefined>)[slot]
    if (!texture?.isTexture || seen.has(texture)) continue
    seen.add(texture)

    if (texture.repeat.x !== u || texture.repeat.y !== v) {
      texture.repeat.set(u, v)

      /*
        资产带 `KHR_texture_transform` 时，GLTFLoader 会把 `matrixAutoUpdate`
        关掉、改用那个扩展算好的矩阵。那时光改 `repeat` **不会生效**——没有
        任何人在重算那个矩阵。所以顺手把它打开：重算用的 offset / repeat /
        rotation / center 正是扩展自己写进去的那几个字段，重算一遍不丢东西。
        没有这个扩展的贴图本来就是 true，这一行是恒等的。
      */
      texture.matrixAutoUpdate = true
    }

    if (u !== 1 || v !== 1) {
      if (texture.wrapS !== RepeatWrapping || texture.wrapT !== RepeatWrapping) {
        texture.wrapS = RepeatWrapping
        texture.wrapT = RepeatWrapping
        texture.needsUpdate = true
      }
    }
  }
}

/**
 * 一次性把渲染设置刷到模型的所有网格上。
 *
 * 为什么必须自己遍历：three 的阴影是逐对象判定的，父级 Group 上的
 * castShadow 不会向下继承；而 TresJS 对 <primitive> 注入的对象不做任何
 * 遍历，写在 <primitive cast-shadow> 上的属性只会落到那个 Group 本身。
 *
 * 线框、阴影、贴图重复**共用这一个 traverse**，避免多遍遍历互相覆盖。
 */
function applySettings() {
  const gltf = state.value
  if (!gltf?.scene) return

  gltf.scene.traverse((object) => {
    const mesh = object as Mesh
    if (!mesh.isMesh) return

    const materials: Material[] = Array.isArray(mesh.material) ? mesh.material : [mesh.material]

    if (mesh.castShadow !== props.castShadow || mesh.receiveShadow !== props.receiveShadow) {
      mesh.castShadow = props.castShadow
      mesh.receiveShadow = props.receiveShadow

      /**
       * receiveShadow 参与 three 的着色器程序缓存键。
       * 只翻 flag 而不 bump version，材质有可能继续复用旧程序，
       * 表现就是「开了接收阴影但模型上什么都没有」。
       * 这里只在标记真的发生变化时才 bump，正常加载和拖动不会反复重编译。
       */
      materials.forEach((material) => {
        if (material) material.needsUpdate = true
      })
    }

    // glTF 的材质类型并不固定，用 `'wireframe' in material` 做能力探测，
    // 只改写真正支持线框的材质，避免误伤自定义 shader 材质。
    materials.forEach((material) => {
      if (material && 'wireframe' in material) {
        ;(material as MeshStandardMaterial).wireframe = props.wireframe
      }
    })

    /*
      贴图重复只对**支持透传贴图的材质**做（`map` 是个好判据：内置的
      MeshStandardMaterial / MeshPhysicalMaterial 都有，自定义 shader 材质没有）。
      这个能力探测与上面 wireframe 那条同一个路子。

      外层这个 `if` 判的是「**这次要不要管**」，不是「要不要把它改成 1」：
      没写 `repeat` 的模型（绝大多数）贴图压根不该被碰——资产自己带的
      `KHR_texture_transform` 也是一份 `repeat`，无条件写 1 会把它抹掉。
      至于「配过 repeat 后来又不要了」，在这份配置里到不了：`deepAssign`
      遇到补丁里没有的键是不动的（它不删键，只跳过 `undefined` 值），
      而历史与导入走的都是它，所以 `repeat` 一旦写进去就只会变成另一个数组，
      不会消失。

      `props.repeat` 用引用做依赖就够了：它来自配置里的三元组风格数组，
      而配置对这类字段是**整体替换**而不是逐项合并（`applyPatch` 的数组分支），
      所以每次写入都是一个新数组，引用一定变。
    */
    if (props.repeat) {
      materials.forEach((material) => {
        if (material && 'map' in material) applyTextureRepeat(material)
      })
    }
  })
}

// state 就绪后立即套用一次，之后跟随各项开关实时更新
watch(
  [state, () => props.wireframe, () => props.castShadow, () => props.receiveShadow, () => props.repeat],
  applySettings,
  { immediate: true },
)

// 加载结束且拿到场景对象才算成功，避免加载失败时误报 completed
watch(
  [isLoading, state],
  ([loading, gltf]) => {
    if (!loading && gltf) emit('loaded')
  },
  { immediate: true },
)

watch(
  () => extras.progress?.percentage ?? 0,
  (percentage) => emit('progress', Math.round(percentage)),
)

watch(
  () => extras.error?.value ?? null,
  (error) => {
    if (!error) return
    emit('error', error instanceof Error ? error.message : String(error))
  },
  { immediate: true },
)
</script>

<template>
  <primitive v-if="state" :object="state.scene" />
</template>
