/*!
 * Copyright (c) 2020-2022 Digital Bazaar, Inc. All rights reserved.
 */
import {config} from '@bedrock/core';
import {_applyConfigFromEnv} from '@bedrock/config-yaml';

describe('bedrock-config-yaml', () => {
  it('app yaml configuration should be merged into bedrock config', () => {
    const testBedrockModuleConfig = {
      bar: 'fromBedrockConfig',
      combinedAppValue: 'hPtQMAHvzECxDRJd',
      foo: 'fromYaml',
      overwriteMe: 'fromYaml',
    };

    config['test-bedrock-module'].should.eql(testBedrockModuleConfig);
  });
  it('core yaml configuration should be merged into bedrock config', () => {
    should.exist(config.loggers.console.someLoggerConfig);
    config.loggers.console.someLoggerConfig.should.be.a('string');
    config.loggers.console.someLoggerConfig.should.equal('foo');
    should.exist(config.loggers.console.someLoggerCombinedConfig);
    config.loggers.console.someLoggerCombinedConfig.should.be.a('string');
    config.loggers.console.someLoggerCombinedConfig
      .should.equal('FDRqpNJLVkgfVxPe');
  });
  it('configuration can be loaded via environment variable', async () => {
    process.env.BEDROCK_CONFIG = 'YXBwOgogIHRlc3QtYmVkcm9jay1lbnYteWFtbDoKI' +
      'CAgIHRlc3RFbnZWYWx1ZTogMTIzMTIzMTIzMTIzCmNvcmU6CiAgdGVzdC1jb3JlLWVud' +
      'jogOTg3NTUzIA==';

    should.not.exist(config['test-bedrock-env-yaml']);
    should.not.exist(config['test-core-env']);

    _applyConfigFromEnv({configType: 'core'});

    should.not.exist(config['test-bedrock-env-yaml']);
    config['test-core-env'].should.eql(987553);

    _applyConfigFromEnv({configType: 'app'});

    config['test-core-env'].should.eql(987553);
    config['test-bedrock-env-yaml'].should.eql({
      testEnvValue: 123123123123
    });
  });
});
