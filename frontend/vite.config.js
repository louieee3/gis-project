import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const rootDir = fileURLToPath(new URL('.', import.meta.url))
  // 根据当前工作目录中的 `mode` 加载 .env 文件
  // 设置第三个参数为 '' 来加载所有环境变量，而不管是否有 `VITE_` 前缀。
  const env = loadEnv(mode, rootDir, '')
  return {
    plugins: [react()],
    server: {
      proxy: {
        // 字符串简写写法
        '/api': {
          target: env.VITE_API_BASE_URL,
          changeOrigin: true,
          // rewrite: (path) => path.replace(/^\/api/, '')
        },
      }
    }
  }
})
