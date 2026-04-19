/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        omega: {
          orange: '#E8732A',
          dark: '#C45E1A',
          pale: '#FDF0E8',
          charcoal: '#2C2C2A',
          slate: '#4A4A47',
          stone: '#6B6B68',
          fog: '#B8B6B0',
          cloud: '#FAFAF8',
          success: '#2D6A4F',
          warning: '#B5690A',
          danger: '#8B2635',
          info: '#1A5276',
        },
      },
      fontFamily: { sans: ['Inter', 'sans-serif'] },
      borderRadius: { sm: '4px', DEFAULT: '8px', md: '8px', lg: '12px', xl: '16px' },
      spacing: { base: '8px' },
    },
  },
  plugins: [],
};
