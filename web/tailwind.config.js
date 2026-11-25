/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        serif: ['"LumenSerif"', '"Noto Serif SC"', '"Source Han Serif SC"', '"Songti SC"', '"STSong"', '"SimSun"', 'Georgia', 'serif'],
        sans: ['"PingFang SC"', '"Microsoft YaHei UI"', '"Noto Sans CJK SC"', '"Noto Sans SC"', '"Hiragino Sans GB"', 'system-ui', '-apple-system', 'sans-serif'],
        kai: ['"LumenKai"', '"Kaiti SC"', '"STKaiti"', '"KaiTi"', '"FangSong"', 'serif'],
        mono: ['"JetBrains Mono"', '"Cascadia Code"', 'Consolas', 'monospace'],
      },
      animation: {
        'spin-slow': 'spin 16s linear infinite',
        'pulse-soft': 'pulseSoft 2.8s ease-in-out infinite',
        'float-in': 'floatIn 0.32s cubic-bezier(0.16, 1, 0.3, 1) forwards',
        'slide-up': 'slideUp 0.36s cubic-bezier(0.16, 1, 0.3, 1) forwards',
      },
      keyframes: {
        pulseSoft: {
          '0%, 100%': { opacity: '0.65', transform: 'scale(1)' },
          '50%': { opacity: '1', transform: 'scale(1.04)' },
        },
        floatIn: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(24px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
}
