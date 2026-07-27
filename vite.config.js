import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// 打包目标:一个自包含的 dist/index.html —— 所有 JS(含 jszip)与 CSS 内联进单个文件。
// 这样才能双击(file://)直接运行:分离的 ES 模块在 file:// 下会被浏览器 CORS 拦截,
// 只有内联成 inline <script> 才可跑。base:'./' 保证任何引用都是相对路径。
export default defineConfig({
  base: './',
  // 开发端口:优先吃启动器分配的 PORT(多会话并行时 5173 可能被占),否则维持 5173。
  server: { port: Number(process.env.PORT) || 5173 },
  plugins: [viteSingleFile()],
  build: {
    target: 'es2020',
    // 全部内联,不切分 chunk / 不外抽 CSS,产物就一个 HTML。
    assetsInlineLimit: 100000000,
    chunkSizeWarningLimit: 100000000,
    cssCodeSplit: false,
  },
});
