/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/server', '<rootDir>/frontend/src', '<rootDir>/utils', '<rootDir>/types'],
  testMatch: [
    '<rootDir>/server/**/*.test.ts',
    '<rootDir>/server/**/*.test.tsx',
    '<rootDir>/frontend/src/**/*.test.ts',
    '<rootDir>/frontend/src/**/*.test.tsx',
  ],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/frontend/src/$1',
    '^vitest$': '<rootDir>/test-shims/vitest.ts',
    '^nitropack/runtime$': '<rootDir>/test-shims/nitropack-runtime.ts',
  },
  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.jest.json' }],
  },
  testPathIgnorePatterns: [
    '/node_modules/',
    '/.nuxt/',
    '/.output/',
    '/dist/',
    '/.next/',
  ],
};
