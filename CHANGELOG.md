# bedrock-config-yaml ChangeLog

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
