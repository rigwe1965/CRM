import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

// Flat config (ESLint 9+). Same rule sets as the old .eslintrc.json: next/core-web-vitals and next/typescript.
const eslintConfig = [
  ...coreWebVitals,
  ...typescript,
  {
    // eslint-config-next 16 adds React-compiler advisory rules. They flag existing, working UI code (7 places), so they
    // are warnings for now: visible in the lint output, but they do not block a deploy. Fix them in a separate change.
    rules: {
      "react-hooks/static-components": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  { ignores: [".next/**", "node_modules/**", "coverage/**", "next-env.d.ts"] },
];

export default eslintConfig;
