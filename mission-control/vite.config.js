import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://collective.csdyn.com:8642',
      '/projects': 'http://collective.csdyn.com:3002',
    }
  }
})
