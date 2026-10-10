import nextConfig from "eslint-config-next";
import tseslint from "typescript-eslint";

/** @type {import("eslint").Linter.Config[]} */
const eslintConfig = [
  {
    // `public/**` holds static assets served verbatim, including the service
    // worker (`public/sw.js`). They are outside the TypeScript program, so the
    // type-aware lint rules cannot analyse them.
    ignores: [
      ".next/**",
      "node_modules/**",
      "next-env.d.ts",
      "prisma/migrations/**",
      "public/**",
    ],
  },
  ...nextConfig,
  {
    plugins: { "@typescript-eslint": tseslint.plugin },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    // Config files (eslint/postcss) declare a JSDoc-typed default export only used as a type.
    files: ["**/*.mjs"],
    rules: {
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
];

export default eslintConfig;
