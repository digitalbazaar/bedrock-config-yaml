/*
 * Copyright (c) 2020-2021 Digital Bazaar, Inc. All rights reserved.
 */
const bedrock = require('bedrock');
const path = require('path');
const {config} = bedrock;
require('bedrock-config-yaml');

config['config-yaml'].app.path = path.join(__dirname, 'mock-configs');
config['config-yaml'].combined.path = path.join(__dirname, 'mock-configs');
config['config-yaml'].core.path = path.join(__dirname, 'mock-configs');

// config for mock test-bedrock-module
config['test-bedrock-module'] = {
  bar: 'fromBedrockConfig',
  overwriteMe: 'fromBedrockConfig',
};

require('bedrock-test');
bedrock.start();
