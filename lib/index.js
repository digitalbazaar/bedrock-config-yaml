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
import {getAwsSource, readConfigFromAws} from './aws.js';
import {
  getTransformerConfig, lockTransformers, parseConfig, resolveTransformers
} from './transformers.js';
import {safeError, safeMessage} from './error.js';
import fs from 'node:fs/promises';
import {logger} from './logger.js';
import path from 'node:path';
import {promisify} from 'node:util';
import zlib from 'node:zlib';

import './config.js';
import './env-transformer.js';

export {registerTransformer} from './transformers.js';
export {TransformError} from './error.js';

const gunzip = promisify(zlib.gunzip);

const {config} = bedrock;

const namespace = 'config-yaml';
const cfg = config[namespace];
let awsConfigPromise;

bedrock.events.on('bedrock-cli.parsed', async function applyConfig() {
  // ensure that bedrock-config-yaml is the last `bedrock-cli.parsed` handler
  const listeners = bedrock.events.listeners('bedrock-cli.parsed');
  if(listeners[listeners.length - 1] !== applyConfig) {
    throw new Error('"bedrock-config-yaml" must be the last import.');
  }

  if(process.env.BEDROCK_CONFIG_GZIP || process.env.BEDROCK_CONFIG) {
    await _applyConfigFromEnv({configType: 'core'});
  } else if(await getAwsSource()) {
    await _applyConfigFromAws({configType: 'core'});
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

  try {
    if(process.env.BEDROCK_CONFIG_GZIP || process.env.BEDROCK_CONFIG) {
      await _applyConfigFromEnv({configType: 'app'});
    } else if(await getAwsSource()) {
      await _applyConfigFromAws({configType: 'app'});
    } else {
      await _applyConfig({configType: 'app'});
    }
  } finally {
    // no config is applied after this point, so a transformer registered later
    // could not be used by one; fail loudly instead
    lockTransformers();
  }
});

function handleConfigLoadError({configType, message}) {
  logger.error(
    `Error loading "${configType}" configuration from environment`);

  throw new Error(`Failed to load config: ${message}`);
}

/**
 * Reads the YAML config from the environment.
 *
 * Exactly one of `BEDROCK_CONFIG_GZIP` or `BEDROCK_CONFIG` may be set; the
 * caller rejects the ambiguous case where both are present. When
 * `BEDROCK_CONFIG_GZIP` is used, its value must be base64-encoded gzipped
 * YAML and is decoded strictly -- a value that is not valid gzip rejects.
 * Otherwise `BEDROCK_CONFIG` is read as base64-encoded YAML.
 *
 * @returns {Promise<string>} - The decoded YAML config.
 */
async function _readConfigFromEnv() {
  if(process.env.BEDROCK_CONFIG_GZIP) {
    const buffer = Buffer.from(process.env.BEDROCK_CONFIG_GZIP, 'base64');
    // rejects if the value is not valid gzip
    return (await gunzip(buffer)).toString('utf8');
  }
  return Buffer.from(process.env.BEDROCK_CONFIG, 'base64').toString();
}

// Exported for test purposes only
export async function _applyConfigFromEnv({configType}) {
  logger.debug(
    `Attempting to apply the "${configType}" configuration from ` +
    `environment variable.`);

  // setting both is ambiguous and most likely a deployment mistake; fail
  // loudly rather than silently ignoring one of them
  if(process.env.BEDROCK_CONFIG_GZIP && process.env.BEDROCK_CONFIG) {
    handleConfigLoadError({
      configType,
      message: 'only one of BEDROCK_CONFIG_GZIP or BEDROCK_CONFIG may be set'
    });
  }

  const envVar = process.env.BEDROCK_CONFIG_GZIP ?
    'BEDROCK_CONFIG_GZIP' : 'BEDROCK_CONFIG';

  try {
    const configYaml = parseConfig(await _readConfigFromEnv());
    if(configYaml[configType]) {
      logger.debug(`"${configType}" configuration found.`);
      _extend(true, config, await _prepareConfig({
        configYaml: configYaml[configType], configType
      }));
    }
  } catch(e) {
    handleConfigLoadError({
      configType, message: safeMessage(e, `${envVar} is invalid`)
    });
  }
}

async function _applyConfigFromAws({configType}) {
  awsConfigPromise ??= readConfigFromAws().then(_parseAwsConfig);
  const combined = await awsConfigPromise;
  const configYaml = combined[configType];
  if(configYaml === undefined) {
    return;
  }
  if(!_isObject(configYaml) || Array.isArray(configYaml)) {
    throw safeError(
      `The AWS ${configType} config section must be an object`);
  }
  _assertAwsSourceIsNotReplaced({configYaml, configType});
  _extend(true, config, await _prepareConfig({configYaml, configType}));
}

function _parseAwsConfig(content) {
  let combined;
  try {
    combined = parseConfig(content);
  } catch(cause) {
    throw safeError('The AWS bedrock config is not valid YAML', cause);
  }
  if(!_isObject(combined) || Array.isArray(combined)) {
    throw safeError('The AWS bedrock config must be an object');
  }
  return combined;
}

function _assertAwsSourceIsNotReplaced({configYaml, configType}) {
  const aws = configYaml?.['config-yaml']?.sources?.aws;
  if(aws !== undefined) {
    throw safeError(
      'The AWS config source cannot replace itself in the ' +
      `${configType} config`);
  }
}

/**
 * Prepares a config for merging by applying any transformer settings it
 * carries and then resolving the transformer directives it contains.
 *
 * The settings are applied first so that a config can enable a transformer and
 * use it, which is what lets a deployment turn one on without an application
 * change. They are merged again with the rest of the config afterwards, which
 * is harmless.
 *
 * Only the section that will actually be merged is resolved. A `combined`
 * config holds both an `app` and a `core` section and is loaded once per
 * section, so resolving the whole document would run the other section's
 * transformers too -- doing its work twice and failing startup on a section
 * that is not being applied yet.
 *
 * @param {object} options - The options to use.
 * @param {*} options.configYaml - The parsed config section to merge.
 * @param {string} options.configType - The config type being applied.
 *
 * @returns {Promise<*>} - The config to merge.
 */
async function _prepareConfig({configYaml, configType}) {
  const transformers = getTransformerConfig(configYaml);
  if(transformers !== undefined) {
    _extend(true, cfg, {transformers});
  }
  return resolveTransformers({configYaml, configType});
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
        let configYaml = parseConfig(content);

        // apply the combined config if it contains a section
        // that corresponds to `configType`
        if(type === 'combined' && configYaml[configType]) {
          configYaml = configYaml[configType];
        }

        // params: deep, target, source
        _extend(true, config, await _prepareConfig({configYaml, configType}));
      } else {
        logger.debug(`"${type}" configuration not found "${configFile}".`);
      }
    }
  } catch(e) {
    handleConfigLoadError({
      configType, message: safeMessage(e, 'bedrock config is invalid')
    });
  }
}

/**
 * Keys that reach the prototype chain rather than the config. Reading
 * `target.__proto__` yields `Object.prototype`, so a deep merge of a config
 * containing one would modify every object in the process; `constructor`
 * reaches `Object.prototype` in turn. YAML has no legitimate use for them, so
 * a config that contains one is rejected rather than silently dropped.
 */
const FORBIDDEN_KEYS = ['__proto__', 'constructor', 'prototype'];

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
      if(FORBIDDEN_KEYS.includes(name)) {
        throw safeError(`"${name}" is not a permitted config key`);
      }
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
