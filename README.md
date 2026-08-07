# Bedrock YAML Configuration _(@bedrock/config-yaml)_

This module is used to layer a deployment Bedrock configuration defined in
a YAML file onto `bedrock.config`. Values defined in the YAML config may add
and overwrite values in `bedrock.config`. The YAML configuration is applied
after all conventional Bedrock module configuration has been completed. If
there is no YAML configuration file found in the location specified by the
`bedrock-config-yaml` config, Bedrock startup proceeds normally and no
configuration changes are applied.

## Install

This software requires and supports maintained recent versions of Node.js.
Updates may remove support for older unmaintained platform versions. Please use
dependency version lock files and testing to ensure compatibility with this
software.

### NPM

To install via NPM:

```
npm install --save @bedrock/config-yaml
```

### Development

To install locally (for development):

```
git clone https://github.com/digitalbazaar/bedrock-config-yaml.git
cd bedrock-config-yaml
npm install
```

## Usage

To ensure that no other module will override the YAML configuration,
`bedrock-config-yaml` should be the last import before `bedrock.start()` is
called. If `bedrock-config-yaml` is not the last `bedrock-cli.parsed` or
`bedrock.configure` event handler, an error will be thrown that will prevent
application startup.

There are two separate configuration files that are applied when different
events occur during Bedrock startup: `core` and `app`.

### Core Config

The `core` config is used to configure core Bedrock features such as the
number of workers or the default log formatter. The `core` config is applied by
the last handler for the `bedrock-cli.parsed` event.  The default location for
the `core` config is: `/etc/bedrock-config/core.yaml`.

#### Sample `core.yaml`

```yaml
core:
  workers: 2
loggers:
  console:
    bedrock:
      formatter: logstash
```

### App Config

The `app` config is used to configure Bedrock application/module features.
The `app` config is applied by the last handler for the `bedrock.configure`
event. The default location for the `app` config is:
`/etc/bedrock-config/app.yaml`.

#### Sample `app.yaml`

```yaml
test-bedrock-module:
  foo: fromYaml
  overwriteMe: fromYaml
another-bedrock-module:
  host: example.com
  port: 18443
```

### Loading From Environment Variable

It is possible to load the config YAML from a `BEDROCK_CONFIG` environment
variable. The value is a base64 encoded version of the entire YAML config file.
If this variable is found, the filesystem based config setup will be skipped.

### Loading From a Compressed Environment Variable

The config YAML may also be loaded from a `BEDROCK_CONFIG_GZIP` environment
variable. The value is the entire YAML config file, gzipped and then base64
encoded. This is useful when the config is stored somewhere with a size limit,
such as an AWS Secrets Manager secret, which caps a stored value at 64 KB;
YAML and PEM text typically compress by roughly 3-4x.

To produce a value:

```
gzip -c config.yaml | base64
```

To inspect one:

```
echo "$BEDROCK_CONFIG_GZIP" | base64 -d | gunzip
```

Only one of `BEDROCK_CONFIG_GZIP` or `BEDROCK_CONFIG` may be set. Setting both
is ambiguous and fails at startup rather than silently ignoring one of them.

The value is decoded strictly: if `BEDROCK_CONFIG_GZIP` is set but is not valid
gzip, startup fails with a `BEDROCK_CONFIG_GZIP is invalid` error rather than
falling back to `BEDROCK_CONFIG`. When `BEDROCK_CONFIG_GZIP` is unset,
`BEDROCK_CONFIG` behaves exactly as before.

## Config Value Transformers

A config may compute individual values at load time using *transformers*,
addressed with a `$NAME` key:

```yaml
database:
  password: {$SECRET: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:db-Ab1'}
  host: {$ENV: DB_HOST}
  port: {$ENV: {name: DB_PORT, type: number, default: 5432}}
```

The same syntax works in JSON, since YAML is a superset of it:

```json
{
  "database": {
    "host": {"$ENV": "DB_HOST"},
    "port": {"$ENV": {"name": "DB_PORT", "type": "number", "default": 5432}}
  }
}
```

A directive is an object whose **only** key is `$` followed by the uppercased
name of a transformer. Only uppercase names are reserved, so `{$ref: ...}`,
`{$schema: ...}`, and MongoDB-style `{$gt: 5}` remain ordinary config values. A
directive key sharing its object with other keys is a mistake and fails the
load rather than being silently treated as a value.

