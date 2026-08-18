/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./app/**/*.html",
    "./faq/**/*.html",
    "./blog/**/*.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
        sans: ['"IBM Plex Sans"', 'ui-sans-serif', 'system-ui'],
      },
      colors: {
        ink: '#10161C',
        stone: '#EEF0EC',
        graphite: '#26313A',
        signal: { DEFAULT: '#D9A54A', dim: '#8A6A2F' },
        verdigris: { DEFAULT: '#3E7368', dim: '#295148' },
        rust: '#B85C3E',
      },
      borderRadius: {
        panel: '8px',
      },
    },
  },
  plugins: [
    require("tailwindcss-animate")
  ],
}
