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

import {config} from '@bedrock/core';
import jsYaml from 'js-yaml';
import {logger} from './logger.js';

const namespace = 'config-yaml';

const KINDS = ['mapping', 'scalar', 'sequence'];
const NAME_REGEX = /^[a-z][a-z0-9_-]*$/i;

// marks errors whose message may be surfaced to the caller; messages produced
// by this module name only transformers and config paths, never config values
const SAFE_ERROR = Symbol('safeError');

// registered transformers, by name
const transformers = new Map();

// set once the `app` config has been applied; registering after that point is
// a module import ordering mistake and would silently have no effect
let locked = false;

/**
 * A transformer directive parsed from a YAML config. Instances stand in for
 * the transformed value until they are resolved; `jsYaml.load` is synchronous
 * and cannot await a transformer.
 */
class TransformDirective {
  constructor({name, kind, value}) {
    this.name = name;
    this.kind = kind;
    this.value = value;
  }
}

/**
 * An error thrown by a transformer, whose message is safe to include in the
 * startup error because it names only the transformer, its options, and the
 * config path. Transformers that throw any other error get a generic message
 * so that provider errors quoting secret material cannot escape.
 */
export class TransformError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'TransformError';
    this[SAFE_ERROR] = true;
  }
}

// one multi-type per YAML node kind captures every local (`!name`) tag. Names
// are checked against the allow list when the directive is resolved, so an
// unknown or disallowed transformer produces a precise error instead of a
// js-yaml parse error that may quote surrounding config content. Tags that are
// not local, such as `!!js/function`, are not captured and continue to be
// rejected by js-yaml itself.
const schema = jsYaml.DEFAULT_SCHEMA.extend(KINDS.map(kind => new jsYaml.Type(
  '!', {
    kind,
    multi: true,
    instanceOf: TransformDirective,
    construct: (value, tag) => new TransformDirective({
      name: tag.slice(1), kind, value
    })
  })));

/**
 * Registers a config value transformer, making its tag available to YAML
 * configs. A transformer must also be named in the
 * `config-yaml.transformers.allow` config before it may be used; registering
 * makes a transformer available, the allow list enables it.
 *
 * Transformers must be registered before `@bedrock/config-yaml` applies the
 * `app` config, which in practice means at module import time.
 *
 * @param {object} options - The options to use.
 * @param {string} options.name - The transformer name, used as the YAML tag,
 *   e.g. `secret` for `!secret`.
 * @param {Function} options.transform - Called as
 *   `transform({value, name, kind, path, configType, signal})` with the
 *   already-resolved YAML node value; may be async and may return any
 *   YAML-able value.
 * @param {Array<string>} [options.kinds=['scalar']] - The YAML node kinds the
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
 * unresolved.
 *
 * @param {string} content - The YAML to parse.
 *
 * @returns {*} - The parsed config.
 */
