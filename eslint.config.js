import js from "@eslint/js";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  { ignores: ["dist/**", "node_modules/**", ".data/**", ".signal-house-dev/**", "e2e/**", "playwright.config.ts", "test-results/**"] },
  js.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { project: "./tsconfig.json", tsconfigRootDir: import.meta.dirname },
      globals: {
        // Bun runtime + platform globals used across src, scripts, and tests.
        Bun: "readonly",
        process: "readonly",
        fetch: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        AbortController: "readonly",
        Request: "readonly",
        Response: "readonly",
        URL: "readonly",
        Headers: "readonly",
        Buffer: "readonly",
        console: "readonly",
        globalThis: "readonly",
        atob: "readonly",
        btoa: "readonly",
        Event: "readonly",
        Error: "readonly",
        Date: "readonly",
        Promise: "readonly",
        Map: "readonly",
        Set: "readonly",
        // Browser globals (the dashboard runs client-side).
        window: "readonly",
        document: "readonly",
        localStorage: "readonly",
        navigator: "readonly",
        HTMLElement: "readonly",
        Element: "readonly",
        Node: "readonly",
        requestAnimationFrame: "readonly",
        cancelAnimationFrame: "readonly",
        MutationObserver: "readonly",
        getComputedStyle: "readonly",
        matchMedia: "readonly",
        CustomEvent: "readonly",
        KeyboardEvent: "readonly",
        MouseEvent: "readonly",
        NodeList: "readonly",
        HTMLCollection: "readonly",
      },
    },
    plugins: { "@typescript-eslint": tsPlugin, "react-hooks": reactHooks },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-expressions": "off",
    },
  },
  {
    files: ["**/*.test.ts", "**/*.test.tsx"],
    rules: { "@typescript-eslint/no-unused-vars": "off" },
  },
];
