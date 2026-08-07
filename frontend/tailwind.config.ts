import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        floor: '#0B0D10',       // page background — graphite floor
        panel: '#14171C',       // card/panel surface
        panelBorder: '#23272E',
        ink: '#E7E9EC',         // primary text
        inkMuted: '#8A9099',    // secondary text
        signal: '#F5A524',      // amber — awaiting decision
        go: '#3DD68C',          // green — approved
        stop: '#F0576B',        // red — rejected
        track: '#5B8CFF',       // steel blue — active/in-progress
      },
      fontFamily: {
        display: ['var(--font-mono)', 'ui-monospace', 'monospace'],
        body: ['var(--font-sans)', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
export default config;