export function parseConfig(content) {
  return jsYaml.load(content, {schema});
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
  if(!(_isPlainObject(configYaml) && _isPlainObject(configYaml[namespace]))) {
    return undefined;
  }
  const settings = configYaml[namespace].transformers;
  if(settings === undefined) {
    return undefined;
  }
  // resolving these would require the settings they are meant to establish
  if(_hasDirectives(settings)) {
    throw _safeError(
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

  const {allow, timeout, cache} = _getSettings();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  // never hold the process open on the timeout alone
  timer.unref?.();

  const ctx = {
    allow,
    configType,
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
      new Promise((resolve, reject) => {
        controller.signal.addEventListener('abort', () => reject(_safeError(
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
 * Returns an error's message if it is safe to surface, otherwise a fallback.
 * Errors raised while loading a config must never quote config content.
 *
 * @param {Error} error - The error.
 * @param {string} fallback - The message to use for unsafe errors.
 *
 * @returns {string} - The message.
 */
export function safeMessage(error, fallback) {
  return error?.[SAFE_ERROR] ? error.message : fallback;
}

/**
 * Creates an error whose message may be surfaced to the caller. Callers are
 * responsible for keeping config values out of the message.
 *
 * @param {string} message - The message.
 * @param {Error} [cause] - The underlying error, for debug logging only.
 *
 * @returns {Error} - The error.
 */
export function safeError(message, cause) {
  return _safeError(message, cause);
}

async function _resolveNode({node, path, ctx}) {
  if(node instanceof TransformDirective) {
    return _memoize(ctx.seen, node,
      () => _resolveDirective({directive: node, path, ctx}));
  }
  if(Array.isArray(node)) {
    return _memoize(ctx.seen, node, () => Promise.all(node.map(
      (value, index) => _resolveNode({
        node: value, path: `${path}[${index}]`, ctx
      }))));
  }
  if(_isPlainObject(node)) {
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

async function _resolveDirective({directive, path, ctx}) {
  const {name, kind} = directive;
  const location = path || '(root)';

  const transformer = transformers.get(name);
  if(!transformer) {
    throw _safeError(`unknown config transformer "!${name}" at "${location}"`);
  }
  if(!(ctx.allow === true || (Array.isArray(ctx.allow) &&
    ctx.allow.includes(name)))) {
    throw _safeError(
      `config transformer "!${name}" at "${location}" is not allowed; add it ` +
      `to the "${namespace}.transformers.allow" config`);
  }
  if(!transformer.kinds.includes(kind)) {
    throw _safeError(
      `config transformer "!${name}" at "${location}" does not accept a ` +
      `${kind} value`);
  }

  // resolve any nested directives first so transformers always receive fully
  // resolved input
  const value = await _resolveNode({node: directive.value, path, ctx});

  const key = ctx.cache && _cacheKey({name, value});
  if(key !== null && ctx.cache.has(key)) {
    return ctx.cache.get(key);
  }

  const promise = (async () => {
    try {
      return await transformer.transform({
        value, name, kind, path: location,
        configType: ctx.configType, signal: ctx.signal
      });
    } catch(e) {
      // the underlying error may quote the value it failed on, so it is logged
      // rather than thrown
      logger.debug(
        `Config transformer "${name}" failed at "${location}".`, {error: e});
      throw _safeError(
        safeMessage(e, `config transformer "!${name}" failed at "${location}"`),
        e);
    }
  })();

  if(key !== null) {
    ctx.cache.set(key, promise);
  }
  return promise;
}

// memoizes by node identity, recording the entry before resolving it so that
// a self-referential YAML alias cannot recurse without bound
function _memoize(map, node, fn) {
  const existing = map.get(node);
  if(existing !== undefined) {
    return existing;
  }
  let settle;
  const promise = new Promise((resolve, reject) => {
    settle = {resolve, reject};
  });
  map.set(node, promise);
  Promise.resolve().then(fn).then(settle.resolve, settle.reject);
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

function _getSettings() {
  const cfg = config[namespace]?.transformers ?? {};
  return {
    allow: cfg.allow === true ? true : (cfg.allow ?? []),
    timeout: cfg.timeout ?? 30000,
    cache: cfg.cache !== false
  };
}

function _hasDirectives(node, visited = new Set()) {
  if(node instanceof TransformDirective) {
    return true;
  }
  if(!(Array.isArray(node) || _isPlainObject(node)) || visited.has(node)) {
    return false;
  }
  visited.add(node);
  return Object.values(node).some(value => _hasDirectives(value, visited));
}

function _isPlainObject(x) {
  if(x === null || typeof x !== 'object') {
    return false;
  }
  const proto = Object.getPrototypeOf(x);
  return proto === Object.prototype || proto === null;
}

function _safeError(message, cause) {
  const error = cause === undefined ?
    new Error(message) : new Error(message, {cause});
  error[SAFE_ERROR] = true;
  return error;
}
