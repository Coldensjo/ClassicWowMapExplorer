import { defineConfig } from 'vite';

export default defineConfig({
	build: {
		// three.js alone is ~500 kB.
		chunkSizeWarningLimit: 1000,
		rollupOptions: {
			input: {
				main: 'index.html',
				inspector: 'inspector.html',
			},
		},
	},
});
