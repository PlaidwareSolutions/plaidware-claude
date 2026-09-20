import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  // Page-system conventions (see the redesign plan): one way to confirm,
  // one way to format a date, one place that knows a route.
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-globals": [
        "error",
        { name: "confirm", message: "Use useConfirm() from @/components/confirm-dialog." },
        { name: "alert", message: "Use toast from sonner." },
        { name: "prompt", message: "Use useConfirm() with a `field` from @/components/confirm-dialog." },
      ],
      "no-restricted-properties": [
        "error",
        { object: "window", property: "confirm", message: "Use useConfirm() from @/components/confirm-dialog." },
        { object: "window", property: "alert", message: "Use toast from sonner." },
        { object: "window", property: "prompt", message: "Use useConfirm() with a `field`." },
        { property: "toLocaleDateString", message: "Use formatDate()/formatDay() from @/lib/dates (fixed display TZ, no hydration drift)." },
        { property: "toLocaleTimeString", message: "Use formatDateTime() from @/lib/dates." },
        { property: "toLocaleString", message: "Use formatDateTime() from @/lib/dates (or formatCents for money)." },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "Literal[value=/^\\/(ops|work|dashboard|billing|monitoring|inbox|team|settings|checkout|login|signup|invite|welcome|products)(\\/|\\?|$)/]",
          message: "Route literals live in src/lib/routes.ts — use OPS.*, WORK.*, TENANT.*, AUTH.* or MARKETING.*.",
        },
        {
          selector:
            "TemplateElement[value.raw=/^\\/(ops|work|dashboard|billing|monitoring|inbox|team|settings|checkout|login|signup|invite|welcome|products)(\\/|\\?|$)/]",
          message: "Route literals live in src/lib/routes.ts — use OPS.*, WORK.*, TENANT.*, AUTH.* or MARKETING.*.",
        },
      ],
    },
  },
  {
    files: [
      "src/lib/routes.ts",
      "src/lib/dates.ts",
      "src/app/robots.ts",
      "src/app/sitemap.ts",
      "src/proxy.ts",
      "src/app/(marketing)/**",
      "src/**/*.test.ts",
    ],
    rules: {
      "no-restricted-syntax": "off",
      "no-restricted-properties": "off",
    },
  },
]);

export default eslintConfig;
