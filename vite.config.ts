import { defineConfig } from 'vite';
import { wowFiles } from './tools/wowFiles';

export default defineConfig({
	plugins: [wowFiles()],
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
