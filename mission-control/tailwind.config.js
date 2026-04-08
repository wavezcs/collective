/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        borg: {
          bg:      '#090b0f',
          surface: '#0d1117',
          panel:   '#111820',
          border:  '#1c2433',
          green:   '#00e5cc',
          dim:     '#4a6080',
          muted:   '#6b80a0',
          text:    '#dde8f0',
        }
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'Consolas', 'monospace'],
      }
    }
  },
  plugins: []
}
