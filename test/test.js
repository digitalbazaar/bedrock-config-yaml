/*!
 * Copyright (c) 2020-2022 Digital Bazaar, Inc. All rights reserved.
 */
import * as bedrock from '@bedrock/core';
import {fileURLToPath} from 'url';
import path from 'path';
import '@bedrock/config-yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

config['config-yaml'].app.path = path.join(__dirname, 'mock-configs');
config['config-yaml'].combined.path = path.join(__dirname, 'mock-configs');
config['config-yaml'].core.path = path.join(__dirname, 'mock-configs');

// config for mock test-bedrock-module
config['test-bedrock-module'] = {
  bar: 'fromBedrockConfig',
  overwriteMe: 'fromBedrockConfig',
};

import '@bedrock/test';
bedrock.start();
