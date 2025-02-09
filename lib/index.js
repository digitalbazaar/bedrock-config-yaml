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
import fs from 'node:fs/promises';
import jsYaml from 'js-yaml';
import {logger} from './logger.js';
import path from 'node:path';

import './config.js';

const {config} = bedrock;

const namespace = 'config-yaml';
const cfg = config[namespace];

bedrock.events.on('bedrock-cli.parsed', async function applyConfig() {
  // ensure that bedrock-config-yaml is the last `bedrock-cli.parsed` handler
  const listeners = bedrock.events.listeners('bedrock-cli.parsed');
  if(listeners[listeners.length - 1] !== applyConfig) {
    throw new Error('"bedrock-config-yaml" must be the last import.');
  }

  if(process.env.BEDROCK_CONFIG) {
    _applyConfigFromEnv({configType: 'core'});
  } else {
    await _applyConfig({configType: 'core'});
  }
});

bedrock.events.on('bedrock.configure', async function applyConfig() {
  // ensure that bedrock-config-yaml is the last `bedrock.configure` handler
  const listeners = bedrock.events.listeners('bedrock.configure');
  if(listeners[listeners.length - 1] !== applyConfig) {
    throw new Error('"bedrock-config-yaml" must be the last import.');
  }

  if(process.env.BEDROCK_CONFIG) {
    _applyConfigFromEnv({configType: 'app'});
  } else {
    await _applyConfig({configType: 'app'});
  }
});

function handleConfigLoadError({configType, message}) {
  logger.error(
    `Error loading "${configType}" configuration from environment`);

  throw new Error(`Failed to load config: ${message}`);
}

// Exported for test purposes only
export function _applyConfigFromEnv({configType}) {
  logger.debug(
    `Attempting to apply the "${configType}" configuration from ` +
    `environment variable.`);

  try {
    const configYaml = jsYaml.load(
      Buffer.from(process.env.BEDROCK_CONFIG, 'base64').toString()
    );
    if(configYaml[configType]) {
      logger.debug(`"${configType}" configuration found.`);
      _extend(true, config, configYaml[configType]);
    }
  } catch(e) {
    handleConfigLoadError({configType, message: 'BEDROCK_CONFIG is invalid'});
  }
}

async function readIfExists(file, options) {
  try {
    return {
      found: true,
      content: await fs.readFile(file, options)
    };
  } catch(e) {
    if(e.code === 'ENOENT') {
      return {
        found: false
      };
    }

    throw e;
  }
}

// Exported for test purposes only
export async function _applyConfig({configType}) {
  logger.debug(`Attempting to apply the "${configType}" configuration.`);
  // attempt to load the YAML file specified by the config
  const types = ['combined', configType];
  try {
    for(const type of types) {
      const configFile = path.join(cfg[type].path, cfg[type].filename);

      const {
        found: configExists,
        content
      } = await readIfExists(configFile, 'utf8');

      if(configExists) {
        logger.debug(`"${type}" configuration found "${configFile}".`);
        let configYaml = jsYaml.load(content);

        // apply the combined config if it contains a section
        // that corresponds to `configType`
        if(type === 'combined' && configYaml[configType]) {
          configYaml = configYaml[configType];
        }

        // params: deep, target, source
        _extend(true, config, configYaml);
      } else {
        logger.debug(`"${type}" configuration not found "${configFile}".`);
      }
    }
  } catch(e) {
    handleConfigLoadError({configType, message: 'bedrock config is invalid'});
  }
}

/**
 * Merges the contents of one or more objects into the first object.
 *
 * Arguments:
 * `deep` (optional), true to do a deep-merge
 * `target` the target object to merge properties into
 * `objects` N objects to merge into the target.
 *
 * @returns {object} - The extended object.
 */
function _extend() {
  let deep = false;
  let i = 0;
  if(arguments.length > 0 && typeof arguments[0] === 'boolean') {
    deep = arguments[0];
    ++i;
  }
  const target = arguments[i] || {};
  i++;
  for(; i < arguments.length; ++i) {
    const obj = arguments[i] || {};
    Object.keys(obj).forEach(function(name) {
      const value = obj[name];
      if(deep && _isObject(value) && !Array.isArray(value)) {
        target[name] = _extend(true, target[name], value);
      } else {
        target[name] = value;
      }
    });
  }
  return target;
}

function _isObject(x) {
  return x && typeof x === 'object';
}
