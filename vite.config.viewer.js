import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { resolve } from 'path';

// viewer.html 的独立单文件构建(vite-plugin-singlefile 明确不支持多入口,
// 见其 README —— 所以主应用与 3D 预览器各构建一次,产物并排放进 dist)。
// emptyOutDir:false 保住第一步构建出的 dist/index.html。
export default defineConfig({
  base: './',
  plugins: [viteSingleFile()],
  build: {
    target: 'es2020',
    emptyOutDir: false,
    assetsInlineLimit: 100000000,
    chunkSizeWarningLimit: 100000000,
    cssCodeSplit: false,
    rollupOptions: { input: resolve(__dirname, 'viewer.html') },
  },
});
