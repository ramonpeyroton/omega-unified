/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        omega: {
          // Brand
          orange: '#E8732A',
          dark: '#C45E1A',
          pale: '#FDF0E8',
          charcoal: '#2C2C2A',
          slate: '#4A4A47',
          stone: '#6B6B68',
          fog: '#B8B6B0',
          cloud: '#FAFAF8',
          // Semantic
          success: '#2D6A4F',
          warning: '#B5690A',
          danger: '#8B2635',
          info: '#1A5276',
          // Calendar event categories — saturated + soft pair for each
          'event-sales':      '#E8732A',
          'event-sales-bg':   '#FDF0E8',
          'event-job':        '#15803D',
          'event-job-bg':     '#DCFCE7',
          'event-service':    '#0369A1',
          'event-service-bg': '#DBEAFE',
          'event-inspect':    '#A16207',
          'event-inspect-bg': '#FEF3C7',
          'event-meeting':    '#7E22CE',
          'event-meeting-bg': '#F3E8FF',
        },
      },
      fontFamily: { sans: ['Inter', 'sans-serif'] },
      borderRadius: {
        sm: '4px',
        DEFAULT: '8px',
        md: '8px',
        lg: '12px',
        xl: '16px',
        '2xl': '20px',
        '3xl': '28px',
      },
      boxShadow: {
        // Soft cards used across the redesigned dashboards.
        card: '0 1px 3px 0 rgba(0,0,0,0.05), 0 1px 2px -1px rgba(0,0,0,0.04)',
        'card-hover': '0 6px 16px -4px rgba(0,0,0,0.08), 0 2px 6px -2px rgba(0,0,0,0.04)',
        // Inner pill shadow for active toggle item.
        pill: '0 1px 2px 0 rgba(0,0,0,0.06), 0 1px 1px 0 rgba(0,0,0,0.04)',
      },
      spacing: { base: '8px' },
    },
  },
  plugins: [],
};
