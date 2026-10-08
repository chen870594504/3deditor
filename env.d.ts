/// <reference types="vite/client" />

// 让 TS 认识 .vue 单文件组件，同时把组件实例类型暴露给模板
declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>
  export default component
}

/*
  这里原先还有一条 `ImportMetaEnv` 的增强，给 `VITE_ASSE_IMAGE_URL` 声明类型、
  防键名写错。**它撤掉了**：键名里那个 `ASSE`（少一个 R）如今只在 `.env` 与
  `vite.config.ts` 里出现一次，而那边是用 `loadEnv()` 按字符串取值的，
  根本没有 `import.meta.env.VITE_ASSE_IMAGE_URL` 这个读点，增强也就没有对象。

  地址的默认值在 `src/editor/defaultAssets.ts` 的 `DEFAULT_ASSET_BASE_URL`，
  `.env` 只是它的覆盖项。详见 CLAUDE.md 的硬性约束 6。
*/
