import prettier from 'eslint-config-prettier'

export default [
  {
    files: ['static/js/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'script',
      globals: {
        // Browser globals
        document: 'readonly',
        window: 'readonly',
        fetch: 'readonly',
        performance: 'readonly',
        requestAnimationFrame: 'readonly',
        CSS: 'readonly',
        URL: 'readonly',
        console: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        alert: 'readonly',
        confirm: 'readonly',
        AbortController: 'readonly',
        MutationObserver: 'readonly',
        Event: 'readonly',
        HTMLElement: 'readonly',
        navigator: 'readonly',
        event: 'readonly',
        // Template-injected globals
        WEB_URLS: 'readonly',
        BENCH_TITLES: 'readonly',
        SPEEDTEST_DIRECT_URL: 'readonly',
        SPEEDTEST_DIRECT_NAME: 'readonly',
        SPEEDTEST_CF_URL: 'readonly',
        SPEEDTEST_CF_NAME: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': 'warn',
      'no-undef': 'warn',
      semi: ['error', 'never'],
      'prefer-const': 'warn',
    },
  },
  prettier,
]
