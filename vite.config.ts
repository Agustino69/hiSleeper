import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// base relativa: la app funciona servida desde cualquier subruta (p. ej. GitHub Pages).
export default defineConfig({
  base: './',
  plugins: [react()],
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
