import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://2b.csdyn.com:8642',
      '/projects': 'http://2b.csdyn.com:3002',
      '/meals': 'http://2b.csdyn.com:3003',
    }
  }
})