Directives are resolved after the config is parsed and before it is merged into
`bedrock.config`, and may be async, which is what makes remote lookups such as
the one above possible. Aside from the built-in `env`, this module ships no
transformers; applications provide their own. A config that uses none is parsed
and merged exactly as before.

### Enabling Transformers

A transformer must be both **registered** in application code and **allowed** by
the `config-yaml.transformers.allow` config. Registration is usually a side
effect of an import; the allow list is what actually turns a transformer on.
Nothing is allowed by default:

```js
import * as bedrock from '@bedrock/core';
// application code that registers `secret`, `ssm`, and `kms-decrypt`
import './lib/aws-transformers.js';
import '@bedrock/config-yaml';

// only these two may be used by a config; `true` allows all registered
bedrock.config['config-yaml'].transformers.allow = ['env', 'secret'];
```

A transformer that is not registered, or not allowed, fails startup rather than
being left in the config as an unresolved object.

A deployment config may set `config-yaml.transformers` itself, so an operator
can enable a transformer without an application change:

```yaml
config-yaml:
  transformers:
    allow: ['env']
```

Settings carried by a config are applied before the directives in that same
config are resolved, and a `core` config's settings apply to the `app` config
that follows it.

Registration is therefore the security boundary: a config can enable only
transformers the application has already registered, and `env` is the only one
this module registers on its own. The allow list is the operational switch over
that set.

### Built-in `env` Transformer

`$ENV` reads an environment variable. It is registered by default but, like any
transformer, must be added to the allow list before it can be used.

```yaml
host: {$ENV: DB_HOST}                        # required; fails if unset
port: {$ENV: {name: DB_PORT, type: number}}  # string, number, boolean, json
debug: {$ENV: {name: DEBUG, type: boolean, default: false}}
```

Values are strings unless `type` is given, so `{$ENV: WORKERS}` yields `"2"`,
not `2`. An unset variable with no `default` fails the config load rather than
silently becoming `undefined`.

`$ENV` lets whoever controls the config read *any* environment variable and
place it anywhere in the config. To narrow that:

```js
config['config-yaml'].transformers.env.allow = ['DB_HOST', /^MYAPP_/];
```

### Writing a Transformer

```js
import {registerTransformer, TransformError} from '@bedrock/config-yaml';

registerTransformer({
  name: 'secret',                 // used as `{$SECRET: ...}`
  kinds: ['scalar', 'mapping'],   // value shapes accepted; default: ['scalar']
  async transform({value, path, settings, configType, signal}) {
    return await fetchSecret(value, {signal});
  }
});
```

`transform` receives the directive's value as `value` and may return any value,
including an object that expands into a subtree of config. It may be sync or
async, and must be registered before `bedrock.start()` is called. `settings` is
this transformer's own config, read from `config-yaml.transformers.<name>` --
the same place the built-in `env` reads `env.allow` from.

Directives may be nested, innermost first, so a transformer always receives
fully resolved input:

```yaml
apiKey: {$BASE64: {value: {$SECRET: 'arn:aws:secretsmanager:...:b64-key-Ab1'}}}
```

Transformer errors are reported with the transformer name and config path, never
the value; the underlying error is logged at `debug` level instead. A
transformer may throw a `TransformError` to add the reason it failed, which must
not contain config values or resolved secrets:

```
Failed to load config: config transformer "$ENV" at "database.host" requires
the "DB_HOST" environment variable, which is not set
```

### Other Settings

```js
// bounds the whole resolution pass, so a hung lookup fails startup
config['config-yaml'].transformers.timeout = 30000;
// resolve identical directives, e.g. the same secret, once per load
config['config-yaml'].transformers.cache = true;
```

## License

[Apache License, Version 2.0](LICENSE) Copyright 2011-2024 Digital Bazaar, Inc.

Other Bedrock libraries are available under a non-commercial license for uses
such as self-study, research, personal projects, or for evaluation purposes.
See the
[Bedrock Non-Commercial License v1.0](https://github.com/digitalbazaar/bedrock/blob/main/LICENSES/LicenseRef-Bedrock-NC-1.0.txt)
for details.

Commercial licensing and support are available by contacting
[Digital Bazaar](https://digitalbazaar.com/) <support@digitalbazaar.com>.
