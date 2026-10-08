import { fileURLToPath, URL } from 'node:url'
import vue from '@vitejs/plugin-vue'
import templateCompilerOptions from '@tresjs/core/template-compiler-options'
import { defineConfig, loadEnv } from 'vite'
import dts from 'vite-plugin-dts'
import { DEFAULT_ASSET_BASE_URL } from './src/editor/defaultAssets'

/**
 * 开发期给远程模型资源起的同源前缀。
 *
 * **必须与 playground/utils/editorAssets.ts 里的 DEV_ASSET_PREFIX 一致**：
 * 只改一边的话，列表里的地址代理不到，表现是清一色的加载失败。
 */
const ASSET_PROXY_PREFIX = '/3d-assets'

/**
 * 这些包必须由宿主应用提供，不打进产物：
 * - vue / three：出现两份实例会直接导致响应式与 WebGL 上下文失效
 * - pinia：宿主已有时复用其实例，打进产物反而造成状态分裂
 * - @tresjs/*：内部同样强依赖单份 three 与 vue
 */
const EXTERNAL = [
  'vue',
  'three',
  'pinia',
  '@tresjs/core',
  '@tresjs/cientos',
]

const isExternal = (id: string) =>
  EXTERNAL.some((dep) => id === dep || id.startsWith(`${dep}/`))

export default defineConfig(({ mode }) => {
  const isLib = mode === 'lib'

  /**
   * 远程模型资源的开发期代理。
   *
   * 那台服务器不发 Access-Control-Allow-Origin，而 three 的 GLTFLoader 走的是
   * fetch——响应其实已经完整到手，是浏览器在交给 JS 之前把它丢掉的，于是模型
   * 必然加载失败。注意同一目录下的缩略图反而是好的：<img> 不受 CORS 约束。
   * 一个同源一个跨域，很容易被误判成「地址写错了」。
   *
   * 把 ASSET_PROXY_PREFIX/** 转发到下面那个地址，跨域就成了同源。
   *
   * 目标地址现读 .env（`VITE_ASSE_IMAGE_URL`），读不到就退到**库内置那个默认**。
   * 于是「换台服务器」只有一处要改：改 `src/editor/defaultAssets.ts` 的
   * `DEFAULT_ASSET_BASE_URL` 就够，`.env` 从「源」降级成「覆盖」
   * （想临时指到别的服务器、又不改库里的默认值时，才去动它）。
   */
  const assetBase =
    loadEnv(mode, process.cwd(), 'VITE_').VITE_ASSE_IMAGE_URL || DEFAULT_ASSET_BASE_URL
  const assetUrl = new URL(assetBase)
  /** 地址里的目录部分，重写代理路径时用它替换掉前缀 */
  const assetPath = assetUrl.pathname.replace(/\/$/, '')

  return {
    plugins: [
      /**
       * TresJS 的 <TresXxx> 是自定义渲染器里的元素，不是 Vue 组件。
       * 不告诉编译器这一点，每个标签都会走一次 resolveComponent，
       * dev 控制台会被「Failed to resolve component」刷满。
       */
      vue({ ...templateCompilerOptions }),
      ...(isLib
        ? [
            dts({
              tsconfigPath: './tsconfig.json',
              include: ['src/**/*.ts', 'src/**/*.vue'],
              exclude: ['playground/**/*', 'src/**/*.test.ts'],
              entryRoot: 'src',
              outDirs: ['dist'],
              insertTypesEntry: true,
            }),
          ]
        : []),
    ],
    resolve: {
      alias: {
        '~': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    build: isLib
      ? {
          lib: {
            entry: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
            name: 'ThreeDMaker',
            formats: ['es', 'cjs'],
            fileName: (format) => (format === 'es' ? 'index.js' : 'index.cjs'),
          },
          cssCodeSplit: false,
          sourcemap: true,
          // 库产物保持可读，压缩交给宿主应用的构建流程
          minify: false,
          rollupOptions: {
            external: isExternal,
            output: {
              exports: 'named',
              assetFileNames: 'style.css',
            },
          },
        }
      : undefined,
    /*
      代理**恒挂着**：目标地址读不到 .env 时退到库内置那个默认，
      两处都不是空，所以不存在「转发到一个空地址」这件事。
      真要不挂，那得先把 `DEFAULT_ASSET_BASE_URL` 改成空——而它不是个空字符串
      能表达的状态（`new URL('')` 会直接抛）。
    */
    server: {
      proxy: {
        [ASSET_PROXY_PREFIX]: {
          target: assetUrl.origin,
          // 不带这个，Host 会是 localhost:5173，nginx 按虚拟主机分流时会 404
          changeOrigin: true,
          // 前缀换成地址里的目录部分，后面的路径原样带过去
          rewrite: (path) =>
            path.startsWith(ASSET_PROXY_PREFIX)
              ? assetPath + path.slice(ASSET_PROXY_PREFIX.length)
              : path,
        },
      },
    },
  }
})
