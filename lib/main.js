/*!
 * Copyright (c) 2020-2021 Digital Bazaar, Inc. All rights reserved.
 */
import bedrock from 'bedrock';
const {config, util: {extend}} = bedrock;
import fs from 'fs/promises';
import jsYaml from 'js-yaml';
import logger from './logger.js';
import path from 'path';
import gcpSecretConfig from './gcp-secret-config.js';

import './config.js';

const namespace = 'config-yaml';
const cfg = config[namespace];

bedrock.events.on('bedrock-cli.parsed', async function applyConfig() {
  // ensure that bedrock-config-yaml is the last `bedrock-cli.parsed` handler
  const listeners = bedrock.events.listeners('bedrock-cli.parsed');
  if(listeners[listeners.length - 1] !== applyConfig) {
    throw new Error('"bedrock-config-yaml" must be the last import.');
  }

  await _applyAllConfigs({configType: 'core'});
});

bedrock.events.on('bedrock.configure', async function applyConfig() {
  // ensure that bedrock-config-yaml is the last `bedrock.configure` handler
  const listeners = bedrock.events.listeners('bedrock.configure');
  if(listeners[listeners.length - 1] !== applyConfig) {
    throw new Error('"bedrock-config-yaml" must be the last import.');
  }

  await _applyAllConfigs({configType: 'app'});
});

async function _applyAllConfigs({configType}) {
  let configYaml = await _getFileConfig({configType});
  _applyConfig({configYaml});
  configYaml = await gcpSecretConfig.getConfig({configType});
  _applyConfig({configYaml});
}

function _applyConfig({configYaml}) {
  if(!configYaml) {
    return;
  }
  // params: deep, target, source
  extend(true, config, configYaml);
}

async function _fileExists(configFile) {
  try {
    await fs.stat(configFile);
    return true;
  } catch(e) {
    return false;
  }
}

async function _getFileConfig({configType}) {
  logger.debug(`Attempting to apply the "${configType}" configuration.`);
  // attempt to load the YAML file specified by the config
  const types = ['combined', configType];
  const returnConfig = {};
  for(const type of types) {
    const configFile = path.join(cfg[type].path, cfg[type].filename);
    if(await _fileExists(configFile)) {
      logger.debug(`"${type}" configuration found "${configFile}".`);
      let configYaml = jsYaml.safeLoad(await fs.readFile(configFile, 'utf8'));

      // apply the combined config if it contains a section
      // that corresponds to `configType`
      if(type === 'combined' && configYaml[configType]) {
        configYaml = configYaml[configType];
      }

      extend(true, returnConfig, configYaml);
    } else {
      logger.debug(`"${type}" configuration not found "${configFile}".`);
    }
  }

  return returnConfig;
}
