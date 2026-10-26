/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#050506',
          900: '#08080a',
          850: '#0b0a0c',
          800: '#0f0d10',
          700: '#151216',
          600: '#1d181d',
        },
        falcon: {
          50: '#fff1f0',
          100: '#ffdedb',
          200: '#ffb9b3',
          300: '#ff8a80',
          400: '#ff5a4e',
          500: '#ff2f2f',
          600: '#e11d2e',
          700: '#b31324',
          800: '#7f0d1a',
          900: '#4a0710',
        },
      },
      fontFamily: {
        display: ['Sora', 'Segoe UI Variable Display', 'system-ui', 'sans-serif'],
        sans: ['Inter', 'Segoe UI Variable Text', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Cascadia Code', 'Consolas', 'monospace'],
      },
      boxShadow: {
        glow: '0 0 26px rgba(255, 45, 45, 0.35)',
        'glow-lg': '0 0 60px rgba(255, 45, 45, 0.45)',
        card: '0 18px 40px -24px rgba(0,0,0,0.9)',
      },
      backgroundImage: {
        'radial-red': 'radial-gradient(circle at 50% 40%, rgba(255,45,45,0.22), transparent 62%)',
        'card-sheen':
          'linear-gradient(145deg, rgba(255,255,255,0.045) 0%, rgba(255,255,255,0.008) 38%, rgba(255,45,45,0.05) 100%)',
      },
      animation: {
        'pulse-slow': 'pulseSlow 3.4s ease-in-out infinite',
        'spin-slow': 'spin 9s linear infinite',
        float: 'float 5s ease-in-out infinite',
        'bar-1': 'bar 1.1s ease-in-out infinite',
        'bar-2': 'bar 1.1s ease-in-out 0.15s infinite',
        'bar-3': 'bar 1.1s ease-in-out 0.3s infinite',
        shimmer: 'shimmer 2.2s linear infinite',
      },
      keyframes: {
        pulseSlow: {
          '0%, 100%': { opacity: '0.55', transform: 'scale(1)' },
          '50%': { opacity: '1', transform: 'scale(1.04)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-6px)' },
        },
        bar: {
          '0%, 100%': { transform: 'scaleY(0.28)' },
          '50%': { transform: 'scaleY(1)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
    },
  },
  plugins: [],
};
