/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        borg: {
          bg:      '#0a0f0a',
          surface: '#111811',
          panel:   '#162016',
          border:  '#1f2e1f',
          green:   '#22c55e',
          dim:     '#4a7a4a',
          muted:   '#6b8f6b',
          text:    '#d4e8d4',
        }
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'Consolas', 'monospace'],
      }
    }
  },
  plugins: []
}
