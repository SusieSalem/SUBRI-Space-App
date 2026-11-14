import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Build output stays in dist/ because firebase.json serves that folder.
export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist" },
});
