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

import {safeError, safeMessage} from './error.js';
import {config} from '@bedrock/core';
import jsYaml from 'js-yaml';
import {logger} from './logger.js';

const namespace = 'config-yaml';

const KINDS = ['mapping', 'scalar', 'sequence'];
const NAME_REGEX = /^[a-z][a-z0-9_-]*$/i;

// A directive is an object whose only key is `$` followed by the uppercased
// name of a transformer, e.g. `{$ENV: DB_HOST}`. The same syntax works in YAML
// and JSON, which is a superset relationship, so one form serves both.
//
// Only uppercase names are reserved. Every established `$` key convention --
// JSON Schema `$ref`, `$schema`, `$id`; MongoDB `$gt`, `$set` -- is lowercase,
// so those remain ordinary config values.
const DIRECTIVE_KEY_REGEX = /^\$[A-Z][A-Z0-9_-]*$/;

// registered transformers, by name
const transformers = new Map();

// set once the `app` config has been applied; registering after that point is
// a module import ordering mistake and would silently have no effect
let locked = false;

/**
 * Registers a config value transformer, making its directive key available to
 * configs. A transformer must also be named in the
 * `config-yaml.transformers.allow` config before it may be used; registering
 * makes a transformer available, the allow list enables it.
 *
 * Transformers must be registered before `@bedrock/config-yaml` applies the
 * `app` config, which in practice means at module import time.
 *
 * @param {object} options - The options to use.
 * @param {string} options.name - The transformer name; its directive key is
 *   `$` followed by the uppercased name, e.g. `secret` for `{$SECRET: ...}`.
 * @param {Function} options.transform - Called as
 *   `transform({value, name, kind, path, settings, configType, signal})` with
 *   the already-resolved directive value; may be async and may return any
 *   config value. `settings` is this transformer's own config, read from
 *   `config-yaml.transformers.<name>`.
 * @param {Array<string>} [options.kinds=['scalar']] - The value shapes the
 *   transformer accepts; any of `scalar`, `sequence`, and `mapping`.
 */
export function registerTransformer({
  name, transform, kinds = ['scalar']
} = {}) {
  if(typeof name !== 'string' || !NAME_REGEX.test(name)) {
    throw new TypeError(
      'Config transformer "name" must be a string beginning with a letter ' +
      'and containing only letters, digits, "-", and "_".');
  }
  if(typeof transform !== 'function') {
    throw new TypeError('Config transformer "transform" must be a function.');
  }
  if(!(Array.isArray(kinds) && kinds.length > 0 &&
    kinds.every(kind => KINDS.includes(kind)))) {
    throw new TypeError(
      `Config transformer "kinds" must be a non-empty array of: ` +
      `${KINDS.join(', ')}.`);
  }
  if(locked) {
    throw new Error(
      `Cannot register config transformer "${name}"; the "app" configuration ` +
      'has already been applied. Transformers must be registered before ' +
      '"bedrock.start()" is called.');
  }
  if(transformers.has(name)) {
    throw new Error(`Config transformer "${name}" is already registered.`);
  }
  transformers.set(name, {name, transform, kinds: [...new Set(kinds)]});
}

/**
 * Prevents any further transformer registration. Called once the `app` config
 * has been applied, after which registering could not affect any config.
 */
export function lockTransformers() {
  locked = true;
}

/**
 * Parses a YAML config, leaving any transformer directives it contains
 * unresolved. YAML is a superset of JSON, so a JSON config parses here too.
 *
 * @param {string} content - The config to parse.
 *
 * @returns {*} - The parsed config.
 */
export function parseConfig(content) {
  return jsYaml.load(content);
}

/**
 * Returns the transformer config carried by a config about to be merged, if
 * any. A deployment config may enable transformers itself, so that operators
 * can turn one on without an application change; the settings it carries are
 * applied before the directives in that same config are resolved.
 *
 * This does not widen what a deployment can reach: a config can only enable
 * transformers the application has already registered.
 *
 * @param {*} configYaml - The config that is about to be merged.
 *
 * @returns {object|undefined} - The transformer config, if any.
 */
export function getTransformerConfig(configYaml) {
  if(!(isPlainObject(configYaml) && isPlainObject(configYaml[namespace]))) {
    return undefined;
  }
  const settings = configYaml[namespace].transformers;
  if(settings === undefined) {
    return undefined;
  }
  // resolving these would require the settings they are meant to establish
  if(_hasDirectives(settings)) {
    throw safeError(
      `"${namespace}.transformers" may not contain config transformers`);
  }
  return settings;
}

/**
 * Resolves every transformer directive in a parsed config, returning a config
 * with each directive replaced by its transformed value. A config that
 * contains no directives is returned unchanged.
 *
 * Directives are resolved depth-first, so a transformer always receives fully
 * resolved input, and concurrently, so unrelated directives do not serialize.
 *
 * @param {object} options - The options to use.
 * @param {*} options.configYaml - The parsed config.
 * @param {string} options.configType - The config type being applied, `core`
 *   or `app`.
 *
 * @returns {Promise<*>} - The resolved config.
 */
export async function resolveTransformers({configYaml, configType}) {
  if(!_hasDirectives(configYaml)) {
    return configYaml;
  }

  const {allow, timeout, cache, settings} = _getSettings();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  // never hold the process open on the timeout alone
  timer.unref?.();

  const ctx = {
    allow,
    configType,
    settings,
    signal: controller.signal,
    // dedupes identical directives, e.g. the same secret referenced from
    // several config paths, within a single config load
    cache: cache ? new Map() : null,
    // dedupes YAML aliases, which make one node reachable from several paths
    seen: new Map()
  };

  try {
    return await Promise.race([
      _resolveNode({node: configYaml, path: '', ctx}),
      new Promise((_, reject) => {
        controller.signal.addEventListener('abort', () => reject(safeError(
          `config transformers did not complete within ${timeout}ms`)),
        {once: true});
      })
    ]);
  } finally {
    clearTimeout(timer);
    // resolved values may be secrets; do not keep them past the config load
    ctx.cache?.clear();
    ctx.seen.clear();
  }
}

