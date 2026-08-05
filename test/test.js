/*!
 * Copyright 2020 - 2026 Digital Bazaar, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import * as bedrock from '@bedrock/core';
import {registerTransformer, TransformError} from '@bedrock/config-yaml';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const {config} = bedrock;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

config['config-yaml'].app.path = path.join(__dirname, 'mock-configs');
config['config-yaml'].combined.path = path.join(__dirname, 'mock-configs');
config['config-yaml'].core.path = path.join(__dirname, 'mock-configs');

// config for mock test-bedrock-module
config['test-bedrock-module'] = {
  bar: 'fromBedrockConfig',
  overwriteMe: 'fromBedrockConfig'
};

// state shared with the transformer tests
const testState = config['test-transformers'] = {
  // the allow list this module ships with, captured before it is overridden
  // below, so the tests can assert that transformers are off by default
  defaultAllow: config['config-yaml'].transformers.allow,
  calls: []
};

registerTransformer({
  name: 'test-echo',
  kinds: ['mapping', 'scalar', 'sequence'],
  transform({value, name, kind, path, configType}) {
    testState.calls.push({name, kind, path, configType, value});
    return kind === 'scalar' ? `echo:${value}` : value;
  }
});

// registered but never added to the allow list
registerTransformer({
  name: 'test-not-allowed',
  transform({value}) {
    return `should-not-happen:${value}`;
  }
});

// throws an error whose message must not reach the caller
registerTransformer({
  name: 'test-throws',
  transform() {
    throw new Error('unsafe-1337');
  }
});

// throws an error whose message is declared safe to surface
registerTransformer({
  name: 'test-throws-safe',
  transform() {
    throw new TransformError('safe-detail');
  }
});

// never settles, to exercise the resolution timeout
registerTransformer({
  name: 'test-hangs',
  transform() {
    return new Promise(() => {});
  }
});

config['config-yaml'].transformers.allow = [
  'env', 'test-echo', 'test-hangs', 'test-throws', 'test-throws-safe'
];

process.env.TEST_CONFIG_YAML_APP = 'fromEnvVar';
process.env.TEST_CONFIG_YAML_PORT = '18443';

import '@bedrock/test';
bedrock.start();
