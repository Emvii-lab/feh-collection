import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // PWA : app installable sur l'écran d'accueil, plein écran SANS barre de navigateur
    // (display: standalone). Se met à jour toute seule à chaque déploiement (autoUpdate).
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.png', 'favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Fire Emblem Heroes, ma collection',
        short_name: 'FEH Collection',
        description: 'Collection, simulateur de combat et solveur de cartes Fire Emblem Heroes.',
        lang: 'fr',
        dir: 'ltr',
        theme_color: '#1a130a',
        background_color: '#1a130a',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          { src: '/pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Précache le SQUELETTE de l'app (JS/CSS/HTML/polices) → démarrage rapide + shell
        // hors-ligne. On NE précache PAS les grosses images de fond (chargées au besoin) ni
        // les données Supabase (toujours réseau → fraîches). Fallback SPA sur index.html.
        globPatterns: ['**/*.{js,css,html,woff2}'],
        globIgnores: ['**/feh/bg/**'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/rest\//, /^\/auth\//, /^\/storage\//],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
})
