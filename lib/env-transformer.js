/*!
 * Copyright 2026 Digital Bazaar, Inc.
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

import {registerTransformer, TransformError} from './transformers.js';
import {config} from '@bedrock/core';

const namespace = 'config-yaml';

const TYPES = ['boolean', 'json', 'number', 'string'];

const BOOLEANS = new Map([
  ['true', true], ['1', true], ['yes', true], ['on', true],
  ['false', false], ['0', false], ['no', false], ['off', false]
]);

// the built-in `env` transformer is registered but, like every other
// transformer, is not usable until it is added to the
// `config-yaml.transformers.allow` config
registerTransformer({
  name: 'env',
  kinds: ['mapping', 'scalar'],
  transform({value, path}) {
    const options = typeof value === 'string' ? {name: value} : value;
    if(!(options?.constructor === Object && typeof options.name === 'string' &&
      options.name.length > 0)) {
      throw new TransformError(
        `"!env" at "${path}" requires an environment variable name, either ` +
        'as a scalar or as the "name" option');
    }

    const {name, type = 'string'} = options;
    if(!TYPES.includes(type)) {
      throw new TransformError(
        `"!env" at "${path}" has an unknown "type" option; expected one of: ` +
        `${TYPES.join(', ')}`);
    }
    if(!_isEnvVarAllowed(name)) {
      throw new TransformError(
        `"!env" at "${path}" may not read the "${name}" environment ` +
        `variable; it is excluded by the ` +
        `"${namespace}.transformers.env.allow" config`);
    }

    const raw = process.env[name];
    if(raw === undefined) {
      if('default' in options) {
        return options.default;
      }
      // an unset variable that silently became `undefined` would surface far
      // from its cause, so it fails the config load instead
      throw new TransformError(
        `"!env" at "${path}" requires the "${name}" environment variable, ` +
        'which is not set');
    }
    return _coerce({raw, type, name, path});
  }
});

function _coerce({raw, type, name, path}) {
  if(type === 'string') {
    return raw;
  }
  if(type === 'number') {
    const value = Number(raw);
    if(raw.trim() === '' || !Number.isFinite(value)) {
      throw new TransformError(
        `"!env" at "${path}" expected the "${name}" environment variable to ` +
        'be a number');
    }
    return value;
  }
  if(type === 'boolean') {
    const value = BOOLEANS.get(raw.trim().toLowerCase());
    if(value === undefined) {
      throw new TransformError(
        `"!env" at "${path}" expected the "${name}" environment variable to ` +
        `be a boolean; expected one of: ${[...BOOLEANS.keys()].join(', ')}`);
    }
    return value;
  }
  try {
    return JSON.parse(raw);
  } catch {
    // the parse error quotes the value, which may be sensitive
    throw new TransformError(
      `"!env" at "${path}" expected the "${name}" environment variable to ` +
      'be valid JSON');
  }
}

function _isEnvVarAllowed(name) {
  const {allow = true} = config[namespace]?.transformers?.env ?? {};
  if(allow === true) {
    return true;
  }
  if(!Array.isArray(allow)) {
    return false;
  }
  return allow.some(
    entry => entry instanceof RegExp ? entry.test(name) : entry === name);
}
