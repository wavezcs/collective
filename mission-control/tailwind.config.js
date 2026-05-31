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
          green:   '#9b87fa',
          dim:     '#5c5a80',
          muted:   '#9491b8',
          text:    '#eeeaf8',
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
