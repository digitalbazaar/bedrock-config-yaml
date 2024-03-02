/*!
 * Copyright 2020 - 2024 Digital Bazaar, Inc.
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
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import '@bedrock/config-yaml';

const {config} = bedrock;
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
