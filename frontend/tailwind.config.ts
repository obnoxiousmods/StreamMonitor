import type { Config } from 'tailwindcss'

export default {
  content: {
    relative: true,
    files: ['./index.html', './src/**/*.{ts,tsx}'],
  },
  theme: {
    extend: {
      colors: {
        canvas: '#080909',
        panel: '#101211',
        panel2: '#151816',
        panel3: '#1b211e',
        line: '#28302c',
        text: '#e7eee9',
        muted: '#8c9a92',
        dim: '#536057',
        mint: '#42d39b',
        cyan: '#4cc9d8',
        amber: '#f0bf45',
        rose: '#f4777f',
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(66, 211, 155, 0.12), 0 18px 48px rgba(0, 0, 0, 0.32)',
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'Segoe UI', 'Roboto', 'Arial', 'sans-serif'],
      },
    },
  },
  plugins: [],
} satisfies Config
