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
