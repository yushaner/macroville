import { defineConfig } from 'vite';

// base: './' 让构建产物使用相对路径，可直接部署到 GitHub Pages 子路径。
export default defineConfig({
  base: './',
  server: {
    port: 5173,
    open: false,
  },
});
