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

import {isPlainObject, registerTransformer} from './transformers.js';
import {TransformError} from './error.js';

const TYPES = ['boolean', 'json', 'number', 'string'];

const BOOLEANS = new Map([
  ['true', true], ['1', true], ['yes', true], ['on', true],
  ['false', false], ['0', false], ['no', false], ['off', false]
]);

// the built-in `env` transformer is registered but, like every other
// transformer, is not usable until it is added to the
// `config-yaml.transformers.allow` config. The resolver prefixes these
// messages with the directive and its config path
registerTransformer({
  name: 'env',
  kinds: ['mapping', 'scalar'],
  transform({value, settings}) {
    const options = typeof value === 'string' ? {name: value} : value;
    if(!(isPlainObject(options) && typeof options.name === 'string' &&
      options.name.length > 0)) {
      throw new TransformError(
        'requires an environment variable name, either as a scalar or as ' +
        'the "name" option');
    }

    const {name, type = 'string'} = options;
    if(!TYPES.includes(type)) {
      throw new TransformError(
        `has an unknown "type" option; expected one of: ${TYPES.join(', ')}`);
    }
    if(!_isEnvVarAllowed({name, allow: settings.allow ?? true})) {
      throw new TransformError(
        `may not read the "${name}" environment variable; it is excluded by ` +
        'the "config-yaml.transformers.env.allow" config');
    }

    const raw = process.env[name];
    if(raw === undefined) {
      if('default' in options) {
        return options.default;
      }
      // an unset variable that silently became `undefined` would surface far
      // from its cause, so it fails the config load instead
      throw new TransformError(
        `requires the "${name}" environment variable, which is not set`);
    }
    return _coerce({raw, type, name});
  }
});

function _coerce({raw, type, name}) {
  // the raw value may be sensitive, so it is never quoted back
  const expected = reason => new TransformError(
    `expected the "${name}" environment variable to be ${reason}`);

  if(type === 'string') {
    return raw;
  }
  if(type === 'number') {
    const value = Number(raw);
    if(raw.trim() === '' || !Number.isFinite(value)) {
      throw expected('a number');
    }
    return value;
  }
  if(type === 'boolean') {
    const value = BOOLEANS.get(raw.trim().toLowerCase());
    if(value === undefined) {
      throw expected(
        `a boolean; expected one of: ${[...BOOLEANS.keys()].join(', ')}`);
    }
    return value;
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw expected('valid JSON');
  }
}

function _isEnvVarAllowed({name, allow}) {
  if(allow === true) {
    return true;
  }
  if(!Array.isArray(allow)) {
    return false;
  }
  return allow.some(
    entry => entry instanceof RegExp ? entry.test(name) : entry === name);
}
