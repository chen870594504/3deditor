import { fileURLToPath, URL } from 'node:url'
import vue from '@vitejs/plugin-vue'
import templateCompilerOptions from '@tresjs/core/template-compiler-options'
import { defineConfig, loadEnv } from 'vite'
import dts from 'vite-plugin-dts'

/**
 * 开发期给远程模型资源起的同源前缀。
 *
 * **必须与 playground/composables/useModelLibrary.ts 里的 DEV_ASSET_PREFIX 一致**：
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
   * 把 ASSET_PROXY_PREFIX/** 转发到 .env 里那个地址，跨域就成了同源。
   * 目标地址现读 .env，换台服务器只改 .env，这里不用动。
   */
  const assetBase = loadEnv(mode, process.cwd(), 'VITE_').VITE_ASSE_IMAGE_URL
  const assetUrl = assetBase ? new URL(assetBase) : null
  /** 地址里的目录部分，重写代理路径时用它替换掉前缀 */
  const assetPath = assetUrl ? assetUrl.pathname.replace(/\/$/, '') : ''

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
      只有解析出地址才挂代理。.env 被清空时宁可不挂——挂一个转发到空地址的
      代理，报错会出现在网络层，比「干脆没有代理」更难查。
    */
    server: assetUrl
      ? {
          proxy: {
            [ASSET_PROXY_PREFIX]: {
              target: assetUrl.origin,
              // 不带这个，Host 会是 localhost:5173，nginx 按虚拟主机分流时会 404
              changeOrigin: true,
              // 前缀换成 .env 地址里的目录部分，后面的路径原样带过去
              rewrite: (path) =>
                path.startsWith(ASSET_PROXY_PREFIX)
                  ? assetPath + path.slice(ASSET_PROXY_PREFIX.length)
                  : path,
            },
          },
        }
      : undefined,
  }
})
