# bedrock-config-yaml ChangeLog

## Unreleased

### Added
- Add the optional `config-yaml.sources.aws` source for Nitro Enclaves.
- Load the version-1 encrypted YAML envelope from Secrets Manager using the
  `BedrockConfigSecretName` EC2 tag and `@bedrock/aws-kms`.

### Changed
- Classify startup retries by standard error name and dependency stage instead
  of package-specific error codes.
- Treat an enabled AWS source as authoritative instead of falling back to file
  configuration when IMDS discovery fails.

## 4.6.0 - 2026-08-24

### Added
- Add support for config value transformers, which compute individual config
  values at load time and are addressed with a `$NAME` key, e.g.
  `password: {$SECRET: 'arn:aws:secretsmanager:...'}`.
- Add a built-in `env` transformer that reads environment variables, with
  optional `default` and `type` (`string`, `number`, `boolean`, `json`)
  options.
- Add the `config-yaml.transformers` config: `allow`, `timeout`, `cache`, and
  `env.allow`.

### Fixed
- Reject `__proto__`, `constructor`, and `prototype` keys in a YAML config.
  Merging them modified `Object.prototype` instead of the config.

## 4.5.0 - 2026-07-29

### Added
- Add support for loading the config from a `BEDROCK_CONFIG_GZIP` environment
  variable containing base64-encoded gzipped YAML. This allows deployments
  that store their config in a size-limited store (such as a 64 KB AWS Secrets
  Manager secret) to gain roughly 3-4x headroom. Only one of
  `BEDROCK_CONFIG_GZIP` or `BEDROCK_CONFIG` may be set; setting both is
  ambiguous and throws. `BEDROCK_CONFIG_GZIP` is decoded strictly: a value
  that is not valid gzip fails loudly instead of falling back to
  `BEDROCK_CONFIG`. `BEDROCK_CONFIG` behavior is unchanged when
  `BEDROCK_CONFIG_GZIP` is unset.

## 4.4.0 - 2026-06-23

### Changed
- Update dependencies:
  - `js-yaml@4.2.0` (security fixes)
- Update minor, dev, and test dependencies.
- **NOTE**: Update supported platforms.
  - Test on Node.js >=22.
  - Update `engines.node` to `>=22`.
  - See README requirements section.

## 4.3.3 - 2025-02-07

### Changed
- Added test expecting error when config is invalid.
- Refactor fs sync to async methods for exists and read (issue #4).

## 4.3.2 - 2025-02-06

### Fixed
- Use standard publishing process.

## 4.3.1 - 2025-02-06

### Fixed
- Capture any errors during config yaml load to avoid leaking sensitive values.

## 4.3.0 - 2024-05-22

### Changed
- Update to `js-yaml@4`.

## 4.2.0 - 2024-02-28

### Changed
- Relicense under the Apache-2.0 license.

## 4.1.0 - 2024-02-24

### Added:
- Add support for loading a base64 encoded yaml config from `BEDROCK_CONFIG`
  environment variable.

## 4.0.0 - 2022-04-29

### Changed
- **BREAKING**: Update peer deps:
  - `@bedrock/core@6`.

## 3.0.0 - 2022-04-04

### Changed
- **BREAKING**: Rename package to `@bedrock/config-yaml`.
- **BREAKING**: Convert to module (ESM).
- **BREAKING**: Remove default export.
- **BREAKING**: Require node 14.x.

## 2.1.0 - 2021-07-16

### Added:
- Add support for a `combined.yaml` file that may contain both an `app` and
  `core` section. This file may be used instead of, or in combination with
  separate `app.yaml` and `core.yaml` files. If used in conjunction with
  separate files, the values in the `app.yaml` and `core.yaml` files will
  override the values in the `combined.yaml` file. The use of a single
  `combined.yaml` file simplifies some deployment environments.

## 2.0.0 - 2020-12-09

### Changed:
- Implement separate YAML files for `core` and `app` configuration.
- **BREAKING**: The Bedrock configuration options and defaults have changed.

## 1.0.1 - 2020-12-07

### Fixed
- Fix default path.

## 1.0.0 - 2020-12-07

- See git history for changes.
