import type { Config } from 'tailwindcss'

export default {
  content: {
    relative: true,
    files: ['./index.html', './src/**/*.{ts,tsx}'],
  },
  theme: {
    extend: {
      colors: {
        canvas: 'rgb(var(--color-canvas) / <alpha-value>)',
        panel: 'rgb(var(--color-panel) / <alpha-value>)',
        panel2: 'rgb(var(--color-panel-2) / <alpha-value>)',
        panel3: 'rgb(var(--color-panel-3) / <alpha-value>)',
        line: 'rgb(var(--color-line) / <alpha-value>)',
        text: 'rgb(var(--color-text) / <alpha-value>)',
        muted: 'rgb(var(--color-muted) / <alpha-value>)',
        dim: 'rgb(var(--color-dim) / <alpha-value>)',
        accent: 'rgb(var(--color-accent) / <alpha-value>)',
        mint: 'rgb(var(--color-ok) / <alpha-value>)',
        cyan: 'rgb(var(--color-info) / <alpha-value>)',
        amber: 'rgb(var(--color-warn) / <alpha-value>)',
        rose: 'rgb(var(--color-err) / <alpha-value>)',
      },
      boxShadow: {
        glow: '0 0 0 1px rgb(var(--color-accent) / 0.12), 0 14px 38px rgba(0, 0, 0, 0.3)',
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'Segoe UI', 'Roboto', 'Arial', 'sans-serif'],
      },
    },
  },
  plugins: [],
} satisfies Config
