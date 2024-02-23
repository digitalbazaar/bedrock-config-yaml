/*!
 * Copyright (c) 2020-2022 Digital Bazaar, Inc. All rights reserved.
 */
import {config} from '@bedrock/core';
import {applyConfigFromEnv} from '@bedrock/config-yaml';

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
    process.env.BEDROCK_CONFIG = 'dGVzdC1iZWRyb2NrLWVudi15YW1sOgogIHRlc3RFb' +
      'nZWYWx1ZTogMTIzMTIzMTIzMTIz';

    applyConfigFromEnv();

    config['test-bedrock-env-yaml'].should.eql({
      testEnvValue: 123123123123
    });
  });
});
