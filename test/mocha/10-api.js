/*!
 * Copyright (c) 2020-2022 Digital Bazaar, Inc. All rights reserved.
 */
import {config} from 'bedrock';

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
});
