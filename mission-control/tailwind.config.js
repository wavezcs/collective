/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        borg: {
          bg:      '#0c0c15',
          surface: '#111120',
          panel:   '#17162a',
          border:  '#252342',
          accent:  '#9b87fa',
          dim:     '#74719c',
          muted:   '#9491b8',
          text:    '#eeeaf8',
          success: '#10b981',
          warning: '#facc15',
          danger:  '#f87171',
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'Consolas', 'monospace'],
      }
    }
  },
  plugins: []
}
