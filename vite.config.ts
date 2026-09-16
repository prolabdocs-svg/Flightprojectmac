import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // Rapier's WASM glue chunk is inherently large and only loads once the player
    // reaches the Flight screen (see manualChunks below and the lazy-loaded
    // FlightScreen in App.tsx), so it no longer blocks initial page load.
    chunkSizeWarningLimit: 3000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('@dimforge/rapier3d-compat')) return 'rapier'
            if (id.includes('/three/')) return 'three'
            if (id.includes('/react-dom/') || id.includes('/react/')) return 'react-vendor'
          }
        },
      },
    },
  },
})
