/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        borg: {
          bg:      '#09090f',
          surface: '#0e0d18',
          panel:   '#13121f',
          border:  '#1e1c35',
          green:   '#a78bfa',
          dim:     '#4a4570',
          muted:   '#6b6590',
          text:    '#ede9f8',
        }
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'Consolas', 'monospace'],
      }
    }
  },
  plugins: []
}
