# bedrock-config-yaml ChangeLog

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
