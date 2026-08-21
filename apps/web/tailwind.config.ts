import type { Config } from "tailwindcss";

// Brand tokens — locked per doc 07 §5. Do not introduce ad hoc colors outside
// this palette; every UI decision derives from these four.
const config: Config = {
  darkMode: ["class"],
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0B0B0C", // Primary — near black
        paper: "#F6F5F2", // Background — warm off-white
        accent: {
          DEFAULT: "#63D678", // Accent — green
          dim: "#4FB363",
          tint: "#E6F8E9",
        },
        slate: {
          DEFAULT: "#6F7378", // Secondary — muted slate
          line: "#DEDBD4", // hairline dividers derived from paper, not a new hue
          surface: "#EFEDE8", // card surface, one step off paper
        },
        danger: "#C24A3D", // reserved for failed executions / cancel states only
      },
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      borderRadius: {
        sm: "6px",
        md: "10px",
        lg: "16px",
        xl: "22px",
      },
      boxShadow: {
        card: "0 1px 2px rgba(11,11,12,0.04), 0 1px 1px rgba(11,11,12,0.03)",
        float: "0 8px 24px rgba(11,11,12,0.10)",
      },
      maxWidth: {
        shell: "1280px",
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.5s ease-out both",
        "fade-in": "fade-in 0.4s ease-out both",
      },
    },
  },
  plugins: [],
};

export default config;
