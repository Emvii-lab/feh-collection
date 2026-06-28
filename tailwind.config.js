/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Thème chaud sombre (companion app premium)
        warm: {
          bg: '#241a0f',
          deep: '#1a130a',
          panel: '#18110a',
          line: 'rgba(255,255,255,0.08)',
          text: '#e8ddca',
          head: '#f6efdf',
          dim: '#a8967a',
          mute: '#94866c',
        },
        gold: {
          light: '#fbe6a6',
          DEFAULT: '#e3bf5e',
          deep: '#b78a2e',
          text: '#f1d98a',
          amber: '#d8b14e',
          ink: '#3a2a08',
        },
        gem: {
          red: '#d8504c',
          blue: '#4d8ee8',
          green: '#3fb267',
          colorless: '#c2cdda',
        },
      },
      fontFamily: {
        // Police officielle FEH en priorité, Space Grotesk en repli (accents, glyphes manquants)
        feh: ['"FEH Game"', '"Space Grotesk"', 'system-ui', 'sans-serif'],
        display: ['"Space Grotesk"', 'system-ui', 'sans-serif'],
        body: ['"Albert Sans"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        xl2: '1rem',
      },
      backgroundImage: {
        'warm-ambient':
          'radial-gradient(60% 45% at 18% 0%, rgba(244,188,86,.26), transparent 62%), radial-gradient(46% 40% at 88% 6%, rgba(226,104,60,.17), transparent 60%), radial-gradient(80% 60% at 50% 112%, rgba(150,92,40,.22), transparent 62%), linear-gradient(180deg,#2c2114,#1a130a)',
        'gold-active':
          'linear-gradient(180deg,#fbe6a6,#e3bf5e 48%,#b78a2e)',
      },
      boxShadow: {
        'gold-btn':
          '0 0 0 1px rgba(120,84,24,.85), 0 6px 16px rgba(150,100,20,.45), inset 0 1px 0 rgba(255,250,225,.85), inset 0 -3px 7px rgba(120,84,24,.45)',
        card: '0 6px 16px rgba(0,0,0,.35)',
      },
      keyframes: {
        orbPulse: {
          '0%,100%': { opacity: '0.9' },
          '50%': { opacity: '1', filter: 'brightness(1.2)' },
        },
      },
      animation: {
        orbPulse: 'orbPulse 2.8s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
