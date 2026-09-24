/// <reference types="vite/client" />

// 让 TS 认识 .vue 单文件组件，同时把组件实例类型暴露给模板
declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>
  export default component
}

/*
  vite/client 自带的 ImportMetaEnv 有一个 `[key: string]: any` 索引签名，
  所以下面这条不加也能过编译——加它是为了让键名写错能被 tsc 抓出来，
  并给这个地址留一处说明。

  注意键名里的 `ASSE` 是照 .env 里的原样写的（那边少了一个 R）。
  playground 侧在 useModelLibrary 里读它，两处必须一起改。
*/
interface ImportMetaEnv {
  /** 模型资源服务器的目录地址，供 playground 的模型库拼接文件名 */
  readonly VITE_ASSE_IMAGE_URL?: string
}
