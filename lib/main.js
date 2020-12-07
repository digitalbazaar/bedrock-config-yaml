/*!
 * Copyright (c) 2020 Digital Bazaar, Inc. All rights reserved.
 */
import bedrock from 'bedrock';
const {config, util: {extend}} = bedrock;
import fs from 'fs';
import jsYaml from 'js-yaml';
import logger from './logger.js';
import path from 'path';

import './config.js';

const namespace = 'config-yaml';
const cfg = config[namespace];

bedrock.events.on('bedrock.configure', function applyConfig() {
  // ensure that bedrock-config-yaml is the last `bedrock.configure` handler
  const listeners = bedrock.events.listeners('bedrock.configure');
  if(listeners[listeners.length - 1] !== applyConfig) {
    throw new Error('"bedrock-config-yaml" must be the last import.');
  }

  // attempt to load the YAML file specified by the config
  const configFile = path.join(cfg.path, cfg.filename);
  if(fs.existsSync(configFile)) {
    logger.debug(`Loaded configuration "${configFile}".`);
    const configYaml = jsYaml.safeLoad(fs.readFileSync(configFile, 'utf8'));

    // params: deep, target, source
    extend(true, config, configYaml);
  } else {
    logger.debug(`Configuration not found "${configFile}".`);
  }
});
