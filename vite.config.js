import { defineConfig } from 'vite';

// GitHub Pages 專案站台會位於 /<repo>/ 子路徑。
// 用環境變數 BASE 覆寫（GitHub Actions 會帶入），本地預設 './' 相對路徑。
export default defineConfig({
  base: process.env.BASE || './',
  build: {
    target: 'es2020',
    outDir: 'dist',
  },
});
