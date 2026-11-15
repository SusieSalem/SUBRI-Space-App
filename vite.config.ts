import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Build output stays in dist/ because firebase.json serves that folder.
// Libraries go in their own chunks so the browser downloads them in parallel
// and keeps them cached between deploys (they change far less than our code).
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    // three.js on its own is ~740 kB minified (190 kB gzipped); it cannot be split further.
    chunkSizeWarningLimit: 800,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            // React first: the 3D libraries depend on it, and it must stay out of their chunk.
            { name: "react", test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/, priority: 40 },
            { name: "three", test: /node_modules[\\/]three[\\/]/, priority: 30 },
            {
              name: "r3f",
              test: /node_modules[\\/](@react-three|postprocessing|three-stdlib|three-mesh-bvh|maath|troika|camera-controls|@monogrid|meshline|stats)/,
              priority: 20,
            },
            { name: "firebase", test: /node_modules[\\/](firebase|@firebase|idb|tslib)[\\/]/, priority: 20 },
            { name: "vendor", test: /node_modules/, priority: 10 },
          ],
        },
      },
    },
  },
});
