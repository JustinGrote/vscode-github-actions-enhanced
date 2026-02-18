/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: "ts-jest/presets/default-esm",
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
    "^libsodium-wrappers$": "<rootDir>/node_modules/libsodium-wrappers/dist/modules/libsodium-wrappers.js"
  },
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        useESM: true
      }
    ]
  },
  moduleFileExtensions: ["ts", "js"]
};
