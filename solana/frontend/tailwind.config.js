/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        gold: '#C5A869',
        sand: '#F9F6F0',
        ink: '#1A1A1A',
        muted: '#6B7280',
      },
    },
  },
  plugins: [],
}
