/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './*.{ts,tsx}',
    './{components,hooks,utils,quality,workflows,services}/**/*.{ts,tsx}'
  ],
  theme: { extend: {} },
  plugins: []
};
