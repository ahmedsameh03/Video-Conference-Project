// rollup.config.mjs
import resolve from "@rollup/plugin-node-resolve";

export default {
  input: "worker-src/e2ee-bundler.js",
  output: {
    file: "js/noble-ciphers.min.js",
    format: "iife", // self-invoking function, perfect for Workers
    name: "NobleCiphers",
  },
  plugins: [resolve()],
};
