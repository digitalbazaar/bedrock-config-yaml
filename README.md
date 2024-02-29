# bedrock-config-yaml
This module is used to layer a deployment Bedrock configuration defined in
a YAML file onto `bedrock.config`. Values defined in the YAML config may add
and overwrite values in `bedrock.config`. The YAML configuration is applied
after all conventional Bedrock module configuration has been completed. If
there is no YAML configuration file found in the location specified by the
`bedrock-config-yaml` config, Bedrock startup proceeds normally and no
configuration changes are applied.

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

## License

[Apache License, Version 2.0](LICENSE) Copyright 2011-2024 Digital Bazaar, Inc.

Other Bedrock libraries are available under a non-commercial license for uses
such as self-study, research, personal projects, or for evaluation purposes.
See the
[Bedrock Non-Commercial License v1.0](https://github.com/digitalbazaar/bedrock/blob/main/LICENSES/LicenseRef-Bedrock-NC-1.0.txt)
for details.

Commercial licensing and support are available by contacting
[Digital Bazaar](https://digitalbazaar.com/) <support@digitalbazaar.com>.
