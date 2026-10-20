const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const git = process.platform === 'win32' ? 'C:/Program Files/Git/cmd/git.exe' : 'git';
const shell = process.env.TEST_SHELL || (process.platform === 'win32' ? 'C:/Program Files/Git/bin/sh.exe' : 'sh');

test('Prisma is a locked production dependency with no existing package versions changed', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json')));
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json')));
  const baseline = JSON.parse(execFileSync(git, ['show', 'HEAD:package-lock.json'], { cwd: root, encoding: 'utf8' }));
  assert.equal(pkg.dependencies.prisma, lock.packages[''].dependencies.prisma);
  assert.equal(pkg.devDependencies.prisma, undefined);
  assert.match(lock.packages['node_modules/prisma'].version, /^6\./);
  assert.equal(lock.packages['node_modules/prisma'].dev, undefined);
  for (const [name, entry] of Object.entries(baseline.packages)) {
    for (const field of ['version', 'resolved', 'integrity']) {
      assert.equal(lock.packages[name]?.[field], entry[field], `${name}: ${field}`);
    }
  }
  console.log(`Locked Prisma CLI: ${lock.packages['node_modules/prisma'].version}`);
});

// Exercise shell control flow with a fake CLI/server. These are not container tests.
for (const scenario of ['missing CLI', 'migration failure', 'migration success', 'seed failure', 'seed success']) {
  test(`entrypoint: ${scenario}`, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'caf-entrypoint-'));
    try {
      const app = path.join(dir, 'app');
      const bin = path.join(dir, 'bin');
      fs.mkdirSync(bin);
      fs.mkdirSync(path.join(app, 'node_modules/prisma/build'), { recursive: true });
      if (scenario !== 'missing CLI') fs.writeFileSync(path.join(app, 'node_modules/prisma/build/index.js'), '');
      fs.writeFileSync(path.join(bin, 'node'), `#!/bin/sh
if [ "$1" = '-e' ]; then echo 'Migration Prisma CLI version: fixture'; exit 0; fi
if [ "$1" = 'server.js' ]; then echo 'SERVER_STARTED'; exit 0; fi
if [ "$1" = 'seed-runtime/prisma/seed.js' ]; then echo 'SEED_CALLED'; exit ${scenario === 'seed failure' ? 31 : 0}; fi
echo 'MIGRATION_CALLED'
exit "${scenario === 'migration failure' ? 23 : 0}"
`, { mode: 0o755 });
      const entry = fs.readFileSync(path.join(root, 'docker-entrypoint.sh'), 'utf8')
        .replaceAll('/app', app.replaceAll('\\', '/'))
        .replace(/\bnode /g, '"${TEST_NODE}" ');
      fs.writeFileSync(path.join(dir, 'entrypoint.sh'), entry);
      const result = spawnSync(shell, [path.join(dir, 'entrypoint.sh').replaceAll('\\', '/')], {
        encoding: 'utf8',
        env: { ...process.env, TEST_NODE: path.join(bin, 'node').replaceAll('\\', '/'), RUN_SEED: scenario.startsWith('seed ') ? '1' : '0' },
      });
      const output = result.stdout + result.stderr;
      assert.ifError(result.error);
      assert.equal(result.status, scenario === 'missing CLI' ? 1 : scenario === 'migration failure' ? 23 : scenario === 'seed failure' ? 31 : 0, output);
      if (scenario === 'migration success' || scenario === 'seed success') {
        assert.match(output, /MIGRATION_CALLED[\s\S]*Database migrations completed\.[\s\S]*SERVER_STARTED/);
        if (scenario === 'seed success') assert.match(output, /Database migrations completed\.[\s\S]*SEED_CALLED[\s\S]*SERVER_STARTED/);
      } else {
        assert.match(output, /Startup failed:/);
        assert.doesNotMatch(output, /SERVER_STARTED|Starting CAF Portal/);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}
