import { defineConfig } from 'vite';
export default defineConfig({
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:3000' },
  },
  build: {
    target: 'es2022',
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'react',
              test: /node_modules\/(react|react-dom|scheduler)\//,
            },
            { name: 'time', test: /node_modules\/(@js-temporal|jsbi)\// },
            { name: 'validation', test: /node_modules\/zod\// },
          ],
        },
      },
    },
  },
});
