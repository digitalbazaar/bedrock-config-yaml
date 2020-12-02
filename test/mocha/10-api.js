/*
 * Copyright (c) 2020 Digital Bazaar, Inc. All rights reserved.
 */
'use strict';

const bedrock = require('bedrock');
const {config} = bedrock;

describe('bedrock-config-yaml', () => {
  it('yaml configuration should be merged into bedrock config', () => {
    const testBedrockModuleConfig = {
      bar: 'fromBedrockConfig',
      foo: 'fromYaml',
      overwriteMe: 'fromYaml',
    };

    config['test-bedrock-module'].should.eql(testBedrockModuleConfig);
  });
});
