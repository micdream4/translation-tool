/** @type {import('tailwindcss').Config} */
// Colors come from the CSS variables in index.css (light and dark values switch with data-theme).
const token = (name) => `rgb(var(--c-${name}) / <alpha-value>)`;
const status = (name) => ({
  DEFAULT: token(name),
  soft: token(`${name}-soft`),
  border: token(`${name}-border`),
  solid: token(`${name}-solid`)
});

export default {
  content: [
    './index.html',
    './*.{ts,tsx}',
    './{components,hooks,utils,quality,workflows,services}/**/*.{ts,tsx}'
  ],
  theme: {
    extend: {
      // System fonts only (no web font download); Chinese falls back to PingFang / Microsoft YaHei.
      fontFamily: {
        sans: ['-apple-system', '"SF Pro Text"', '"Segoe UI"', '"PingFang SC"', '"Microsoft YaHei"', 'sans-serif'],
        mono: ['ui-monospace', '"SF Mono"', 'Menlo', 'Consolas', 'monospace']
      },
      // Type scale 12/13/14/16/20/24: body 14 at 1.5, headings at 1.3.
      fontSize: {
        caption: ['12px', { lineHeight: '1.5' }],
        label: ['13px', { lineHeight: '1.5' }],
        body: ['14px', { lineHeight: '1.5' }],
        title: ['16px', { lineHeight: '1.3' }],
        heading: ['20px', { lineHeight: '1.3' }],
        display: ['24px', { lineHeight: '1.3' }]
      },
      borderRadius: {
        control: '10px',
        panel: '16px'
      },
      colors: {
        bg: token('bg'),
        surface: token('surface'),
        sunken: token('sunken'),
        subtle: token('subtle'),
        strong: token('strong'),
        line: token('line'),
        ink: { DEFAULT: token('ink'), soft: token('ink-soft') },
        muted: token('muted'),
        primary: {
          DEFAULT: token('primary'),
          hover: token('primary-hover'),
          soft: token('primary-soft'),
          ink: token('primary-ink'),
          border: token('primary-border')
        },
        'on-primary': token('on-primary'),
        danger: status('danger'),
        warning: status('warning'),
        kept: status('kept'),
        success: status('success')
      }
    }
  },
  plugins: []
};
