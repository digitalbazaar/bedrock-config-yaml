/*!
 * Copyright (c) 2020-2022 Digital Bazaar, Inc. All rights reserved.
 */
import * as bedrock from '@bedrock/core';
import fs from 'node:fs';
import jsYaml from 'js-yaml';
import {logger} from './logger.js';
import path from 'node:path';

import './config.js';

const {config} = bedrock;

const namespace = 'config-yaml';
const cfg = config[namespace];

bedrock.events.on('bedrock-cli.parsed', function applyConfig() {
  // ensure that bedrock-config-yaml is the last `bedrock-cli.parsed` handler
  const listeners = bedrock.events.listeners('bedrock-cli.parsed');
  if(listeners[listeners.length - 1] !== applyConfig) {
    throw new Error('"bedrock-config-yaml" must be the last import.');
  }

  if(!process.env.BEDROCK_CONFIG) {
    _applyConfig({configType: 'core'});
  }
});

bedrock.events.on('bedrock.configure', function applyConfig() {
  // ensure that bedrock-config-yaml is the last `bedrock.configure` handler
  const listeners = bedrock.events.listeners('bedrock.configure');
  if(listeners[listeners.length - 1] !== applyConfig) {
    throw new Error('"bedrock-config-yaml" must be the last import.');
  }

  if(process.env.BEDROCK_CONFIG) {
    applyConfigFromEnv();
  } else {
    _applyConfig({configType: 'app'});
  }
});

export function applyConfigFromEnv() {
  const configYaml = jsYaml.load(
    Buffer.from(process.env.BEDROCK_CONFIG, 'base64').toString()
  );
  _extend(true, config, configYaml);
}

function _applyConfig({configType}) {
  logger.debug(`Attempting to apply the "${configType}" configuration.`);
  // attempt to load the YAML file specified by the config
  const types = ['combined', configType];
  for(const type of types) {
    const configFile = path.join(cfg[type].path, cfg[type].filename);
    if(fs.existsSync(configFile)) {
      logger.debug(`"${type}" configuration found "${configFile}".`);
      let configYaml = jsYaml.safeLoad(fs.readFileSync(configFile, 'utf8'));

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
