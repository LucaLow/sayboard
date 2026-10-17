import tseslint from "typescript-eslint";
export default tseslint.config(
  { ignores: ["dist", "server-dist", "data", "node_modules", "test-results", "playwright-report", "src/speech/vendor/espeak/espeak.js"] },
  ...tseslint.configs.recommended,
);
