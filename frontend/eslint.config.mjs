import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // These three rules are React Compiler *readiness* lints — they flag
      // patterns that are perfectly correct today but would need rewriting
      // before adopting the (still-experimental) React Compiler. This app
      // does not use the compiler and deliberately uses lightweight manual
      // data-fetching (see useAsync.ts) instead of a query library, which
      // relies on exactly the patterns these rules flag (setState in an
      // effect to drive loading/error state, a ref holding the latest
      // fetcher closure). Revisit if/when this project adopts the compiler.
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/refs": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