/**
 * Returns true if a value is an object that a config may nest values in, as
 * opposed to a `Date`, a `Buffer`, or a transformer directive.
 *
 * @param {*} x - The value to test.
 *
 * @returns {boolean} - True if the value is a plain object.
 */
export function isPlainObject(x) {
  if(x === null || typeof x !== 'object') {
    return false;
  }
  const proto = Object.getPrototypeOf(x);
  return proto === Object.prototype || proto === null;
}

async function _resolveNode({node, path, ctx}) {
  if(Array.isArray(node)) {
    return _memoize(ctx.seen, node, () => Promise.all(node.map(
      (value, index) => _resolveNode({
        node: value, path: `${path}[${index}]`, ctx
      }))));
  }
  if(isPlainObject(node)) {
    const key = _directiveKey({node, path});
    if(key !== undefined) {
      return _memoize(ctx.seen, node,
        () => _resolveDirective({key, value: node[key], path, ctx}));
    }
    return _memoize(ctx.seen, node, async () => Object.fromEntries(
      await Promise.all(Object.entries(node).map(async ([key, value]) => [
        key,
        await _resolveNode({
          node: value, path: path ? `${path}.${key}` : key, ctx
        })
      ]))));
  }
  return node;
}

/**
 * Returns the directive key of an object, if it is a directive. An object
 * carrying a directive key alongside anything else is almost certainly a
 * mistake, so it is rejected rather than quietly treated as a plain value.
 *
 * @param {object} options - The options to use.
 * @param {object} options.node - The plain object to test.
 * @param {string} options.path - The config path, for error messages.
 *
 * @returns {string|undefined} - The directive key, if any.
 */
function _directiveKey({node, path}) {
  const keys = Object.keys(node);
  const key = keys.find(key => DIRECTIVE_KEY_REGEX.test(key));
  if(key !== undefined && keys.length > 1) {
    throw safeError(
      `config transformer "${key}" at "${path || '(root)'}" must be the only ` +
      'key in its object');
  }
  return key;
}

async function _resolveDirective({key, value: directiveValue, path, ctx}) {
  const name = key.slice(1).toLowerCase();
  const kind = Array.isArray(directiveValue) ? 'sequence' :
    isPlainObject(directiveValue) ? 'mapping' : 'scalar';
  const location = path || '(root)';
  const at = `config transformer "${key}" at "${location}"`;

  const transformer = transformers.get(name);
  if(!transformer) {
    throw safeError(`unknown ${at}`);
  }
  if(!(ctx.allow === true || ctx.allow.has(name))) {
    throw safeError(
      `${at} is not allowed; add it to the ` +
      `"${namespace}.transformers.allow" config`);
  }
  if(!transformer.kinds.includes(kind)) {
    throw safeError(`${at} does not accept a ${kind} value`);
  }

  // resolve any nested directives first so transformers always receive fully
  // resolved input
  const value = await _resolveNode({node: directiveValue, path, ctx});

  const run = async () => {
    try {
      return await transformer.transform({
        value, name, kind, path: location, settings: ctx.settings(name),
        configType: ctx.configType, signal: ctx.signal
      });
    } catch(e) {
      // the underlying error may quote the value it failed on, so only a
      // message the transformer declared safe is surfaced; the rest is logged
      logger.debug(`Config transformer "${name}" failed at "${location}".`,
        {error: e});
      throw safeError(`${at} ${safeMessage(e, 'failed')}`, e);
    }
  };

  // dedupes identical directives; an unserializable value resolves every time
  const cacheKey = ctx.cache && _cacheKey({name, value});
  return cacheKey ? _memoize(ctx.cache, cacheKey, run) : run();
}

// memoizes by key, recording the entry before resolving it so that a
// self-referential YAML alias cannot recurse without bound; `.then(fn)` defers
// `fn` past the `map.set` below
function _memoize(map, key, fn) {
  let promise = map.get(key);
  if(promise === undefined) {
    promise = Promise.resolve().then(fn);
    map.set(key, promise);
  }
  return promise;
}

function _cacheKey({name, value}) {
  try {
    return `${name} ${JSON.stringify(value)}`;
  } catch {
    // not serializable; resolve it every time rather than risk a collision
    return null;
  }
}

// `lib/config.js` owns the defaults; `allow` is normalized here so the point
// of use does not have to know which shapes are accepted
function _getSettings() {
  const cfg = config[namespace].transformers;
  return {
    allow: cfg.allow === true ?
      true : new Set(Array.isArray(cfg.allow) ? cfg.allow : []),
    timeout: cfg.timeout,
    cache: cfg.cache,
    // a transformer's own settings live beside the framework's, under its name
    settings: name => cfg[name] ?? {}
  };
}

function _hasDirectives(node, visited = new Set()) {
  if(!(Array.isArray(node) || isPlainObject(node)) || visited.has(node)) {
    return false;
  }
  visited.add(node);
  // any directive key counts, including one sharing its object with other
  // keys, so that `_resolveNode` reaches it and reports the mistake
  if(Object.keys(node).some(key => DIRECTIVE_KEY_REGEX.test(key))) {
    return true;
  }
  return Object.values(node).some(value => _hasDirectives(value, visited));
}

