import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

const src = (path: string) => fileURLToPath(new URL(`./src/${path}`, import.meta.url))

export default defineConfig({
  resolve: {
    alias: [
      { find: /^#lib\/(.*)$/, replacement: `${src('lib')}/$1.ts` },
      { find: '#types', replacement: src('types/index.ts') },
      { find: '@', replacement: src('') },
    ],
  },
  test: {
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/lib/**/*.ts'],
      exclude: [
        // Punto de entrada de linea de comandos, sin logica propia.
        'src/lib/db/migrate.ts',
        // Habla el protocolo SSH contra un servidor real: se verifica con
        // scripts/e2e-terminal.mjs, no con pruebas unitarias.
        'src/lib/ssh/connect.ts',
      ],
      thresholds: { lines: 80, functions: 80, branches: 75, statements: 80 },
    },
  },
})
