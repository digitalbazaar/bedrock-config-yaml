/*
 * Copyright (c) 2020-2021 Digital Bazaar, Inc. All rights reserved.
 */
'use strict';

const bedrock = require('bedrock');
const {config} = bedrock;

describe('bedrock-config-yaml', () => {
  it('app yaml configuration should be merged into bedrock config', () => {
    const testBedrockModuleConfig = {
      bar: 'fromBedrockConfig',
      foo: 'fromYaml',
      overwriteMe: 'fromYaml',
    };

    config['test-bedrock-module'].should.eql(testBedrockModuleConfig);
  });
  it('core yaml configuration should be merged into bedrock config', () => {
    should.exist(config.loggers.console.someLoggerConfig);
    config.loggers.console.someLoggerConfig.should.be.a('string');
    config.loggers.console.someLoggerConfig.should.equal('foo');
  });
});
