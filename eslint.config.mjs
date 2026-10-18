import next from "eslint-config-next";

const config = [...next, { ignores: [".next/**", "tests/mock-gemini/**", "tests/e2e/launch.mjs", "node_modules/**", "test-results/**"] }];
export default config;
