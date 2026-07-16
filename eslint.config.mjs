import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["node_modules/**", "target/**", "tests/fixtures/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    languageOptions: {
      globals: { ...globals.node, ...globals.mocha },
    },
    rules: {
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-unsafe-function-type": "off",
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-constant-binary-expression": "error",
      "no-control-regex": "off",
      "no-duplicate-imports": ["error", { allowSeparateTypeImports: true }],
      "no-unsafe-finally": "off",
    },
  },
  {
    files: ["tests/**"],
    rules: {
      "@typescript-eslint/ban-ts-comment": "off",
      "@typescript-eslint/no-unused-expressions": "off",
    },
  },
  eslintConfigPrettier,
);
