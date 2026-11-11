'use strict';
/**
 * `node -r` hook for `npm run openapi:export`: registers ts-node with the
 * @nestjs/swagger CLI plugin as a custom transformer, using the same options
 * declared in nest-cli.json. Without it, ts-node skips the plugin that
 * `nest build` applies and every DTO schema is exported without properties.
 * (ts-node has no CLI flag for transformers, hence the register hook.)
 */
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const swaggerPlugin = require('@nestjs/swagger/plugin');

function readSwaggerPluginOptions() {
  const nestCli = JSON.parse(
    readFileSync(join(__dirname, '..', 'nest-cli.json'), 'utf-8'),
  );
  const plugins = nestCli.compilerOptions?.plugins ?? [];
  const entry = plugins.find(
    (plugin) =>
      (typeof plugin === 'string' ? plugin : plugin.name) === '@nestjs/swagger',
  );
  if (!entry) {
    throw new Error(
      '@nestjs/swagger plugin is not configured in nest-cli.json',
    );
  }
  return typeof entry === 'string' ? {} : (entry.options ?? {});
}

const options = readSwaggerPluginOptions();

require('ts-node').register({
  transformers: (program) => ({
    before: [swaggerPlugin.before(options, program)],
  }),
});
