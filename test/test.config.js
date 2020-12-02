/*
 * Copyright (c) 2020 Digital Bazaar, Inc. All rights reserved.
 */
'use strict';

const {config} = require('bedrock');
const path = require('path');

config.mocha.tests.push(path.join(__dirname, 'mocha'));

config['config-yaml'].path = path.join(__dirname);

// config for mock test-bedrock-module
config['test-bedrock-module'] = {
  bar: 'fromBedrockConfig',
  overwriteMe: 'fromBedrockConfig',
};
