# bedrock-config-yaml
This module is used to layer a deployment Bedrock configuration defined in
a YAML file onto `bedrock.config`. Values defined in the YAML config may add
and overwrite values in `bedrock.config`. The YAML configuration is applied
after all conventional Bedrock module configuration has been completed. If
there is no YAML configuration file found in the location specified by the
`bedrock-config-yaml` config, Bedrock startup proceeds normally and no
configuration changes are applied.

## Usage
The default location for the YAML configuration file is:
```
/etc/bedrock-config/config.yaml
```

### Sample `config.yaml`
```yaml
test-bedrock-module:
  foo: fromYaml
  overwriteMe: fromYaml
```
