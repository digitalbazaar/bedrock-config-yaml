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

import {config} from '@bedrock/core';
import path from 'node:path';
import '@bedrock/aws-kms';

const namespace = 'config-yaml';
const cfg = config[namespace] = {app: {}, combined: {}, core: {}};

// The Bedrock events described below are documented here:
// https://github.com/digitalbazaar/bedrock#bedrockevents

// applied by the last handler for `bedrock.configure`
cfg.app.path = path.join('/etc', 'bedrock-config');
cfg.app.filename = 'app.yaml';

// applied by the last handler for `bedrock-cli.parsed`
cfg.core.path = path.join('/etc', 'bedrock-config');
cfg.core.filename = 'core.yaml';

// a combined config may include both an `app` and `core` section
cfg.combined.path = path.join('/etc', 'bedrock-config');
cfg.combined.filename = 'combined.yaml';

cfg.sources = {
  aws: {
    enabled: false,
    environment: null,
    configLocationTag: 'BedrockConfigSecretName'
  }
};

config['aws-kms'].clients['config-yaml'] = {};

// config value transformers; a deployment config may set these itself, so that
// an operator can enable a transformer without an application change. Only
// transformers the application has registered can be enabled
cfg.transformers = {
  // names of registered transformers that YAML configs may use; `true` allows
  // every registered transformer. Nothing is enabled by default
  allow: [],
  // maximum time, in milliseconds, for all transformers in a single config
  // load; a transformer that hangs must not hang startup indefinitely
  timeout: 30000,
  // true to resolve identical directives, such as the same secret referenced
  // from several config paths, only once per config load
  cache: true,
  // built-in `env` transformer
  env: {
    // `true` allows any environment variable to be read; an array of names
    // and/or regular expressions restricts which ones may be
    allow: true
  }
};
