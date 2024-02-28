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

import {config} from '@bedrock/core';
import path from 'node:path';

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
