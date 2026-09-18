'use strict';

// Testes de navegador do Gerenciador de Aluguel. Cada teste sobe o próprio
// `php -S` numa porta livre, com uma pasta de dados temporária (ver
// apoio/servidor.js) — nada aqui toca em data/ ou contratos/ de verdade.
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './specs',
  outputDir: './resultados/artefatos',
  timeout: 60_000,
  expect: { timeout: 7_000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  reporter: [['list'], ['html', { outputFolder: './resultados/relatorio', open: 'never' }]],
  use: {
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    viewport: { width: 1366, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 900 } } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'], viewport: { width: 1366, height: 900 } } },
  ],
});
